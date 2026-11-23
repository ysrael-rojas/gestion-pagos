// e2e de la superficie de pagos (T5b1) contra la base viva `gestion_pagos_dev`.
//
// Que prueba, en una frase: que cada endpoint del vertical de pagos responde con los datos del
// dueno de la SESION y nada mas, por la misma ruta que usa la UI (HTTP -> Better Auth -> withOwner
// -> RLS).
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada (45 pagos, 41 comprobantes de la demo).
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: las dos salen de `auth.api.signInEmail` / `auth.api.signUpEmail`, el mismo camino
// que ejecuta el handler HTTP de Better Auth. El dueno demo (que no tiene credencial porque el
// seed solo lo crea en `auth.users`) recibe una fila `auth.account` temporal con la contrasena
// hasheada por `hashPassword` de Better Auth; el teardown borra la cuenta y las sesiones.
//
// Fixtures: el segundo dueno se da de alta con `signUpEmail` y sus filas de dominio se siembran
// con SQL directo (igual que los seeds). Como las filas tienen que ser visibles desde otra
// conexion (el request HTTP corre en su propia transaccion), no pueden vivir en una transaccion
// abierta: se borran en el teardown en orden de FK (`deleteOwnerFixtures`). El unico caso
// "insertado dentro de una transaccion que se revierte" es el de las vistas, donde el rollback
// es parte de la prueba.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import { getTodayLocalDate } from "../../../packages/shared/src/lib/utils.ts";
import type { ApiHarness } from "./support/harness.ts";
import {
	type AccountIds,
	type OwnerSession,
	type SeededSecondOwner,
	APP_TODAY,
	deleteOwnerFixtures,
	findSeededOwnerId,
	grantDemoCredential,
	insertPayment,
	insertVoucher,
	pickDemoIds,
	revokeDemoCredential,
	seedSecondOwnerDomain,
	signIn,
	signUpSecondOwner,
	TEST_PASSWORD,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

const SOME_UUID = "11111111-1111-4111-8111-111111111111";

let harness: ApiHarness;
let pool: Pool;
let demo: OwnerSession;
let demoIds: AccountIds;
let demoPaymentCount: number;
let second: SeededSecondOwner;

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

/** Todas las rutas del vertical, con entradas validas, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/payments" },
	{ method: "GET", path: "/payments?direction=INGRESO&desde=2026-01-01&hasta=2026-12-31" },
	{ method: "GET", path: `/payments/${SOME_UUID}` },
	{ method: "GET", path: `/payments/${SOME_UUID}/history` },
	{ method: "GET", path: "/payments/unassigned?direction=INGRESO" },
	{ method: "GET", path: "/payments/assign-state?direction=INGRESO" },
	{ method: "POST", path: "/payments", body: {} },
	{ method: "POST", path: `/payments/${SOME_UUID}/void`, body: { reason: "e2e" } },
	{ method: "POST", path: `/payments/${SOME_UUID}/allocations`, body: { items: [] } },
	{ method: "POST", path: "/payments/mark-processed", body: { paymentIds: [SOME_UUID] } },
	{ method: "GET", path: "/cartera/resumen" },
	{ method: "GET", path: `/cartera/statement/${SOME_UUID}?from=2026-01-01&to=2026-12-31` },
	{ method: "GET", path: "/vouchers/open?direction=INGRESO" },
];

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de pagos corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	// Secretos efimeros si el entorno no los trae: no se escriben en ningun archivo.
	process.env.BETTER_AUTH_SECRET ??= "e2e-pagos-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	const demoOwnerId = await findSeededOwnerId(pool);
	const demoEmail = await grantDemoCredential(pool, demoOwnerId);
	demo = await signIn(harness.auth, demoEmail, TEST_PASSWORD);
	demoIds = await pickDemoIds(pool, demoOwnerId);

	const secondSession = await signUpSecondOwner(harness.auth);
	const domain = await seedSecondOwnerDomain(pool, secondSession.ownerId);
	const assignedPaymentId = await insertPayment(pool, {
		ownerId: secondSession.ownerId,
		ids: domain.ids,
		amount: 400,
		allocation: { comprobanteId: domain.openVoucherId, amount: 400 },
	});
	const unassignedPaymentId = await insertPayment(pool, {
		ownerId: secondSession.ownerId,
		ids: domain.ids,
		amount: 800,
	});

	second = {
		session: secondSession,
		ids: domain.ids,
		openVoucherId: domain.openVoucherId,
		freeVoucherId: domain.freeVoucherId,
		assignedPaymentId,
		unassignedPaymentId,
	};

	const count = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.payment where owner_id = $1",
		[demo.ownerId],
	);
	demoPaymentCount = count.rows[0]?.n ?? 0;
});

after(async () => {
	if (pool && second) {
		await deleteOwnerFixtures(pool, second.session.ownerId);
	}

	if (pool && demo) {
		await revokeDemoCredential(pool, demo.ownerId, demo.sessionTokens);
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion todas las rutas responden 401 antes de validar el payload", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve ANTES del pipe de Zod: una query invalida sin sesion sigue siendo
	// 401, no 400. Si el orden se invirtiera, este caso responderia 400.
	const invalidQuery = await call("GET", "/payments?direction=NOPE");

	assert.equal(invalidQuery.status, 401);

	// Y una cookie inventada tampoco abre nada.
	const forged = await call("GET", "/payments", { cookie: "better-auth.session_token=forged.sig" });

	assert.equal(forged.status, 401);
});

test("GET /payments devuelve los pagos del dueno de la sesion y ninguno del otro dueno", async () => {
	const result = await call("GET", "/payments", { cookie: demo.cookie });

	assert.equal(result.status, 200);
	assert.ok(Array.isArray(result.body), "el listado debe ser un array");
	assert.equal(
		result.body.length,
		demoPaymentCount,
		"el dueno demo debe ver exactamente sus pagos sembrados",
	);

	const ownerRows = await pool.query<{ id: string }>(
		"select id from public.payment where owner_id = $1",
		[demo.ownerId],
	);
	const demoIdsSet = new Set(ownerRows.rows.map((row) => row.id));

	for (const item of result.body) {
		assert.ok(
			demoIdsSet.has(item.id),
			`la fila ${item.id} no pertenece al dueno de la sesion`,
		);
		assert.equal(typeof item.amount, "number", "amount viaja como numero, no como string");
		assert.match(item.receiptNumber, /^R[IE]-\d{6}$/);
		assert.equal(typeof item.unassignedAmount, "number");
	}

	const secondIds = new Set([second.assignedPaymentId, second.unassignedPaymentId]);

	for (const item of result.body) {
		assert.ok(
			!secondIds.has(item.id),
			`el listado del dueno demo filtro una fila del otro dueno: ${item.id}`,
		);
	}

	// El orden previo del endpoint (payment_date descendente) se conserva.
	const dates = result.body.map((item: { paymentDate: string }) => item.paymentDate);

	assert.deepEqual(
		dates,
		[...dates].sort((a: string, b: string) => (a < b ? 1 : -1)),
		"el listado sigue ordenado por fecha de pago descendente",
	);

	// Control positivo del otro lado: el segundo dueno ve lo suyo y no lo del demo.
	const other = await call("GET", "/payments", { cookie: second.session.cookie });

	assert.equal(other.status, 200);
	const otherIds = new Set(other.body.map((item: { id: string }) => item.id));

	assert.ok(otherIds.has(second.unassignedPaymentId));
	assert.ok(otherIds.has(second.assignedPaymentId));
	assert.ok(!otherIds.has(result.body[0].id), "el segundo dueno no debe ver filas del demo");
});

test("GET /payments aplica los filtros del listado (direction, desde, hasta, estado)", async () => {
	const busiest = await pool.query<{ d: string; n: number }>(
		`select payment_date::text as d, count(*)::int as n
		   from public.payment
		  where owner_id = $1 and direction = 'INGRESO'
		  group by 1
		  order by n desc, d desc
		  limit 1`,
		[demo.ownerId],
	);

	const day = busiest.rows[0];

	assert.ok(day, "la demo debe tener pagos de ingreso para filtrar");

	const byDay = await call("GET", `/payments?direction=INGRESO&desde=${day.d}&hasta=${day.d}`, {
		cookie: demo.cookie,
	});

	assert.equal(byDay.status, 200);
	assert.equal(byDay.body.length, day.n);
	for (const item of byDay.body) {
		assert.equal(item.direction, "INGRESO");
		assert.equal(item.paymentDate, day.d);
	}

	const processed = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.payment
		  where owner_id = $1 and status = 'PROCESADO' and direction = 'INGRESO'`,
		[demo.ownerId],
	);

	const byStatus = await call("GET", "/payments?direction=INGRESO&estado=PROCESADO", {
		cookie: demo.cookie,
	});

	assert.equal(byStatus.status, 200);
	assert.equal(byStatus.body.length, processed.rows[0]?.n);
	for (const item of byStatus.body) {
		assert.equal(item.status, "PROCESADO");
	}

	const page = await call("GET", "/payments?page=1&pageSize=5", { cookie: demo.cookie });

	assert.equal(page.status, 200);
	assert.equal(page.body.length, Math.min(5, demoPaymentCount));

	const badQuery = await call("GET", "/payments?pageSize=999", { cookie: demo.cookie });

	assert.equal(badQuery.status, 400, "pageSize fuera de rango se rechaza con el pipe de Zod");
});

test("GET /payments/:id devuelve el detalle con asignaciones y saldos", async () => {
	const withAllocations = await pool.query<{ id: string }>(
		`select p.id from public.payment p
		   join public.payment_allocation a on a.payment_id = p.id
		  where p.owner_id = $1
		  limit 1`,
		[demo.ownerId],
	);
	const paymentId = withAllocations.rows[0]?.id;

	assert.ok(paymentId, "la demo debe tener pagos con asignaciones");

	const result = await call("GET", `/payments/${paymentId}`, { cookie: demo.cookie });

	assert.equal(result.status, 200);
	assert.equal(result.body.id, paymentId);
	assert.ok(Array.isArray(result.body.allocations));
	assert.ok(result.body.allocations.length > 0);
	assert.equal(typeof result.body.assignedAmount, "number");
	assert.equal(typeof result.body.unassignedAmount, "number");
	assert.equal(
		Math.round((result.body.assignedAmount + result.body.unassignedAmount) * 100) / 100,
		result.body.amount,
		"asignado + sin asignar debe reconstruir el importe del pago",
	);

	for (const allocation of result.body.allocations) {
		assert.equal(allocation.paymentId, paymentId);
		assert.equal(typeof allocation.amount, "number");
		assert.match(allocation.voucherNumber, /.+/);
	}
});

test("GET /payments/:id de otro dueno responde 404 y no filtra datos", async () => {
	const result = await call("GET", `/payments/${second.unassignedPaymentId}`, {
		cookie: demo.cookie,
	});

	assert.equal(result.status, 404, "un pago de otro dueno no se distingue de uno inexistente");
	assert.equal(result.body?.amount, undefined);
	assert.equal(result.body?.id, undefined);

	const missing = await call("GET", `/payments/${SOME_UUID}`, { cookie: demo.cookie });

	assert.equal(missing.status, 404);
});

test("GET /payments/:id/history devuelve el historial del comprobante y nada ajeno", async () => {
	const voucher = await pool.query<{ comprobante_id: string }>(
		`select a.comprobante_id from public.payment_allocation a
		  where a.owner_id = $1
		  group by 1
		  order by count(*) desc
		  limit 1`,
		[demo.ownerId],
	);
	const comprobanteId = voucher.rows[0]?.comprobante_id;

	assert.ok(comprobanteId, "la demo debe tener comprobantes con asignaciones");

	const result = await call("GET", `/payments/${comprobanteId}/history`, { cookie: demo.cookie });

	assert.equal(result.status, 200);
	assert.ok(result.body.length > 0, "el historial no puede venir vacio");
	for (const entry of result.body) {
		assert.equal(typeof entry.allocationId, "string");
		assert.equal(typeof entry.paymentId, "string");
		assert.equal(typeof entry.amount, "number");
		assert.equal(typeof entry.paymentAmount, "number");
		assert.match(entry.receiptNumber, /^R[IE]-\d{6}$/);
	}

	// El comprobante del segundo dueno no existe para la sesion del demo: historial vacio, no 403.
	const foreign = await call("GET", `/payments/${second.openVoucherId}/history`, {
		cookie: demo.cookie,
	});

	assert.equal(foreign.status, 200);
	assert.deepEqual(foreign.body, []);
});

test("POST /payments crea el pago por create_payment_with_allocations y lo devuelve completo", async () => {
	const before = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.payment where owner_id = $1",
		[second.session.ownerId],
	);

	const result = await call("POST", "/payments", {
		cookie: second.session.cookie,
		body: {
			entityId: second.ids.entityId,
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 500,
			methodId: second.ids.methodId,
			cashAccountId: second.ids.cashAccountId,
			categoryId: second.ids.categoryId,
			reference: "e2e-ope",
			notes: "e2e alta",
			allocations: [],
		},
	});

	assert.equal(result.status, 201);
	assert.equal(typeof result.body.id, "string");
	assert.equal(result.body.amount, 500);
	assert.equal(result.body.status, "EN_REVISION");
	assert.equal(result.body.unassignedAmount, 500);
	assert.equal(result.body.assignedAmount, 0);
	assert.equal(result.body.reference, "e2e-ope");
	assert.equal(result.body.notes, "e2e alta");
	assert.deepEqual(result.body.allocations, []);
	assert.match(result.body.receiptNumber, /^RI-\d{6}$/);

	const stored = await pool.query<{ owner_id: string; amount: string }>(
		"select owner_id, amount from public.payment where id = $1",
		[result.body.id],
	);

	assert.equal(stored.rows[0]?.owner_id, second.session.ownerId, "el owner sale de la sesion");
	assert.equal(Number(stored.rows[0]?.amount), 500);

	const afterCount = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.payment where owner_id = $1",
		[second.session.ownerId],
	);

	assert.equal(afterCount.rows[0]?.n, (before.rows[0]?.n ?? 0) + 1);
});

test("POST /payments rechaza entidad y cuenta de caja de otro dueno y no escribe nada", async () => {
	const before = await pool.query<{ demo: number; second: number }>(
		`select (select count(*)::int from public.payment where owner_id = $1) as demo,
		        (select count(*)::int from public.payment where owner_id = $2) as second`,
		[demo.ownerId, second.session.ownerId],
	);

	const foreignEntity = await call("POST", "/payments", {
		cookie: demo.cookie,
		body: {
			entityId: second.ids.entityId,
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 100,
			methodId: demoIds.methodId,
			cashAccountId: demoIds.cashAccountId,
			categoryId: demoIds.categoryId,
			allocations: [],
		},
	});

	assert.equal(foreignEntity.status, 403);
	assert.equal(foreignEntity.body?.message, "La entidad no existe");

	const foreignAccount = await call("POST", "/payments", {
		cookie: demo.cookie,
		body: {
			entityId: demoIds.entityId,
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 100,
			methodId: demoIds.methodId,
			cashAccountId: second.ids.cashAccountId,
			categoryId: demoIds.categoryId,
			allocations: [],
		},
	});

	assert.equal(foreignAccount.status, 403);
	assert.equal(foreignAccount.body?.message, "La cuenta de caja no existe");

	const after = await pool.query<{ demo: number; second: number }>(
		`select (select count(*)::int from public.payment where owner_id = $1) as demo,
		        (select count(*)::int from public.payment where owner_id = $2) as second`,
		[demo.ownerId, second.session.ownerId],
	);

	assert.deepEqual(after.rows[0], before.rows[0], "un alta rechazada no deja filas escritas");
});

test("POST /payments valida el payload con el contrato compartido y responde 400 con los issues", async () => {
	const result = await call("POST", "/payments", {
		cookie: demo.cookie,
		body: { direction: "INGRESO" },
	});

	assert.equal(result.status, 400);
	assert.equal(result.body?.message, "El payload no cumple el contrato compartido.");
	assert.ok(Array.isArray(result.body?.issues) && result.body.issues.length > 0);
	assert.ok(result.body.issues.some((issue: { path: string }) => issue.path === "amount"));

	// El superRefine del schema compartido tambien corre: sin entidad no hay asignaciones.
	const noEntity = await call("POST", "/payments", {
		cookie: demo.cookie,
		body: {
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 100,
			methodId: demoIds.methodId,
			cashAccountId: demoIds.cashAccountId,
			categoryId: demoIds.categoryId,
			allocations: [{ comprobanteId: SOME_UUID, amount: 10 }],
		},
	});

	assert.equal(noEntity.status, 400);
	assert.equal(noEntity.body?.issues?.[0]?.message, "Selecciona la entidad para asignar el pago.");
});

test("POST /payments/:id/void anula una sola vez y exige motivo", async () => {
	const created = await call("POST", "/payments", {
		cookie: second.session.cookie,
		body: {
			entityId: second.ids.entityId,
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 120,
			methodId: second.ids.methodId,
			cashAccountId: second.ids.cashAccountId,
			categoryId: second.ids.categoryId,
			allocations: [],
		},
	});

	assert.equal(created.status, 201);

	const voided = await call("POST", `/payments/${created.body.id}/void`, {
		cookie: second.session.cookie,
		body: { reason: "anulado por el e2e" },
	});

	assert.equal(voided.status, 200);

	const detail = await call("GET", `/payments/${created.body.id}`, {
		cookie: second.session.cookie,
	});

	assert.equal(detail.status, 200);
	assert.equal(detail.body.status, "ANULADO");
	assert.equal(detail.body.voidReason, "anulado por el e2e");
	assert.ok(detail.body.voidedAt, "el pago anulado debe llevar fecha de anulacion");

	const again = await call("POST", `/payments/${created.body.id}/void`, {
		cookie: second.session.cookie,
		body: { reason: "otra vez" },
	});

	assert.equal(again.status, 409);

	const withoutReason = await call("POST", `/payments/${created.body.id}/void`, {
		cookie: second.session.cookie,
		body: {},
	});

	assert.equal(withoutReason.status, 400);

	const foreign = await call("POST", `/payments/${created.body.id}/void`, {
		cookie: demo.cookie,
		body: { reason: "no es mio" },
	});

	assert.equal(foreign.status, 404, "anular un pago ajeno se comporta como inexistente");
});

test("POST /payments/:id/allocations asigna el saldo a un comprobante", async () => {
	// Comprobante propio de este test: los comprobantes compartidos del fixture son de solo
	// lectura para que el orden de ejecucion no cambie el resultado de otras pruebas.
	const voucherId = await insertVoucher(pool, {
		ownerId: second.session.ownerId,
		entityId: second.ids.entityId,
		total: 300,
		voucherNumber: `E2E-ASG-${randomUUID().slice(0, 8)}`,
	});

	const created = await call("POST", "/payments", {
		cookie: second.session.cookie,
		body: {
			entityId: second.ids.entityId,
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 400,
			methodId: second.ids.methodId,
			cashAccountId: second.ids.cashAccountId,
			categoryId: second.ids.categoryId,
			allocations: [],
		},
	});

	assert.equal(created.status, 201);

	const allocated = await call("POST", `/payments/${created.body.id}/allocations`, {
		cookie: second.session.cookie,
		body: { items: [{ comprobanteId: voucherId, amount: 300 }] },
	});

	assert.equal(allocated.status, 200);

	const detail = await call("GET", `/payments/${created.body.id}`, {
		cookie: second.session.cookie,
	});

	assert.equal(detail.status, 200);
	assert.equal(detail.body.assignedAmount, 300);
	assert.equal(detail.body.unassignedAmount, 100);
	assert.equal(detail.body.allocations.length, 1);
	assert.equal(detail.body.allocations[0].comprobanteId, voucherId);

	// El comprobante quedo cubierto: sale de `voucher_balance` (vista security_invoker).
	const open = await call("GET", "/vouchers/open?direction=INGRESO", {
		cookie: second.session.cookie,
	});

	assert.equal(open.status, 200);
	assert.ok(
		!open.body.some((voucher: { comprobanteId: string }) => voucher.comprobanteId === voucherId),
		"un comprobante cubierto no puede seguir apareciendo como abierto",
	);

	// Una asignacion a un comprobante inexistente/ajeno se rechaza en la base y no escribe.
	const foreign = await call("POST", `/payments/${created.body.id}/allocations`, {
		cookie: second.session.cookie,
		body: { items: [{ comprobanteId: SOME_UUID, amount: 10 }] },
	});

	assert.equal(foreign.status, 403, "el trigger de consistencia rechaza comprobantes ajenos");
	assert.match(String(foreign.body?.message), /comprobante/i);

	const untouched = await call("GET", `/payments/${created.body.id}`, {
		cookie: second.session.cookie,
	});

	assert.equal(untouched.body.assignedAmount, 300, "la asignacion rechazada no dejo filas");
});

test("GET /payments/unassigned devuelve solo los pagos con saldo sin asignar del dueno", async () => {
	const result = await call("GET", "/payments/unassigned?direction=INGRESO", {
		cookie: second.session.cookie,
	});

	assert.equal(result.status, 200);

	const ids = new Set(result.body.map((payment: { id: string }) => payment.id));

	assert.ok(ids.has(second.unassignedPaymentId), "el pago sin asignar debe aparecer");
	assert.ok(!ids.has(second.assignedPaymentId), "un pago totalmente asignado no es 'sin asignar'");

	const foreign = await call("GET", "/payments/unassigned?direction=INGRESO", {
		cookie: demo.cookie,
	});
	const foreignIds = new Set(foreign.body.map((payment: { id: string }) => payment.id));

	assert.ok(!foreignIds.has(second.unassignedPaymentId));
});

test("GET /payments/assign-state deriva el estado desde payment_balance", async () => {
	const result = await call("GET", "/payments/assign-state?direction=INGRESO", {
		cookie: second.session.cookie,
	});

	assert.equal(result.status, 200);

	const byPayment = new Map(
		result.body.map((row: { paymentId: string; assignState: string }) => [
			row.paymentId,
			row.assignState,
		]),
	);

	assert.equal(byPayment.get(second.unassignedPaymentId), "POR_ASIGNAR");
	assert.equal(byPayment.get(second.assignedPaymentId), "ASIGNADO");

	const demoState = await call("GET", "/payments/assign-state", { cookie: demo.cookie });
	const demoPaymentIds = new Set(
		demoState.body.map((row: { paymentId: string }) => row.paymentId),
	);

	assert.ok(!demoPaymentIds.has(second.unassignedPaymentId), "no puede incluir filas ajenas");
	assert.ok(demoPaymentIds.size > 0);
});

test("POST /payments/mark-processed usa la RPC y respeta el dueno de la sesion", async () => {
	const created = await call("POST", "/payments", {
		cookie: second.session.cookie,
		body: {
			entityId: second.ids.entityId,
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 90,
			methodId: second.ids.methodId,
			cashAccountId: second.ids.cashAccountId,
			categoryId: second.ids.categoryId,
			allocations: [],
		},
	});

	assert.equal(created.status, 201);
	assert.equal(created.body.status, "EN_REVISION");

	const marked = await call("POST", "/payments/mark-processed", {
		cookie: second.session.cookie,
		body: { paymentIds: [created.body.id] },
	});

	assert.equal(marked.status, 200);
	assert.equal(marked.body, 1, "la RPC devuelve cuantos recibos marco");

	const stored = await pool.query<{ status: string }>(
		"select status from public.payment where id = $1",
		[created.body.id],
	);

	assert.equal(stored.rows[0]?.status, "PROCESADO");

	// El dueno demo no puede marcar el recibo de otro: la RPC lo rechaza y nada cambia.
	const created2 = await call("POST", "/payments", {
		cookie: second.session.cookie,
		body: {
			entityId: second.ids.entityId,
			direction: "INGRESO",
			paymentDate: getTodayLocalDate(),
			amount: 91,
			methodId: second.ids.methodId,
			cashAccountId: second.ids.cashAccountId,
			categoryId: second.ids.categoryId,
			allocations: [],
		},
	});

	const foreign = await call("POST", "/payments/mark-processed", {
		cookie: demo.cookie,
		body: { paymentIds: [created2.body.id] },
	});

	assert.equal(foreign.status, 400);
	assert.equal(
		foreign.body?.message,
		"Solo se pueden marcar recibos en revisión de tus cuentas",
	);

	const untouched = await pool.query<{ status: string }>(
		"select status from public.payment where id = $1",
		[created2.body.id],
	);

	assert.equal(untouched.rows[0]?.status, "EN_REVISION");
});

test("GET /cartera/resumen agrega los buckets del dueno de la sesion", async () => {
	const result = await call("GET", "/cartera/resumen", { cookie: second.session.cookie });

	assert.equal(result.status, 200);
	assert.equal(result.body.today, getTodayLocalDate());

	for (const bucket of [
		result.body.receivable,
		result.body.payable,
		result.body.unassignedReceipts,
		result.body.unassignedPayments,
	]) {
		assert.equal(typeof bucket.count, "number");
		assert.equal(typeof bucket.amount, "number");
		assert.equal(typeof bucket.overdueCount, "number");
		assert.equal(typeof bucket.overdueAmount, "number");
	}

	// Las expectativas se calculan en SQL con la MISMA semantica del origen (SPEC 48/50), para
	// que el resultado no dependa del orden en que corrieron los otros tests.
	const vouchers = await pool.query<{ count: number; amount: string; overdue: number; overdue_amount: string }>(
		`select count(*)::int as count,
		        coalesce(sum(v.balance), 0)::numeric as amount,
		        count(*) filter (where v.effective_due_date < ${APP_TODAY})::int as overdue,
		        coalesce(sum(v.balance) filter (where v.effective_due_date < ${APP_TODAY}), 0)::numeric as overdue_amount
		   from public.voucher_balance v
		   join public.comprobante c on c.id = v.comprobante_id
		  where c.owner_id = $1 and v.voucher_kind = 'VENTA' and v.balance > 0`,
		[second.session.ownerId],
	);

	assert.equal(result.body.receivable.count, vouchers.rows[0]?.count);
	assert.equal(result.body.receivable.amount, Number(vouchers.rows[0]?.amount));
	assert.equal(result.body.receivable.overdueCount, vouchers.rows[0]?.overdue);
	assert.equal(result.body.receivable.overdueAmount, Number(vouchers.rows[0]?.overdue_amount));
	assert.equal(result.body.payable.count, 0, "el segundo dueno no tiene comprobantes de compra");

	const receipts = await pool.query<{ count: number; amount: string }>(
		`select count(*)::int as count, coalesce(sum(b.unassigned_amount), 0)::numeric as amount
		   from public.payment_balance b
		   join public.payment p on p.id = b.payment_id
		  where p.owner_id = $1
		    and b.status in ('EN_REVISION', 'PROCESADO')
		    and b.unassigned_amount > 0
		    and p.direction = 'INGRESO'
		    and p.is_cash_movement = false`,
		[second.session.ownerId],
	);

	assert.equal(result.body.unassignedReceipts.count, receipts.rows[0]?.count);
	assert.equal(result.body.unassignedReceipts.amount, Number(receipts.rows[0]?.amount));
	assert.ok(result.body.unassignedReceipts.count > 0, "el dueno tiene recibos con saldo");

	// Aislamiento: el resumen del demo no puede incluir la deuda del segundo dueno.
	const demoResumen = await call("GET", "/cartera/resumen", { cookie: demo.cookie });

	assert.equal(demoResumen.status, 200);

	const expected = await pool.query<{ n: number }>(
		`select count(*)::int as n
		   from public.voucher_balance v
		   join public.comprobante c on c.id = v.comprobante_id
		  where c.owner_id = $1 and v.voucher_kind = 'VENTA' and v.balance > 0`,
		[demo.ownerId],
	);

	assert.equal(
		demoResumen.body.receivable.count,
		expected.rows[0]?.n,
		"el bucket de cobranza cuenta exactamente los comprobantes abiertos del dueno",
	);
});

test("GET /cartera/statement/:accountId devuelve los pagos de la cuenta en el rango", async () => {
	const accountId = second.ids.cashAccountId;
	const from = "2000-01-01";
	const to = getTodayLocalDate();

	const result = await call(
		"GET",
		`/cartera/statement/${accountId}?from=${from}&to=${to}`,
		{ cookie: second.session.cookie },
	);

	assert.equal(result.status, 200);

	const expected = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.payment
		  where owner_id = $1 and cash_account_id = $2
		    and payment_date between $3 and $4`,
		[second.session.ownerId, accountId, from, to],
	);

	assert.equal(result.body.length, expected.rows[0]?.n);
	for (const payment of result.body) {
		assert.equal(payment.cashAccountId, accountId);
		assert.ok(payment.paymentDate >= from && payment.paymentDate <= to);
	}

	// La cuenta del segundo dueno no existe para la sesion del demo.
	const foreign = await call("GET", `/cartera/statement/${accountId}?from=${from}&to=${to}`, {
		cookie: demo.cookie,
	});

	assert.equal(foreign.status, 200);
	assert.deepEqual(foreign.body, []);

	const invalid = await call("GET", `/cartera/statement/${accountId}?from=ayer&to=hoy`, {
		cookie: demo.cookie,
	});

	assert.equal(invalid.status, 400);
});

test("GET /vouchers/open lee voucher_balance y devuelve solo los comprobantes del dueno", async () => {
	const result = await call("GET", "/vouchers/open?direction=INGRESO", { cookie: demo.cookie });

	assert.equal(result.status, 200);
	assert.ok(result.body.length > 0, "la demo debe tener comprobantes abiertos");

	const ownerVouchers = await pool.query<{ id: string }>(
		"select id from public.comprobante where owner_id = $1",
		[demo.ownerId],
	);
	const demoVoucherIds = new Set(ownerVouchers.rows.map((row) => row.id));

	for (const voucher of result.body) {
		assert.ok(
			demoVoucherIds.has(voucher.comprobanteId),
			`voucher_balance filtro un comprobante ajeno: ${voucher.comprobanteId}`,
		);
		assert.equal(voucher.voucherKind, "VENTA");
		assert.ok(voucher.balance > 0);
		assert.equal(typeof voucher.total, "number");
		assert.equal(typeof voucher.paidAmount, "number");

		const expected = await pool.query<{ balance: string }>(
			"select balance from public.voucher_balance where comprobante_id = $1",
			[voucher.comprobanteId],
		);

		assert.equal(voucher.balance, Number(expected.rows[0]?.balance));
	}

	assert.ok(
		!result.body.some(
			(voucher: { comprobanteId: string }) =>
				voucher.comprobanteId === second.openVoucherId ||
				voucher.comprobanteId === second.freeVoucherId,
		),
		"los comprobantes del segundo dueno no pueden aparecer",
	);

	const secondOpen = await call("GET", "/vouchers/open?direction=INGRESO", {
		cookie: second.session.cookie,
	});

	assert.equal(secondOpen.status, 200);
	const secondIds = new Set(secondOpen.body.map((v: { comprobanteId: string }) => v.comprobanteId));

	assert.ok(secondIds.has(second.openVoucherId));
	assert.ok(!secondIds.has(result.body[0].comprobanteId));

	const badDirection = await call("GET", "/vouchers/open?direction=NOPE", { cookie: demo.cookie });

	assert.equal(badDirection.status, 400);
});

test("las vistas security_invoker no devuelven filas ajenas (fixture insertada y revertida)", async () => {
	// Esta prueba hace lo que el resto no puede: crear una fila de OTRO dueno dentro de una
	// transaccion visible para la misma conexion y comprobar las dos vistas sobre ella, para
	// revertirla al final. Es la prueba directa de que `security_invoker` + RLS filtran por
	// `app.user_id`, sin depender de ningun `where owner_id` escrito en el API.
	const client = await pool.connect();
	const entityId = randomUUID();
	const comprobanteId = randomUUID();

	try {
		await client.query("begin");

		await client.query(
			`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, owner_id)
			 values ($1, 'SIN_DOCUMENTO', '', 'e2e rollback', 'rollback@example.test', true, $2)`,
			[entityId, second.session.ownerId],
		);

		await client.query(
			`insert into public.comprobante
			   (id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, owner_id)
			 values ($1, $2, 'VENTA', 'FACTURA', $3, ${APP_TODAY}, 700, 0, 700, 'CONTADO', $4)`,
			[comprobanteId, entityId, `E2E-RB-${comprobanteId.slice(0, 8)}`, second.session.ownerId],
		);

		const payment = await client.query<{ id: string }>(
			`insert into public.payment
			   (owner_id, entity_id, direction, payment_date, amount, method_id, cash_account_id, category_id, reference)
			 values ($1, $2, 'INGRESO', ${APP_TODAY}, 250, $3, $4, $5, 'e2e rollback')
			 returning id`,
			[
				second.session.ownerId,
				entityId,
				second.ids.methodId,
				second.ids.cashAccountId,
				second.ids.categoryId,
			],
		);
		const paymentId = payment.rows[0]?.id;

		assert.ok(paymentId);

		// Misma sesion, rol de la aplicacion y GUC del dueno demo.
		await client.query("select set_config('app.user_id', $1, true)", [demo.ownerId]);
		await client.query("set local role authenticated");

		const asDemo = await client.query<{ vouchers: number; payments: number }>(
			`select (select count(*)::int from public.voucher_balance where comprobante_id = $1) as vouchers,
			        (select count(*)::int from public.payment_balance where payment_id = $2) as payments`,
			[comprobanteId, paymentId],
		);

		assert.deepEqual(
			asDemo.rows[0],
			{ vouchers: 0, payments: 0 },
			"voucher_balance/payment_balance no pueden mostrar filas de otro dueno",
		);

		// Control positivo: el mismo fixture SI se ve con la identidad de su dueno.
		await client.query("select set_config('app.user_id', $1, true)", [second.session.ownerId]);

		const asOwner = await client.query<{ vouchers: number; payments: number }>(
			`select (select count(*)::int from public.voucher_balance where comprobante_id = $1) as vouchers,
			        (select count(*)::int from public.payment_balance where payment_id = $2) as payments`,
			[comprobanteId, paymentId],
		);

		assert.deepEqual(asOwner.rows[0], { vouchers: 1, payments: 1 });
	} finally {
		// Revierte la fila ajena y el cambio de rol/GUC de la transaccion.
		await client.query("rollback");
		client.release();
	}
});
