// e2e de cierres y arqueos del vertical de cajas-bancos (C4) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que el API NO escribe `cash_close`, `cash_close_denomination`,
// `cash_count` ni `cash_count_denomination` —las escribe la base por RPC (S3)— y que todas las
// reglas que deciden si un cierre se permite las aplica PostgreSQL, no Node (S4/S5):
//
//   - 401 en las cinco rutas nuevas antes de validar nada;
//   - un cierre con movimientos devuelve `difference = counted - expected` con `expected` leido
//     de la base (`private.cash_expected_balance`), no calculado en el test (S2);
//   - cerrar un periodo ya cerrado responde el mensaje de dominio exacto;
//   - un `period_end` futuro lo rechaza la base con su mensaje;
//   - una diferencia sobre `cash_difference_tolerance` sin motivo se rechaza, y la misma con
//     motivo cierra (S4);
//   - un `insert into cash_close` con el rol de la sesion muere con `42501`. NO es RED de este
//     slice: no toca ninguna ruta nueva y pasa igual en el commit base. Documenta el ACL/RLS que
//     ya existia (S3);
//   - el cierre de otro dueno responde 404 y sus denominaciones nunca viajan (S6, lectura);
//   - cerrar la CUENTA de otro dueno responde el error de dominio de la RPC (`La cuenta no
//     existe`) y no deja ninguna fila en la cuenta ajena (S6, escritura);
//   - dos llamadas DIRECTAS a `public.close_cash_account` desde dos conexiones del pool, sin API
//     de por medio, producen EXACTAMENTE un cierre y un error de dominio (S5): la serializacion
//     vive en el SQL, no en Node;
//   - dos `fetch` simultaneos del mismo periodo responden un 201 y un 400 de dominio: pina el
//     CONTRATO del API en la carrera, no donde vive el candado (lo pina el test anterior).
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: igual que `cash-accounts.e2e.test.ts`, salen de la API server-side de Better Auth
// (`signUpEmail`), que es el mismo camino que ejecuta el handler HTTP.
//
// FECHAS: fijas y pasadas (`2026-03-01` apertura, `2026-03-10` corte), no "hoy", para no depender
// de la zona horaria del contenedor (la clase de bug de L9). La unica fecha que se calcula es la
// FUTURA del test de rechazo, y se pide a la base (`current_date + 5`): el comparador del SQL es
// su reloj, no el de Node.
//
// FIXTURES: cuentas, metodo, categorias y recibos se siembran con SQL directo como `dev_user`
// (owner de las tablas, igual que los seeds). Los recibos van a mano porque lo que se prueba es
// el cierre sobre movimientos ya existentes, no el alta de pagos; el ANULADO de 999 esta ahi
// para que el `expected` de la base solo cuadre si la formula excluye los anulados.
//
// `deleteOwnerFixtures` NO borra `cash_count` (deuda L5 del doc de la feature: C8 la lleva al
// teardown comun), asi que este archivo borra sus arqueos antes de llamarlo. Sin eso el borrado
// de `cash_account` revienta por FK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { sql } from "drizzle-orm";
import type { Pool } from "pg";
import { withOwner } from "../src/db/with-owner.ts";
import type { ApiHarness } from "./support/harness.ts";
import {
	deleteOwnerFixtures,
	signUpSecondOwner,
	type OwnerSession,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Apertura de TODAS las cuentas del fixture: anterior a cualquier movimiento y al corte. */
const OPENING_DATE = "2026-03-01";

/** Corte del periodo que se cierra en casi todos los tests. */
const PERIOD_END = "2026-03-10";

/** Movimientos de la caja con actividad: un ingreso, un egreso y un recibo ANULADO. */
const INCOME_DATE = "2026-03-05";
const EXPENSE_DATE = "2026-03-07";
const VOIDED_DATE = "2026-03-08";

/**
 * Conteo fisico del cierre con movimientos, escrito como lo que el cajero conto (S/ 350.50).
 *
 * La caja arranca con 100, cobra 300 y paga 50: el esperado de la base es 350. Una diferencia de
 * exactamente 0.50 esta EN el limite de la tolerancia por defecto (`abs(diff) > tolerance` es
 * falso), asi que este cierre prueba de paso que el borde no exige motivo.
 */
const MOVEMENTS_COUNTED = 350.5;

/** Las seis rutas... cinco rutas nuevas con una entrada valida, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/cash-closes" },
	{ method: "GET", path: `/cash-closes/${randomUUID()}` },
	{
		method: "POST",
		path: "/cash-closes",
		body: { cashAccountId: randomUUID(), periodEnd: PERIOD_END, countedBalance: 0 },
	},
	{ method: "GET", path: "/cash-counts" },
	{
		method: "POST",
		path: "/cash-counts",
		body: { accountId: randomUUID(), countDate: PERIOD_END, countedBalance: 0 },
	},
];

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las cuentas que se cierran y se arquearon. */
let owner: OwnerSession;
/** Otro dueno: prueba que su cierre responde 404 y que sus denominaciones no viajan. */
let intruder: OwnerSession;

interface SeededAccounts {
	movements: string;
	denominations: string;
	tolerance: string;
	concurrent: string;
	rpcConcurrent: string;
	future: string;
	closed: string;
	counts: string;
	methodId: string;
	incomeCategoryId: string;
	expenseCategoryId: string;
}

let accounts: SeededAccounts;
let intruderAccounts: SeededAccounts;

/** Cierre creado en el test de movimientos: lo reusan el listado y las aserciones de fila. */
let movementsCloseId: string;
/** Cierre con arqueo del test de denominaciones. */
let denominationsCloseId: string;
/** Cierre de otro dueno: el que el dueno de la sesion no puede leer. */
let intruderCloseId: string;

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

/** Dos decimales, para comparar importes sin ruido de coma flotante. */
function round2(value: number): number {
	return Number(value.toFixed(2));
}

/**
 * El saldo esperado a una fecha, leido de la BASE (`private.cash_expected_balance`).
 *
 * Es la misma funcion que llaman `close_cash_account` y `register_cash_count` (L10 del doc de la
 * feature), y por eso es la unica fuente legitima de `expected` en este test: replicar
 * `apertura + ingresos - egresos ± transferencias` en TypeScript seria una cuarta copia de la
 * formula y taparia justo el bug que S2 quiere evitar.
 */
async function expectedFromDb(accountId: string, asOf: string): Promise<number> {
	const result = await pool.query<{ expected: string }>(
		"select private.cash_expected_balance($1::uuid, $2::date)::text as expected",
		[accountId, asOf],
	);

	return Number(result.rows[0]?.expected);
}

/** Una fecha futura segun el reloj de PostgreSQL (el que compara la RPC), como "YYYY-MM-DD". */
async function futureDateFromDb(): Promise<string> {
	const result = await pool.query<{ date: string }>(
		"select (current_date + 5)::text as date",
	);

	const date = result.rows[0]?.date;

	assert.ok(date, "la base deberia devolver una fecha futura");

	return date;
}

/** Filas de `cash_close` de una cuenta (via SQL, como `dev_user`). */
async function closeCount(accountId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.cash_close where cash_account_id = $1",
		[accountId],
	);

	return result.rows[0]?.n ?? 0;
}

/**
 * Cierra una cuenta llamando a `public.close_cash_account` tal cual, desde el pool del test:
 * sin HTTP, sin `ClosesService`, sin el harness de la app. Es el unico camino para probar que el
 * candado de S5 esta en el SQL y no en Node.
 *
 * La transaccion hace lo minimo que hace `withOwner` (`src/db/with-owner.ts`): fija el GUC que lee
 * `auth.uid()` y cambia el rol de sesion a `authenticated`, al que le aplican las politicas. Sin
 * esos dos pasos el error seria otro (RLS/privilegio) y no la serializacion de la RPC.
 */
async function closeViaRpc(accountId: string, ownerId: string): Promise<string> {
	const client = await pool.connect();

	try {
		await client.query("begin");
		await client.query("select set_config('app.user_id', $1, true)", [ownerId]);
		await client.query("set local role authenticated");

		const result = await client.query<{ id: string }>(
			`select public.close_cash_account(
				$1::uuid, $2::date, null::numeric, null::text, null::jsonb,
				null::text, null::text, null::text
			) as id`,
			[accountId, PERIOD_END],
		);

		await client.query("commit");

		const id = result.rows[0]?.id;

		assert.ok(id, "close_cash_account deberia devolver el id del cierre creado");

		return id;
	} catch (error) {
		// El perdedor de la carrera ya trae la transaccion abortada por el `raise exception`; el
		// rollback solo devuelve la conexion limpia al pool.
		await client.query("rollback").catch(() => undefined);
		throw error;
	} finally {
		client.release();
	}
}

/** La fila cruda de un cierre, en texto, para comparar contra lo que devolvio el API. */
async function storedClose(id: string): Promise<Record<string, string | null>> {
	const result = await pool.query<Record<string, string | null>>(
		`select period_start::text, period_end::text, periodicity::text,
		        opening_balance::text, income_total::text, expense_total::text,
		        expected_balance::text, transfer_in_total::text, transfer_out_total::text,
		        counted_balance::text, difference::text, difference_reason,
		        difference_tolerance::text, change_fund::text, counted_by, verified_by,
		        pen_usd_rate::text, notes
		   from public.cash_close
		  where id = $1`,
		[id],
	);

	const row = result.rows[0];

	assert.ok(row, `deberia existir el cierre ${id}`);

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
 * Siembra el juego de cuentas de un dueno con SQL directo (como `dev_user`).
 *
 * Ocho cuentas, una por escenario, para que ningun test dependa del estado que deja otro:
 *
 *   movements     CASH_BOX, apertura 100, ingreso 300, egreso 50 y un ANULADO de 999
 *   denominations CASH_BOX, apertura 420: el arqueo 200x2 + 20x1 cuadra exacto
 *   tolerance     CASH_BOX, apertura 0: contado 5 -> diferencia 5 sobre la tolerancia 0.50
 *   concurrent    CASH_BOX, apertura 0: la carrera del cierre por HTTP
 *   rpcConcurrent CASH_BOX, apertura 0: la carrera de las llamadas directas a la RPC
 *   future        CASH_BOX, apertura 0: el rechazo de la fecha futura
 *   closed        CASH_BOX, apertura 0: cerrar dos veces el mismo periodo
 *   counts        CASH_BOX, apertura 100: arqueos sorpresivos (nunca se cierra)
 */
async function seedAccounts(
	pool: Pool,
	ownerId: string,
	tag: string,
): Promise<SeededAccounts> {
	const ids: SeededAccounts = {
		movements: randomUUID(),
		denominations: randomUUID(),
		tolerance: randomUUID(),
		concurrent: randomUUID(),
		rpcConcurrent: randomUUID(),
		future: randomUUID(),
		closed: randomUUID(),
		counts: randomUUID(),
		methodId: randomUUID(),
		incomeCategoryId: randomUUID(),
		expenseCategoryId: randomUUID(),
	};

	const boxes: Array<[string, number]> = [
		[ids.movements, 100],
		[ids.denominations, 420],
		[ids.tolerance, 0],
		[ids.concurrent, 0],
		[ids.rpcConcurrent, 0],
		[ids.future, 0],
		[ids.closed, 0],
		[ids.counts, 100],
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
		"insert into public.payment_method (id, code, name, owner_id) values ($1, $2, $3, $4)",
		[ids.methodId, `E2E_${tag}`.toUpperCase(), "E2E efectivo", ownerId],
	);

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'INGRESO', $2, $3, $4), ($5, 'EGRESO', $6, $7, $4)`,
		[
			ids.incomeCategoryId,
			`E2E cobranza ${tag}`,
			`E2E_ING_${tag}`.toUpperCase(),
			ownerId,
			ids.expenseCategoryId,
			`E2E gasto ${tag}`,
			`E2E_EGR_${tag}`.toUpperCase(),
		],
	);

	// Los recibos los numera el trigger `payment_assign_receipt`, asi que `receipt_serial` no
	// viaja. El ANULADO lleva sus tres columnas de anulacion, que es lo que exige
	// `payment_void_check`.
	const payments: Array<[string, string, number, string, string | null]> = [
		["INGRESO", INCOME_DATE, 300, ids.incomeCategoryId, null],
		["EGRESO", EXPENSE_DATE, 50, ids.expenseCategoryId, null],
		["INGRESO", VOIDED_DATE, 999, ids.incomeCategoryId, "anulado en el fixture"],
	];

	for (const [direction, date, amount, categoryId, voidReason] of payments) {
		await pool.query(
			`insert into public.payment
			   (owner_id, direction, payment_date, amount, method_id, cash_account_id,
			    category_id, reference, notes, status, void_reason, voided_at)
			 values ($1, $2::payment_direction, $3::date, $4, $5, $6, $7, 'e2e', 'fixture e2e',
			         $8::payment_status, $9, case when $9::text is null then null else now() end)`,
			[
				ownerId,
				direction,
				date,
				amount,
				ids.methodId,
				ids.movements,
				categoryId,
				voidReason === null ? "EN_REVISION" : "ANULADO",
				voidReason,
			],
		);
	}

	return ids;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de cierres corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-cierres-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await signUpSecondOwner(harness.auth);
	intruder = await signUpSecondOwner(harness.auth);

	accounts = await seedAccounts(pool, owner.ownerId, "cierres");
	intruderAccounts = await seedAccounts(pool, intruder.ownerId, "ajeno");
});

after(async () => {
	// `cash_count` no esta en `deleteOwnerFixtures` (deuda L5): sin estas dos lineas el borrado de
	// `cash_account` falla por FK. `cash_count_denomination` y `cash_close_denomination` cuelgan
	// con `on delete cascade`.
	for (const session of [owner, intruder]) {
		if (session) {
			await pool.query("delete from public.cash_count where owner_id = $1", [session.ownerId]);
			await deleteOwnerFixtures(pool, session.ownerId);
		}
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las rutas de cierres y arqueos responden 401 antes de validar el body", async () => {
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
	const invalid = await call("POST", "/cash-closes", {
		body: { cashAccountId: "no-es-uuid", periodEnd: "ayer", countedBalance: -5 },
	});

	assert.equal(invalid.status, 401);

	const forged = await call("GET", "/cash-closes", {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("POST /cash-closes cierra un periodo con movimientos y la diferencia es contado menos el esperado de la base", async () => {
	// El esperado sale de la base: 100 (apertura) + 300 - 50 = 350, con el ANULADO de 999 fuera.
	const expected = await expectedFromDb(accounts.movements, PERIOD_END);

	const created = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: {
			cashAccountId: accounts.movements,
			periodEnd: PERIOD_END,
			countedBalance: MOVEMENTS_COUNTED,
			notes: "cierre de la semana",
			countedBy: "Ana Rios",
			verifiedBy: "Luis Torres",
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	movementsCloseId = created.body.id;

	assert.equal(created.body.expectedBalance, expected, "el esperado es el de la base");
	assert.equal(created.body.countedBalance, MOVEMENTS_COUNTED);
	assert.equal(
		created.body.difference,
		round2(MOVEMENTS_COUNTED - expected),
		"difference = counted - expected",
	);
	// 0.50 es exactamente la tolerancia por defecto: el borde del `>` no exige motivo (S4).
	assert.equal(created.body.difference, 0.5);
	assert.equal(created.body.differenceReason, null);
	assert.equal(created.body.differenceTolerance, 0.5);

	// El resto de la fila son los numeros que congelo la RPC, no una suma de Node.
	assert.equal(created.body.cashAccountId, accounts.movements);
	assert.equal(created.body.periodicity, "DAILY", "sin `app_setting` la periodicidad cae a DAILY");
	assert.equal(created.body.periodStart, OPENING_DATE);
	assert.equal(created.body.periodEnd, PERIOD_END);
	assert.equal(created.body.openingBalance, 100);
	assert.equal(created.body.incomeTotal, 300);
	assert.equal(created.body.expenseTotal, 50);
	assert.equal(created.body.transferInTotal, 0);
	assert.equal(created.body.transferOutTotal, 0);
	assert.equal(created.body.changeFund, 0);
	assert.equal(created.body.penUsdRate, null, "una cuenta en soles no congela tasa");
	assert.equal(created.body.countedBy, "Ana Rios");
	assert.equal(created.body.verifiedBy, "Luis Torres");
	assert.equal(created.body.notes, "cierre de la semana");
	assert.deepEqual(created.body.denominations, [], "sin arqueo no hay denominaciones");

	// Y la fila persistida es la misma: el API no reescribio nada despues de la RPC.
	const stored = await storedClose(movementsCloseId);

	assert.equal(stored.expected_balance, expected.toFixed(2));
	assert.equal(stored.counted_balance, MOVEMENTS_COUNTED.toFixed(2));
	assert.equal(stored.difference, (MOVEMENTS_COUNTED - expected).toFixed(2));
	assert.equal(stored.difference_tolerance, "0.50");
	assert.equal(stored.period_start, OPENING_DATE);
	assert.equal(stored.period_end, PERIOD_END);
});

test("GET /cash-closes/:id devuelve el cierre con su arqueo y el listado filtra por cuenta", async () => {
	const created = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: {
			cashAccountId: accounts.denominations,
			periodEnd: PERIOD_END,
			// La cantidad 0 no se guarda (la RPC filtra `quantity > 0`).
			denominations: [
				{ denomination: 200, quantity: 2 },
				{ denomination: 20, quantity: 1 },
				{ denomination: 10, quantity: 0 },
			],
			countedBy: "Ana Rios",
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	denominationsCloseId = created.body.id;

	// El conteo lo sumo la RPC desde el detalle: 200x2 + 20x1 = 420, que es el esperado.
	assert.equal(created.body.countedBalance, 420);
	assert.equal(created.body.expectedBalance, 420);
	assert.equal(created.body.difference, 0);
	assert.deepEqual(created.body.denominations, [
		{ denomination: 200, quantity: 2 },
		{ denomination: 20, quantity: 1 },
	]);

	const detail = await call("GET", `/cash-closes/${denominationsCloseId}`, {
		cookie: owner.cookie,
	});

	assert.equal(detail.status, 200);
	assert.equal(detail.body.id, denominationsCloseId);
	assert.deepEqual(detail.body.denominations, [
		{ denomination: 200, quantity: 2 },
		{ denomination: 20, quantity: 1 },
	]);

	// Listado completo: los dos cierres, el mas reciente (mismo corte, otro `created_at`) primero.
	const all = await call("GET", "/cash-closes", { cookie: owner.cookie });

	assert.equal(all.status, 200);
	assert.deepEqual(
		all.body.map((row: { id: string }) => row.id),
		[denominationsCloseId, movementsCloseId],
	);

	// Filtrado por cuenta: solo el de esa cuenta.
	const filtered = await call("GET", `/cash-closes?accountId=${accounts.movements}`, {
		cookie: owner.cookie,
	});

	assert.equal(filtered.status, 200);
	assert.deepEqual(
		filtered.body.map((row: { id: string }) => row.id),
		[movementsCloseId],
	);

	// Un id que no es uuid lo rechaza el pipe (400), sin llegar al servicio.
	const invalid = await call("GET", "/cash-closes/no-es-uuid", { cookie: owner.cookie });

	assert.equal(invalid.status, 400);
});

test("cerrar un periodo ya cerrado responde el mensaje de dominio exacto y no escribe otra fila", async () => {
	const first = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: { cashAccountId: accounts.closed, periodEnd: PERIOD_END, countedBalance: 0 },
	});

	assert.equal(first.status, 201, JSON.stringify(first.body));
	assert.equal(await closeCount(accounts.closed), 1);

	const again = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: { cashAccountId: accounts.closed, periodEnd: PERIOD_END, countedBalance: 0 },
	});

	assert.equal(again.status, 400, JSON.stringify(again.body));
	// Textual de `close_cash_account` (`20261027232454_spec51_cash_close_signatures.sql:90`).
	assert.equal(again.body.message, `El periodo ya esta cerrado hasta ${PERIOD_END}`);
	assert.equal(await closeCount(accounts.closed), 1, "el rechazo no crea un segundo cierre");
});

test("un period_end futuro lo rechaza la base con su mensaje y no crea ningun cierre", async () => {
	const future = await futureDateFromDb();

	const result = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: { cashAccountId: accounts.future, periodEnd: future, countedBalance: 0 },
	});

	assert.equal(result.status, 400, JSON.stringify(result.body));
	assert.equal(
		result.body.message,
		`La fecha de cierre no puede ser futura (${future}). Usa hoy o una fecha anterior`,
	);
	assert.equal(await closeCount(accounts.future), 0);
});

test("una diferencia sobre la tolerancia sin motivo se rechaza; la misma con motivo cierra", async () => {
	const rejected = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: { cashAccountId: accounts.tolerance, periodEnd: PERIOD_END, countedBalance: 5 },
	});

	assert.equal(rejected.status, 400, JSON.stringify(rejected.body));
	// Textual de la RPC: los dos numeros son los `numeric(12,2)` congelados en el mensaje.
	assert.equal(
		rejected.body.message,
		"La diferencia (5.00) supera la tolerancia (0.50). Registra el motivo de la diferencia",
	);
	assert.equal(await closeCount(accounts.tolerance), 0, "el rechazo no escribe nada");

	const accepted = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: {
			cashAccountId: accounts.tolerance,
			periodEnd: PERIOD_END,
			countedBalance: 5,
			differenceReason: "Faltante de cambio en el turno de la manana",
		},
	});

	assert.equal(accepted.status, 201, JSON.stringify(accepted.body));
	assert.equal(accepted.body.difference, 5);
	assert.equal(accepted.body.differenceReason, "Faltante de cambio en el turno de la manana");
	assert.equal(accepted.body.differenceTolerance, 0.5);
});

test("un INSERT directo en cash_close con el rol de la sesion es rechazado (42501): ACL/RLS preexistente, no RED de C4", async () => {
	// ESTADO PREEXISTENTE, no evidencia RED de este slice: este test no toca ninguna ruta nueva y
	// pasa igual en el commit base. Lo que documenta es el ACL/RLS que ya estaba (S3: `cash_close`
	// solo tiene politica de SELECT, asi que el INSERT muere con 42501 aunque el privilegio de
	// tabla exista). Se conserva porque el contrato "no se escribe el cierre sin la RPC" depende
	// de eso, pero la garantia no la introduce C4.
	//
	// Se usa `withOwner`, que es exactamente como trabaja el API: `app.user_id` + rol
	// `authenticated`. La fila es valida en todo salvo el privilegio, asi que el error no puede
	// venir de un CHECK ni de una FK: viene de la RLS.
	await assert.rejects(
		withOwner(harness.db, owner.ownerId, (tx) =>
			tx.execute(sql`
				insert into public.cash_close (
					cash_account_id, periodicity, period_start, period_end,
					opening_balance, expected_balance
				) values (
					${accounts.future}::uuid, 'DAILY', ${OPENING_DATE}::date, ${"2026-04-30"}::date,
					0, 0
				)
			`),
		),
		(error: unknown) => {
			assert.equal(
				postgresCode(error),
				"42501",
				`un INSERT directo deberia fallar por privilegios/RLS, fallo con ${postgresCode(error)}: ${String(error)}`,
			);
			return true;
		},
	);

	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.cash_close where cash_account_id = $1",
		[accounts.future],
	);

	assert.equal(result.rows[0]?.n, 0, "la fila rechazada no existe");
});

test("el cierre de otro dueno responde 404 y sus denominaciones nunca viajan", async () => {
	const created = await call("POST", "/cash-closes", {
		cookie: intruder.cookie,
		body: {
			cashAccountId: intruderAccounts.denominations,
			periodEnd: PERIOD_END,
			countedBalance: 420,
			countedBy: "Contadora ajena",
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	intruderCloseId = created.body.id;

	const foreign = await call("GET", `/cash-closes/${intruderCloseId}`, { cookie: owner.cookie });

	assert.equal(foreign.status, 404);
	assert.equal(foreign.body.message, "El cierre no existe.");

	// Ni el detalle ni el arqueo del otro dueno: la respuesta no nombra `denominations` siquiera.
	const serialized = JSON.stringify(foreign.body);

	assert.ok(!serialized.includes("denominations"), `no debe viajar el arqueo ajeno: ${serialized}`);
	assert.ok(!serialized.includes("420"), `no debe viajar ningun importe ajeno: ${serialized}`);

	// El otro dueno SI puede leer el suyo (el 404 es aislamiento, no una ruta rota).
	const own = await call("GET", `/cash-closes/${intruderCloseId}`, { cookie: intruder.cookie });

	assert.equal(own.status, 200);

	// Y los filtros por cuenta ajena no devuelven nada, ni cierres ni arqueos.
	const closes = await call("GET", `/cash-closes?accountId=${intruderAccounts.movements}`, {
		cookie: owner.cookie,
	});
	const counts = await call("GET", `/cash-counts?accountId=${intruderAccounts.movements}`, {
		cookie: owner.cookie,
	});

	assert.deepEqual(closes.body, []);
	assert.deepEqual(counts.body, []);

	// El listado completo del dueno no incluye el cierre ajeno.
	const all = await call("GET", "/cash-closes", { cookie: owner.cookie });

	assert.ok(
		!all.body.some((row: { id: string }) => row.id === intruderCloseId),
		"el cierre ajeno no aparece en el listado del dueno",
	);
});

test("cerrar la cuenta de otro dueno responde el error de dominio de la RPC y no escribe en la cuenta ajena (S6)", async () => {
	// Lado ESCRITURA del aislamiento: leer el cierre ajeno ya responde 404 arriba, pero cerrar la
	// cuenta ajena es otra ruta y otra garantia. Se usa una cuenta de B sin movimientos (apertura 0,
	// asi el cierre seria un exito limpio si el aislamiento no existiera) que ningun test cierra,
	// de modo que su conteo es el control del test.
	const foreignAccount = intruderAccounts.closed;

	assert.equal(await closeCount(foreignAccount), 0, "el fixture arranca sin cierres en esa cuenta");

	const attempt = await call("POST", "/cash-closes", {
		cookie: owner.cookie,
		body: { cashAccountId: foreignAccount, periodEnd: PERIOD_END, countedBalance: 0 },
	});

	// 400 y no 201: la sesion de A no puede cerrar la cuenta de B. Tampoco 404: la RPC responde su
	// propia excepcion de dominio, con el mismo texto para "no existe" y "es de otro", para no
	// filtrar la existencia de la cuenta ajena.
	assert.equal(attempt.status, 400, JSON.stringify(attempt.body));
	// Textual de `public.close_cash_account`: el `if v_owner is null or v_owner is distinct from
	// auth.uid()` de `20261027232454_spec51_cash_close_signatures.sql:53-55`.
	assert.equal(attempt.body.message, "La cuenta no existe");

	assert.equal(
		await closeCount(foreignAccount),
		0,
		"el rechazo no deja un cierre en la cuenta ajena",
	);

	// B sigue pudiendo cerrarla: lo que rechazo fue el aislamiento, no una cuenta rota.
	const ownClose = await call("POST", "/cash-closes", {
		cookie: intruder.cookie,
		body: { cashAccountId: foreignAccount, periodEnd: PERIOD_END, countedBalance: 0 },
	});

	assert.equal(ownClose.status, 201, JSON.stringify(ownClose.body));
	assert.equal(await closeCount(foreignAccount), 1, "el dueno si cierra su propia cuenta");
});

test("concurrencia en la base (S5): dos llamadas directas a close_cash_account producen un cierre y un error de dominio", async () => {
	const accountId = accounts.rpcConcurrent;

	// Dos conexiones distintas del MISMO pool, disparadas juntas, sin HTTP y sin `ClosesService`:
	// lo unico que puede decidir la carrera es el SQL de la RPC. Si la serializacion estuviera en
	// Node (un pre-chequeo antes del INSERT) esta prueba veria dos exitos o dos cierres.
	const [first, second] = await Promise.allSettled([
		closeViaRpc(accountId, owner.ownerId),
		closeViaRpc(accountId, owner.ownerId),
	]);

	const outcomes = [first, second];
	const statuses = outcomes.map((outcome) => outcome.status).join(",");
	const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
	const lost = outcomes.filter((outcome) => outcome.status === "rejected");

	assert.equal(won.length, 1, `una sola llamada puede crear el cierre: ${statuses}`);
	assert.equal(lost.length, 1, `la otra tiene que ser rechazada por la base: ${statuses}`);

	const failure = lost[0] as PromiseRejectedResult;

	// `P0001` es la excepcion de dominio de PL/pgSQL, no el `23505` del indice: el perdedor espera
	// el `for update` de la cuenta, revalida el ultimo cierre y ahi encuentra el del ganador.
	assert.equal(
		postgresCode(failure.reason),
		"P0001",
		`el perdedor deberia fallar con el error de dominio de la RPC: ${String(failure.reason)}`,
	);
	// Textual de `close_cash_account` (`20261027232454_spec51_cash_close_signatures.sql:90`).
	assert.equal(
		(failure.reason as { message?: string }).message,
		`El periodo ya esta cerrado hasta ${PERIOD_END}`,
		`el perdedor deberia recibir el mensaje de dominio: ${String(failure.reason)}`,
	);

	// Y una sola fila para ese (cuenta, periodo): el perdedor no alcanzo a escribir nada.
	const rows = await pool.query<{ n: number }>(
		`select count(*)::int as n
		   from public.cash_close
		  where cash_account_id = $1 and period_end = $2::date`,
		[accountId, PERIOD_END],
	);

	assert.equal(rows.rows[0]?.n, 1, "exactamente una fila para (cuenta, periodo)");
});

test("concurrencia por HTTP: dos cierres simultaneos del mismo periodo responden un 201 y un 400 de dominio", async () => {
	const body = {
		cashAccountId: accounts.concurrent,
		periodEnd: PERIOD_END,
		countedBalance: 0,
	};

	// Dos `fetch` en paralelo, mismo dueno y misma sesion, sin pre-chequear nada en el cliente.
	//
	// Lo que este test prueba: el CONTRATO del API en la carrera —una peticion responde 201, la
	// otra recibe el mensaje de dominio del periodo ya cerrado— sea cual sea el lugar donde viva
	// el candado. Lo que NO prueba: que el candado viva en la base; pasaria igual con un
	// pre-chequeo en Node. Esa mitad la pina el test anterior, que llama a `close_cash_account`
	// directo desde dos conexiones del pool sin pasar por el API.
	const [first, second] = await Promise.all([
		call("POST", "/cash-closes", { cookie: owner.cookie, body }),
		call("POST", "/cash-closes", { cookie: owner.cookie, body }),
	]);

	const statuses = [first.status, second.status].sort((left, right) => left - right);

	assert.deepEqual(statuses, [201, 400], `una sola respuesta puede ganar: ${statuses.join(",")}`);

	const rejected = first.status === 400 ? first : second;

	assert.equal(rejected.body.message, `El periodo ya esta cerrado hasta ${PERIOD_END}`);
	assert.equal(
		await closeCount(accounts.concurrent),
		1,
		"la base persistio exactamente un cierre del periodo",
	);
});

test("POST /cash-counts registra un arqueo con el esperado de la base y GET /cash-counts lo lista", async () => {
	// La caja de arqueos no tiene movimientos: el esperado a la fecha es su apertura (100).
	const expected = await expectedFromDb(accounts.counts, INCOME_DATE);

	const created = await call("POST", "/cash-counts", {
		cookie: owner.cookie,
		body: {
			accountId: accounts.counts,
			countDate: INCOME_DATE,
			countedBy: "Ana Rios",
			notes: "arqueo sorpresivo",
			denominations: [{ denomination: 100, quantity: 1 }],
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.equal(created.body.accountId, accounts.counts);
	assert.equal(created.body.countDate, INCOME_DATE);
	assert.equal(created.body.countedBalance, 100);
	assert.equal(created.body.expectedBalance, expected);
	assert.equal(created.body.difference, round2(100 - expected));
	assert.equal(created.body.isSurprise, true);
	assert.equal(created.body.countedBy, "Ana Rios");
	assert.equal(created.body.notes, "arqueo sorpresivo");

	const listed = await call("GET", `/cash-counts?accountId=${accounts.counts}`, {
		cookie: owner.cookie,
	});

	assert.equal(listed.status, 200);
	assert.deepEqual(
		listed.body.map((row: { id: string }) => row.id),
		[created.body.id],
	);

	// Un arqueo sobre un periodo ya cerrado lo rechaza la RPC, con su mensaje.
	const closedPeriod = await call("POST", "/cash-counts", {
		cookie: owner.cookie,
		body: { accountId: accounts.closed, countDate: PERIOD_END, countedBalance: 0 },
	});

	assert.equal(closedPeriod.status, 400, JSON.stringify(closedPeriod.body));
	assert.equal(
		closedPeriod.body.message,
		`La fecha del arqueo cae en un periodo ya cerrado (hasta ${PERIOD_END})`,
	);

	// Sin conteo ni denominaciones la RPC pide el efectivo contado: el borde no inventa un 0.
	const missing = await call("POST", "/cash-counts", {
		cookie: owner.cookie,
		body: { accountId: accounts.counts, countDate: INCOME_DATE },
	});

	assert.equal(missing.status, 400, JSON.stringify(missing.body));
	assert.equal(missing.body.message, "Indica el efectivo contado (mayor o igual a cero)");
});
