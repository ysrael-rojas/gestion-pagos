// e2e del modulo `vouchers` de `apps/api` (T3 del port del vertical ventas, S5/S6/S9 de
// `odd/tasks/port-vertical-ventas.md`; T1 del port del vertical series, S2 de
// `odd/tasks/port-vertical-series.md`) contra una base viva con las migraciones y los seeds
// aplicados.
//
// Que prueba, en una frase: que el alta, la edicion, el listado y el detalle de un comprobante de
// VENTA pasan por el camino real (HTTP -> Better Auth -> withOwner -> RPC/RLS), que el dueno sale
// de la sesion y nunca del payload, y que los mensajes de S6 llegan al cliente con su status.
//
// S2 cambia dos cosas de lo que se pina aca: el body ya no lleva el numero (lo asigna la base
// desde la serie por defecto del tipo, y sin serie por defecto no hay alta) y la edicion no puede
// cambiarlo. El alta necesita una serie sembrada, que `before` inserta por SQL.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base migrada y sembrada (`packages/db/scripts/apply-sql.mjs` +
//                        `apply-seeds.mjs`).
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Identidad: los dos duenos de este archivo se crean por SQL (`createSecondOwner`), igual que el
// procedimiento documentado en `docs/operacion/crear-usuario.md`: el alta publica esta cerrada
// desde L77, asi que `signUpEmail` no es una via disponible ni para los tests. La ENTRADA si es la
// real (`signInEmail`), y el GUC `app.user_id` lo sigue fijando `withOwner` a partir de la sesion.
//
// Los comprobantes de fixture se insertan por SQL como `dev_user` cuando el caso necesita un
// estado que el API no puede producir (un comprobante con pagos), y se crean por la ruta HTTP
// cuando el caso es del alta. El teardown borra todo en orden de FK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import { getTodayLocalDate } from "../../../packages/shared/src/lib/utils.ts";
import type { ApiHarness } from "./support/harness.ts";
import {
	type AccountIds,
	type OwnerSession,
	createSecondOwner,
	deleteOwnerFixtures,
	insertPayment,
	insertVoucher,
	seedSecondOwnerDomain,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Textos de S6, verbatim: el test los compara contra lo que responde el API. */
const CLIENTE_INEXISTENTE = "El cliente seleccionado no existe.";
const SIN_SERIE_POR_DEFECTO =
	"No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.";
const SALDO_INALCANZABLE = "No se pudo cargar el saldo de los comprobantes.";
const COMPROBANTE_CON_PAGOS =
	"No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha";
/** Texto de la RPC `editar_venta`, que T3 mapea a 404 (ver L10 del doc de la feature). */
const COMPROBANTE_INEXISTENTE = "El comprobante no existe.";
/** Texto de S13.3, verbatim: el tipo de un comprobante emitido es inmutable, como su numero. */
const TIPO_INMUTABLE = "El tipo de un comprobante emitido no se puede cambiar.";

/** Mensaje del pipe de Zod cuando el body no cumple `voucherFormSchema` (S11). */
const PAYLOAD_INVALIDO = "El payload no cumple el contrato compartido.";

const SOME_UUID = "11111111-1111-4111-8111-111111111111";

let harness: ApiHarness;
let pool: Pool;
let first: OwnerSession;
let firstIds: AccountIds;
let firstEntityName: string;
/** Comprobante del dueno 1 con 200 ya asignados de un total de 500 (saldo abierto 300). */
let paidVoucherId: string;
let second: OwnerSession;
let secondEntityId: string;
/** Comprobante del dueno 2: el dueno 1 no debe verlo ni poder editarlo. */
let secondVoucherId: string;
let secondVoucherNumber: string;

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
 * Payload minimo valido del contrato de ESCRITURA (`voucherWriteSchema`, S2); cada caso cambia solo
 * lo que mira.
 *
 * SIN `voucherNumber`: el numero dejo de viajar en el body. Lo asigna la base desde la serie por
 * defecto del tipo y el API devuelve el que quedo escrito.
 */
function voucherBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		issueDate: "2026-03-15",
		voucherType: "FACTURA",
		entityId: firstIds.entityId,
		total: 118,
		paymentType: "CONTADO",
		status: "PENDIENTE",
		...overrides,
	};
}

/** Alta por la ruta real; falla fuerte si no fue 201 (el caso de alta tiene sus propias pruebas). */
// biome-ignore lint/suspicious/noExplicitAny: el alta devuelve el detalle del comprobante.
async function createVoucher(body: Record<string, unknown>): Promise<any> {
	const result = await call("POST", "/vouchers", { cookie: first.cookie, body });

	assert.equal(result.status, 201, `el alta deberia responder 201: ${JSON.stringify(result.body)}`);

	return result.body;
}

/** Las cuatro rutas del vertical, con entradas validas, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/vouchers" },
	{ method: "GET", path: `/vouchers/${SOME_UUID}` },
	{ method: "POST", path: "/vouchers", body: {} },
	{ method: "PATCH", path: `/vouchers/${SOME_UUID}`, body: {} },
];

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e del vertical de ventas corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	// Secretos efimeros si el entorno no los trae: no se escriben en ningun archivo.
	process.env.BETTER_AUTH_SECRET ??= "e2e-ventas-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	first = await createSecondOwner(pool, harness.auth);
	const domain = await seedSecondOwnerDomain(pool, first.ownerId);
	firstIds = domain.ids;

	const entity = await pool.query<{ name: string }>("select name from public.entidad where id = $1", [
		firstIds.entityId,
	]);
	firstEntityName = entity.rows[0]?.name ?? "";

	// Serie F001 de FACTURA del dueno 1, POR DEFECTO y con un `last_number` que el test controla:
	// desde S2 el alta toma el numero de aca (`code-lpad(last+1, 6, '0')`), asi que sin serie por
	// defecto no hay venta. Los seeds no traen series (el control los declara en `null`), asi que se
	// siembra por SQL y `auth.users` la arrastra en el teardown.
	await pool.query(
		`insert into public.voucher_series (owner_id, voucher_type, code, last_number, is_default)
		 values ($1, 'FACTURA', 'F001', 3, true)`,
		[first.ownerId],
	);

	// Comprobante con pagos (el trigger `comprobante_protect_paid` bloquea importe, numero,
	// cliente y fecha) y con saldo abierto: el numero respeta el patron de S7 a proposito, para
	// que el caso llegue al trigger y no muera antes en la validacion del schema.
	paidVoucherId = await insertVoucher(pool, {
		ownerId: first.ownerId,
		entityId: firstIds.entityId,
		total: 500,
		voucherNumber: "F002-000001",
	});
	await insertPayment(pool, {
		ownerId: first.ownerId,
		ids: firstIds,
		amount: 200,
		allocation: { comprobanteId: paidVoucherId, amount: 200 },
	});

	second = await createSecondOwner(pool, harness.auth);
	secondEntityId = randomUUID();
	const tag = second.ownerId.slice(0, 8);

	await pool.query(
		`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, owner_id)
		 values ($1, 'SIN_DOCUMENTO', '', $2, $3, true, $4)`,
		[secondEntityId, `E2E ajeno ${tag}`, `e2e-ajeno-${tag}@example.test`, second.ownerId],
	);

	secondVoucherNumber = "F009-000001";
	secondVoucherId = await insertVoucher(pool, {
		ownerId: second.ownerId,
		entityId: secondEntityId,
		total: 900,
		voucherNumber: secondVoucherNumber,
	});
});

after(async () => {
	if (pool && second) {
		await deleteOwnerFixtures(pool, second.ownerId);
	}

	if (pool && first) {
		await deleteOwnerFixtures(pool, first.ownerId);
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
	const invalidBody = await call("POST", "/vouchers", { body: { voucherNumber: "" } });

	assert.equal(invalidBody.status, 401);

	// Y una cookie inventada tampoco abre nada.
	const forged = await call("GET", "/vouchers", { cookie: "better-auth.session_token=forged.sig" });

	assert.equal(forged.status, 401);
});

test("GET /vouchers/open sigue siendo la ruta de cartera y no el detalle de un comprobante", async () => {
	// `vouchers` ya estaba en la allowlist del BFF y `GET /vouchers/open` es la ruta de la
	// cartera (`CarteraController`). El modulo nuevo registra `GET /vouchers/:id`, asi que el
	// orden de registro de los modulos decide quien atiende "open": si el vertical de ventas
	// ganara, este request responderia 400 (un uuid invalido) o 404. Es la regresion que se pina.
	const result = await call("GET", "/vouchers/open?direction=INGRESO", { cookie: first.cookie });

	assert.equal(result.status, 200);
	assert.ok(Array.isArray(result.body), "la cartera devuelve un array de saldos");
	assert.ok(result.body.length > 0, "el dueno 1 tiene comprobantes con saldo abierto");
	// Columna de `voucher_balance`, no del detalle del vertical de ventas (`id`).
	assert.ok("comprobanteId" in result.body[0], "la fila tiene que ser la de `voucher_balance`");
	assert.equal("id" in result.body[0], false);
});

test("POST /vouchers da de alta la venta y asigna el numero que calculo la base", async () => {
	// Sin `issueDate` en el body: el API tiene que usar el "hoy" del NEGOCIO (S9), no el reloj del
	// proceso ni `toISOString()`.
	const body = voucherBody({
		voucherType: "FACTURA",
		total: 118,
	});

	delete body.issueDate;

	const result = await call("POST", "/vouchers", { cookie: first.cookie, body });

	assert.equal(result.status, 201, JSON.stringify(result.body));

	// S2: los montos se derivan del total con el 18 % y cierre al centavo.
	assert.equal(result.body.subtotal, 100);
	assert.equal(result.body.igv, 18);
	assert.equal(result.body.total, 118);

	// S9: el default de emision es el de la zona del negocio.
	assert.equal(result.body.issueDate, getTodayLocalDate());
	assert.match(
		String(result.body.registrationDate),
		/^\d{4}-\d{2}-\d{2}$/,
		"registrationDate es una fecha ISO corta (columna con default `current_date`)",
	);

	// S3: CONTADO no lleva dias de credito y `due_date` (columna generada) queda en null.
	assert.equal(result.body.creditDays, null);
	assert.equal(result.body.dueDate, null);

	// S2: la serie F001 esta sembrada con `last_number = 3`, asi que la base asigna el 4.
	assert.equal(result.body.voucherNumber, "F001-000004");
	assert.equal(result.body.voucherType, "FACTURA");
	assert.equal(result.body.entityId, firstIds.entityId);
	assert.equal(result.body.entityName, firstEntityName);
	assert.equal(result.body.status, "PENDIENTE");
	assert.equal(result.body.paidAmount, 0);
	assert.equal(result.body.balance, 118);

	// Lo que devuelve el API es EXACTAMENTE lo que hay en la base, no un preview del cliente.
	const stored = await pool.query<{ voucher_number: string }>(
		"select voucher_number from public.comprobante where id = $1",
		[result.body.id],
	);

	assert.equal(stored.rows[0]?.voucher_number, result.body.voucherNumber);

	// S2: el alta avanzo `last_number` en la misma transaccion.
	const series = await pool.query<{ last_number: number }>(
		`select last_number from public.voucher_series
		  where owner_id = $1 and voucher_type = 'FACTURA' and code = 'F001'`,
		[first.ownerId],
	);

	assert.equal(series.rows[0]?.last_number, 4);

	// S2: un `voucherNumber` que todavia mande el cliente se IGNORA (T5 lo saca del formulario).
	// El numero es el que asigna la base, no el que viaja en el body.
	const stray = await call("POST", "/vouchers", {
		cookie: first.cookie,
		body: voucherBody({ voucherType: "FACTURA", voucherNumber: "F001-000900", total: 59 }),
	});

	assert.equal(stray.status, 201, JSON.stringify(stray.body));
	assert.equal(stray.body.voucherNumber, "F001-000005", "el numero del body no se usa");

	const afterStray = await pool.query<{ last_number: number }>(
		`select last_number from public.voucher_series
		  where owner_id = $1 and voucher_type = 'FACTURA' and code = 'F001'`,
		[first.ownerId],
	);

	assert.equal(afterStray.rows[0]?.last_number, 5);
});

test("POST /vouchers responde el mensaje de S6 cuando el tipo no tiene serie por defecto", async () => {
	// El dueno 2 no tiene ninguna serie: sin serie por defecto no hay alta (S2, L4c).
	const result = await call("POST", "/vouchers", {
		cookie: second.cookie,
		body: voucherBody({ entityId: secondEntityId, total: 118 }),
	});

	assert.equal(result.status, 400, JSON.stringify(result.body));
	assert.equal(result.body?.message, SIN_SERIE_POR_DEFECTO);

	const stored = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.comprobante where owner_id = $1",
		[second.ownerId],
	);

	assert.equal(stored.rows[0]?.n, 1, "no se escribio ninguna venta nueva");
});

test("GET /vouchers lista las ventas del dueno de la sesion y ninguna ajena", async () => {
	const result = await call("GET", "/vouchers", { cookie: first.cookie });

	assert.equal(result.status, 200);
	assert.ok(Array.isArray(result.body), "el listado debe ser un array");

	const expected = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.comprobante
		  where owner_id = $1 and voucher_kind = 'VENTA' and deleted_at is null`,
		[first.ownerId],
	);

	assert.equal(result.body.length, expected.rows[0]?.n);
	assert.ok(result.body.length > 0, "el dueno 1 tiene comprobantes");

	// La fila ajena y las columnas del listado.
	assert.equal(
		result.body.some((row: { voucherNumber: string }) => row.voucherNumber === secondVoucherNumber),
		false,
		"el listado no puede traer comprobantes de otro dueno",
	);

	// Orden: emision descendente (el contrato de la pantalla de ventas).
	const dates = result.body.map((row: { issueDate: string }) => row.issueDate);
	const sorted = [...dates].sort().reverse();

	assert.deepEqual(dates, sorted);
});

test("GET /vouchers/:id devuelve el comprobante con su saldo", async () => {
	const result = await call("GET", `/vouchers/${paidVoucherId}`, { cookie: first.cookie });

	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.equal(result.body.id, paidVoucherId);
	assert.equal(result.body.voucherNumber, "F002-000001");
	assert.equal(result.body.entityName, firstEntityName);
	assert.equal(result.body.total, 500);
	// El saldo es el de `voucher_balance`, que es el que muestra el origen: 500 - 200 asignados.
	assert.equal(result.body.paidAmount, 200);
	assert.equal(result.body.balance, 300);
	assert.equal(result.body.status, "PENDIENTE");

	// Un comprobante de otro dueno no existe para esta sesion (la RLS lo hace invisible y el
	// mensaje es el mismo que el de un id inventado).
	const foreign = await call("GET", `/vouchers/${secondVoucherId}`, { cookie: first.cookie });

	assert.equal(foreign.status, 404);
	assert.equal(foreign.body?.message, COMPROBANTE_INEXISTENTE);

	const invented = await call("GET", `/vouchers/${randomUUID()}`, { cookie: first.cookie });

	assert.equal(invented.status, 404);
	assert.equal(invented.body?.message, COMPROBANTE_INEXISTENTE);
});

test("PATCH /vouchers/:id edita la venta, recalcula el vencimiento y NO cambia el numero", async () => {
	const created = await createVoucher(voucherBody({ total: 236 }));

	// Edicion completa (el contrato es el mismo del formulario) a CREDITO. El TIPO viaja con el
	// que la fila ya tiene: desde S13.3 el tipo de un comprobante emitido es inmutable (el numero
	// lo asigno la serie de ese tipo), asi que cambiarlo responde 409 con su propio mensaje. El
	// caso del rechazo lo pina la prueba de abajo.
	const result = await call("PATCH", `/vouchers/${created.id}`, {
		cookie: first.cookie,
		body: voucherBody({
			voucherType: "FACTURA",
			issueDate: "2026-03-10",
			total: 590,
			paymentType: "CREDITO",
			creditDays: 15,
		}),
	});

	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.equal(result.body.id, created.id);
	assert.equal(result.body.voucherType, "FACTURA", "el tipo sigue siendo el del alta (S13.3)");
	assert.equal(result.body.issueDate, "2026-03-10");
	assert.equal(result.body.subtotal, 500);
	assert.equal(result.body.igv, 90);
	assert.equal(result.body.total, 590);
	assert.equal(result.body.paymentType, "CREDITO");
	assert.equal(result.body.creditDays, 15);
	// `due_date` es columna generada: la escribe la base (issue_date + credit_days), nunca el API.
	assert.equal(result.body.dueDate, "2026-03-25");
	assert.equal(result.body.balance, 590);

	// S2: el numero de un comprobante emitido es inmutable (la correccion va por NC/ND, L4b), y un
	// `voucherNumber` en el body de la edicion se ignora.
	assert.equal(result.body.voucherNumber, created.voucherNumber);

	const series = await pool.query<{ last_number: number }>(
		`select last_number from public.voucher_series
		  where owner_id = $1 and voucher_type = 'FACTURA' and code = 'F001'`,
		[first.ownerId],
	);

	assert.equal(series.rows[0]?.last_number, 6, "la edicion no avanza la serie");
});

test("PATCH /vouchers/:id responde 409 cuando el body cambia el tipo de un comprobante emitido (S13.3)", async () => {
	const created = await createVoucher(voucherBody({ total: 100 }));

	assert.equal(created.voucherType, "FACTURA");

	// El numero lo asigno la serie de FACTURA: si la fila pasara a BOLETA, un correlativo de
	// factura quedaria publicado bajo otro tipo. Es un rechazo por ESTADO (409), no un 400: la
	// peticion esta bien formada y la correccion va por NC/ND.
	const result = await call("PATCH", `/vouchers/${created.id}`, {
		cookie: first.cookie,
		body: voucherBody({ voucherType: "BOLETA", total: 900 }),
	});

	assert.equal(result.status, 409, JSON.stringify(result.body));
	assert.equal(result.body?.message, TIPO_INMUTABLE);

	// Nada de la fila cambio: ni el tipo, ni el numero, ni el importe.
	const unchanged = await call("GET", `/vouchers/${created.id}`, { cookie: first.cookie });

	assert.equal(unchanged.status, 200);
	assert.equal(unchanged.body.voucherType, "FACTURA");
	assert.equal(unchanged.body.voucherNumber, created.voucherNumber);
	assert.equal(unchanged.body.total, 100);
});

test("PATCH /vouchers/:id rechaza un comprobante con pagos con el mensaje del trigger", async () => {
	// Cambiar el importe de un comprobante con pagos no anulados lo bloquea el trigger
	// `comprobante_protect_paid`, y la RPC no lo puede saltar (S6/S8): el texto llega tal cual.
	const result = await call("PATCH", `/vouchers/${paidVoucherId}`, {
		cookie: first.cookie,
		body: voucherBody({
			total: 900,
		}),
	});

	assert.equal(result.status, 409, JSON.stringify(result.body));
	assert.equal(result.body?.message, COMPROBANTE_CON_PAGOS);

	// Nada cambio: el importe y el saldo siguen siendo los de antes.
	const unchanged = await call("GET", `/vouchers/${paidVoucherId}`, { cookie: first.cookie });

	assert.equal(unchanged.body.total, 500);
	assert.equal(unchanged.body.balance, 300);
});

test("POST /vouchers guarda CONTADO sin dias aunque el body los mande (S3)", async () => {
	// El formulario arranca con 30 al elegir Credito y puede quedar el valor viejo al volver a
	// Contado. `voucherFormSchema` lo limpia antes de la base (S3) y el CHECK
	// `comprobante_credit_days` nunca se viola: si no fuera asi, este caso responderia 400.
	const result = await call("POST", "/vouchers", {
		cookie: first.cookie,
		body: voucherBody({
			total: 100,
			paymentType: "CONTADO",
			creditDays: 30,
		}),
	});

	assert.equal(result.status, 201, JSON.stringify(result.body));
	assert.equal(result.body.creditDays, null);
	assert.equal(result.body.dueDate, null);

	const stored = await pool.query<{ credit_days: number | null; due_date: string | null }>(
		"select credit_days, due_date from public.comprobante where id = $1",
		[result.body.id],
	);

	assert.equal(stored.rows[0]?.credit_days, null);
	assert.equal(stored.rows[0]?.due_date, null);
});

test("el estado lo deriva la base: el `status` del formulario no se escribe", async () => {
	// L8 del doc de la feature: el `status` del formulario es editable en el origen pero quien lo
	// calcula es `private.refresh_comprobante_status` al asignar o anular pagos. La tabla arranca en
	// PENDIENTE y el API no pisa esa columna.
	const result = await call("POST", "/vouchers", {
		cookie: first.cookie,
		body: voucherBody({ total: 118, status: "PAGADO" }),
	});

	assert.equal(result.status, 201, JSON.stringify(result.body));
	assert.equal(result.body.status, "PENDIENTE");
});

test("PATCH y POST responden 404 con `El comprobante no existe.` cuando el id no es una venta del dueno", async () => {
	const invented = await call("PATCH", `/vouchers/${randomUUID()}`, {
		cookie: first.cookie,
		body: voucherBody(),
	});

	assert.equal(invented.status, 404, JSON.stringify(invented.body));
	assert.equal(invented.body?.message, COMPROBANTE_INEXISTENTE);

	// El comprobante de otro dueno responde lo mismo: no se filtra su existencia.
	const foreign = await call("PATCH", `/vouchers/${secondVoucherId}`, {
		cookie: first.cookie,
		body: voucherBody(),
	});

	assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
	assert.equal(foreign.body?.message, COMPROBANTE_INEXISTENTE);
});

test("POST /vouchers responde 404 con `El cliente seleccionado no existe.`", async () => {
	const result = await call("POST", "/vouchers", {
		cookie: first.cookie,
		body: voucherBody({ entityId: randomUUID() }),
	});

	assert.equal(result.status, 404, JSON.stringify(result.body));
	assert.equal(result.body?.message, CLIENTE_INEXISTENTE);
});

test("POST /vouchers rechaza el body con los mensajes del contrato compartido (S4/S11)", async () => {
	// El `issues` sale del MISMO schema que valida el formulario: si el API tuviera un DTO propio,
	// el texto (y el contrato) serian otros.
	//
	// El numero ya NO se valida aca: dejo de ser un campo del contrato de escritura (S2). El
	// formulario lo sigue exigiendo (`voucherFormSchema`) para el preview, y eso lo pina
	// `apps/web/lib/ventas/formulario.test.ts`.
	//
	// `""` no es "sin fecha": la fecha de emision vacia sigue siendo el mensaje de S4.
	const emptyDate = await call("POST", "/vouchers", {
		cookie: first.cookie,
		body: voucherBody({ issueDate: "" }),
	});

	assert.equal(emptyDate.status, 400);
	assert.equal(emptyDate.body?.message, PAYLOAD_INVALIDO);
	assert.equal(emptyDate.body?.issues?.[0]?.message, "La fecha de emisión es requerida");

	// El tipo sigue siendo un enum cerrado: un tipo que no existe no llega a la base.
	const badType = await call("POST", "/vouchers", {
		cookie: first.cookie,
		body: voucherBody({ voucherType: "REMITO" }),
	});

	assert.equal(badType.status, 400);
	assert.equal(badType.body?.issues?.[0]?.message, "Selecciona el tipo de comprobante");
});

test("S6: el mensaje del saldo no se confunde con el generico de la base", async () => {
	// `No se pudo cargar el saldo de los comprobantes.` existe porque el origen leia
	// `voucher_balance` en su propia consulta: si esa lectura falla, el cliente tiene que ver ese
	// texto y no el generico. La rama se prueba en `vouchers.errors.test.ts` (romper la vista aca
	// exigiria mutar el esquema); este caso pina que el detalle normal si trae saldo.
	const result = await call("GET", `/vouchers/${paidVoucherId}`, { cookie: first.cookie });

	assert.equal(result.status, 200);
	assert.equal(typeof result.body.paidAmount, "number");
	assert.equal(typeof result.body.balance, "number");
	assert.notEqual(result.body.message, SALDO_INALCANZABLE);
});
