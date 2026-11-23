// e2e del agregado mensual de flujo de caja del vertical de cajas-bancos (C7) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que `GET /cash-flow/monthly` devuelve los totales del mes que el
// dashboard del origen calculaba en el cliente (`getMonthlyCashFlow` + `summarizeCashFlow`), pero
// calculados por PostgreSQL en UNA consulta, con el MISMO filtro del origen:
//
//     status <> 'ANULADO' and payment_date between from and to
//
// POR QUE NO SE PUEDE ARMAR DESDE `GET /payments`: ese listado esta topado a `pageSize` 100
// (`apps/api/src/payments/payments.query.ts:26`) y sumar paginas en Node no es la semantica del
// origen ni es seguro (dos paginas pueden ser de momentos distintos y el tope cambia el total sin
// avisar). El test de las 150 filas de abajo es exactamente eso: si la ruta leyera filas, el total
// se cortaria en 100.
//
// S2 DEL VERTICAL — EL DINERO LO CALCULA LA BASE. `income`, `expense` y `net` salen de un
// `sum(case ... end)`; la app no suma ni resta. El test NO recalcula el total a partir de las filas
// sembradas con una funcion equivalente: compara contra el numero escrito a mano en el comentario
// del fixture, que es el resultado esperado del filtro del origen.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// FECHAS: fijas y pasadas (marzo y junio de 2026), no "hoy", para no depender de la zona horaria
// del contenedor. Los dos bordes del rango (`from` y `to`) tienen un movimiento cada uno: el filtro
// del origen es INCLUSIVE en las dos puntas.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import { deleteOwnerFixtures, signUpSecondOwner, type OwnerSession } from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Rango del caso principal: los dos bordes son INCLUSIVE. */
const FROM = "2026-03-01";
const TO = "2026-03-31";

/** Rango del caso de "muchas filas": 150 movimientos, por encima del tope de `GET /payments`. */
const MANY_FROM = "2026-06-01";
const MANY_TO = "2026-06-30";

/** Rango del caso vacio: ninguna fila del fixture cae aca. */
const EMPTY_FROM = "2025-01-01";
const EMPTY_TO = "2025-01-31";

let harness: ApiHarness;
let pool: Pool;
/** Dueno de los pagos que se agregan. */
let owner: OwnerSession;
/** Otro dueno: sus pagos no pueden entrar en los totales del primero (S6). */
let intruder: OwnerSession;

interface SeededIds {
	cashAccountId: string;
	methodId: string;
	incomeCategoryId: string;
	expenseCategoryId: string;
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

/** Cuenta, metodo y las dos categorias que necesita un `payment` (FK NOT NULL). */
async function seedCatalog(pool: Pool, ownerId: string, tag: string): Promise<SeededIds> {
	const ids: SeededIds = {
		cashAccountId: randomUUID(),
		methodId: randomUUID(),
		incomeCategoryId: randomUUID(),
		expenseCategoryId: randomUUID(),
	};

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'CASH_BOX', $2, 'PEN', 0, '2026-01-01'::date, $3)`,
		[ids.cashAccountId, `E2E flujo ${tag}`, ownerId],
	);

	await pool.query(
		"insert into public.payment_method (id, code, name, owner_id) values ($1, $2, $3, $4)",
		[ids.methodId, `E2E_FLUJO_${tag}`.toUpperCase(), "E2E efectivo", ownerId],
	);

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'INGRESO', $2, $3, $5), ($4, 'EGRESO', $6, $7, $5)`,
		[
			ids.incomeCategoryId,
			`E2E cobranza ${tag}`,
			`E2E_ING_${tag}`.toUpperCase(),
			ids.expenseCategoryId,
			ownerId,
			`E2E gasto ${tag}`,
			`E2E_EGR_${tag}`.toUpperCase(),
		],
	);

	return ids;
}

/**
 * Siembra un recibo con SQL directo, como `dev_user` (la ruta de los seeds).
 *
 * `receipt_serial` no viaja: lo numera el trigger. Un ANULADO necesita sus tres columnas de
 * anulacion, que es lo que exige `payment_void_check`.
 */
async function seedPayment(
	pool: Pool,
	input: {
		ownerId: string;
		ids: SeededIds;
		direction: "INGRESO" | "EGRESO";
		date: string;
		amount: number;
		voided?: boolean;
	},
): Promise<void> {
	await pool.query(
		`insert into public.payment
		   (owner_id, direction, payment_date, amount, method_id, cash_account_id,
		    category_id, reference, notes, status, void_reason, voided_at)
		 values ($1, $2::payment_direction, $3::date, $4, $5, $6, $7, 'e2e', 'fixture e2e',
		         $8::payment_status, $9,
		         case when $9::text is null then null else now() end)`,
		[
			input.ownerId,
			input.direction,
			input.date,
			input.amount,
			input.ids.methodId,
			input.ids.cashAccountId,
			input.direction === "INGRESO" ? input.ids.incomeCategoryId : input.ids.expenseCategoryId,
			input.voided ? "ANULADO" : "EN_REVISION",
			input.voided ? "anulado en el fixture" : null,
		],
	);
}

let ids: SeededIds;
let intruderIds: SeededIds;

/** Ruta del agregado con el rango del caso principal. */
function flowPath(from: string, to: string): string {
	return `/cash-flow/monthly?from=${from}&to=${to}`;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de flujo de caja corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-flujo-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await signUpSecondOwner(harness.auth);
	intruder = await signUpSecondOwner(harness.auth);

	ids = await seedCatalog(pool, owner.ownerId, "flujo");
	intruderIds = await seedCatalog(pool, intruder.ownerId, "ajeno");

	// Fixture del caso principal (marzo de 2026), escrito a mano:
	//
	//   INGRESO 100.10 el 2026-03-01   (borde inferior: INCLUSIVE)
	//   INGRESO 250.00 el 2026-03-15
	//   EGRESO   40.25 el 2026-03-31   (borde superior: INCLUSIVE)
	//   INGRESO 999.00 el 2026-03-10 ANULADO  -> fuera del total
	//   INGRESO 500.00 el 2026-02-28   (fuera del rango, por abajo)
	//   EGRESO  700.00 el 2026-04-01   (fuera del rango, por arriba)
	//
	//   income  = 100.10 + 250.00               = 350.10
	//   expense = 40.25                         =  40.25
	//   net     = 350.10 - 40.25                = 309.85
	await seedPayment(pool, {
		ownerId: owner.ownerId,
		ids,
		direction: "INGRESO",
		date: FROM,
		amount: 100.1,
	});
	await seedPayment(pool, {
		ownerId: owner.ownerId,
		ids,
		direction: "INGRESO",
		date: "2026-03-15",
		amount: 250,
	});
	await seedPayment(pool, {
		ownerId: owner.ownerId,
		ids,
		direction: "EGRESO",
		date: TO,
		amount: 40.25,
	});
	await seedPayment(pool, {
		ownerId: owner.ownerId,
		ids,
		direction: "INGRESO",
		date: "2026-03-10",
		amount: 999,
		voided: true,
	});
	await seedPayment(pool, {
		ownerId: owner.ownerId,
		ids,
		direction: "INGRESO",
		date: "2026-02-28",
		amount: 500,
	});
	await seedPayment(pool, {
		ownerId: owner.ownerId,
		ids,
		direction: "EGRESO",
		date: "2026-04-01",
		amount: 700,
	});

	// El pago del otro dueno cae DENTRO del rango: si la RLS no recortara, apareceria en el total.
	await seedPayment(pool, {
		ownerId: intruder.ownerId,
		ids: intruderIds,
		direction: "INGRESO",
		date: "2026-03-10",
		amount: 1234.56,
	});
});

after(async () => {
	for (const session of [owner, intruder]) {
		if (session) {
			await deleteOwnerFixtures(pool, session.ownerId);
		}
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion el agregado responde 401 antes de validar la query", async () => {
	const result = await call("GET", flowPath(FROM, TO));

	assert.equal(result.status, 401);
	assert.equal(result.body?.message, "Sesion requerida.");

	// Query invalida sin sesion: sigue siendo 401 (la guardia corre antes del pipe).
	const invalid = await call("GET", "/cash-flow/monthly?from=ayer");

	assert.equal(invalid.status, 401);
});

test("GET /cash-flow/monthly devuelve los totales del origen con el filtro del origen", async () => {
	const result = await call("GET", flowPath(FROM, TO), { cookie: owner.cookie });

	assert.equal(result.status, 200, JSON.stringify(result.body));

	// La forma es la de `CashFlowTotals` (`lib/caja/dashboard.ts:17-21` del origen): tres campos.
	assert.deepEqual(Object.keys(result.body).sort(), ["expense", "income", "net"]);
	assert.deepEqual(
		result.body,
		{ income: 350.1, expense: 40.25, net: 309.85 },
		"los bordes son INCLUSIVE, el ANULADO y las filas fuera de rango no entran",
	);

	// El total no incluye el pago de 1234.56 del otro dueno (S6).
	assert.ok(!JSON.stringify(result.body).includes("1234.56"));
});

test("un rango sin movimientos devuelve ceros, no 404", async () => {
	const result = await call("GET", flowPath(EMPTY_FROM, EMPTY_TO), { cookie: owner.cookie });

	assert.equal(result.status, 200);
	assert.deepEqual(result.body, { income: 0, expense: 0, net: 0 });
});

test("el total es un agregado de SQL: 150 movimientos suman 150 y no se cortan en el tope de /payments", async () => {
	// Mas filas que el `pageSize` maximo de `GET /payments` (100). Si la ruta leyera filas y sumara
	// en Node, este total seria 100.
	for (let index = 0; index < 150; index += 1) {
		await seedPayment(pool, {
			ownerId: owner.ownerId,
			ids,
			direction: "INGRESO",
			date: MANY_FROM,
			amount: 1,
		});
	}

	const result = await call("GET", flowPath(MANY_FROM, MANY_TO), { cookie: owner.cookie });

	assert.equal(result.status, 200);
	assert.deepEqual(result.body, { income: 150, expense: 0, net: 150 });
});

test("la query del agregado se valida con el pipe de Zod", async () => {
	const cases = [
		"/cash-flow/monthly",
		"/cash-flow/monthly?from=2026-03-01",
		"/cash-flow/monthly?from=2026-3-1&to=2026-03-31",
		"/cash-flow/monthly?from=ayer&to=hoy",
	];

	for (const path of cases) {
		const result = await call("GET", path, { cookie: owner.cookie });

		assert.equal(result.status, 400, `${path} deberia responder 400`);
	}
});
