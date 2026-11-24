// e2e del modulo `notes` de `apps/api` (T3 del port del vertical notas; S1, S4 y S10 de
// `odd/tasks/port-vertical-notas.md`) contra una base viva con las migraciones y los seeds
// aplicados.
//
// Que prueba, en una frase: que el alta de una nota de credito/debito y el listado de las notas de
// un comprobante pasan por el camino real (HTTP -> Better Auth -> withOwner -> RPC `security
// definer`), que el dueno sale de la sesion y nunca del payload, que el numero lo asigna la base
// desde la serie por defecto del TIPO DE LA NOTA (S3), que los montos los deriva `saleAmounts` (S4)
// y que los mensajes de S10 llegan al cliente con su status.
//
// CONTRATO DE LECTURA: `GET /notes?voucherId=<uuid>`. El prefijo `notes` es propio de este modulo,
// asi que ninguna ruta comparte prefijo con `GET /vouchers/:id` ni con `GET /vouchers/open` (la
// trampa de orden de registro que documenta `vouchers.controller.ts`): aca el orden de `AppModule`
// no puede cambiar el ruteo.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base migrada y sembrada (`packages/db/scripts/apply-sql.mjs` +
//                        `apply-seeds.mjs`).
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Identidad: los duenos salen de `createSecondOwner` (SQL + `signInEmail`, la entrada real). Las
// series se crean por la ruta HTTP (`POST /series`), que es la que `crear_nota` consume: sin serie
// por defecto del tipo de la nota no hay correlativo y el alta falla con el mensaje de S3. Las
// ventas se crean por `POST /vouchers`. El unico estado sembrado por SQL es el que el API no puede
// producir: el comprobante de COMPRA (no hay vertical de compras) y el comprobante de otro dueno
// para el caso de S10.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import { voucherAdjustmentSchema } from "../../../packages/shared/src/lib/schemas/nota.ts";
import type { ApiHarness } from "./support/harness.ts";
import {
	type AccountIds,
	type OwnerSession,
	createSecondOwner,
	deleteOwnerFixtures,
	insertVoucher,
	seedSecondOwnerDomain,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Textos de S10, verbatim: el test los compara contra lo que responde el API. */
const REFERENCIADO_INEXISTENTE = "El comprobante referenciado no existe.";
const SOLO_BASE_DE_VENTA = "Solo puedes referenciar factura, boleta o nota de venta.";
const NOTA_DUPLICADA = "Ya registraste una nota con ese número de comprobante.";
const DATOS_NOTA_INVALIDOS = "Los datos de la nota no son válidos.";
const TOPE_CREDITO =
	"Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.";
const REFERENCIA_AJENA = "El comprobante referenciado es de otro usuario.";

/** Texto de S3 (la serie por defecto del tipo de la nota), verbatim. */
const SIN_SERIE_POR_DEFECTO =
	"No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.";

/** Mensajes del contrato compartido (`notaWriteSchema`, S8), verbatim. */
const MOTIVO_FUERA_DE_CATALOGO = "El motivo no pertenece al catálogo de la nota";
const MOTIVO_REQUERIDO = "Selecciona el motivo de la nota";

/** Mensaje del pipe de Zod cuando el body no cumple el contrato compartido. */
const PAYLOAD_INVALIDO = "El payload no cumple el contrato compartido.";

/** Textual del trigger `comprobante_owner_consistency`, que la RPC NO reescribe. */
const TRIGGER_REFERENCIA_AJENA =
	"El comprobante referencia una entidad o comprobante de otro usuario";

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las pruebas de alta y listado, con sus tres series por defecto creadas por HTTP. */
let owner: OwnerSession;
let ownerIds: AccountIds;
/** Dueno de un comprobante ajeno, para el 404 de S10. */
let other: OwnerSession;
let otherVoucherId: string;
/** Dueno SIN serie por defecto de nota: el alta responde el mensaje de S3. */
let bare: OwnerSession;
let bareIds: AccountIds;
/** Todos los duenos creados, para el teardown. */
const owners: Array<{ session: OwnerSession; ids: AccountIds }> = [];

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

/** Body minimo valido de `notaWriteSchema` (S4/S8); cada caso cambia solo lo que mira. */
function notaBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		issueDate: "2026-11-20",
		voucherType: "NOTA_CREDITO",
		total: 18,
		motiveCode: "01",
		referencedComprobanteId: "",
		...overrides,
	};
}

/** Alta de serie por la ruta real; falla fuerte si no fue 201 (el CRUD tiene su propio e2e). */
async function createSerie(
	session: OwnerSession,
	body: { voucherType: string; code: string; isDefault: boolean },
): Promise<void> {
	const result = await call("POST", "/series", { cookie: session.cookie, body });

	assert.equal(
		result.status,
		201,
		`el alta de la serie ${body.voucherType}/${body.code} deberia responder 201: ${JSON.stringify(result.body)}`,
	);
}

/** Venta por la ruta real (necesita la serie por defecto de FACTURA del dueno). */
async function createSale(session: OwnerSession, entityId: string, total: number): Promise<string> {
	const result = await call("POST", "/vouchers", {
		cookie: session.cookie,
		body: {
			issueDate: "2026-11-19",
			voucherType: "FACTURA",
			entityId,
			total,
			paymentType: "CONTADO",
			status: "PENDIENTE",
		},
	});

	assert.equal(result.status, 201, `el alta de la venta deberia responder 201: ${JSON.stringify(result.body)}`);

	return result.body.id;
}

/** Alta de nota por la ruta real; falla fuerte si no fue 201 (los rechazos tienen sus pruebas). */
// biome-ignore lint/suspicious/noExplicitAny: el alta devuelve la fila del ajuste.
async function createNota(body: Record<string, unknown>, session = owner): Promise<any> {
	const result = await call("POST", "/notes", { cookie: session.cookie, body });

	assert.equal(result.status, 201, `el alta de la nota deberia responder 201: ${JSON.stringify(result.body)}`);

	return result.body;
}

/** El saldo que expone `GET /vouchers/:id` para el comprobante referenciado. */
async function balanceOf(voucherId: string): Promise<{ paidAmount: number; balance: number }> {
	const result = await call("GET", `/vouchers/${voucherId}`, { cookie: owner.cookie });

	assert.equal(result.status, 200, JSON.stringify(result.body));

	return { paidAmount: result.body.paidAmount, balance: result.body.balance };
}

/** `last_number` de la serie de un tipo en el listado del API, o `null` si no existe. */
async function lastNumberOf(session: OwnerSession, voucherType: string): Promise<number | null> {
	const list = await call("GET", "/series", { cookie: session.cookie });

	assert.equal(list.status, 200, JSON.stringify(list.body));

	const row = list.body.find((item: { voucherType: string }) => item.voucherType === voucherType);

	return row?.lastNumber ?? null;
}

/** Las filas crudas de las notas de un comprobante, para afirmar que un rechazo no escribio. */
async function storedNotes(referencedId: string): Promise<Array<{ voucher_number: string; total: string }>> {
	const result = await pool.query<{ voucher_number: string; total: string }>(
		`select voucher_number, total::text
		   from public.comprobante
		  where referenced_comprobante_id = $1
		    and voucher_type in ('NOTA_CREDITO', 'NOTA_DEBITO', 'COMPROBANTE_RETENCION')
		  order by voucher_number`,
		[referencedId],
	);

	return result.rows;
}

/** Siembra un comprobante de COMPRA: este vertical no tiene alta de compras. */
async function seedCompra(ownerSession: OwnerSession, entityId: string): Promise<string> {
	const id = randomUUID();

	await pool.query(
		`insert into public.comprobante
		   (id, owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
		    issue_date, subtotal, igv, total, payment_type, credit_days)
		 values ($1, $2, $3, 'COMPRA', 'FACTURA', $4, '2026-11-19', 100, 18, 118, 'CONTADO', null)`,
		[id, ownerSession.ownerId, entityId, `C-${id.slice(0, 8).toUpperCase()}`],
	);

	return id;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e del vertical de ventas corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	// Secretos efimeros si el entorno no los trae: no se escriben en ningun archivo.
	process.env.BETTER_AUTH_SECRET ??= "e2e-notas-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	// Dueno 1: las tres series por defecto que el alta necesita, creadas por la ruta real.
	owner = await createSecondOwner(pool, harness.auth);
	ownerIds = (await seedSecondOwnerDomain(pool, owner.ownerId)).ids;
	owners.push({ session: owner, ids: ownerIds });

	await createSerie(owner, { voucherType: "FACTURA", code: "F001", isDefault: true });
	await createSerie(owner, { voucherType: "NOTA_CREDITO", code: "FC01", isDefault: true });
	await createSerie(owner, { voucherType: "NOTA_DEBITO", code: "FD01", isDefault: true });

	// Dueno 2: un comprobante suyo, que el dueno 1 no puede referenciar (S10).
	other = await createSecondOwner(pool, harness.auth);
	const otherIds = (await seedSecondOwnerDomain(pool, other.ownerId)).ids;
	owners.push({ session: other, ids: otherIds });
	otherVoucherId = await insertVoucher(pool, {
		ownerId: other.ownerId,
		entityId: otherIds.entityId,
		total: 118,
		voucherNumber: `AJENA-${randomUUID().slice(0, 8).toUpperCase()}`,
	});

	// Dueno 3: serie de FACTURA y ninguna de nota, para el mensaje de S3.
	bare = await createSecondOwner(pool, harness.auth);
	bareIds = (await seedSecondOwnerDomain(pool, bare.ownerId)).ids;
	owners.push({ session: bare, ids: bareIds });
	await createSerie(bare, { voucherType: "FACTURA", code: "G001", isDefault: true });
});

after(async () => {
	if (pool) {
		for (const entry of owners) {
			// `deleteOwnerFixtures` no borra `voucher_series`: se borra explicito para no depender de
			// la cascada de `auth.users`.
			await pool.query("delete from public.voucher_series where owner_id = $1", [entry.session.ownerId]);
			await deleteOwnerFixtures(pool, entry.session.ownerId);
		}
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las dos rutas responden 401 antes de validar el payload", async () => {
	const cases: Array<{ method: string; path: string; body?: unknown }> = [
		// El body es INVALIDO a proposito: la sesion se resuelve antes del pipe de Zod.
		{ method: "POST", path: "/notes", body: {} },
		{ method: "GET", path: `/notes?voucherId=${randomUUID()}` },
		{ method: "GET", path: "/notes" },
	];

	for (const route of cases) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	const forged = await call("POST", "/notes", {
		cookie: "better-auth.session_token=forged.sig",
		body: notaBody(),
	});

	assert.equal(forged.status, 401);
	assert.equal(forged.body?.message, "Sesion requerida.");
});

test("POST /notes registra una nota de crédito y baja el saldo del comprobante referenciado (S4, S10)", async () => {
	const saleId = await createSale(owner, ownerIds.entityId, 118);

	assert.deepEqual(await balanceOf(saleId), { paidAmount: 0, balance: 118 });

	// `voucherNumber` viaja en el body porque el formulario lo muestra como preview, y se IGNORA:
	// el numero lo asigna la base desde la serie por defecto del tipo de la nota (S3).
	const created = await createNota(
		notaBody({
			referencedComprobanteId: saleId,
			total: 18,
			motiveCode: "01",
			voucherNumber: "FC01-999999",
		}),
	);

	// La respuesta es la fila del ajuste (`voucherAdjustmentSchema`), no un eco del body: el numero
	// es el que quedo escrito y sale de la serie de NOTA_CREDITO, no de la factura.
	assert.deepEqual(Object.keys(created).sort(), [
		"id",
		"issueDate",
		"motiveCode",
		"total",
		"voucherNumber",
		"voucherType",
	]);
	assert.deepEqual(voucherAdjustmentSchema.parse(created), created);
	assert.equal(created.voucherNumber, "FC01-000001");
	assert.equal(created.voucherType, "NOTA_CREDITO");
	assert.equal(created.issueDate, "2026-11-20");
	assert.equal(created.motiveCode, "01");
	assert.equal(created.total, 18);
	assert.equal(await lastNumberOf(owner, "NOTA_CREDITO"), 1, "la serie de la nota avanzo");

	// Un conjunto de claves que este mismo schema comparte con el listado del detalle.
	assert.equal(voucherAdjustmentSchema.safeParse(created).success, true);

	// S4/S2: el saldo del referenciado lo ajustan los triggers existentes, y la factura NO se
	// reescribe: el comprobante se corrige con una nota.
	assert.deepEqual(await balanceOf(saleId), { paidAmount: 0, balance: 100 });

	const sale = await call("GET", `/vouchers/${saleId}`, { cookie: owner.cookie });

	assert.equal(sale.body.total, 118);
	assert.equal(sale.body.voucherNumber, "F001-000001");
});

test("POST /notes registra una nota de débito y sube el saldo del comprobante referenciado (S4)", async () => {
	const saleId = await createSale(owner, ownerIds.entityId, 118);

	const created = await createNota(
		notaBody({
			referencedComprobanteId: saleId,
			voucherType: "NOTA_DEBITO",
			total: 100,
			motiveCode: "02",
		}),
	);

	// La serie es la del TIPO de la nota: FD01, no la de la factura ni la de la nota de credito.
	assert.equal(created.voucherNumber, "FD01-000001");
	assert.equal(created.voucherType, "NOTA_DEBITO");
	assert.equal(created.motiveCode, "02");
	assert.equal(created.total, 100);
	assert.equal(await lastNumberOf(owner, "NOTA_DEBITO"), 1);

	// Una ND AUMENTA el saldo; una NC que superara el total no seria el mismo caso (S5).
	assert.deepEqual(await balanceOf(saleId), { paidAmount: 0, balance: 218 });
});

test("una nota de crédito que pasa el tope responde 409 con el mensaje de S5 y no escribe nada", async () => {
	const saleId = await createSale(owner, ownerIds.entityId, 118);
	const serieBefore = await lastNumberOf(owner, "NOTA_CREDITO");

	await createNota(notaBody({ referencedComprobanteId: saleId, total: 60 }));

	const written = await storedNotes(saleId);
	const serieAfter = await lastNumberOf(owner, "NOTA_CREDITO");

	assert.equal(written.length, 1);
	assert.equal(written[0]?.total, "60.00");
	assert.equal(serieAfter, (serieBefore ?? 0) + 1);

	const rejection = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: notaBody({ referencedComprobanteId: saleId, total: 60 }),
	});

	assert.equal(rejection.status, 409, JSON.stringify(rejection.body));
	assert.equal(rejection.body?.message, TOPE_CREDITO);

	// El rechazo no dejo rastro: ni fila, ni correlativo consumido, ni saldo movido.
	assert.deepEqual(await storedNotes(saleId), written);
	assert.equal(await lastNumberOf(owner, "NOTA_CREDITO"), serieAfter);
	assert.deepEqual(await balanceOf(saleId), { paidAmount: 0, balance: 58 });

	// El tope es del comprobante referenciado, no del dueno: otra venta puede llevar su nota de
	// credito completa aunque la primera ya tenga una.
	const otra = await createSale(owner, ownerIds.entityId, 118);

	await createNota(notaBody({ referencedComprobanteId: otra, total: 118 }));

	assert.deepEqual(await balanceOf(otra), { paidAmount: 0, balance: 0 });
});

test("referenciar un comprobante de otro dueño o inexistente responde 404 con el mensaje de S10", async () => {
	const serieBefore = await lastNumberOf(owner, "NOTA_CREDITO");

	// El trigger `comprobante_owner_consistency` levanta su propio texto (42501, que nombra la
	// regla de la base): el mapa del API lo traduce al texto de S10 para el usuario.
	const foreign = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: notaBody({ referencedComprobanteId: otherVoucherId, total: 10 }),
	});

	assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
	assert.equal(foreign.body?.message, REFERENCIA_AJENA);
	assert.notEqual(foreign.body?.message, TRIGGER_REFERENCIA_AJENA, "el texto de la base no se muestra");

	// El comprobante ajeno quedo intacto y la serie del dueno no avanzo.
	const foreignRow = await pool.query<{ total: string }>(
		"select total::text from public.comprobante where id = $1",
		[otherVoucherId],
	);

	assert.equal(foreignRow.rows[0]?.total, "118.00");
	assert.deepEqual(await storedNotes(otherVoucherId), []);
	assert.equal(await lastNumberOf(owner, "NOTA_CREDITO"), serieBefore);

	// Un id que no existe: el otro texto de 404 de S10.
	const invented = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: notaBody({ referencedComprobanteId: randomUUID(), total: 10 }),
	});

	assert.equal(invented.status, 404, JSON.stringify(invented.body));
	assert.equal(invented.body?.message, REFERENCIADO_INEXISTENTE);

	// Una COMPRA comparte tipo con su par de venta: la base mira el `voucher_kind` y responde el
	// texto de S10, que el mapa devuelve como 400.
	const compraId = await seedCompra(owner, ownerIds.entityId);
	const compra = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: notaBody({ referencedComprobanteId: compraId, total: 10 }),
	});

	assert.equal(compra.status, 400, JSON.stringify(compra.body));
	assert.equal(compra.body?.message, SOLO_BASE_DE_VENTA);
	assert.deepEqual(await storedNotes(compraId), [], "ninguno de los tres rechazos escribio");
});

test("sin serie por defecto del tipo de la nota responde 400 con el mensaje de S3", async () => {
	const saleId = await createSale(bare, bareIds.entityId, 118);

	const rejection = await call("POST", "/notes", {
		cookie: bare.cookie,
		body: notaBody({ referencedComprobanteId: saleId, total: 10 }),
	});

	assert.equal(rejection.status, 400, JSON.stringify(rejection.body));
	assert.equal(rejection.body?.message, SIN_SERIE_POR_DEFECTO);

	// Nada escrito: ni nota, ni saldo movido.
	assert.deepEqual(await storedNotes(saleId), []);

	const sale = await call("GET", `/vouchers/${saleId}`, { cookie: bare.cookie });

	assert.equal(sale.body.balance, 118);

	// La serie de FACTURA no sirve como fallback para una nota de credito, y una nota de debito
	// tampoco encuentra la suya.
	const debito = await call("POST", "/notes", {
		cookie: bare.cookie,
		body: notaBody({
			referencedComprobanteId: saleId,
			voucherType: "NOTA_DEBITO",
			total: 10,
			motiveCode: "01",
		}),
	});

	assert.equal(debito.status, 400, JSON.stringify(debito.body));
	assert.equal(debito.body?.message, SIN_SERIE_POR_DEFECTO);
});

test("el motivo fuera del catálogo y la retención se rechazan con 400 y no escriben", async () => {
	const saleId = await createSale(owner, ownerIds.entityId, 118);
	const serieBefore = await lastNumberOf(owner, "NOTA_CREDITO");

	// `04` es un motivo del catalogo de NOTA_CREDITO, no del de NOTA_DEBITO: `notaWriteSchema` valida
	// el catalogo POR TIPO y el mensaje es el del contrato compartido (S9), igual que en el formulario.
	const fueraDeCatalogo = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: notaBody({
			referencedComprobanteId: saleId,
			voucherType: "NOTA_DEBITO",
			total: 10,
			motiveCode: "04",
		}),
	});

	assert.equal(fueraDeCatalogo.status, 400, JSON.stringify(fueraDeCatalogo.body));
	assert.equal(fueraDeCatalogo.body?.message, PAYLOAD_INVALIDO);
	assert.equal(fueraDeCatalogo.body?.issues?.[0]?.path, "motiveCode");
	assert.equal(fueraDeCatalogo.body?.issues?.[0]?.message, MOTIVO_FUERA_DE_CATALOGO);

	// El motivo es obligatorio en una nota (CHECK `comprobante_ajuste_check`).
	const sinMotivo = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: { ...notaBody({ referencedComprobanteId: saleId, total: 10 }), motiveCode: undefined },
	});

	assert.equal(sinMotivo.status, 400, JSON.stringify(sinMotivo.body));
	assert.equal(sinMotivo.body?.issues?.[0]?.message, MOTIVO_REQUERIDO);

	const totalInvalido = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: notaBody({ referencedComprobanteId: saleId, total: 0 }),
	});

	assert.equal(totalInvalido.status, 400, JSON.stringify(totalInvalido.body));
	assert.equal(totalInvalido.body?.issues?.[0]?.message, "El total debe ser mayor a 0");

	// La retencion queda fuera de este slice (S1): el contrato la acepta (no lleva motivo) y la
	// base la rechaza con el mensaje de S10, que es lo que el cliente ve.
	const retencion = await call("POST", "/notes", {
		cookie: owner.cookie,
		body: {
			issueDate: "2026-11-20",
			voucherType: "COMPROBANTE_RETENCION",
			total: 10,
			referencedComprobanteId: saleId,
		},
	});

	assert.equal(retencion.status, 400, JSON.stringify(retencion.body));
	assert.equal(retencion.body?.message, DATOS_NOTA_INVALIDOS);

	assert.deepEqual(await storedNotes(saleId), [], "ninguno de los cuatro rechazos escribio");
	assert.equal(await lastNumberOf(owner, "NOTA_CREDITO"), serieBefore, "la serie no avanzo");
});

test("GET /notes?voucherId= lista solo las notas de ese comprobante (S1)", async () => {
	const primera = await createSale(owner, ownerIds.entityId, 118);
	const segunda = await createSale(owner, ownerIds.entityId, 118);

	const credito = await createNota(
		notaBody({ referencedComprobanteId: primera, total: 10, issueDate: "2026-11-18" }),
	);
	const debito = await createNota(
		notaBody({
			referencedComprobanteId: primera,
			voucherType: "NOTA_DEBITO",
			total: 5,
			motiveCode: "01",
			issueDate: "2026-11-19",
		}),
	);
	const ajena = await createNota(notaBody({ referencedComprobanteId: segunda, total: 7 }));

	const list = await call("GET", `/notes?voucherId=${primera}`, { cookie: owner.cookie });

	assert.equal(list.status, 200, JSON.stringify(list.body));
	// El contrato del detalle: `voucherAdjustmentSchema[]`, de la emision mas reciente a la mas
	// vieja (mismo orden que el origen).
	assert.deepEqual(list.body, [debito, credito]);
	assert.deepEqual(
		list.body.map((row: { voucherNumber: string }) => row.voucherNumber),
		[debito.voucherNumber, credito.voucherNumber],
	);
	for (const row of list.body) {
		assert.deepEqual(voucherAdjustmentSchema.parse(row), row);
	}

	// La segunda venta solo ve la suya.
	const otra = await call("GET", `/notes?voucherId=${segunda}`, { cookie: owner.cookie });

	assert.deepEqual(otra.body, [ajena]);

	// Un comprobante sin notas, uno ajeno y uno inexistente devuelven la lista vacia: las filas
	// ajenas no son visibles (RLS) y el listado no filtra su existencia.
	const sinNotas = await createSale(owner, ownerIds.entityId, 50);
	const empty = await call("GET", `/notes?voucherId=${sinNotas}`, { cookie: owner.cookie });

	assert.deepEqual(empty.body, []);

	const foreign = await call("GET", `/notes?voucherId=${otherVoucherId}`, { cookie: owner.cookie });
	const invented = await call("GET", `/notes?voucherId=${randomUUID()}`, { cookie: owner.cookie });

	assert.deepEqual(foreign.body, []);
	assert.deepEqual(invented.body, []);

	// El parametro es obligatorio y tipado: sin el, la query no llega al servicio.
	const missing = await call("GET", "/notes", { cookie: owner.cookie });

	assert.equal(missing.status, 400, JSON.stringify(missing.body));
	assert.equal(missing.body?.message, PAYLOAD_INVALIDO);

	const invalid = await call("GET", "/notes?voucherId=no-es-uuid", { cookie: owner.cookie });

	assert.equal(invalid.status, 400, JSON.stringify(invalid.body));
	assert.equal(invalid.body?.message, PAYLOAD_INVALIDO);
});

test("el registro de NotesModule no cambia el ruteo de /vouchers (preserva la trampa de `open`)", async () => {
	// Las rutas que comparten prefijo con el vertical de ventas siguen resolviendo igual: `open` la
	// atiende `CarteraController` (no el `:id` de `VouchersController`) y el detalle sigue siendo
	// `GET /vouchers/:id`.
	const open = await call("GET", "/vouchers/open?direction=INGRESO", { cookie: owner.cookie });

	assert.equal(open.status, 200, JSON.stringify(open.body));
	assert.ok(Array.isArray(open.body));

	const saleId = await createSale(owner, ownerIds.entityId, 118);
	const detail = await call("GET", `/vouchers/${saleId}`, { cookie: owner.cookie });

	assert.equal(detail.status, 200, JSON.stringify(detail.body));
	assert.equal(detail.body.total, 118);

	// Y una nota no aparece en el listado de ventas: `voucher_balance` solo expone los tipos base
	// (S1 del slice 1) y una nota se corrige con otra nota, no editandose.
	await createNota(notaBody({ referencedComprobanteId: saleId, total: 10 }));

	const list = await call("GET", "/vouchers", { cookie: owner.cookie });

	assert.equal(
		list.body.some((row: { voucherType: string }) => row.voucherType.startsWith("NOTA_")),
		false,
	);
});
