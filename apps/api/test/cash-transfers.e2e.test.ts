// e2e de transferencias entre cuentas del vertical de cajas-bancos (C6) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que mover dinero entre dos cuentas es UNA llamada a
// `public.create_cash_transfer` (S8), que no escribe ningun `payment` y que todas las reglas las
// aplica PostgreSQL, no Node:
//
//   - 401 en las tres rutas nuevas antes de validar el body ni la query;
//   - el alta devuelve la fila RELEIDA de la base (`amount` numeric, `transferDate` "YYYY-MM-DD",
//     `createdAt` ISO) y NO crea ningun recibo de pago;
//   - el listado filtra `accountId` como origen O destino con `transfer_date` INCLUSIVE en los dos
//     bordes;
//   - origen igual a destino responde el mensaje de dominio de la RPC y no deja fila: la regla no
//     vive en el `superRefine` del schema compartido (se descarta a proposito, igual que en C4);
//   - una cuenta en USD la rechaza la RPC (`Solo se permiten transferencias entre cuentas en PEN`);
//   - un destino inexistente responde 404 con el mensaje de la base;
//   - la transferencia de otro dueno no se puede leer (404) ni usar como origen o destino (404), y
//     el rechazo no deja filas en la cuenta ajena;
//   - un INSERT directo en `cash_transfer` con el rol de la sesion muere con `42501`: la tabla
//     solo tiene politica de SELECT y la escritura es la RPC.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: salen de la API server-side de Better Auth (`signInEmail`, con el dueno creado por SQL), igual que en
// `cash-closes.e2e.test.ts`.
//
// FECHAS: fijas y pasadas (apertura `2026-03-01`), no "hoy", para no depender de la zona horaria
// del contenedor (la clase de bug de L9 del doc de la feature). La ventana del listado es
// `2026-03-06..2026-03-10` y las transferencias se siembran DENTRO (en los dos bordes) y FUERA de
// ella a proposito.
//
// `deleteOwnerFixtures` NO borra `cash_transfer` (deuda L5 del doc de la feature: C8 la lleva al
// teardown comun), asi que este archivo borra sus transferencias antes de llamarlo. Sin eso el
// borrado de `cash_account` revienta por FK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { withOwner } from "../src/db/with-owner.ts";
import type { ApiHarness } from "./support/harness.ts";
import {
	deleteOwnerFixtures,
	createSecondOwner,
	type OwnerSession,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Apertura de TODAS las cuentas del fixture: anterior a cualquier transferencia. */
const OPENING_DATE = "2026-03-01";

/** Fecha del alta del camino feliz: fuera (antes) de la ventana del listado, a proposito. */
const TRANSFER_DATE = "2026-03-05";

/** Ventana del listado: los dos bordes son INCLUSIVE y ninguna otra transferencia cae dentro. */
const WINDOW_FROM = "2026-03-06";
const WINDOW_TO = "2026-03-10";

/** Importe del alta del camino feliz: sin centavos, para comparar el numeric(12,2) sin ruido. */
const AMOUNT = 150;

/** Las tres rutas nuevas con una entrada valida, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: `/cash-transfers?accountId=${randomUUID()}&from=${WINDOW_FROM}&to=${WINDOW_TO}` },
	{ method: "GET", path: `/cash-transfers/${randomUUID()}` },
	{
		method: "POST",
		path: "/cash-transfers",
		body: {
			sourceAccountId: randomUUID(),
			targetAccountId: randomUUID(),
			amount: 10,
			transferDate: TRANSFER_DATE,
		},
	},
];

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las cuentas que se mueven. */
let owner: OwnerSession;
/** Otro dueno: prueba que su transferencia y sus cuentas son inalcanzables. */
let intruder: OwnerSession;

interface SeededAccounts {
	/** Caja en PEN con saldo: la punta de origen en casi todos los tests. */
	source: string;
	/** Caja en PEN vacia: la punta de destino y el sujeto del filtro por cuenta. */
	target: string;
	/** Tercera cuenta en PEN, para transferencias fuera de la ventana del listado. */
	other: string;
	/** Cuenta en USD: la unica moneda que la RPC rechaza por contrato. */
	usd: string;
}

let accounts: SeededAccounts;
let intruderAccounts: SeededAccounts;

/** Transferencia creada por el otro dueno: el dueno de la sesion no puede leerla. */
let intruderTransferId: string;

interface ApiResult {
	status: number;
	// biome-ignore lint/suspicious/noExplicitAny: el cuerpo varia por endpoint en las aserciones.
	body: any;
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

	return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Transferencias en las que la cuenta participa, leidas por SQL como `dev_user`. */
async function transferCount(accountId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		`select count(*)::int as n
		   from public.cash_transfer
		  where source_account_id = $1 or target_account_id = $1`,
		[accountId],
	);

	return result.rows[0]?.n ?? 0;
}

/** Todos los `payment` del dueno: una transferencia NO debe crear ninguno (S8). */
async function paymentCount(ownerId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.payment where owner_id = $1",
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

/** La fila cruda de una transferencia, en texto, para comparar contra lo que devolvio el API. */
async function storedTransfer(id: string): Promise<Record<string, string | null>> {
	const result = await pool.query<Record<string, string | null>>(
		`select source_account_id::text, target_account_id::text, amount::text,
		        transfer_date::text, notes, owner_id::text
		   from public.cash_transfer
		  where id = $1`,
		[id],
	);

	const row = result.rows[0];

	assert.ok(row, `deberia existir la transferencia ${id}`);

	return row;
}

/** Codigo SQLSTATE del error, mirando la cadena de `cause` (drizzle envuelve el original). */
function postgresCode(error: unknown): string | null {
	let current: unknown = error;

	for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth += 1) {
		const candidate = current as { code?: unknown; cause?: unknown };

		if (typeof candidate.code === "string") {
			return candidate.code;
		}

		current = candidate.cause;
	}

	return null;
}

/**
 * Siembra las cuatro cuentas de un dueno con SQL directo (como `dev_user`).
 *
 *   source  CASH_BOX PEN, apertura 500
 *   target  CASH_BOX PEN, apertura 0
 *   other   CASH_BOX PEN, apertura 0
 *   usd     BANK_ACCOUNT USD, apertura 0 (una cuenta bancaria necesita `bank_name` y una caja no
 *           puede tenerlo: `cash_account_bank_requires_name`)
 */
async function seedAccounts(pool: Pool, ownerId: string, tag: string): Promise<SeededAccounts> {
	const ids: SeededAccounts = {
		source: randomUUID(),
		target: randomUUID(),
		other: randomUUID(),
		usd: randomUUID(),
	};

	const boxes: Array<[string, number]> = [
		[ids.source, 500],
		[ids.target, 0],
		[ids.other, 0],
	];

	for (const [id, opening] of boxes) {
		await pool.query(
			`insert into public.cash_account
			   (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
			 values ($1, 'CASH_BOX', $2, 'PEN', $3, $4::date, $5)`,
			[id, `E2E caja ${tag} ${opening}`, opening, OPENING_DATE, ownerId],
		);
	}

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, bank_name, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'BANK_ACCOUNT', $2, 'USD', 'BCP', 0, $3::date, $4)`,
		[ids.usd, `E2E banco ${tag}`, OPENING_DATE, ownerId],
	);

	return ids;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de transferencias corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-transferencias-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await createSecondOwner(harness.pool, harness.auth);
	intruder = await createSecondOwner(harness.pool, harness.auth);

	accounts = await seedAccounts(pool, owner.ownerId, "transferencias");
	intruderAccounts = await seedAccounts(pool, intruder.ownerId, "ajeno");
});

after(async () => {
	// `cash_transfer` no esta en `deleteOwnerFixtures` (deuda L5): sin esta linea el borrado de
	// `cash_account` falla por FK.
	for (const session of [owner, intruder]) {
		if (session) {
			await pool.query("delete from public.cash_transfer where owner_id = $1", [session.ownerId]);
			await deleteOwnerFixtures(pool, session.ownerId);
		}
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las rutas de transferencias responden 401 antes de validar nada", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve antes del pipe: un body invalido sin sesion sigue siendo 401.
	const invalid = await call("POST", "/cash-transfers", {
		body: { sourceAccountId: "no-es-uuid", targetAccountId: "tampoco", amount: -5 },
	});

	assert.equal(invalid.status, 401);

	const forged = await call("GET", `/cash-transfers/${randomUUID()}`, {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("POST /cash-transfers mueve el monto entre dos cuentas y la fila es la que guardo la base", async () => {
	const paymentsBefore = await paymentCount(owner.ownerId);

	const created = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.source,
			targetAccountId: accounts.target,
			amount: AMOUNT,
			transferDate: TRANSFER_DATE,
			notes: "Reposición de cambio para la caja chica",
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	// El contrato de salida es exactamente este: siete campos, sin `ownerId` ni totales.
	assert.deepEqual(Object.keys(created.body).sort(), [
		"amount",
		"createdAt",
		"id",
		"notes",
		"sourceAccountId",
		"targetAccountId",
		"transferDate",
	]);
	assert.equal(created.body.sourceAccountId, accounts.source);
	assert.equal(created.body.targetAccountId, accounts.target);
	// `numeric(12,2)` viaja como number, igual que en cierres y en pagos.
	assert.equal(created.body.amount, AMOUNT);
	assert.equal(typeof created.body.amount, "number");
	// `date` viaja "YYYY-MM-DD" sin corrimiento de zona.
	assert.equal(created.body.transferDate, TRANSFER_DATE);
	assert.equal(created.body.notes, "Reposición de cambio para la caja chica");
	assert.match(created.body.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

	const transferId = created.body.id;

	// La fila persistida es la misma: el API no reescribio nada despues de la RPC.
	const stored = await storedTransfer(transferId);

	assert.equal(stored.source_account_id, accounts.source);
	assert.equal(stored.target_account_id, accounts.target);
	assert.equal(stored.amount, AMOUNT.toFixed(2));
	assert.equal(stored.transfer_date, TRANSFER_DATE);
	assert.equal(stored.notes, "Reposición de cambio para la caja chica");
	assert.equal(stored.owner_id, owner.ownerId, "el dueno sale de la sesion, no del body");

	// S8: la transferencia NO crea un recibo de pago. El movimiento lo ve el saldo que calcula la
	// base (`private.cash_expected_balance` suma y resta `cash_transfer`).
	assert.equal(
		await paymentCount(owner.ownerId),
		paymentsBefore,
		"una transferencia no inserta ningun payment",
	);

	// GET /cash-transfers/:id devuelve la misma fila.
	const detail = await call("GET", `/cash-transfers/${transferId}`, { cookie: owner.cookie });

	assert.equal(detail.status, 200);
	assert.deepEqual(detail.body, created.body);

	// Sin notas, la RPC las normaliza a NULL (`nullif(p_notes, '')`), no a cadena vacia.
	const withoutNotes = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.source,
			targetAccountId: accounts.other,
			amount: 25.5,
			transferDate: TRANSFER_DATE,
		},
	});

	assert.equal(withoutNotes.status, 201, JSON.stringify(withoutNotes.body));
	assert.equal(withoutNotes.body.notes, null);
	assert.equal(withoutNotes.body.amount, 25.5);

	// Un id que no es uuid lo rechaza el pipe (400), sin llegar al servicio.
	const invalid = await call("GET", "/cash-transfers/no-es-uuid", { cookie: owner.cookie });

	assert.equal(invalid.status, 400);

	// Un id valido que no existe responde 404 con el mensaje del borde, no el de la base.
	const missing = await call("GET", `/cash-transfers/${randomUUID()}`, { cookie: owner.cookie });

	assert.equal(missing.status, 404);
	assert.equal(missing.body.message, "La transferencia no existe.");
});

test("GET /cash-transfers filtra por cuenta en las dos puntas y por fecha con los dos bordes inclusive", async () => {
	// Las cuatro transferencias se crean por la ruta real (la RPC es la unica via).
	const inWindowFrom = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.other,
			targetAccountId: accounts.target,
			amount: 10,
			transferDate: WINDOW_FROM,
		},
	});

	assert.equal(inWindowFrom.status, 201, JSON.stringify(inWindowFrom.body));

	// En la otra punta de la cuenta: `target` como ORIGEN (el filtro es origen O destino).
	const inWindowTo = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.target,
			targetAccountId: accounts.other,
			amount: 20,
			transferDate: WINDOW_TO,
		},
	});

	assert.equal(inWindowTo.status, 201, JSON.stringify(inWindowTo.body));

	// Antes y despues de la ventana: existen en la base pero no deben viajar.
	const beforeWindow = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.other,
			targetAccountId: accounts.target,
			amount: 30,
			transferDate: OPENING_DATE,
		},
	});

	assert.equal(beforeWindow.status, 201, JSON.stringify(beforeWindow.body));

	const afterWindow = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.other,
			targetAccountId: accounts.target,
			amount: 40,
			transferDate: "2026-03-11",
		},
	});

	assert.equal(afterWindow.status, 201, JSON.stringify(afterWindow.body));

	const listed = await call(
		"GET",
		`/cash-transfers?accountId=${accounts.target}&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
		{ cookie: owner.cookie },
	);

	assert.equal(listed.status, 200, JSON.stringify(listed.body));

	// Solo las dos de la ventana, en el orden del origen (fecha ascendente).
	assert.deepEqual(
		listed.body.map((row: { id: string }) => row.id),
		[inWindowFrom.body.id, inWindowTo.body.id],
	);

	// Las de fuera de la ventana existen: lo que las excluyo fue el filtro, no que no se crearan.
	// (`target` participa en cinco: el alta del camino feliz, las dos de la ventana y las dos de
	// fuera.)
	assert.equal(await transferCount(accounts.target), 5);

	// Una cuenta que no participa en ninguna transferencia devuelve lista vacia, no 404.
	const unrelated = await call(
		"GET",
		`/cash-transfers?accountId=${accounts.usd}&from=${WINDOW_FROM}&to=${WINDOW_TO}`,
		{ cookie: owner.cookie },
	);

	assert.equal(unrelated.status, 200);
	assert.deepEqual(unrelated.body, []);

	// Los tres parametros son obligatorios: sin `from`/`to` el pipe rechaza con 400.
	const missingQuery = await call("GET", `/cash-transfers?accountId=${accounts.target}`, {
		cookie: owner.cookie,
	});

	assert.equal(missingQuery.status, 400);
	assert.equal(missingQuery.body.message, "El payload no cumple el contrato compartido.");
});

test("origen y destino iguales lo rechaza la base con su mensaje y no deja ninguna fila", async () => {
	const before = await transferCount(accounts.source);

	const result = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.source,
			targetAccountId: accounts.source,
			amount: 50,
			transferDate: TRANSFER_DATE,
		},
	});

	// 400 con el mensaje de la RPC, no con el del schema compartido: el `superRefine` de
	// `cashTransferSchema` se descarta a proposito (mismo criterio que C4, L12(b)) y la rama SQL es
	// la que responde, con su texto y su punto final ausente.
	assert.equal(result.status, 400, JSON.stringify(result.body));
	assert.equal(result.body.message, "Origen y destino deben ser cuentas distintas");
	assert.equal(await transferCount(accounts.source), before, "el rechazo no crea ninguna fila");
});

test("una cuenta que no esta en PEN la rechaza la RPC y no deja ninguna fila", async () => {
	const before = await transferCount(accounts.source);

	const result = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.source,
			targetAccountId: accounts.usd,
			amount: 100,
			transferDate: TRANSFER_DATE,
		},
	});

	assert.equal(result.status, 400, JSON.stringify(result.body));
	assert.equal(result.body.message, "Solo se permiten transferencias entre cuentas en PEN");
	assert.equal(await transferCount(accounts.source), before);
	assert.equal(await transferCount(accounts.usd), 0);
});

test("un destino inexistente responde 404 con el mensaje de la base y no escribe nada", async () => {
	const before = await transferCount(accounts.source);

	const result = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.source,
			targetAccountId: randomUUID(),
			amount: 10,
			transferDate: TRANSFER_DATE,
		},
	});

	// 404: la RLS/el `for update` de la RPC no encuentran la cuenta, y el mensaje es el mismo
	// para "no existe" y "es de otro" (a proposito, para no filtrar la existencia de lo ajeno).
	assert.equal(result.status, 404, JSON.stringify(result.body));
	assert.equal(result.body.message, "La cuenta de destino no existe");
	assert.equal(await transferCount(accounts.source), before);
});

test("la transferencia de otro dueno no se lee y sus cuentas no se pueden usar como puntas (S6)", async () => {
	// El otro dueno crea SU transferencia por la ruta real.
	const created = await call("POST", "/cash-transfers", {
		cookie: intruder.cookie,
		body: {
			sourceAccountId: intruderAccounts.source,
			targetAccountId: intruderAccounts.target,
			amount: 75,
			transferDate: TRANSFER_DATE,
			notes: "transferencia ajena",
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	intruderTransferId = created.body.id;

	// Lectura por id: 404 con el mismo mensaje que un id inexistente.
	const foreign = await call("GET", `/cash-transfers/${intruderTransferId}`, {
		cookie: owner.cookie,
	});

	assert.equal(foreign.status, 404);
	assert.equal(foreign.body.message, "La transferencia no existe.");

	const serialized = JSON.stringify(foreign.body);

	assert.ok(
		!serialized.includes("transferencia ajena"),
		`no debe viajar nada de la transferencia ajena: ${serialized}`,
	);

	// El otro dueno SI la lee: el 404 es aislamiento, no una ruta rota.
	const own = await call("GET", `/cash-transfers/${intruderTransferId}`, {
		cookie: intruder.cookie,
	});

	assert.equal(own.status, 200);
	assert.equal(own.body.amount, 75);

	// El listado con la cuenta ajena devuelve lista vacia (la RLS la hace invisible). La ventana
	// cubre la fecha de la transferencia ajena, para que el vacio sea aislamiento y no el filtro.
	const listed = await call(
		"GET",
		`/cash-transfers?accountId=${intruderAccounts.target}&from=${OPENING_DATE}&to=${WINDOW_TO}`,
		{ cookie: owner.cookie },
	);

	assert.equal(listed.status, 200);
	assert.deepEqual(listed.body, []);

	// El otro dueno SI ve la suya en la misma ventana.
	const intruderListed = await call(
		"GET",
		`/cash-transfers?accountId=${intruderAccounts.target}&from=${OPENING_DATE}&to=${WINDOW_TO}`,
		{ cookie: intruder.cookie },
	);

	assert.equal(intruderListed.status, 200);
	assert.deepEqual(
		intruderListed.body.map((row: { id: string }) => row.id),
		[intruderTransferId],
	);

	// Lado ESCRITURA: usar la cuenta ajena como destino responde el error de dominio de la RPC.
	const ownCountBefore = await transferCount(intruderAccounts.source);
	const ownSourceBefore = await transferCount(accounts.source);
	const targetAttempt = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: accounts.source,
			targetAccountId: intruderAccounts.target,
			amount: 10,
			transferDate: TRANSFER_DATE,
		},
	});

	assert.equal(targetAttempt.status, 404, JSON.stringify(targetAttempt.body));
	assert.equal(targetAttempt.body.message, "La cuenta de destino no existe");

	// Y como origen tampoco.
	const sourceAttempt = await call("POST", "/cash-transfers", {
		cookie: owner.cookie,
		body: {
			sourceAccountId: intruderAccounts.source,
			targetAccountId: accounts.target,
			amount: 10,
			transferDate: TRANSFER_DATE,
		},
	});

	assert.equal(sourceAttempt.status, 404, JSON.stringify(sourceAttempt.body));
	assert.equal(sourceAttempt.body.message, "La cuenta de origen no existe");

	// Ninguno de los dos rechazos dejo una fila en las cuentas ajenas: el conteo es el mismo que
	// dejo la transferencia legitima del otro dueno.
	assert.equal(
		await transferCount(intruderAccounts.source),
		ownCountBefore,
		"el rechazo no escribe en la cuenta ajena",
	);
	assert.equal(
		await transferCount(accounts.source),
		ownSourceBefore,
		"el intento con la cuenta ajena no escribe en la propia",
	);
});

test("un INSERT directo en cash_transfer con el rol de la sesion es rechazado (42501): RLS preexistente, no un guard de C6", async () => {
	// ESTADO PREEXISTENTE, igual que el INSERT directo de `cash_close` en C4: no toca ninguna ruta
	// nueva. Documenta que `cash_transfer` solo tiene politica de SELECT, asi que la unica via de
	// escritura es la RPC (S8) aunque `authenticated` conserve el privilegio de tabla.
	const failed = await (async () => {
		try {
			await withOwner(harness.db, owner.ownerId, (tx) =>
				tx.execute(sql`
					insert into public.cash_transfer (
						owner_id, source_account_id, target_account_id, amount, transfer_date
					) values (
						${owner.ownerId}::uuid, ${accounts.source}::uuid, ${accounts.target}::uuid,
						999, ${TRANSFER_DATE}::date
					)
				`),
			);

			return null;
		} catch (error) {
			return error;
		}
	})();

	assert.ok(failed, "un INSERT directo deberia fallar por RLS");
	assert.equal(
		postgresCode(failed),
		"42501",
		`deberia fallar por privilegios/RLS, fallo con ${postgresCode(failed)}: ${String(failed)}`,
	);

	const rows = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.cash_transfer where amount = 999",
	);

	assert.equal(rows.rows[0]?.n, 0, "la fila rechazada no existe");
});
