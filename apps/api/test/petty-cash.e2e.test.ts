// e2e de caja chica del vertical de cajas-bancos (C6) contra la base viva `gestion_pagos_dev`.
//
// Que prueba, en una frase: que el vale, su anulacion y la reposicion son RPC (S5/S8), que el
// `serial` y el `status` los pone la base, que el vale genera su recibo de egreso y anularlo lo
// anula, y que todas las reglas (limite por gasto, caja chica, categoria EGRESO, metodo EFECTIVO,
// vales pendientes) las aplica PostgreSQL, no Node:
//
//   - 401 en las cinco rutas nuevas antes de validar el body ni la query;
//   - el alta devuelve la fila RELEIDA: `serial` correlativo de la base, `status` PENDIENTE,
//     `paymentId` del recibo que creo la RPC (S8) y ningun `ownerId` en el body aceptado (S6);
//   - el vale que supera `petty_expense_limit` lo rechaza la RPC con su mensaje (no el
//     `superRefine` compartido) y no deja ni vale ni pago;
//   - una cuenta que no es caja chica y una categoria que no es EGRESO se rechazan con el mensaje
//     de la base, sin escribir nada;
//   - el listado filtra por cuenta y por estado, en el orden del correlativo;
//   - anular responde 200 `{ id, status }` con el estado RELEIDO, anula el recibo de egreso y un
//     segundo intento responde el mensaje de dominio sin cambiar el estado;
//   - reponer transiciona PENDIENTE -> REPUESTO, crea la transferencia por el total (el monto lo
//     suma el SQL) y devuelve `transferId` + los vales releidos; repetirlo responde el mensaje de
//     dominio y no crea otra transferencia;
//   - el vale y la caja chica de otro dueno son inalcanzables (404) y el rechazo no toca sus filas;
//   - un INSERT directo en `petty_cash_vale` con el rol de la sesion muere con `42501`.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: salen de la API server-side de Better Auth (`signInEmail`, con el dueno creado por SQL), igual que en
// `cash-closes.e2e.test.ts`.
//
// FECHAS: fijas y pasadas (apertura `2026-03-01`, vales `2026-03-05`), no "hoy", para no depender
// de la zona horaria del contenedor (la clase de bug de L9 del doc de la feature). La excepcion es
// la fecha de la transferencia de reposicion, que la RPC toma con `current_date`: el test no la
// fija, la lee de la fila.
//
// FIXTURES: las cuentas, el metodo `EFECTIVO` (la RPC lo exige por codigo) y las dos categorias se
// siembran con SQL directo como `dev_user` (owner de las tablas, igual que los seeds). Los VALES y
// sus pagos no se siembran a mano: los crea la RPC, que es la ruta real y lo que este archivo
// prueba (S8: el vertical no inserta `payment` ni `petty_cash_vale`).
//
// `deleteOwnerFixtures` NO borra `cash_transfer` (deuda L5 del doc de la feature: C8 la lleva al
// teardown comun), asi que este archivo borra las transferencias de reposicion antes de llamarlo.
// `petty_cash_vale` y `payment` si estan en el teardown comun, en orden de FK.
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

/** Apertura de TODAS las cuentas del fixture: anterior a cualquier vale y a la reposicion. */
const OPENING_DATE = "2026-03-01";

/** Fecha de los vales de este archivo (pasada y posterior a la apertura). */
const VALE_DATE = "2026-03-05";

/** Limite por gasto de la caja chica del fixture (`petty_expense_limit`). */
const EXPENSE_LIMIT = 100;

/** Concepto del primer vale: tambien viaja al `notes` del recibo de egreso. */
const CONCEPT = "Compra de utiles de oficina";

/** Las cinco rutas nuevas con una entrada valida, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: `/petty-cash/vales?accountId=${randomUUID()}` },
	{ method: "GET", path: `/petty-cash/vales/${randomUUID()}` },
	{
		method: "POST",
		path: "/petty-cash/vales",
		body: {
			accountId: randomUUID(),
			categoryId: randomUUID(),
			valeDate: VALE_DATE,
			paidTo: "Ana Rios",
			concept: CONCEPT,
			amount: 10,
			hasReceipt: true,
		},
	},
	{ method: "POST", path: `/petty-cash/vales/${randomUUID()}/void` },
	{
		method: "POST",
		path: "/petty-cash/replenish",
		body: { accountId: randomUUID(), sourceAccountId: randomUUID(), valeIds: [randomUUID()] },
	},
];

let harness: ApiHarness;
let pool: Pool;
/** Dueno de la caja chica que se opera. */
let owner: OwnerSession;
/** Otro dueno: prueba que su caja chica y sus vales son inalcanzables. */
let intruder: OwnerSession;

interface SeededAccounts {
	/** Caja chica del fixture: `is_petty_cash`, limite por gasto y fondo de cambio. */
	petty: string;
	/** Caja que NO es caja chica: la RPC la rechaza con su propio mensaje. */
	plain: string;
	/** Cuenta de origen de la reposicion (banco en PEN). */
	source: string;
	/** Metodo `EFECTIVO`: `create_petty_cash_vale` lo busca por codigo. */
	methodId: string;
	/** Categoria EGRESO: la unica direccion que la RPC acepta para el gasto del vale. */
	expenseCategoryId: string;
	/** Categoria INGRESO: existe para probar que la RPC rechaza la direccion equivocada. */
	incomeCategoryId: string;
}

let accounts: SeededAccounts;
let intruderAccounts: SeededAccounts;

/** Primer vale del archivo: lo reusan el listado y la anulacion. */
let firstValeId: string;
let firstValeSerial: number;
/** Vale del otro dueno: el dueno de la sesion no puede leerlo ni anularlo. */
let intruderValeId: string;

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

/** Vales de una cuenta, contados por SQL como `dev_user`. */
async function valeCount(accountId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.petty_cash_vale where account_id = $1",
		[accountId],
	);

	return result.rows[0]?.n ?? 0;
}

/** Recibos de egreso de una cuenta: los crea la RPC, el API nunca. */
async function paymentCount(accountId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.payment where cash_account_id = $1",
		[accountId],
	);

	return result.rows[0]?.n ?? 0;
}

/** Transferencias de reposicion que apuntan a una caja chica. */
async function replenishCount(accountId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.cash_transfer where target_account_id = $1",
		[accountId],
	);

	return result.rows[0]?.n ?? 0;
}

/** La fila cruda de un vale, en texto, para comparar contra lo que devolvio el API. */
async function storedVale(id: string): Promise<Record<string, string | null>> {
	const result = await pool.query<Record<string, string | null>>(
		`select account_id::text, serial::text, vale_date::text, paid_to, concept, amount::text,
		        has_receipt::text, status::text, payment_id::text, owner_id::text
		   from public.petty_cash_vale
		  where id = $1`,
		[id],
	);

	const row = result.rows[0];

	assert.ok(row, `deberia existir el vale ${id}`);

	return row;
}

/** La fila cruda del recibo de egreso que genero un vale (SPEC 49). */
async function storedPayment(id: string): Promise<Record<string, string | null>> {
	const result = await pool.query<Record<string, string | null>>(
		`select direction::text, amount::text, is_cash_movement::text, status::text,
		        method_id::text, category_id::text, cash_account_id::text, notes,
		        void_reason, voided_at::text
		   from public.payment
		  where id = $1`,
		[id],
	);

	const row = result.rows[0];

	assert.ok(row, `deberia existir el pago ${id}`);

	return row;
}

/** La transferencia que creo la reposicion. */
async function storedTransfer(id: string): Promise<Record<string, string | null>> {
	const result = await pool.query<Record<string, string | null>>(
		`select source_account_id::text, target_account_id::text, amount::text,
		        transfer_date::text, notes
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
 * Siembra el juego de cuentas y catalogos de un dueno con SQL directo (como `dev_user`).
 *
 *   petty   CASH_BOX PEN, caja chica, limite 100, fondo 200, apertura 200
 *   plain   CASH_BOX PEN que NO es caja chica
 *   source  BANK_ACCOUNT PEN con saldo: el origen de la reposicion
 *   EFECTIVO + una categoria EGRESO y una INGRESO
 *
 * El metodo `EFECTIVO` es obligatorio: `create_petty_cash_vale` lo busca por codigo y falla con
 * `No existe el método de pago Efectivo para esta cuenta` si no esta. Es el caso real de L4 (sin
 * `POST /settings/ensure` el vertical no puede crear vales).
 */
async function seedPettyCash(pool: Pool, ownerId: string, tag: string): Promise<SeededAccounts> {
	const ids: SeededAccounts = {
		petty: randomUUID(),
		plain: randomUUID(),
		source: randomUUID(),
		methodId: randomUUID(),
		expenseCategoryId: randomUUID(),
		incomeCategoryId: randomUUID(),
	};

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, opening_balance, opening_balance_date,
		    is_petty_cash, change_fund, petty_expense_limit, custodian_name, owner_id)
		 values ($1, 'CASH_BOX', $2, 'PEN', 200, $3::date, true, 200, $4, 'Ana Rios', $5)`,
		[ids.petty, `E2E caja chica ${tag}`, OPENING_DATE, EXPENSE_LIMIT, ownerId],
	);

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'CASH_BOX', $2, 'PEN', 0, $3::date, $4)`,
		[ids.plain, `E2E caja ${tag}`, OPENING_DATE, ownerId],
	);

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, bank_name, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'BANK_ACCOUNT', $2, 'PEN', 'BCP', 5000, $3::date, $4)`,
		[ids.source, `E2E banco ${tag}`, OPENING_DATE, ownerId],
	);

	await pool.query(
		"insert into public.payment_method (id, code, name, owner_id) values ($1, 'EFECTIVO', $2, $3)",
		[ids.methodId, `Efectivo ${tag}`, ownerId],
	);

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'EGRESO', $2, $3, $4), ($5, 'INGRESO', $6, $7, $4)`,
		[
			ids.expenseCategoryId,
			`E2E gasto ${tag}`,
			`E2E_EGR_${tag}`.toUpperCase(),
			ownerId,
			ids.incomeCategoryId,
			`E2E cobranza ${tag}`,
			`E2E_ING_${tag}`.toUpperCase(),
		],
	);

	return ids;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de caja chica corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-caja-chica-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await createSecondOwner(harness.pool, harness.auth);
	intruder = await createSecondOwner(harness.pool, harness.auth);

	accounts = await seedPettyCash(pool, owner.ownerId, "caja-chica");
	intruderAccounts = await seedPettyCash(pool, intruder.ownerId, "ajena");
});

after(async () => {
	// `cash_transfer` no esta en `deleteOwnerFixtures` (deuda L5): la reposicion crea una y el
	// borrado de `cash_account` fallaria por FK.
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

test("sin sesion las rutas de caja chica responden 401 antes de validar nada", async () => {
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
	const invalid = await call("POST", "/petty-cash/vales", {
		body: { accountId: "no-es-uuid", amount: -5, paidTo: "" },
	});

	assert.equal(invalid.status, 401);

	const forged = await call("GET", `/petty-cash/vales/${randomUUID()}`, {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("POST /petty-cash/vales crea el vale con el serial y el recibo que asigna la base (S5 y S8)", async () => {
	const paymentsBefore = await paymentCount(accounts.petty);

	const created = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			categoryId: accounts.expenseCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Rosa Quispe",
			concept: CONCEPT,
			amount: 40,
			hasReceipt: true,
			// Un `ownerId` en el body no fija el dueno (S6): el schema lo descarta.
			ownerId: intruder.ownerId,
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	// El contrato de salida es exactamente este: once campos, sin `ownerId`.
	assert.deepEqual(Object.keys(created.body).sort(), [
		"accountId",
		"amount",
		"concept",
		"createdAt",
		"hasReceipt",
		"id",
		"paidTo",
		"paymentId",
		"serial",
		"status",
		"valeDate",
	]);
	assert.equal(created.body.accountId, accounts.petty);
	// El correlativo lo asigna la RPC con la cuenta bloqueada: es el primero de esta caja.
	assert.equal(created.body.serial, 1);
	assert.equal(created.body.valeDate, VALE_DATE);
	assert.equal(created.body.paidTo, "Rosa Quispe");
	assert.equal(created.body.concept, CONCEPT);
	assert.equal(created.body.amount, 40);
	assert.equal(typeof created.body.amount, "number");
	assert.equal(created.body.hasReceipt, true);
	assert.equal(created.body.status, "PENDIENTE", "el estado inicial lo pone la base");
	assert.match(created.body.paymentId, /^[0-9a-f-]{36}$/, "el vale genera su recibo de egreso");
	assert.match(created.body.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

	firstValeId = created.body.id;
	firstValeSerial = created.body.serial;

	// La fila persistida es la misma, y el dueno es el de la sesion aunque el body mandara otro.
	const stored = await storedVale(firstValeId);

	assert.equal(stored.account_id, accounts.petty);
	assert.equal(stored.serial, "1");
	assert.equal(stored.vale_date, VALE_DATE);
	assert.equal(stored.concept, CONCEPT);
	assert.equal(stored.amount, "40.00");
	assert.equal(stored.has_receipt, "true");
	assert.equal(stored.status, "PENDIENTE");
	assert.equal(stored.payment_id, created.body.paymentId);
	assert.equal(stored.owner_id, owner.ownerId, "el dueno sale de la sesion, no del body");

	// S8: el dinero se movio por el camino que ya existia — la RPC inserta el recibo de egreso en
	// `payment` (SPEC 49/50) y el API no lo toca.
	assert.equal(
		await paymentCount(accounts.petty),
		paymentsBefore + 1,
		"el vale crea exactamente un recibo de egreso",
	);

	const payment = await storedPayment(created.body.paymentId);

	assert.equal(payment.cash_account_id, accounts.petty);
	assert.equal(payment.direction, "EGRESO");
	assert.equal(payment.amount, "40.00");
	assert.equal(payment.status, "EN_REVISION");
	assert.equal(payment.method_id, accounts.methodId, "el recibo usa el metodo EFECTIVO");
	assert.equal(payment.category_id, accounts.expenseCategoryId);
	assert.equal(payment.is_cash_movement, "true", "un vale no se asigna a comprobantes");
	assert.ok(
		payment.notes?.includes(String(firstValeSerial)) &&
			payment.notes?.includes(CONCEPT),
		`el recibo nombra el vale y su concepto: ${payment.notes}`,
	);

	// El segundo vale de la misma caja toma el correlativo siguiente, otra vez desde la base.
	const second = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			categoryId: accounts.expenseCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Luis Torres",
			concept: "Movilidad",
			amount: 20,
			hasReceipt: false,
		},
	});

	assert.equal(second.status, 201, JSON.stringify(second.body));
	assert.equal(second.body.serial, firstValeSerial + 1, "el correlativo lo asigna la base");
	assert.equal(second.body.hasReceipt, false);
});

test("un vale sobre el limite por gasto lo rechaza la RPC y no deja ni vale ni recibo", async () => {
	const valesBefore = await valeCount(accounts.petty);
	const paymentsBefore = await paymentCount(accounts.petty);

	const result = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			categoryId: accounts.expenseCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Rosa Quispe",
			concept: CONCEPT,
			amount: EXPENSE_LIMIT + 50,
			hasReceipt: true,
		},
	});

	// 400 de la RPC y no del `superRefine` de `createPettyCashValeSchema`: el limite es una columna
	// de la cuenta y su juez es el SQL, que es el unico que la tiene leida (mismo criterio que
	// L12(b) en C4).
	assert.equal(result.status, 400, JSON.stringify(result.body));
	// `p_amount` es `numeric` sin escala (150) y `petty_expense_limit` es `numeric(12,2)` (100.00),
	// asi que el mensaje se comprueba por forma: los dos valores interpolados.
	assert.match(
		result.body.message,
		/^El monto del vale \(150(?:\.0+)?\) supera el límite por gasto de la caja chica \(100\.00\)$/,
	);
	assert.equal(await valeCount(accounts.petty), valesBefore, "el rechazo no crea el vale");
	assert.equal(
		await paymentCount(accounts.petty),
		paymentsBefore,
		"el rechazo tampoco crea el recibo de egreso",
	);
});

test("una cuenta que no es caja chica y una categoria que no es EGRESO se rechazan con el mensaje de la base", async () => {
	const valesBefore = await valeCount(accounts.plain);

	const notPetty = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.plain,
			categoryId: accounts.expenseCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Rosa Quispe",
			concept: CONCEPT,
			amount: 10,
			hasReceipt: false,
		},
	});

	assert.equal(notPetty.status, 400, JSON.stringify(notPetty.body));
	assert.equal(notPetty.body.message, "La cuenta no está marcada como caja chica");
	assert.equal(await valeCount(accounts.plain), valesBefore);

	const wrongDirection = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			categoryId: accounts.incomeCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Rosa Quispe",
			concept: CONCEPT,
			amount: 10,
			hasReceipt: false,
		},
	});

	assert.equal(wrongDirection.status, 400, JSON.stringify(wrongDirection.body));
	assert.equal(wrongDirection.body.message, "La categoría del vale no es válida");

	// Un id de categoria inexistente tampoco pasa: la RPC no encuentra la fila.
	const missingCategory = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			categoryId: randomUUID(),
			valeDate: VALE_DATE,
			paidTo: "Rosa Quispe",
			concept: CONCEPT,
			amount: 10,
			hasReceipt: false,
		},
	});

	assert.equal(missingCategory.status, 400, JSON.stringify(missingCategory.body));
	assert.equal(missingCategory.body.message, "La categoría del vale no es válida");

	// Una fecha anterior a la apertura la rechaza `private.assert_account_open_for`, con su texto.
	const beforeOpening = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			categoryId: accounts.expenseCategoryId,
			valeDate: "2026-02-20",
			paidTo: "Rosa Quispe",
			concept: CONCEPT,
			amount: 10,
			hasReceipt: false,
		},
	});

	assert.equal(beforeOpening.status, 400, JSON.stringify(beforeOpening.body));
	assert.equal(
		beforeOpening.body.message,
		`La fecha del recibo (2026-02-20) es anterior al saldo inicial de la cuenta (${OPENING_DATE}).`,
	);
});

test("GET /petty-cash/vales lista por correlativo y filtra por estado; GET por id responde 404 si no existe", async () => {
	const listed = await call("GET", `/petty-cash/vales?accountId=${accounts.petty}`, {
		cookie: owner.cookie,
	});

	assert.equal(listed.status, 200, JSON.stringify(listed.body));
	assert.deepEqual(
		listed.body.map((row: { serial: number }) => row.serial),
		[1, 2],
		"el orden es el del correlativo, igual que el origen",
	);
	assert.equal(listed.body.length, 2, `deberian ser los dos vales creados: ${JSON.stringify(listed.body)}`);
	assert.equal(listed.body[0].id, firstValeId);
	assert.equal(listed.body[0].accountId, accounts.petty);

	const pending = await call(
		"GET",
		`/petty-cash/vales?accountId=${accounts.petty}&status=PENDIENTE`,
		{ cookie: owner.cookie },
	);

	assert.equal(pending.status, 200);

	const replenished = await call(
		"GET",
		`/petty-cash/vales?accountId=${accounts.petty}&status=REPUESTO`,
		{ cookie: owner.cookie },
	);

	assert.equal(replenished.status, 200);
	assert.deepEqual(replenished.body, []);

	// Un estado que el enum no tiene lo rechaza el pipe, sin llegar a la base.
	const invalidStatus = await call(
		"GET",
		`/petty-cash/vales?accountId=${accounts.petty}&status=PAGADO`,
		{ cookie: owner.cookie },
	);

	assert.equal(invalidStatus.status, 400);
	assert.equal(invalidStatus.body.message, "El payload no cumple el contrato compartido.");

	const detail = await call("GET", `/petty-cash/vales/${firstValeId}`, { cookie: owner.cookie });

	assert.equal(detail.status, 200);
	assert.equal(detail.body.id, firstValeId);
	assert.equal(detail.body.serial, firstValeSerial);

	const missing = await call("GET", `/petty-cash/vales/${randomUUID()}`, { cookie: owner.cookie });

	assert.equal(missing.status, 404);
	assert.equal(missing.body.message, "El vale no existe.");
});

test("POST /petty-cash/vales/:id/void anula el vale y su recibo, y un segundo intento no cambia nada", async () => {
	const paymentId = (await call("GET", `/petty-cash/vales/${firstValeId}`, { cookie: owner.cookie }))
		.body.paymentId;

	const voided = await call("POST", `/petty-cash/vales/${firstValeId}/void`, {
		cookie: owner.cookie,
	});

	// 200 y no 201: no crea un recurso, cambia el estado de uno existente.
	assert.equal(voided.status, 200, JSON.stringify(voided.body));
	assert.deepEqual(Object.keys(voided.body).sort(), ["id", "status"]);
	assert.equal(voided.body.id, firstValeId);
	assert.equal(voided.body.status, "ANULADO");

	// El estado que responde es el que quedo en la tabla (se relee, no se asume).
	assert.equal((await storedVale(firstValeId)).status, "ANULADO");

	// S8: el recibo de egreso del vale queda anulado con su motivo y su fecha.
	const payment = await storedPayment(paymentId);

	assert.equal(payment.status, "ANULADO");
	assert.ok(
		payment.void_reason?.includes(String(firstValeSerial)),
		`el motivo nombra el vale anulado: ${payment.void_reason}`,
	);
	assert.ok(payment.voided_at, "la anulacion deja fecha");

	// El vale sigue existiendo: la anulacion no borra el correlativo.
	const after = await call("GET", `/petty-cash/vales/${firstValeId}`, { cookie: owner.cookie });

	assert.equal(after.status, 200);
	assert.equal(after.body.status, "ANULADO");

	// Anular un vale ya anulado responde el mensaje de dominio y no cambia el estado.
	const again = await call("POST", `/petty-cash/vales/${firstValeId}/void`, {
		cookie: owner.cookie,
	});

	assert.equal(again.status, 400, JSON.stringify(again.body));
	assert.equal(again.body.message, "Solo se pueden anular vales pendientes");
	assert.equal((await storedVale(firstValeId)).status, "ANULADO", "el rechazo no revierte nada");
	assert.equal(
		(await storedPayment(paymentId)).status,
		"ANULADO",
		"el rechazo tampoco toca el recibo",
	);
});

test("POST /petty-cash/replenish repone los vales pendientes y crea la transferencia por el total", async () => {
	// Dos vales PENDIENTES nuevos: la suma (30 + 20) la hace la RPC, no el test ni el API.
	const valeIds: string[] = [];

	for (const amount of [30, 20]) {
		const created = await call("POST", "/petty-cash/vales", {
			cookie: owner.cookie,
			body: {
				accountId: accounts.petty,
				categoryId: accounts.expenseCategoryId,
				valeDate: VALE_DATE,
				paidTo: "Rosa Quispe",
				concept: `Reposicion ${amount}`,
				amount,
				hasReceipt: true,
			},
		});

		assert.equal(created.status, 201, JSON.stringify(created.body));
		valeIds.push(created.body.id);
	}

	const transfersBefore = await replenishCount(accounts.petty);

	const replenished = await call("POST", "/petty-cash/replenish", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			sourceAccountId: accounts.source,
			valeIds,
		},
	});

	assert.equal(replenished.status, 201, JSON.stringify(replenished.body));
	assert.deepEqual(Object.keys(replenished.body).sort(), ["transferId", "vales"]);

	// Los vales vuelven RELEIDOS del RPC: la transicion PENDIENTE -> REPUESTO la hizo la base.
	assert.deepEqual(
		replenished.body.vales.map((row: { id: string; status: string }) => [row.id, row.status]),
		[
			[valeIds[0], "REPUESTO"],
			[valeIds[1], "REPUESTO"],
		],
	);
	assert.equal(
		replenished.body.vales[0].serial + 1,
		replenished.body.vales[1].serial,
		"los valeIds viajan en el orden del correlativo",
	);

	// El id que devuelve la RPC es el de la TRANSFERENCIA, y es una transferencia real.
	const transfer = await storedTransfer(replenished.body.transferId);

	assert.equal(transfer.source_account_id, accounts.source);
	assert.equal(transfer.target_account_id, accounts.petty);
	assert.equal(transfer.amount, "50.00", "el total lo suma el SQL, no Node");
	assert.match(transfer.notes ?? "", /^Reposición de caja chica \(vales /);
	assert.equal(await replenishCount(accounts.petty), transfersBefore + 1);

	// Repetir la reposicion con los mismos vales responde el mensaje de dominio: ya no estan
	// PENDIENTES.
	const again = await call("POST", "/petty-cash/replenish", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			sourceAccountId: accounts.source,
			valeIds,
		},
	});

	assert.equal(again.status, 400, JSON.stringify(again.body));
	assert.equal(
		again.body.message,
		"Algún vale no existe, no pertenece a la caja chica o no está pendiente",
	);
	assert.equal(
		await replenishCount(accounts.petty),
		transfersBefore + 1,
		"el rechazo no crea otra transferencia",
	);
	assert.deepEqual(
		(await call("GET", `/petty-cash/vales?accountId=${accounts.petty}&status=REPUESTO`, {
			cookie: owner.cookie,
		})).body.map((row: { id: string }) => row.id),
		valeIds,
		"los dos vales siguen REPUESTOS",
	);

	// El origen no puede ser la caja chica: la regla vive en `create_cash_transfer`, que la
	// reposicion hereda (`Origen y destino deben ser cuentas distintas`). Es la razon por la que
	// el `superRefine` del schema compartido se descarta en el borde.
	const pending = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			categoryId: accounts.expenseCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Rosa Quispe",
			concept: "Vale para probar el origen invalido",
			amount: 5,
			hasReceipt: false,
		},
	});

	assert.equal(pending.status, 201, JSON.stringify(pending.body));

	const sameAccount = await call("POST", "/petty-cash/replenish", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.petty,
			sourceAccountId: accounts.petty,
			valeIds: [pending.body.id],
		},
	});

	assert.equal(sameAccount.status, 400, JSON.stringify(sameAccount.body));
	assert.equal(sameAccount.body.message, "Origen y destino deben ser cuentas distintas");
	assert.equal(
		(await storedVale(pending.body.id)).status,
		"PENDIENTE",
		"el rechazo no repone el vale",
	);
	assert.equal(await replenishCount(accounts.petty), transfersBefore + 1);
});

test("la caja chica y los vales de otro dueno son inalcanzables y el rechazo no toca sus filas (S6)", async () => {
	// El otro dueno crea SU vale por la ruta real.
	const created = await call("POST", "/petty-cash/vales", {
		cookie: intruder.cookie,
		body: {
			accountId: intruderAccounts.petty,
			categoryId: intruderAccounts.expenseCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Contadora ajena",
			concept: "Vale ajeno",
			amount: 60,
			hasReceipt: true,
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	intruderValeId = created.body.id;

	// Lectura por id: 404 con el mismo mensaje que un id inexistente.
	const foreign = await call("GET", `/petty-cash/vales/${intruderValeId}`, { cookie: owner.cookie });

	assert.equal(foreign.status, 404);
	assert.equal(foreign.body.message, "El vale no existe.");

	const serialized = JSON.stringify(foreign.body);

	assert.ok(!serialized.includes("Vale ajeno"), `no debe viajar el vale ajeno: ${serialized}`);

	// El otro dueno SI lo lee: el 404 es aislamiento, no una ruta rota.
	const own = await call("GET", `/petty-cash/vales/${intruderValeId}`, {
		cookie: intruder.cookie,
	});

	assert.equal(own.status, 200);
	assert.equal(own.body.amount, 60);

	// El listado con la caja ajena devuelve lista vacia (la RLS la hace invisible).
	const listed = await call("GET", `/petty-cash/vales?accountId=${intruderAccounts.petty}`, {
		cookie: owner.cookie,
	});

	assert.equal(listed.status, 200);
	assert.deepEqual(listed.body, []);

	// Lado ESCRITURA: crear un vale en la caja chica ajena responde el error de dominio de la RPC.
	const foreignValesBefore = await valeCount(intruderAccounts.petty);
	const foreignPaymentsBefore = await paymentCount(intruderAccounts.petty);

	const createAttempt = await call("POST", "/petty-cash/vales", {
		cookie: owner.cookie,
		body: {
			accountId: intruderAccounts.petty,
			categoryId: intruderAccounts.expenseCategoryId,
			valeDate: VALE_DATE,
			paidTo: "Rosa Quispe",
			concept: CONCEPT,
			amount: 10,
			hasReceipt: false,
		},
	});

	assert.equal(createAttempt.status, 404, JSON.stringify(createAttempt.body));
	assert.equal(createAttempt.body.message, "La cuenta de caja chica no existe");
	assert.equal(await valeCount(intruderAccounts.petty), foreignValesBefore);
	assert.equal(await paymentCount(intruderAccounts.petty), foreignPaymentsBefore);

	// Anular el vale ajeno tampoco: el estado ajeno queda como estaba.
	const voidAttempt = await call("POST", `/petty-cash/vales/${intruderValeId}/void`, {
		cookie: owner.cookie,
	});

	assert.equal(voidAttempt.status, 404, JSON.stringify(voidAttempt.body));
	assert.equal(voidAttempt.body.message, "El vale no existe");
	assert.equal((await storedVale(intruderValeId)).status, "PENDIENTE");

	// Reponer la caja ajena tampoco, y no crea transferencia.
	const replenishAttempt = await call("POST", "/petty-cash/replenish", {
		cookie: owner.cookie,
		body: {
			accountId: intruderAccounts.petty,
			sourceAccountId: accounts.source,
			valeIds: [intruderValeId],
		},
	});

	assert.equal(replenishAttempt.status, 404, JSON.stringify(replenishAttempt.body));
	assert.equal(replenishAttempt.body.message, "La cuenta de caja chica no existe");
	assert.equal(await replenishCount(intruderAccounts.petty), 0);
	assert.equal((await storedVale(intruderValeId)).status, "PENDIENTE");
});

test("un INSERT directo en petty_cash_vale con el rol de la sesion es rechazado (42501): RLS preexistente, no un guard de C6", async () => {
	// ESTADO PREEXISTENTE, igual que el INSERT directo de `cash_close` en C4: no toca ninguna ruta
	// nueva. Documenta que `petty_cash_vale` solo tiene politica de SELECT, asi que las tres
	// escrituras (alta, anulacion, reposicion) pasan por RPC (S5/S8).
	const failed = await (async () => {
		try {
			await withOwner(harness.db, owner.ownerId, (tx) =>
				tx.execute(sql`
					insert into public.petty_cash_vale (
						owner_id, account_id, serial, vale_date, paid_to, concept, amount
					) values (
						${owner.ownerId}::uuid, ${accounts.petty}::uuid, 999, ${VALE_DATE}::date,
						'Invasor', 'Alta directa', 1
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
		"select count(*)::int as n from public.petty_cash_vale where serial = 999",
	);

	assert.equal(rows.rows[0]?.n, 0, "la fila rechazada no existe");
});
