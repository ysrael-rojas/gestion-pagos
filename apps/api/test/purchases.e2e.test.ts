// e2e del modulo `purchases` de `apps/api` (T3 del port del vertical compras; S6, S8 y S10 de
// `odd/tasks/port-vertical-compras.md`) contra una base viva con las migraciones y los seeds
// aplicados.
//
// Que prueba, en una frase: que una COMPRA se lista, se da de alta, se edita y se lee con su saldo
// por pagar por el camino real (HTTP -> Better Auth -> withOwner -> RPC/RLS), con el numero que
// emitio el proveedor como dato del usuario (S2/L3a) y con los mensajes de S8.
//
// Las diferencias con `vouchers.e2e.test.ts` que este archivo pina:
//
//   * El numero VIAJA en el body del alta y se puede CORREGIR al editar (S2, L3a/L3g), junto con el
//     tipo. La venta no puede: su numero lo asigno la base y el tipo es inmutable.
//   * El mismo numero puede existir como VENTA y como COMPRA a la vez: la unicidad es por
//     `(owner_id, voucher_kind, voucher_number)` (S2).
//   * Una compra es una cuenta POR PAGAR: `voucher_balance` la incluye y el detalle devuelve el
//     saldo que la UI muestra (S6).
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base migrada y sembrada (`packages/db/scripts/apply-sql.mjs` +
//                        `apply-seeds.mjs`).
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Identidad: los duenos salen de `createSecondOwner` (SQL + `signInEmail` real), igual que en el
// resto de los e2e del API. Los datos de dominio propios que el API todavia no puede producir (un
// pago de EGRESO asignado a la compra, la compra de otro dueno, una venta con el mismo numero) se
// insertan por SQL como `dev_user`, la misma via de los seeds. El teardown borra todo en orden de
// FK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import {
	APP_TODAY,
	type AccountIds,
	type OwnerSession,
	createSecondOwner,
	deleteOwnerFixtures,
	insertVoucher,
	seedSecondOwnerDomain,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Textos de S8, verbatim: el test los compara contra lo que responde el API. */
const PROVEEDOR_INEXISTENTE = "El proveedor seleccionado no existe.";
const COMPRA_DUPLICADA = "Ya registraste una compra con ese número de comprobante.";
const COMPROBANTE_INEXISTENTE = "El comprobante no existe.";
/** Textual del trigger `comprobante_protect_paid`, que la RPC re-lanza sin tocar (S8). */
const COMPROBANTE_CON_PAGOS =
	"No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha";

/** Mensaje del pipe de Zod cuando el body no cumple el contrato compartido. */
const PAYLOAD_INVALIDO = "El payload no cumple el contrato compartido.";

const SOME_UUID = "11111111-1111-4111-8111-111111111111";

let harness: ApiHarness;
let pool: Pool;
let alice: OwnerSession;
let aliceIds: AccountIds;
let aliceSupplierId: string;
let aliceSupplierName: string;
let aliceEgresoCategoryId: string;
let bob: OwnerSession;
let bobSupplierId: string;
/** Compra del dueno 2: el dueno 1 no debe verla ni poder editarla. */
let bobPurchaseId: string;
let bobPurchaseNumber: string;
/** Dueno sin compras: el listado tiene que ser un array vacio, no un 404 ni el de otro. */
let emptyOwner: OwnerSession;

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

/**
 * Payload valido del contrato de ESCRITURA de compra (`purchaseWriteSchema`, S2): el numero es
 * OBLIGATORIO y es el del comprobante que emitio el proveedor. Cada caso cambia lo que mira.
 */
function purchaseBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		issueDate: "2026-03-15",
		voucherType: "FACTURA",
		voucherNumber: "F001-000001",
		entityId: aliceSupplierId,
		total: 118,
		paymentType: "CONTADO",
		status: "PENDIENTE",
		...overrides,
	};
}

/** Alta por la ruta real; falla fuerte si no fue 201 (el caso del alta tiene sus propias pruebas). */
// biome-ignore lint/suspicious/noExplicitAny: el alta devuelve el detalle de la compra.
async function createPurchase(body: Record<string, unknown>): Promise<any> {
	const result = await call("POST", "/purchases", { cookie: alice.cookie, body });

	assert.equal(
		result.status,
		201,
		`el alta deberia responder 201: ${JSON.stringify(result.body)}`,
	);

	return result.body;
}

/** Las cuatro rutas del vertical, con entradas validas, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/purchases" },
	{ method: "GET", path: `/purchases/${SOME_UUID}` },
	{ method: "POST", path: "/purchases", body: {} },
	{ method: "PATCH", path: `/purchases/${SOME_UUID}`, body: {} },
];

/**
 * Categoria de EGRESO del dueno 1: la necesita el pago de una compra, que `validate_allocation`
 * solo admite en esa direccion (S6).
 */
async function seedEgresoCategory(ownerId: string, tag: string): Promise<string> {
	const id = randomUUID();

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'EGRESO', $2, $3, $4)`,
		[id, `E2E compras ${tag}`, `E2E_COMPRAS_${tag}`.toUpperCase(), ownerId],
	);

	return id;
}

/** Proveedor del dueno, insertado por SQL como `dev_user` (la misma via de los seeds). */
async function seedSupplier(ownerId: string, tag: string): Promise<{ id: string; name: string }> {
	const id = randomUUID();
	const name = `E2E proveedor ${tag}`;

	await pool.query(
		`insert into public.entidad
		   (id, document_type, document_number, name, billing_email, is_client, is_supplier, owner_id)
		 values ($1, 'SIN_DOCUMENTO', '', $2, $3, false, true, $4)`,
		[id, name, `e2e-proveedor-${tag}@example.test`, ownerId],
	);

	return { id, name };
}

/** Compra de fixture para el caso "no puedo ver la de otro dueno" (S2: el kind lo exige). */
async function insertPurchase(input: {
	ownerId: string;
	entityId: string;
	voucherNumber: string;
	subtotal: string;
	igv: string;
	total: string;
}): Promise<string> {
	const id = randomUUID();

	await pool.query(
		`insert into public.comprobante
		   (id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, owner_id)
		 values ($1, $2, 'COMPRA', 'FACTURA', $3, ${APP_TODAY}, $4, $5, $6, 'CONTADO', $7)`,
		[
			id,
			input.entityId,
			input.voucherNumber,
			input.subtotal,
			input.igv,
			input.total,
			input.ownerId,
		],
	);

	return id;
}

/**
 * Asigna un EGRESO a la compra: es lo que la deja "con pagos registrados" (dispara
 * `comprobante_protect_paid`) y lo que `voucher_balance` resta del saldo (S6).
 */
async function payPurchase(comprobanteId: string, amount: number): Promise<void> {
	const result = await pool.query<{ id: string }>(
		`insert into public.payment
		   (owner_id, entity_id, direction, payment_date, amount, method_id, cash_account_id, category_id, reference, notes)
		 values ($1, $2, 'EGRESO', ${APP_TODAY}, $3, $4, $5, $6, 'e2e', 'fixture compras')
		 returning id`,
		[
			alice.ownerId,
			aliceSupplierId,
			amount,
			aliceIds.methodId,
			aliceIds.cashAccountId,
			aliceEgresoCategoryId,
		],
	);

	const paymentId = result.rows[0]?.id;

	assert.ok(paymentId, "la insercion del pago de fixture deberia devolver id");

	await pool.query(
		`insert into public.payment_allocation (owner_id, payment_id, comprobante_id, amount)
		 values ($1, $2, $3, $4)`,
		[alice.ownerId, paymentId, comprobanteId, amount],
	);
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e del vertical de compras corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	// Secretos efimeros si el entorno no los trae: no se escriben en ningun archivo.
	process.env.BETTER_AUTH_SECRET ??= "e2e-compras-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	alice = await createSecondOwner(pool, harness.auth);
	const domain = await seedSecondOwnerDomain(pool, alice.ownerId);
	aliceIds = domain.ids;
	aliceEgresoCategoryId = await seedEgresoCategory(alice.ownerId, "alice");

	const supplier = await seedSupplier(alice.ownerId, "alice");
	aliceSupplierId = supplier.id;
	aliceSupplierName = supplier.name;

	bob = await createSecondOwner(pool, harness.auth);
	const bobSupplier = await seedSupplier(bob.ownerId, "bob");
	bobSupplierId = bobSupplier.id;
	bobPurchaseNumber = "F900-000001";
	bobPurchaseId = await insertPurchase({
		ownerId: bob.ownerId,
		entityId: bobSupplierId,
		voucherNumber: bobPurchaseNumber,
		subtotal: "100.00",
		igv: "18.00",
		total: "118.00",
	});

	emptyOwner = await createSecondOwner(pool, harness.auth);
});

after(async () => {
	for (const owner of [emptyOwner, bob, alice]) {
		if (pool && owner) {
			await deleteOwnerFixtures(pool, owner.ownerId);
		}
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las cuatro rutas responden 401 antes de validar el payload", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve ANTES del pipe de Zod: un body invalido sin sesion sigue siendo 401.
	const invalidBody = await call("POST", "/purchases", { body: { voucherNumber: "" } });

	assert.equal(invalidBody.status, 401);

	// Y una cookie inventada tampoco abre nada.
	const forged = await call("GET", "/purchases", {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("GET /purchases de un dueno nuevo es un array vacio, no un 404", async () => {
	const result = await call("GET", "/purchases", { cookie: emptyOwner.cookie });

	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.ok(Array.isArray(result.body), "el listado debe ser un array");
	assert.deepEqual(result.body, [], "un dueno sin compras no tiene filas");

	// Y el detalle de un id inventado si es 404, con el texto de S8.
	const invented = await call("GET", `/purchases/${randomUUID()}`, { cookie: alice.cookie });

	assert.equal(invented.status, 404, JSON.stringify(invented.body));
	assert.equal(invented.body?.message, COMPROBANTE_INEXISTENTE);
});

test("POST /purchases da de alta la compra con el numero que emitio el proveedor (S2, S5)", async () => {
	const result = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001-000101", total: 118 }),
	});

	assert.equal(result.status, 201, JSON.stringify(result.body));

	// S5: los montos se derivan del total con `saleAmounts` (18 % con cierre al centavo).
	assert.equal(result.body.subtotal, 100);
	assert.equal(result.body.igv, 18);
	assert.equal(result.body.total, 118);

	// S2: el numero NO lo asigna la base: viaja en el body y la respuesta devuelve el que se
	// escribio. El tipo tambien es del proveedor.
	assert.equal(result.body.voucherNumber, "F001-000101", "el numero es el que se mando");
	assert.equal(result.body.voucherType, "FACTURA");
	assert.equal(result.body.entityId, aliceSupplierId);
	assert.equal(result.body.entityName, aliceSupplierName, "el proveedor viaja como entityName");
	assert.equal(result.body.issueDate, "2026-03-15");
	assert.equal(result.body.paymentType, "CONTADO");
	assert.equal(result.body.creditDays, null);
	assert.equal(result.body.dueDate, null);
	assert.equal(result.body.status, "PENDIENTE");
	assert.equal(result.body.paidAmount, 0);
	assert.equal(result.body.balance, 118);
	assert.match(String(result.body.registrationDate), /^\d{4}-\d{2}-\d{2}$/);

	// El numero se normaliza en los bordes: los espacios no crean un duplicado que el indice unico
	// considere distinto.
	const trimmed = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "  F001-000102  ", total: 59 }),
	});

	assert.equal(trimmed.status, 201, JSON.stringify(trimmed.body));
	assert.equal(trimmed.body.voucherNumber, "F001-000102");

	// Lo que devuelve el API es lo que hay en la base: kind COMPRA (no viaja en el body) y los
	// importes derivados.
	const stored = await pool.query<{
		voucher_kind: string;
		voucher_number: string;
		entity_id: string;
		subtotal: string;
		igv: string;
		total: string;
		owner_id: string;
	}>(
		`select voucher_kind::text, voucher_number, entity_id, subtotal::text, igv::text, total::text, owner_id
		   from public.comprobante where id = $1`,
		[result.body.id],
	);

	assert.equal(stored.rows[0]?.voucher_kind, "COMPRA", "voucher_kind es COMPRA por construccion");
	assert.equal(stored.rows[0]?.voucher_number, "F001-000101");
	assert.equal(stored.rows[0]?.entity_id, aliceSupplierId);
	assert.equal(stored.rows[0]?.owner_id, alice.ownerId, "el dueno sale de la sesion");
	assert.equal(stored.rows[0]?.subtotal, "100.00");
	assert.equal(stored.rows[0]?.igv, "18.00");
	assert.equal(stored.rows[0]?.total, "118.00");
});

test("GET /purchases lista las compras del dueno con el nombre del proveedor y ninguna venta ni ajena (S10)", async () => {
	// Una compra mas vieja y una mas nueva que la del alta, para pinnar el orden por emision.
	const older = await createPurchase(
		purchaseBody({ voucherNumber: "F001-000201", issueDate: "2026-01-10", total: 236 }),
	);
	const newer = await createPurchase(
		purchaseBody({ voucherNumber: "F001-000202", issueDate: "2026-06-20", total: 59 }),
	);

	// Una VENTA del mismo dueno: el listado de compras no puede traerla (el filtro es el kind, S1).
	await insertVoucher(pool, {
		ownerId: alice.ownerId,
		entityId: aliceIds.entityId,
		total: 118,
		voucherNumber: "F050-000001",
	});

	const result = await call("GET", "/purchases", { cookie: alice.cookie });

	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.ok(Array.isArray(result.body), "el listado debe ser un array");
	assert.ok(result.body.length >= 3, "el dueno 1 tiene compras");

	const numbers = result.body.map((row: { voucherNumber: string }) => row.voucherNumber);

	assert.equal(numbers.includes("F001-000101"), true, "la compra del alta esta en el listado");
	assert.equal(numbers.includes(older.voucherNumber), true);
	assert.equal(numbers.includes(newer.voucherNumber), true);
	assert.equal(numbers.includes("F050-000001"), false, "una venta no es una compra");
	assert.equal(numbers.includes(bobPurchaseNumber), false, "la compra de otro dueno no se lista");

	// El nombre del proveedor viaja en la misma fila (la pantalla lo muestra en la columna).
	const created = result.body.find(
		(row: { voucherNumber: string }) => row.voucherNumber === "F001-000101",
	);

	assert.equal(created?.entityName, aliceSupplierName);
	assert.equal(created?.entityId, aliceSupplierId);

	// S10: emision descendente (mas nueva primero).
	const dates = result.body.map((row: { issueDate: string }) => row.issueDate);
	const sorted = [...dates].sort().reverse();

	assert.deepEqual(dates, sorted);

	// El total de filas es el de las compras vivas del dueno: el filtro no pierde ni agrega.
	const expected = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.comprobante
		  where owner_id = $1 and voucher_kind = 'COMPRA' and deleted_at is null`,
		[alice.ownerId],
	);

	assert.equal(result.body.length, expected.rows[0]?.n);
});

test("GET /purchases/:id devuelve el saldo POR PAGAR y lo reduce al asignarle un EGRESO (S6)", async () => {
	const created = await createPurchase(
		purchaseBody({ voucherNumber: "F001-000301", total: 500 }),
	);

	const unpaid = await call("GET", `/purchases/${created.id}`, { cookie: alice.cookie });

	assert.equal(unpaid.status, 200, JSON.stringify(unpaid.body));
	assert.equal(unpaid.body.id, created.id);
	assert.equal(unpaid.body.total, 500);
	assert.equal(unpaid.body.entityName, aliceSupplierName);
	// `voucher_balance` la incluye como cuenta por pagar: sin pagos, el saldo es el total.
	assert.equal(unpaid.body.paidAmount, 0);
	assert.equal(unpaid.body.balance, 500);

	await payPurchase(created.id, 200);

	const paid = await call("GET", `/purchases/${created.id}`, { cookie: alice.cookie });

	assert.equal(paid.status, 200, JSON.stringify(paid.body));
	assert.equal(paid.body.paidAmount, 200, "el EGRESO asignado se descuenta");
	assert.equal(paid.body.balance, 300, "saldo por pagar");

	// La compra de otro dueno no existe para esta sesion (la RLS la hace invisible y el texto es el
	// mismo que el de un id inventado).
	const foreign = await call("GET", `/purchases/${bobPurchaseId}`, { cookie: alice.cookie });

	assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
	assert.equal(foreign.body?.message, COMPROBANTE_INEXISTENTE);
});

test("POST /purchases responde 409 con el mensaje de S8 cuando el numero ya es otra compra (S2, S7)", async () => {
	await createPurchase(purchaseBody({ voucherNumber: "F001-000401", total: 118 }));

	const duplicated = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001-000401", total: 236 }),
	});

	assert.equal(duplicated.status, 409, JSON.stringify(duplicated.body));
	assert.equal(duplicated.body?.message, COMPRA_DUPLICADA);

	// El rechazo no escribio: sigue habiendo una sola compra con ese numero.
	const stored = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.comprobante
		  where owner_id = $1 and voucher_kind = 'COMPRA' and voucher_number = 'F001-000401'`,
		[alice.ownerId],
	);

	assert.equal(stored.rows[0]?.n, 1);
});

test("POST /purchases responde 404 con `El proveedor seleccionado no existe.` para el proveedor de otro dueno (S4, S8)", async () => {
	const foreign = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001-000501", entityId: bobSupplierId }),
	});

	assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
	assert.equal(foreign.body?.message, PROVEEDOR_INEXISTENTE);

	// Un uuid que no existe responde lo mismo: no se filtra la existencia de entidades ajenas.
	const invented = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001-000502", entityId: randomUUID() }),
	});

	assert.equal(invented.status, 404, JSON.stringify(invented.body));
	assert.equal(invented.body?.message, PROVEEDOR_INEXISTENTE);

	const stored = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.comprobante
		  where owner_id = $1 and voucher_number in ('F001-000501', 'F001-000502')`,
		[alice.ownerId],
	);

	assert.equal(stored.rows[0]?.n, 0, "ninguno de los dos rechazos escribio");
});

test("PATCH /purchases/:id corrige el numero Y el tipo mientras la compra no tenga pagos (S2, L3a/L3g)", async () => {
	const created = await createPurchase(
		purchaseBody({ voucherNumber: "F001-000601", voucherType: "FACTURA", total: 118 }),
	);

	// El numero del proveedor es un dato que el usuario digita: a diferencia de la venta, se
	// corrige. El tipo tambien: una BOLETA transcripta como FACTURA es un error de tipeo sobre un
	// documento ajeno.
	const edited = await call("PATCH", `/purchases/${created.id}`, {
		cookie: alice.cookie,
		body: purchaseBody({
			voucherNumber: "B001-000042",
			voucherType: "BOLETA",
			total: 236,
			paymentType: "CREDITO",
			creditDays: 15,
		}),
	});

	assert.equal(edited.status, 200, JSON.stringify(edited.body));
	assert.equal(edited.body.id, created.id);
	assert.equal(edited.body.voucherNumber, "B001-000042", "el numero de una compra se corrige");
	assert.equal(edited.body.voucherType, "BOLETA", "el tipo de una compra se corrige");
	assert.equal(edited.body.total, 236);
	assert.equal(edited.body.subtotal, 200);
	assert.equal(edited.body.igv, 36);
	assert.equal(edited.body.paymentType, "CREDITO");
	assert.equal(edited.body.creditDays, 15);
	assert.equal(edited.body.dueDate, "2026-03-30", "due_date la calcula la base, no el API");
	assert.equal(edited.body.balance, 236);

	// Y lo corregido es lo que quedo en la base.
	const reread = await call("GET", `/purchases/${created.id}`, { cookie: alice.cookie });

	assert.equal(reread.body.voucherNumber, "B001-000042");
	assert.equal(reread.body.voucherType, "BOLETA");
	assert.equal(reread.body.total, 236);
});

test("PATCH /purchases/:id responde 409 con el texto del trigger cuando la compra tiene pagos (S8)", async () => {
	const created = await createPurchase(
		purchaseBody({ voucherNumber: "F001-000701", total: 500 }),
	);

	await payPurchase(created.id, 100);

	const blocked = await call("PATCH", `/purchases/${created.id}`, {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001-000702", total: 900 }),
	});

	assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
	assert.equal(blocked.body?.message, COMPROBANTE_CON_PAGOS);

	// Nada cambio: ni el numero, ni el importe, ni el saldo.
	const unchanged = await call("GET", `/purchases/${created.id}`, { cookie: alice.cookie });

	assert.equal(unchanged.status, 200);
	assert.equal(unchanged.body.voucherNumber, "F001-000701");
	assert.equal(unchanged.body.total, 500);
	assert.equal(unchanged.body.paidAmount, 100);
	assert.equal(unchanged.body.balance, 400);

	// La compra de otro dueno responde el 404 de la RPC, no el trigger.
	const foreign = await call("PATCH", `/purchases/${bobPurchaseId}`, {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001-000703" }),
	});

	assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
	assert.equal(foreign.body?.message, COMPROBANTE_INEXISTENTE);
});

test("una VENTA con el mismo numero no colisiona: la unicidad es por kind (S2)", async () => {
	// La venta existe de verdad en la base, con el numero que la compra va a usar.
	await insertVoucher(pool, {
		ownerId: alice.ownerId,
		entityId: aliceIds.entityId,
		total: 118,
		voucherNumber: "F070-000001",
	});

	const created = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F070-000001", total: 118 }),
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.equal(created.body.voucherNumber, "F070-000001");

	const stored = await pool.query<{ voucher_kind: string; n: number }>(
		`select voucher_kind::text, count(*) over ()::int as n
		   from public.comprobante
		  where owner_id = $1 and voucher_number = 'F070-000001'
		  order by voucher_kind`,
		[alice.ownerId],
	);

	assert.equal(stored.rows.length, 2, "una venta y una compra con el mismo numero");
	assert.deepEqual(
		stored.rows.map((row) => row.voucher_kind),
		["COMPRA", "VENTA"],
	);
});

test("POST /purchases rechaza el body con los mensajes del contrato compartido: el numero es obligatorio (S2, S9)", async () => {
	// El numero de una compra lo tipea el usuario, asi que es un campo REQUERIDO del contrato (la
	// unica diferencia con la venta, cuyo numero lo asigna la base).
	const emptyNumber = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "" }),
	});

	assert.equal(emptyNumber.status, 400, JSON.stringify(emptyNumber.body));
	assert.equal(emptyNumber.body?.message, PAYLOAD_INVALIDO);
	assert.equal(
		emptyNumber.body?.issues?.[0]?.message,
		"El número de comprobante es requerido",
	);

	const badFormat = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001" }),
	});

	assert.equal(badFormat.status, 400, JSON.stringify(badFormat.body));
	assert.equal(
		badFormat.body?.issues?.[0]?.message,
		"Usa el formato serie-correlativo, por ejemplo F001-000001",
	);

	// El resto de los mensajes son los mismos de la venta (S9): el contrato es el mismo schema.
	const noEntity = await call("POST", "/purchases", {
		cookie: alice.cookie,
		body: purchaseBody({ voucherNumber: "F001-000801", entityId: "" }),
	});

	assert.equal(noEntity.status, 400, JSON.stringify(noEntity.body));
	assert.equal(noEntity.body?.issues?.[0]?.message, "Selecciona el cliente o proveedor");

	// Ningun rechazo escribio.
	const stored = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.comprobante
		  where owner_id = $1 and voucher_number in ('F001-000801')`,
		[alice.ownerId],
	);

	assert.equal(stored.rows[0]?.n, 0);
});
