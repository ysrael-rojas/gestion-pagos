// e2e de la conciliacion bancaria del vertical de cajas-bancos (C7) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que la ESCRITURA es la RPC `public.save_bank_reconciliation` (upsert
// sobre el triplete exacto `(cash_account_id, period_start, period_end)` + reemplazo de partidas)
// y que la LECTURA la hace el API con Drizzle porque no hay vista ni RPC de lectura, con las ocho
// reglas de dominio de la RPC llegando a HTTP con su mensaje textual:
//
//   - 401 en las tres rutas antes de validar el body o la query;
//   - POST responde 201 con la fila RELEIDA (cabecera + partidas en la misma transaccion), nunca
//     el id solo: `numeric` -> number, `date` -> "YYYY-MM-DD", `updatedAt` -> ISO;
//   - GET por triplete exacto: el mismo objeto, y `null` LITERAL cuando no hay conciliacion para
//     ese periodo (un periodo sin conciliar es un estado normal, no un 404);
//   - el segundo POST del mismo triplete NO crea otra fila: actualiza la cabecera y reemplaza las
//     partidas (delete-then-insert de la RPC), y `updatedAt` avanza;
//   - cada una de las ocho reglas de dominio de la RPC (`P0001`) responde su mensaje EXACTO y no
//     deja fila ni partidas: se re-lee la base despues del rechazo;
//   - solo se concilian cuentas bancarias: una CASH_BOX existente del mismo dueno se rechaza con
//     `Solo se concilian cuentas bancarias` (no es "la cuenta no existe");
//   - aislamiento por dueno en las DOS direcciones: el detalle ajeno responde 404, el triplete
//     ajeno responde `null` y la cuenta ajena no se puede conciliar (404 con el mismo texto para
//     "no existe" y "es de otro", para no filtrar la existencia de cuentas ajenas).
//
// NADA DE ARITMETICA ACA: la respuesta NO incluye `difference` ni `reconciledBalance`. Ese calculo
// es el helper de display de la web (`computeReconciliation`, tolerancia de un centimo) y no lo
// persiste la RPC; recalcularlo en el API o "validar" con el seria duplicar el formato oficial en
// el borde (S2 del vertical: el dinero lo calcula la base y lo que no calcula la base no se
// inventa aca).
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: salen de la API server-side de Better Auth (`signUpEmail`), igual que en
// `cash-closes.e2e.test.ts` y `cash-transfers.e2e.test.ts`.
//
// FECHAS: fijas y pasadas (`2026-02-01..2026-02-28` y `2026-01-01..2026-01-31`), no "hoy", para no
// depender de la zona horaria del contenedor.
//
// `deleteOwnerFixtures` NO borra `bank_reconciliation` (deuda L5 del doc de la feature: C8 la
// lleva al teardown comun), asi que este archivo borra sus conciliaciones antes de llamarlo. Sin
// eso el borrado de `cash_account` revienta por FK (`bank_reconciliation_cash_account_id_fkey`).
// Las partidas cuelgan con `on delete cascade`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import { deleteOwnerFixtures, signUpSecondOwner, type OwnerSession } from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Periodo que se concilia en casi todos los tests. */
const PERIOD_START = "2026-02-01";
const PERIOD_END = "2026-02-28";

/** Otro periodo de la MISMA cuenta: sin conciliacion, para el `null` literal. */
const OTHER_START = "2026-01-01";
const OTHER_END = "2026-01-31";

/** Las tres rutas con una entrada valida, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{
		method: "GET",
		path: `/bank-reconciliations?accountId=${randomUUID()}&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`,
	},
	{ method: "GET", path: `/bank-reconciliations/${randomUUID()}` },
	{
		method: "POST",
		path: "/bank-reconciliations",
		body: {
			accountId: randomUUID(),
			periodStart: PERIOD_START,
			periodEnd: PERIOD_END,
			statementBalance: 0,
			booksBalance: 0,
			items: [],
		},
	},
];

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las cuentas que se concilian. */
let owner: OwnerSession;
/** Otro dueno: prueba el aislamiento en las dos direcciones. */
let intruder: OwnerSession;

interface SeededAccounts {
	/** Cuenta bancaria del camino feliz y del upsert. */
	bank: string;
	/** Cuenta bancaria sin conciliaciones: los rechazos de partidas y el `null` literal. */
	secondBank: string;
	/** Caja de efectivo del mismo dueno: la regla "solo cuentas bancarias". */
	box: string;
}

let accounts: SeededAccounts;
let intruderAccounts: SeededAccounts;

/** Id de la conciliacion creada en el test del camino feliz. */
let savedId: string;
/** `updatedAt` del alta: el upsert tiene que moverlo (trigger `bank_reconciliation_set_updated_at`). */
let savedUpdatedAt: string;

interface ApiResult {
	status: number;
	// biome-ignore lint/suspicious/noExplicitAny: el cuerpo varia por endpoint en las aserciones.
	body: any;
	/** Cuerpo crudo: es lo unico que distingue un `null` literal de un cuerpo vacio. */
	text: string;
}

async function call(
	method: string,
	path: string,
	options: { cookie?: string; body?: unknown } = {},
): Promise<ApiResult> {
	const headers: Record<string, string> = {};

	if (options.cookie) headers.cookie = options.cookie;
	if (options.body !== undefined) headers["content-type"] = "application/json";

	const response = await fetch(`${harness.url}${path}`, {
		method,
		headers,
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const text = await response.text();

	return { status: response.status, body: text ? JSON.parse(text) : null, text };
}

/** Query del triplete exacto, tal como la manda la pantalla de conciliacion. */
function triplePath(accountId: string, periodStart: string, periodEnd: string): string {
	return `/bank-reconciliations?accountId=${accountId}&periodStart=${periodStart}&periodEnd=${periodEnd}`;
}

/** Filas de `bank_reconciliation` de una cuenta (SQL como `dev_user`), con sus partidas. */
async function stored(accountId: string): Promise<{ rows: number; items: number }> {
	const result = await pool.query<{ rows: number; items: number }>(
		`select (select count(*)::int from public.bank_reconciliation where cash_account_id = $1) as rows,
		        (select count(*)::int
		           from public.bank_reconciliation_item i
		           join public.bank_reconciliation r on r.id = i.reconciliation_id
		          where r.cash_account_id = $1) as items`,
		[accountId],
	);

	return result.rows[0] as unknown as { rows: number; items: number };
}

/** Partidas persistidas de una conciliacion, para probar que el upsert las reemplazo. */
async function storedItems(reconciliationId: string): Promise<string[]> {
	const result = await pool.query<{ description: string }>(
		"select description from public.bank_reconciliation_item where reconciliation_id = $1 order by description",
		[reconciliationId],
	);

	return result.rows.map((row) => row.description);
}

/**
 * Siembra dos cuentas bancarias y una caja para un dueno, con SQL directo como `dev_user`.
 *
 * Tres cuentas y no una: los rechazos de la RPC no deben dejar rastro en la cuenta del camino
 * feliz, y la caja existe para que `Solo se concilian cuentas bancarias` no se pueda confundir con
 * `La cuenta no existe`.
 */
async function seedAccounts(pool: Pool, ownerId: string, tag: string): Promise<SeededAccounts> {
	const ids: SeededAccounts = {
		bank: randomUUID(),
		secondBank: randomUUID(),
		box: randomUUID(),
	};

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, bank_name, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'BANK_ACCOUNT', $2, 'PEN', 'BCP', 0, '2026-01-01'::date, $6),
		        ($3, 'BANK_ACCOUNT', $4, 'PEN', 'Interbank', 0, '2026-01-01'::date, $6),
		        ($5, 'CASH_BOX', $7, 'PEN', null, 0, '2026-01-01'::date, $6)`,
		[
			ids.bank,
			`E2E banco ${tag}`,
			ids.secondBank,
			`E2E banco 2 ${tag}`,
			ids.box,
			ownerId,
			`E2E caja ${tag}`,
		],
	);

	return ids;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de conciliacion corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-conciliacion-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await signUpSecondOwner(harness.auth);
	intruder = await signUpSecondOwner(harness.auth);

	accounts = await seedAccounts(pool, owner.ownerId, "conciliacion");
	intruderAccounts = await seedAccounts(pool, intruder.ownerId, "ajena");
});

after(async () => {
	for (const session of [owner, intruder]) {
		if (session) {
			// Deuda L5: `deleteOwnerFixtures` no conoce estas tablas todavia (C8 las lleva).
			await pool.query("delete from public.bank_reconciliation where owner_id = $1", [
				session.ownerId,
			]);
			await deleteOwnerFixtures(pool, session.ownerId);
		}
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las rutas de conciliacion responden 401 antes de validar nada", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// Un body invalido sin sesion sigue siendo 401: la guardia corre antes del pipe.
	const invalid = await call("POST", "/bank-reconciliations", {
		body: { accountId: "no-es-uuid", periodEnd: "ayer", items: [{ kind: 1 }] },
	});

	assert.equal(invalid.status, 401);

	const forged = await call("GET", triplePath(randomUUID(), PERIOD_START, PERIOD_END), {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("POST /bank-reconciliations devuelve la fila releida y GET la devuelve igual por el triplete exacto", async () => {
	const created = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.bank,
			periodStart: PERIOD_START,
			periodEnd: PERIOD_END,
			statementBalance: 1234.56,
			booksBalance: 1200.5,
			preparedBy: "Ana Rios",
			reviewedBy: "Luis Torres",
			notes: "conciliacion de febrero",
			items: [
				{ kind: "DEPOSITO_EN_TRANSITO", description: "Deposito del 27", amount: 150.75 },
				{ kind: "CARGO_NO_REGISTRADO", description: "Comision del banco", amount: 12.25 },
			],
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	savedId = created.body.id;
	savedUpdatedAt = created.body.updatedAt;

	assert.equal(typeof savedId, "string");
	assert.deepEqual(
		Object.keys(created.body).sort(),
		[
			"accountId",
			"booksBalance",
			"id",
			"items",
			"notes",
			"periodEnd",
			"periodStart",
			"preparedBy",
			"reviewedBy",
			"statementBalance",
			"updatedAt",
		],
		"el contrato es el del origen: cabecera + partidas, sin campos calculados",
	);

	assert.equal(created.body.accountId, accounts.bank);
	assert.equal(created.body.periodStart, PERIOD_START, "date -> YYYY-MM-DD sin corrimiento");
	assert.equal(created.body.periodEnd, PERIOD_END);
	assert.equal(created.body.statementBalance, 1234.56, "numeric -> number");
	assert.equal(created.body.booksBalance, 1200.5);
	assert.equal(created.body.preparedBy, "Ana Rios");
	assert.equal(created.body.reviewedBy, "Luis Torres");
	assert.equal(created.body.notes, "conciliacion de febrero");
	assert.match(
		created.body.updatedAt,
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
		"timestamptz -> ISO string",
	);

	// Las partidas: mismos campos que el origen (`id`, `kind`, `description`, `amount`).
	assert.equal(created.body.items.length, 2);
	assert.deepEqual(
		created.body.items
			.map((item: { id: string; kind: string; description: string; amount: number }) => ({
				kind: item.kind,
				description: item.description,
				amount: item.amount,
			}))
			.sort((left: { amount: number }, right: { amount: number }) => left.amount - right.amount),
		[
			{ kind: "CARGO_NO_REGISTRADO", description: "Comision del banco", amount: 12.25 },
			{ kind: "DEPOSITO_EN_TRANSITO", description: "Deposito del 27", amount: 150.75 },
		],
	);

	for (const item of created.body.items) {
		assert.equal(typeof item.id, "string");
	}

	// La lectura por id y la lectura por triplete devuelven lo mismo que el POST.
	const byId = await call("GET", `/bank-reconciliations/${savedId}`, { cookie: owner.cookie });

	assert.equal(byId.status, 200);
	assert.deepEqual(byId.body, created.body);

	const byTriple = await call("GET", triplePath(accounts.bank, PERIOD_START, PERIOD_END), {
		cookie: owner.cookie,
	});

	assert.equal(byTriple.status, 200);
	assert.deepEqual(byTriple.body, created.body);

	// Y lo persistido es una cabecera con sus dos partidas.
	assert.deepEqual(await stored(accounts.bank), { rows: 1, items: 2 });
});

test("un segundo POST del mismo triplete actualiza la cabecera y reemplaza las partidas (upsert)", async () => {
	const updated = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.bank,
			periodStart: PERIOD_START,
			periodEnd: PERIOD_END,
			statementBalance: 999.99,
			booksBalance: 900,
			preparedBy: "Ana Rios",
			notes: "corregida",
			items: [{ kind: "ABONO_NO_REGISTRADO", description: "Interes ganado", amount: 5.5 }],
		},
	});

	assert.equal(updated.status, 201, JSON.stringify(updated.body));
	assert.equal(updated.body.id, savedId, "el upsert conserva el id: no hay una segunda fila");
	assert.equal(updated.body.statementBalance, 999.99);
	assert.equal(updated.body.booksBalance, 900);
	assert.equal(updated.body.notes, "corregida");
	assert.equal(updated.body.reviewedBy, null, "la cabecera se reemplaza entera");
	assert.equal(updated.body.items.length, 1, "las partidas se reemplazan, no se acumulan");
	assert.deepEqual(
		updated.body.items.map((item: { kind: string; description: string; amount: number }) => ({
			kind: item.kind,
			description: item.description,
			amount: item.amount,
		})),
		[{ kind: "ABONO_NO_REGISTRADO", description: "Interes ganado", amount: 5.5 }],
	);
	assert.ok(
		updated.body.updatedAt >= savedUpdatedAt,
		`el upsert mueve updatedAt (antes ${savedUpdatedAt}, ahora ${updated.body.updatedAt})`,
	);

	assert.deepEqual(await stored(accounts.bank), { rows: 1, items: 1 }, "una fila, una partida");
	assert.deepEqual(await storedItems(savedId), ["Interes ganado"], "la partida vieja ya no esta");

	// Y la lectura ve la version nueva.
	const byTriple = await call("GET", triplePath(accounts.bank, PERIOD_START, PERIOD_END), {
		cookie: owner.cookie,
	});

	assert.equal(byTriple.status, 200);
	assert.equal(byTriple.body.id, savedId);
	assert.equal(byTriple.body.statementBalance, 999.99);
	assert.equal(byTriple.body.items.length, 1);
});

test("sin conciliacion para ese periodo la lectura responde 200 con un null LITERAL (no 404)", async () => {
	const missing = await call("GET", triplePath(accounts.secondBank, PERIOD_START, PERIOD_END), {
		cookie: owner.cookie,
	});

	assert.equal(missing.status, 200, "un periodo sin conciliar es un estado normal, no un 404");
	assert.equal(missing.text, "null", "el cuerpo es el JSON literal `null`");
	assert.equal(missing.body, null);

	// Un periodo distinto de una cuenta YA conciliada tampoco es una lectura parcial: es `null`.
	const otherPeriod = await call("GET", triplePath(accounts.bank, OTHER_START, OTHER_END), {
		cookie: owner.cookie,
	});

	assert.equal(otherPeriod.status, 200);
	assert.equal(otherPeriod.text, "null", "el match es el triplete exacto, no un rango");
});

test("las ocho reglas de dominio de la RPC llegan a HTTP con su mensaje exacto y sin escribir nada", async () => {
	// El orden de los `raise exception` de `save_bank_reconciliation` es: cuenta, cuenta
	// existente/visible, tipo, periodo, saldos y partidas. Cada caso satisface las anteriores.
	const valid = {
		accountId: accounts.secondBank,
		periodStart: PERIOD_START,
		periodEnd: PERIOD_END,
		statementBalance: 100,
		booksBalance: 100,
		// Obligatorio desde el hardening de C7: sin `items` el borde responde 400 y el caso nunca
		// llegaria a la RPC, que es justo lo que este test quiere ejercitar.
		items: [],
	};

	const cases: Array<{
		name: string;
		body: Record<string, unknown>;
		status: number;
		message: string;
	}> = [
		{
			name: "sin cuenta",
			body: { periodStart: PERIOD_START, periodEnd: PERIOD_END, items: [] },
			status: 400,
			message: "Indica la cuenta bancaria a conciliar",
		},
		{
			name: "cuenta inexistente",
			body: { ...valid, accountId: randomUUID() },
			status: 404,
			message: "La cuenta no existe",
		},
		{
			name: "cuenta de caja (solo cuentas bancarias)",
			body: { ...valid, accountId: accounts.box },
			status: 400,
			message: "Solo se concilian cuentas bancarias",
		},
		{
			name: "periodo invertido",
			body: { ...valid, periodStart: PERIOD_END, periodEnd: PERIOD_START },
			status: 400,
			message: "El período de la conciliación no es válido",
		},
		{
			name: "sin saldos",
			body: {
				accountId: accounts.secondBank,
				periodStart: PERIOD_START,
				periodEnd: PERIOD_END,
				items: [],
			},
			status: 400,
			message: "Indica el saldo según extracto y el saldo según registros",
		},
		{
			name: "partida con clase invalida",
			body: {
				...valid,
				items: [{ kind: "NO_EXISTE", description: "x", amount: 1 }],
			},
			status: 400,
			message: "Hay una partida con una clase o un monto inválido",
		},
		{
			name: "partida con monto invalido",
			body: {
				...valid,
				items: [{ kind: "DEPOSITO_EN_TRANSITO", description: "x", amount: "no-es-numero" }],
			},
			status: 400,
			message: "Hay una partida con una clase o un monto inválido",
		},
		{
			name: "partida sin descripcion",
			body: {
				...valid,
				items: [{ kind: "DEPOSITO_EN_TRANSITO", description: "   ", amount: 1 }],
			},
			status: 400,
			message: "Cada partida necesita una descripción",
		},
		{
			name: "partida con monto cero",
			body: {
				...valid,
				items: [{ kind: "DEPOSITO_EN_TRANSITO", description: "x", amount: 0 }],
			},
			status: 400,
			message: "El monto de cada partida debe ser mayor a cero",
		},
	];

	// La caja existe de verdad: el rechazo del tipo no es "la cuenta no existe" disfrazado.
	const box = await pool.query<{ type: string }>(
		"select type::text from public.cash_account where id = $1",
		[accounts.box],
	);

	assert.equal(box.rows[0]?.type, "CASH_BOX");

	for (const testCase of cases) {
		const result = await call("POST", "/bank-reconciliations", {
			cookie: owner.cookie,
			body: testCase.body,
		});

		assert.equal(
			result.status,
			testCase.status,
			`${testCase.name}: esperaba ${testCase.status}, respondio ${result.status} ${JSON.stringify(result.body)}`,
		);
		assert.equal(
			result.body.message,
			testCase.message,
			`${testCase.name}: el mensaje de la RPC viaja textual`,
		);

		// El rechazo no dejo nada: ni cabecera, ni partidas, ni una fila a medias.
		assert.deepEqual(
			await stored(accounts.secondBank),
			{ rows: 0, items: 0 },
			`${testCase.name}: el rechazo no puede escribir`,
		);

		const stillMissing = await call(
			"GET",
			triplePath(accounts.secondBank, PERIOD_START, PERIOD_END),
			{ cookie: owner.cookie },
		);

		assert.equal(stillMissing.text, "null", `${testCase.name}: la relectura sigue vacia`);
	}
});

test("el aislamiento por dueno vale para la lectura y para la escritura (S6)", async () => {
	// El otro dueno concilia SU cuenta: la fila existe, pero no para el dueno de la sesion.
	const foreign = await call("POST", "/bank-reconciliations", {
		cookie: intruder.cookie,
		body: {
			accountId: intruderAccounts.bank,
			periodStart: PERIOD_START,
			periodEnd: PERIOD_END,
			statementBalance: 55.5,
			booksBalance: 55.5,
			notes: "conciliacion ajena",
			items: [{ kind: "PAGO_NO_DEBITADO", description: "Cheque girado", amount: 20 }],
		},
	});

	assert.equal(foreign.status, 201, JSON.stringify(foreign.body));

	// 1) El detalle ajeno responde 404 con el mismo texto que un id inexistente.
	const detail = await call("GET", `/bank-reconciliations/${foreign.body.id}`, {
		cookie: owner.cookie,
	});

	assert.equal(detail.status, 404);
	assert.equal(detail.body.message, "La conciliación no existe.");
	assert.ok(
		!JSON.stringify(detail.body).includes("conciliacion ajena"),
		"no debe viajar ningun dato de la conciliacion ajena",
	);

	// 2) El triplete ajeno no devuelve la fila ajena: `null`, no 404 y no datos.
	const triple = await call(
		"GET",
		triplePath(intruderAccounts.bank, PERIOD_START, PERIOD_END),
		{ cookie: owner.cookie },
	);

	assert.equal(triple.status, 200);
	assert.equal(triple.text, "null", "la RLS hace invisible la fila ajena");

	// 3) La cuenta ajena no se puede conciliar, y el rechazo no toca la fila ajena.
	const attempt = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: intruderAccounts.bank,
			periodStart: PERIOD_START,
			periodEnd: PERIOD_END,
			statementBalance: 1,
			booksBalance: 1,
			items: [],
		},
	});

	assert.equal(attempt.status, 404, JSON.stringify(attempt.body));
	assert.equal(attempt.body.message, "La cuenta no existe");

	// La fila ajena sigue exactamente como la dejo su dueno.
	const stillOwned = await call("GET", `/bank-reconciliations/${foreign.body.id}`, {
		cookie: intruder.cookie,
	});

	assert.equal(stillOwned.status, 200);
	assert.deepEqual(stillOwned.body, foreign.body);
	assert.deepEqual(await stored(intruderAccounts.bank), { rows: 1, items: 1 });

	// Y el dueno de la sesion sigue pudiendo conciliar su propia cuenta bancaria.
	const own = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.secondBank,
			periodStart: PERIOD_START,
			periodEnd: PERIOD_END,
			statementBalance: 10,
			booksBalance: 10,
			items: [],
		},
	});

	assert.equal(own.status, 201, JSON.stringify(own.body));
	assert.deepEqual(await stored(accounts.secondBank), { rows: 1, items: 0 });
});

test("las rutas de conciliacion validan la query y el id con el pipe de Zod", async () => {
	const cases = [
		`/bank-reconciliations?accountId=no-es-uuid&periodStart=${PERIOD_START}&periodEnd=${PERIOD_END}`,
		`/bank-reconciliations?accountId=${accounts.bank}&periodStart=2026-2-1&periodEnd=${PERIOD_END}`,
		`/bank-reconciliations?accountId=${accounts.bank}&periodStart=${PERIOD_START}`,
		"/bank-reconciliations/no-es-uuid",
	];

	for (const path of cases) {
		const result = await call("GET", path, { cookie: owner.cookie });

		assert.equal(result.status, 400, `${path} deberia responder 400`);
	}
});

// Este test y el siguiente son la REGRESION de lo que encontro la verificacion independiente del
// slice: `items` opcional con `default([])` hacia que un POST de solo encabezado llegara a la RPC
// con `p_items = '[]'`, y la RPC borra y reinserta — el acta quedaba vacida con un 201.
test("POST sin items responde 400 y deja el acta guardada intacta", async () => {
	const OTHER_START = "2025-11-01";
	const OTHER_END = "2025-11-30";
	const before = await stored(accounts.secondBank);

	const created = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.secondBank,
			periodStart: OTHER_START,
			periodEnd: OTHER_END,
			statementBalance: 100,
			booksBalance: 100,
			items: [{ kind: "DEPOSITO_EN_TRANSITO", description: "Deposito pendiente", amount: 10 }],
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.deepEqual(await stored(accounts.secondBank), {
		rows: before.rows + 1,
		items: before.items + 1,
	});

	// El caso del defecto: el encabezado solo, sin `items`.
	const withoutItems = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.secondBank,
			periodStart: OTHER_START,
			periodEnd: OTHER_END,
			statementBalance: 100,
			booksBalance: 100,
			preparedBy: "Otra persona",
		},
	});

	assert.equal(withoutItems.status, 400, JSON.stringify(withoutItems.body));
	assert.deepEqual(
		await stored(accounts.secondBank),
		{ rows: before.rows + 1, items: before.items + 1 },
		"la partida tiene que seguir ahi: el rechazo no puede haber vaciado el acta",
	);

	// Y el acta vacia a proposito sigue siendo valida: el campo es obligatorio, no no-vacio.
	const emptyOnPurpose = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.secondBank,
			periodStart: OTHER_START,
			periodEnd: OTHER_END,
			statementBalance: 100,
			booksBalance: 100,
			items: [],
		},
	});

	assert.equal(emptyOnPurpose.status, 201, JSON.stringify(emptyOnPurpose.body));
	assert.deepEqual(await stored(accounts.secondBank), {
		rows: before.rows + 1,
		items: before.items,
	});
});

test("una fecha que no existe en el calendario responde 400 y no llega a la base", async () => {
	const before = await stored(accounts.bank);

	const impossible = await call("POST", "/bank-reconciliations", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.bank,
			periodStart: "2026-02-31",
			periodEnd: PERIOD_END,
			statementBalance: 100,
			booksBalance: 100,
			items: [],
		},
	});

	// Sin la regla del calendario esto llegaba al `::date` y salia un 500 por SQLSTATE 22008.
	assert.equal(impossible.status, 400, JSON.stringify(impossible.body));
	assert.deepEqual(await stored(accounts.bank), before, "no se escribe nada con una fecha imposible");
});
