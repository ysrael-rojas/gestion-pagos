// e2e de las posiciones de caja y banco del vertical de cajas-bancos (C3) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que la lectura de posiciones devuelve el saldo que calcula la BASE
// (`get_cash_positions` / `get_cash_position`, S2) y no una suma de Node, que una transferencia
// mueve las dos cuentas, que `GET /last-movement-dates` distingue una cuenta con movimientos de
// una sin movimientos, y que ningun id de otro dueno se puede leer por el parametro de ruta
// (404, no una fila filtrada) ni aparece en el listado (S6).
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: igual que `cash-accounts.e2e.test.ts`, salen de la API server-side de Better Auth
// (`signUpEmail`), que es el mismo camino que ejecuta el handler HTTP.
//
// FIXTURES: las cuentas, los recibos y la transferencia se siembran con SQL directo como
// `dev_user` (owner de las tablas, igual que los seeds), que es lo que la tarea permite hacer
// desde el test. La transferencia se inserta en `public.cash_transfer` a mano porque todavia NO
// hay ruta que la cree (`POST /cash-transfers` es C6); la RPC `create_cash_transfer` existe, pero
// el borde HTTP del vertical no la expone en este slice.
//
// FECHAS: el fixture usa fechas pasadas y fijas (`2026-01-01` / `2026-01-10`), no "hoy". Asi el
// test no depende de la zona horaria del contenedor (la clase de bug que describe L9) y ademas
// puede pedir la posicion a una fecha ANTERIOR a los movimientos, que es la unica forma de
// probar que `asOf` llega de verdad a la funcion.
//
// `deleteOwnerFixtures` NO borra `cash_transfer` (deuda L5 del doc de la feature: borra
// `cash_account` antes que sus hijas y C8 lo arregla), asi que este archivo borra sus propias
// transferencias antes de llamarlo. Sin eso el teardown revienta por FK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import {
	deleteOwnerFixtures,
	signUpSecondOwner,
	type OwnerSession,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Saldo inicial de las cuentas del fixture (fecha de apertura, anterior a los movimientos). */
const OPENING_DATE = "2026-01-01";

/** Fecha de TODOS los movimientos del fixture: ingresos, egresos y la transferencia. */
const MOVEMENT_DATE = "2026-01-10";

/**
 * Fecha a la que se pide la posicion para probar que `asOf` es de verdad un parametro:
 * anterior a los movimientos, asi el saldo tiene que ser el de apertura.
 */
const EARLIER_AS_OF = "2026-01-05";

/** Fecha del recibo ANULADO: POSTERIOR a los movimientos, para que contarlo cambie el resultado. */
const VOIDED_DATE = "2026-01-20";

/**
 * Importes del fixture en CENTIMOS (`numeric(12,2)` en la base).
 *
 * La expectativa se arma con esta aritmetica entera y una sola division a number: sumar en JS
 * los importes con decimales da `1074.4500000000002` y el test compararia ruido de coma flotante
 * en vez de la formula.
 */
const CAJA_OPENING = 100_000;
const CAJA_INCOME = 25_010;
const CAJA_EXPENSE = 10_040;
const CAJA_TRANSFER_OUT = 7_525;
const BANCO_OPENING = 50_000;
const BANCO_INCOME = 5_000;
const TRANSFER_SOURCE_OPENING = 30_000;
const TRANSFER_TARGET_OPENING = 20_000;
const TRANSFER_AMOUNT = 4_000;

/** 1000 + 250.10 − 100.40 − 75.25: saldo inicial + ingresos − egresos − transferencia saliente. */
const CAJA_BALANCE = (CAJA_OPENING + CAJA_INCOME - CAJA_EXPENSE - CAJA_TRANSFER_OUT) / 100;
/** 500 + 50 + 75.25: saldo inicial + ingresos + transferencia entrante. */
const BANCO_BALANCE = (BANCO_OPENING + BANCO_INCOME + CAJA_TRANSFER_OUT) / 100;

/** Las ocho claves de una fila de `GET /cash-positions`: lo que leen el dashboard y el listado. */
const POSITION_KEYS = [
	"accountId",
	"balance",
	"bankName",
	"closingPeriodicity",
	"currency",
	"isPettyCash",
	"name",
	"type",
];

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las cuentas del fixture. */
let owner: OwnerSession;
/** Otro dueno sin cuentas: prueba que un id ajeno responde 404 y no aparece en su listado. */
let intruder: OwnerSession;

interface PositionsFixture {
	/** Caja con ingreso, egreso, un anulado y una transferencia saliente. */
	caja: string;
	/** Banco con un ingreso y la transferencia entrante. */
	banco: string;
	/** Cuenta viva sin ningun recibo: no tiene ultimo movimiento. */
	sinMovimientos: string;
	/** Cuenta cuyo unico recibo esta ANULADO: tampoco tiene ultimo movimiento. */
	soloAnulado: string;
	/** Origen de la transferencia dedicada del test de transferencias. */
	transferSource: string;
	/** Destino de la transferencia dedicada del test de transferencias. */
	transferTarget: string;
}

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

/** Las tres lecturas del slice, para el barrido de 401. */
const ROUTES: Array<{ path: string }> = [
	{ path: "/cash-positions" },
	{ path: `/cash-accounts/${randomUUID()}/position` },
	{ path: "/last-movement-dates" },
];

/** Fila de `GET /cash-positions` tal como la espera la UI (el contrato que el test pinnea). */
interface PositionRow {
	accountId: string;
	balance: number;
	name: string;
	type: string;
	currency: string;
	bankName: string | null;
	closingPeriodicity: string | null;
	isPettyCash: boolean;
}

/** Fila de `GET /cash-positions` por id de cuenta. */
function positionOf(rows: PositionRow[], accountId: string): PositionRow {
	const row = rows.find((item) => item.accountId === accountId);

	assert.ok(row, `la cuenta ${accountId} aparece en GET /cash-positions`);

	return row;
}

/**
 * Siembra el fixture completo con SQL como `dev_user`.
 *
 * Los recibos llevan `receipt_serial` NULL a proposito: el trigger `payment_assign_receipt` lo
 * asigna (la columna es NOT NULL y el trigger corre ANTES del chequeo).
 */
async function seedPositionsFixture(
	pool: Pool,
	ownerId: string,
	tag: string,
): Promise<PositionsFixture> {
	const fixture: PositionsFixture = {
		caja: randomUUID(),
		banco: randomUUID(),
		sinMovimientos: randomUUID(),
		soloAnulado: randomUUID(),
		transferSource: randomUUID(),
		transferTarget: randomUUID(),
	};
	const methodId = randomUUID();
	const incomeCategoryId = randomUUID();
	const expenseCategoryId = randomUUID();

	await pool.query(
		`insert into public.payment_method (id, code, name, owner_id) values ($1, $2, $3, $4)`,
		[methodId, `E2E_POS_${tag}`.toUpperCase(), "E2E posiciones", ownerId],
	);

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'INGRESO', $2, $3, $4), ($5, 'EGRESO', $6, $7, $4)`,
		[
			incomeCategoryId,
			`E2E cobranza ${tag}`,
			`E2E_POS_IN_${tag}`.toUpperCase(),
			ownerId,
			expenseCategoryId,
			`E2E gasto ${tag}`,
			`E2E_POS_OUT_${tag}`.toUpperCase(),
		],
	);

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, opening_balance, opening_balance_date, owner_id,
		    bank_name, closing_periodicity)
		 values
		   ($1, 'CASH_BOX', $2, 'PEN', $3, $4, $5, null, null),
		   ($6, 'BANK_ACCOUNT', $7, 'PEN', $8, $4, $5, 'BCP', 'MONTHLY'),
		   ($9, 'CASH_BOX', $10, 'PEN', 0, $4, $5, null, null),
		   ($11, 'CASH_BOX', $12, 'PEN', 0, $4, $5, null, null),
		   ($13, 'CASH_BOX', $14, 'PEN', $15, $4, $5, null, null),
		   ($16, 'BANK_ACCOUNT', $17, 'PEN', $18, $4, $5, 'Interbank', null)`,
		[
			fixture.caja,
			`E2E caja ${tag}`,
			CAJA_OPENING / 100,
			OPENING_DATE,
			ownerId,
			fixture.banco,
			`E2E banco ${tag}`,
			BANCO_OPENING / 100,
			fixture.sinMovimientos,
			`E2E sin movimientos ${tag}`,
			fixture.soloAnulado,
			`E2E solo anulado ${tag}`,
			fixture.transferSource,
			`E2E origen ${tag}`,
			TRANSFER_SOURCE_OPENING / 100,
			fixture.transferTarget,
			`E2E destino ${tag}`,
			TRANSFER_TARGET_OPENING / 100,
		],
	);

	await pool.query(
		`insert into public.payment
		   (owner_id, direction, payment_date, amount, method_id, cash_account_id, category_id,
		    status, void_reason, voided_at)
		 values
		   ($1, 'INGRESO', $2, $3, $4, $5, $6, 'EN_REVISION', null, null),
		   ($1, 'EGRESO',  $2, $7, $4, $5, $8, 'PROCESADO', null, null),
		   ($1, 'EGRESO',  $9, 999.99, $4, $5, $8, 'ANULADO', 'anulado en el fixture', now()),
		   ($1, 'INGRESO', $2, $10, $4, $11, $6, 'PROCESADO', null, null),
		   ($1, 'INGRESO', $9, 444.44, $4, $12, $6, 'ANULADO', 'unico recibo, anulado', now())`,
		[
			ownerId,
			MOVEMENT_DATE,
			CAJA_INCOME / 100,
			methodId,
			fixture.caja,
			incomeCategoryId,
			CAJA_EXPENSE / 100,
			expenseCategoryId,
			VOIDED_DATE,
			BANCO_INCOME / 100,
			fixture.banco,
			fixture.soloAnulado,
		],
	);

	// Dos transferencias: la del fixture principal (caja -> banco) y la dedicada del test de
	// transferencias (origen -> destino), para que una prueba no dependa del saldo de la otra.
	await pool.query(
		`insert into public.cash_transfer
		   (owner_id, source_account_id, target_account_id, amount, transfer_date, notes)
		 values ($1, $2, $3, $4, $5, $6), ($1, $7, $8, $9, $5, $10)`,
		[
			ownerId,
			fixture.caja,
			fixture.banco,
			CAJA_TRANSFER_OUT / 100,
			MOVEMENT_DATE,
			"transferencia del fixture",
			fixture.transferSource,
			fixture.transferTarget,
			TRANSFER_AMOUNT / 100,
			"transferencia del test",
		],
	);

	return fixture;
}

let fixture: PositionsFixture;

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de posiciones corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-posiciones-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await signUpSecondOwner(harness.auth);
	intruder = await signUpSecondOwner(harness.auth);

	fixture = await seedPositionsFixture(pool, owner.ownerId, owner.ownerId.slice(0, 8));
});

after(async () => {
	// `cash_transfer` no esta en `deleteOwnerFixtures` (L5): se borra antes, o el borrado de la
	// cuenta falla por FK. Las cuentas del intruso no tienen transferencias.
	for (const session of [owner, intruder]) {
		if (pool && session) {
			await pool.query("delete from public.cash_transfer where owner_id = $1", [
				session.ownerId,
			]);
		}
	}

	if (pool && owner) {
		await deleteOwnerFixtures(pool, owner.ownerId);
	}

	if (pool && intruder) {
		await deleteOwnerFixtures(pool, intruder.ownerId);
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las tres lecturas de posiciones responden 401 antes de validar la query", async () => {
	for (const route of ROUTES) {
		const result = await call("GET", route.path);

		assert.equal(
			result.status,
			401,
			`GET ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve antes del pipe: una fecha invalida sin sesion sigue siendo 401.
	const invalid = await call("GET", "/cash-positions?asOf=10-01-2026");

	assert.equal(invalid.status, 401);

	const forged = await call("GET", "/last-movement-dates", {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("GET /cash-positions devuelve opening + ingresos − egresos ± transferencias sin contar anulados", async () => {
	const result = await call("GET", `/cash-positions?asOf=${MOVEMENT_DATE}`, {
		cookie: owner.cookie,
	});

	assert.equal(result.status, 200);

	const caja = positionOf(result.body, fixture.caja);
	const banco = positionOf(result.body, fixture.banco);

	// `numeric(12,2)` viaja como number en el JSON: la UI formatea numeros, no strings.
	assert.equal(typeof caja.balance, "number");
	assert.equal(
		caja.balance,
		CAJA_BALANCE,
		"1000 + 250.10 − 100.40 − 75.25: el anulado de 999.99 no cuenta (S2)",
	);
	assert.equal(banco.balance, BANCO_BALANCE, "500 + 50 + 75.25: transferencia entrante");

	// La fila trae lo que leen el dashboard (`type`, `currency`, `balance`) y el listado
	// (`name`, `bankName`, `closingPeriodicity`, `isPettyCash`), y nada mas.
	assert.deepEqual(Object.keys(banco).sort(), POSITION_KEYS);
	assert.deepEqual(banco, {
		accountId: fixture.banco,
		name: `E2E banco ${owner.ownerId.slice(0, 8)}`,
		type: "BANK_ACCOUNT",
		currency: "PEN",
		balance: BANCO_BALANCE,
		bankName: "BCP",
		closingPeriodicity: "MONTHLY",
		isPettyCash: false,
	});

	// `asOf` llega a la funcion: a una fecha anterior a los movimientos, el saldo es el inicial.
	const earlier = await call("GET", `/cash-positions?asOf=${EARLIER_AS_OF}`, {
		cookie: owner.cookie,
	});

	assert.equal(earlier.status, 200);
	assert.equal(positionOf(earlier.body, fixture.caja).balance, CAJA_OPENING / 100);
	assert.equal(positionOf(earlier.body, fixture.banco).balance, BANCO_OPENING / 100);

	// Sin `asOf` la funcion usa su propio default (`current_date`), que es posterior al fixture:
	// los mismos tres terminos, sin que la app calcule "hoy".
	const today = await call("GET", "/cash-positions", { cookie: owner.cookie });

	assert.equal(today.status, 200);
	assert.equal(positionOf(today.body, fixture.caja).balance, CAJA_BALANCE);
});

test("GET /cash-accounts/:id/position devuelve el saldo de UNA cuenta a la fecha pedida", async () => {
	const result = await call(
		"GET",
		`/cash-accounts/${fixture.caja}/position?asOf=${MOVEMENT_DATE}`,
		{ cookie: owner.cookie },
	);

	assert.equal(result.status, 200);
	assert.equal(result.body, CAJA_BALANCE, "mismo numero que la fila del listado");

	const earlier = await call(
		"GET",
		`/cash-accounts/${fixture.caja}/position?asOf=${EARLIER_AS_OF}`,
		{ cookie: owner.cookie },
	);

	assert.equal(earlier.status, 200);
	assert.equal(earlier.body, CAJA_OPENING / 100, "antes de los movimientos: saldo inicial");
});

test("una transferencia mueve las dos cuentas: una baja y la otra sube", async () => {
	const result = await call("GET", `/cash-positions?asOf=${MOVEMENT_DATE}`, {
		cookie: owner.cookie,
	});

	assert.equal(result.status, 200);

	const source = positionOf(result.body, fixture.transferSource);
	const target = positionOf(result.body, fixture.transferTarget);

	assert.equal(
		source.balance,
		(TRANSFER_SOURCE_OPENING - TRANSFER_AMOUNT) / 100,
		"la cuenta de origen baja exactamente el monto transferido",
	);
	assert.equal(
		target.balance,
		(TRANSFER_TARGET_OPENING + TRANSFER_AMOUNT) / 100,
		"la cuenta de destino sube exactamente el monto transferido",
	);
	// No es una suma de Node: los dos saldos salen de `get_cash_positions` (S2).
	assert.equal(
		source.balance + target.balance,
		(TRANSFER_SOURCE_OPENING + TRANSFER_TARGET_OPENING) / 100,
		"la transferencia no crea ni destruye dinero",
	);
});

test("GET /last-movement-dates distingue una cuenta con movimientos de una sin movimientos", async () => {
	const result = await call("GET", "/last-movement-dates", { cookie: owner.cookie });

	assert.equal(result.status, 200);

	// `payment_date` viaja como "YYYY-MM-DD" sin conversion de zona horaria.
	assert.equal(result.body[fixture.caja], MOVEMENT_DATE, "el ultimo recibo no anulado");
	assert.equal(result.body[fixture.banco], MOVEMENT_DATE);
	// Una cuenta sin recibos no tiene fila; una con el unico recibo ANULADO tampoco: el anulado
	// no es un movimiento (misma regla que el saldo).
	assert.equal(result.body[fixture.sinMovimientos], undefined, "sin movimientos: no aparece");
	assert.equal(result.body[fixture.soloAnulado], undefined, "solo un anulado: no es movimiento");
});

test("la posicion de un id de otro dueno responde 404 y no filtra la fila", async () => {
	const result = await call(
		"GET",
		`/cash-accounts/${fixture.caja}/position?asOf=${MOVEMENT_DATE}`,
		{ cookie: intruder.cookie },
	);

	assert.equal(result.status, 404, "un id ajeno no existe para el otro dueno");
	assert.equal(result.body?.message, "La cuenta no existe o fue eliminada.");

	// Tampoco se escapa por el listado ni por el mapa de fechas.
	const positions = await call("GET", `/cash-positions?asOf=${MOVEMENT_DATE}`, {
		cookie: intruder.cookie,
	});

	assert.equal(positions.status, 200);
	assert.deepEqual(positions.body, [], "el intruso no tiene ninguna cuenta propia");

	const dates = await call("GET", "/last-movement-dates", { cookie: intruder.cookie });

	assert.equal(dates.status, 200);
	assert.deepEqual(dates.body, {}, "y ninguna fecha de movimiento ajena");

	// La cuenta del dueno sigue respondiendo igual.
	const own = await call(
		"GET",
		`/cash-accounts/${fixture.caja}/position?asOf=${MOVEMENT_DATE}`,
		{ cookie: owner.cookie },
	);

	assert.equal(own.status, 200);
	assert.equal(own.body, CAJA_BALANCE);
});
