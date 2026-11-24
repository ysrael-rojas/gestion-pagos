// e2e del modulo `series` de `apps/api` (T3 del port del vertical series, S4/S5/S6 de
// `odd/tasks/port-vertical-series.md`) contra una base viva con las migraciones y los seeds
// aplicados.
//
// Que prueba, en una frase: que el CRUD de series de comprobante pasa por el camino real
// (HTTP -> Better Auth -> withOwner -> RPC `security definer`), que el dueno sale de la sesion y
// nunca del payload, que el listado devuelve el contrato de fila de S10 (`voucherSeriesSchema`),
// y que los mensajes de S6 llegan al cliente con su status.
//
// Por que el borrado NO es `DELETE` HTTP: el unico consumidor es el BFF del navegador
// (`apps/web/app/api/backend/[...path]/route.ts`) y su allowlist reenvia solo GET, POST y PATCH
// (S9). El borrado es LOGICO (`deleted_at`), asi que no se pierde nada usando un POST: el modulo
// publica `POST /series/:id/delete` y el e2e lo pina. Una ruta `DELETE` que el navegador no puede
// alcanzar seria superficie sin cliente.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base migrada y sembrada (`packages/db/scripts/apply-sql.mjs` +
//                        `apply-seeds.mjs`).
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Identidad: los dos duenos se crean por SQL (`createSecondOwner`), igual que el procedimiento de
// `docs/operacion/crear-usuario.md`; la ENTRADA es la real (`signInEmail`). El dueno del servidor
// (`seed-demo.sql`) no se toca y sus series no se leen: cada prueba usa duenos propios.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import { voucherSeriesSchema } from "../../../packages/shared/src/lib/schemas/serie.ts";
import type { ApiHarness } from "./support/harness.ts";
import {
	type AccountIds,
	type OwnerSession,
	createSecondOwner,
	deleteOwnerFixtures,
	seedSecondOwnerDomain,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Textos de S6, verbatim: el test los compara contra lo que responde el API. */
const SERIE_DUPLICADA = "Ya existe una serie con ese código para ese tipo.";
const SERIE_INEXISTENTE = "La serie no existe.";
const SIN_SERIE_POR_DEFECTO =
	"No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.";

/** Mensajes del contrato compartido (S7), verbatim. */
const TIPO_REQUERIDO = "Selecciona el tipo de comprobante";
const CODIGO_REQUERIDO = "El código de serie es requerido";
const CODIGO_INVALIDO = "Usa 1 a 4 caracteres alfanuméricos, por ejemplo F001";

/** Mensaje del pipe de Zod cuando el body no cumple el contrato compartido. */
const PAYLOAD_INVALIDO = "El payload no cumple el contrato compartido.";

const SOME_UUID = "11111111-1111-4111-8111-111111111111";

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las pruebas de CRUD. Arranca SIN series: el alta es una de las pruebas. */
let owner: OwnerSession;
let ownerIds: AccountIds;
/** Dueno con series propias, para los casos de "id de otro dueno". */
let other: OwnerSession;

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

/** Body minimo valido del contrato del formulario (`serieFormSchema`, S10). */
function serieBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return { voucherType: "FACTURA", code: "F001", isDefault: true, ...overrides };
}

/** Alta por la ruta real; falla fuerte si no fue 201 (el alta tiene sus propias pruebas). */
// biome-ignore lint/suspicious/noExplicitAny: el alta devuelve la fila de la serie.
async function createSerie(body: Record<string, unknown>, session = owner): Promise<any> {
	const result = await call("POST", "/series", { cookie: session.cookie, body });

	assert.equal(result.status, 201, `el alta deberia responder 201: ${JSON.stringify(result.body)}`);

	return result.body;
}

/** Las cuatro rutas del modulo, con entradas validas, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/series" },
	{ method: "POST", path: "/series", body: {} },
	{ method: "PATCH", path: `/series/${SOME_UUID}`, body: {} },
	{ method: "POST", path: `/series/${SOME_UUID}/delete` },
];

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e del vertical de ventas corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	// Secretos efimeros si el entorno no los trae: no se escriben en ningun archivo.
	process.env.BETTER_AUTH_SECRET ??= "e2e-series-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await createSecondOwner(pool, harness.auth);
	const domain = await seedSecondOwnerDomain(pool, owner.ownerId);
	ownerIds = domain.ids;

	// El dueno 1 arranca sin series: `POST /series` es una de las pruebas y el listado vacio
	// tambien. Las series de este archivo se crean por la ruta HTTP, nunca por SQL.
	other = await createSecondOwner(pool, harness.auth);
});

after(async () => {
	if (pool && other) {
		await pool.query("delete from public.voucher_series where owner_id = $1", [other.ownerId]);
		await deleteOwnerFixtures(pool, other.ownerId);
	}

	if (pool && owner) {
		// Las series no las borra `deleteOwnerFixtures`: la tabla no esta en su lista porque el
		// e2e de ventas las siembra y el `delete from auth.users` las arrastra por cascada. Aca se
		// borran explicitas para que el teardown no dependa de la cascada.
		await pool.query("delete from public.voucher_series where owner_id = $1", [owner.ownerId]);
		await deleteOwnerFixtures(pool, owner.ownerId);
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
	const invalidBody = await call("POST", "/series", { body: { code: "" } });

	assert.equal(invalidBody.status, 401);

	const forged = await call("GET", "/series", { cookie: "better-auth.session_token=forged.sig" });

	assert.equal(forged.status, 401);
});

test("GET /series de un dueno sin series devuelve una lista vacia", async () => {
	const result = await call("GET", "/series", { cookie: owner.cookie });

	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.deepEqual(result.body, [], "un dueno nuevo no tiene series");

	// Y no ve las del otro dueno: la RLS ya lo impide, el filtro del servicio es defensa en
	// profundidad.
	await createSerie(serieBody({ code: "J001" }), other);

	const afterOther = await call("GET", "/series", { cookie: owner.cookie });

	assert.deepEqual(afterOther.body, [], "la serie del otro dueno no aparece");
});

test("POST /series crea la serie y devuelve el contrato de fila de S10", async () => {
	const result = await call("POST", "/series", {
		cookie: owner.cookie,
		body: serieBody({ voucherType: "FACTURA", code: "F001", isDefault: true }),
	});

	assert.equal(result.status, 201, JSON.stringify(result.body));

	// El contrato completo: `voucherSeriesSchema` es lo que pinta la tabla de Configuración y lo
	// que el frontend tipa. `lastNumber` existe (SPEC 44 lo pedia) y arranca en 0.
	assert.deepEqual(Object.keys(result.body).sort(), [
		"code",
		"id",
		"isDefault",
		"lastNumber",
		"voucherType",
	]);
	assert.match(result.body.id, /^[0-9a-f-]{36}$/);
	assert.equal(result.body.voucherType, "FACTURA");
	assert.equal(result.body.code, "F001");
	assert.equal(result.body.isDefault, true);
	assert.equal(result.body.lastNumber, 0, "una serie nueva arranca en 0");

	// El cuerpo que devuelve el API cumple el schema compartido, campo por campo.
	assert.deepEqual(voucherSeriesSchema.parse(result.body), result.body);

	// Lo que devuelve es exactamente la fila escrita.
	const stored = await pool.query<{ code: string; last_number: number; is_default: boolean }>(
		"select code, last_number, is_default from public.voucher_series where id = $1",
		[result.body.id],
	);

	assert.deepEqual(stored.rows[0], { code: "F001", last_number: 0, is_default: true });

	// El codigo se normaliza con el contrato compartido (trim), asi que un espacio de mas no
	// llega a la base como un codigo distinto.
	const trimmed = await createSerie(serieBody({ voucherType: "BOLETA", code: " B001 " }));

	assert.equal(trimmed.code, "B001", "el `trim` es del schema compartido");
});

test("POST /series responde 409 con el mensaje de S6 cuando el codigo ya existe para ese tipo", async () => {
	// `F001` de FACTURA ya lo creo la prueba anterior; el indice unico
	// `voucher_series_owner_type_code_idx` es el juez y la RPC lo traduce.
	const duplicate = await call("POST", "/series", {
		cookie: owner.cookie,
		body: serieBody({ voucherType: "FACTURA", code: "F001", isDefault: false }),
	});

	assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
	assert.equal(duplicate.body?.message, SERIE_DUPLICADA);

	// El mismo codigo en OTRO tipo no es duplicado: el indice es por (dueno, tipo, codigo).
	const otherType = await createSerie(serieBody({ voucherType: "NOTA_VENTA", code: "F001" }));

	assert.equal(otherType.code, "F001");
	assert.equal(otherType.voucherType, "NOTA_VENTA");

	// Y no quedo ninguna fila de mas por el rechazo.
	const count = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.voucher_series
		  where owner_id = $1 and code = 'F001' and deleted_at is null`,
		[owner.ownerId],
	);

	assert.equal(count.rows[0]?.n, 2);
});

test("POST /series con isDefault limpia el default anterior del mismo tipo", async () => {
	const result = await createSerie(serieBody({ voucherType: "FACTURA", code: "F002", isDefault: true }));

	assert.equal(result.isDefault, true);

	const list = await call("GET", "/series", { cookie: owner.cookie });
	const facturas = list.body.filter((row: { voucherType: string }) => row.voucherType === "FACTURA");

	assert.deepEqual(
		facturas.map((row: { code: string; isDefault: boolean }) => [row.code, row.isDefault]),
		[
			["F001", false],
			["F002", true],
		],
		"una sola por defecto por tipo: el indice parcial queda satisfecho",
	);

	// Una serie por defecto de OTRO tipo no toca la de FACTURA.
	const boleta = await createSerie(serieBody({ voucherType: "BOLETA", code: "B002", isDefault: true }));

	assert.equal(boleta.isDefault, true);

	const afterList = await call("GET", "/series", { cookie: owner.cookie });

	assert.equal(
		afterList.body.find((row: { code: string }) => row.code === "F002")?.isDefault,
		true,
		"el default de FACTURA sigue siendo F002",
	);
});

test("PATCH /series/:id edita el codigo y el default, y nunca el tipo", async () => {
	const created = await createSerie(serieBody({ voucherType: "BOLETA", code: "B010", isDefault: false }));

	// El body de edicion es el MISMO contrato menos `voucherType`: la pantalla no ofrece el tipo
	// porque cambiarlo reescribiria la numeracion ya emitida (L4a).
	const result = await call("PATCH", `/series/${created.id}`, {
		cookie: owner.cookie,
		body: { code: "B011", isDefault: true },
	});

	assert.equal(result.status, 200, JSON.stringify(result.body));
	assert.equal(result.body.id, created.id);
	assert.equal(result.body.code, "B011");
	assert.equal(result.body.isDefault, true);
	assert.equal(result.body.voucherType, "BOLETA", "el tipo no se edita");
	assert.equal(result.body.lastNumber, 0, "el correlativo no se edita desde el API");

	// Un `voucherType` en el body de la edicion NO cambia nada: el contrato de edicion no lo
	// incluye y el schema descarta lo que no declara.
	const stray = await call("PATCH", `/series/${created.id}`, {
		cookie: owner.cookie,
		body: { code: "B011", isDefault: true, voucherType: "FACTURA" },
	});

	assert.equal(stray.status, 200, JSON.stringify(stray.body));
	assert.equal(stray.body.voucherType, "BOLETA");

	// Y el default quedo en la fila: la anterior de BOLETA (B002) dejo de serlo.
	const list = await call("GET", "/series", { cookie: owner.cookie });
	const boletas = list.body.filter((row: { voucherType: string }) => row.voucherType === "BOLETA");

	assert.deepEqual(
		boletas.map((row: { code: string; isDefault: boolean }) => [row.code, row.isDefault]),
		[
			["B001", false],
			["B002", false],
			["B011", true],
		],
	);
});

test("PATCH /series/:id responde los errores de S6 y no escribe cuando rechaza", async () => {
	const created = await createSerie(serieBody({ voucherType: "NOTA_VENTA", code: "NV10", isDefault: false }));

	// Codigo repetido dentro del mismo tipo.
	const duplicate = await call("PATCH", `/series/${created.id}`, {
		cookie: owner.cookie,
		body: { code: "F001", isDefault: false },
	});

	assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
	assert.equal(duplicate.body?.message, SERIE_DUPLICADA);

	// El rechazo no cambio la fila.
	const stored = await pool.query<{ code: string; is_default: boolean }>(
		"select code, is_default from public.voucher_series where id = $1",
		[created.id],
	);

	assert.deepEqual(stored.rows[0], { code: "NV10", is_default: false });

	// Id inexistente, de otro dueno y de una serie ya dada de baja: el mismo 404 con el mismo
	// texto (la RPC no filtra la existencia de series ajenas).
	const invented = await call("PATCH", `/series/${randomUUID()}`, {
		cookie: owner.cookie,
		body: { code: "X001", isDefault: false },
	});

	assert.equal(invented.status, 404, JSON.stringify(invented.body));
	assert.equal(invented.body?.message, SERIE_INEXISTENTE);

	const foreignId = await createSerie(serieBody({ voucherType: "FACTURA", code: "J010" }), other);
	const foreign = await call("PATCH", `/series/${foreignId.id}`, {
		cookie: owner.cookie,
		body: { code: "J011", isDefault: true },
	});

	assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
	assert.equal(foreign.body?.message, SERIE_INEXISTENTE);

	// La serie ajena quedo intacta.
	const foreignRow = await pool.query<{ code: string }>(
		"select code from public.voucher_series where id = $1",
		[foreignId.id],
	);

	assert.equal(foreignRow.rows[0]?.code, "J010");
});

test("POST /series/:id/delete da de baja la serie, conserva los comprobantes y bloquea los 404", async () => {
	const created = await createSerie(serieBody({ voucherType: "FACTURA", code: "F900", isDefault: true }));

	// Una venta emitida con esa serie: el borrado logico NO puede tocarla (S8 del doc, el dialogo
	// del origen lo promete).
	const venta = await call("POST", "/vouchers", {
		cookie: owner.cookie,
		body: {
			issueDate: "2026-03-15",
			voucherType: "FACTURA",
			entityId: ownerIds.entityId,
			total: 118,
			paymentType: "CONTADO",
			status: "PENDIENTE",
		},
	});

	assert.equal(venta.status, 201, JSON.stringify(venta.body));
	assert.equal(venta.body.voucherNumber, "F900-000001");

	const deleted = await call("POST", `/series/${created.id}/delete`, { cookie: owner.cookie });

	// 204 sin cuerpo: no hay recurso que devolver, el resultado se ve en el listado.
	assert.equal(deleted.status, 204, JSON.stringify(deleted.body));
	assert.equal(deleted.body, null);

	// La fila sigue, con `deleted_at`: es el historico de en que serie se emitio.
	const stored = await pool.query<{ deleted_at: Date | null; last_number: number }>(
		"select deleted_at, last_number from public.voucher_series where id = $1",
		[created.id],
	);

	assert.ok(stored.rows[0]?.deleted_at, "la baja es logica");
	assert.equal(stored.rows[0]?.last_number, 1, "el correlativo quedo como estaba");

	// El comprobante ya emitido no cambio.
	const voucher = await call("GET", `/vouchers/${venta.body.id}`, { cookie: owner.cookie });

	assert.equal(voucher.status, 200, JSON.stringify(voucher.body));
	assert.equal(voucher.body.voucherNumber, "F900-000001");
	assert.equal(voucher.body.total, 118);

	// Deja de estar en el listado: el universo visible del modulo son las vivas, igual que el de
	// `editar_serie` / `eliminar_serie` en la base.
	const list = await call("GET", "/series", { cookie: owner.cookie });

	assert.equal(
		list.body.some((row: { id: string }) => row.id === created.id),
		false,
		"la serie dada de baja no se lista",
	);

	// Y deja de USARSE: la serie dada de baja era la default de FACTURA, asi que no queda ninguna
	// por defecto de ese tipo y el alta de una venta responde el mensaje de S6 (S2, L4c). Sin esta
	// mitad, el test solo probaria que la fila desaparece del listado.
	assert.deepEqual(
		list.body.filter(
			(row: { voucherType: string; isDefault: boolean }) =>
				row.voucherType === "FACTURA" && row.isDefault,
		),
		[],
		"la serie dada de baja era la default de FACTURA",
	);

	const blocked = await call("POST", "/vouchers", {
		cookie: owner.cookie,
		body: {
			issueDate: "2026-03-15",
			voucherType: "FACTURA",
			entityId: ownerIds.entityId,
			total: 59,
			paymentType: "CONTADO",
			status: "PENDIENTE",
		},
	});

	assert.equal(blocked.status, 400, JSON.stringify(blocked.body));
	assert.equal(blocked.body?.message, SIN_SERIE_POR_DEFECTO);

	// Una serie ya dada de baja responde el mismo 404 que una ajena.
	const again = await call("POST", `/series/${created.id}/delete`, { cookie: owner.cookie });

	assert.equal(again.status, 404, JSON.stringify(again.body));
	assert.equal(again.body?.message, SERIE_INEXISTENTE);

	const editGone = await call("PATCH", `/series/${created.id}`, {
		cookie: owner.cookie,
		body: { code: "F900", isDefault: true },
	});

	assert.equal(editGone.status, 404);
	assert.equal(editGone.body?.message, SERIE_INEXISTENTE);

	// Y un id de otro dueno tampoco se puede borrar.
	const foreignId = await createSerie(serieBody({ voucherType: "FACTURA", code: "J020" }), other);
	const foreignDelete = await call("POST", `/series/${foreignId.id}/delete`, { cookie: owner.cookie });

	assert.equal(foreignDelete.status, 404, JSON.stringify(foreignDelete.body));
	assert.equal(foreignDelete.body?.message, SERIE_INEXISTENTE);

	const foreignRow = await pool.query<{ deleted_at: Date | null }>(
		"select deleted_at from public.voucher_series where id = $1",
		[foreignId.id],
	);

	assert.equal(foreignRow.rows[0]?.deleted_at, null, "la serie ajena sigue viva");
});

test("una venta nueva usa el siguiente numero de la serie que el API marco por defecto", async () => {
	// El alta de series y el alta de ventas comparten la base: lo que el API marca por defecto es
	// lo que `crear_venta` toma (S2). Esta prueba cierra ese circuito de punta a punta.
	const serie = await createSerie(serieBody({ voucherType: "BOLETA", code: "B100", isDefault: true }));

	const first = await call("POST", "/vouchers", {
		cookie: owner.cookie,
		body: {
			issueDate: "2026-03-16",
			voucherType: "BOLETA",
			entityId: ownerIds.entityId,
			total: 59,
			paymentType: "CONTADO",
			status: "PENDIENTE",
		},
	});

	assert.equal(first.status, 201, JSON.stringify(first.body));
	assert.equal(first.body.voucherNumber, "B100-000001");

	// La fila de la serie, por la ruta del API, muestra el correlativo que avanzo la base.
	const list = await call("GET", "/series", { cookie: owner.cookie });
	const row = list.body.find((item: { id: string }) => item.id === serie.id);

	assert.equal(row?.lastNumber, 1, "el listado muestra el correlativo que escribio la base");

	const second = await call("POST", "/vouchers", {
		cookie: owner.cookie,
		body: {
			issueDate: "2026-03-16",
			voucherType: "BOLETA",
			entityId: ownerIds.entityId,
			total: 59,
			paymentType: "CONTADO",
			status: "PENDIENTE",
		},
	});

	assert.equal(second.status, 201, JSON.stringify(second.body));
	assert.equal(second.body.voucherNumber, "B100-000002", "sin saltos");
});

test("POST y PATCH /series rechazan el body con los mensajes del contrato compartido (S7)", async () => {
	// Los mensajes salen del MISMO schema que valida el formulario: si el API tuviera un DTO
	// propio, el texto (y el contrato) serian otros.
	const noType = await call("POST", "/series", {
		cookie: owner.cookie,
		body: { code: "F001", isDefault: false },
	});

	assert.equal(noType.status, 400, JSON.stringify(noType.body));
	assert.equal(noType.body?.message, PAYLOAD_INVALIDO);
	assert.equal(noType.body?.issues?.[0]?.message, TIPO_REQUERIDO);

	// La retencion sigue afuera del contrato (S4), porque todavia no tiene flujo que la emita: el
	// schema compartido la rechaza con el mensaje del tipo. Las dos notas si entran desde el slice 3
	// (`odd/tasks/port-vertical-notas.md`, S3), y el alta lo comprueba mas abajo.
	const retention = await call("POST", "/series", {
		cookie: owner.cookie,
		body: serieBody({ voucherType: "COMPROBANTE_RETENCION" }),
	});

	assert.equal(retention.status, 400, JSON.stringify(retention.body));
	assert.equal(retention.body?.issues?.[0]?.message, TIPO_REQUERIDO);

	// Una serie del tipo de una nota: el contrato la acepta y `crear_serie` tambien (S3), asi que
	// el alta responde 201 y la fila se puede leer.
	const creditNote = await createSerie(serieBody({ voucherType: "NOTA_CREDITO", code: "FC01" }));

	assert.equal(creditNote.voucherType, "NOTA_CREDITO");
	assert.equal(creditNote.code, "FC01");

	const emptyCode = await call("POST", "/series", {
		cookie: owner.cookie,
		body: serieBody({ code: "   " }),
	});

	assert.equal(emptyCode.status, 400);
	assert.equal(emptyCode.body?.issues?.[0]?.message, CODIGO_REQUERIDO);

	const longCode = await call("POST", "/series", {
		cookie: owner.cookie,
		body: serieBody({ code: "F0001" }),
	});

	assert.equal(longCode.status, 400);
	assert.equal(longCode.body?.issues?.[0]?.message, CODIGO_INVALIDO);

	// El `PATCH` valida el mismo contrato menos el tipo: un codigo invalido no llega a la base.
	const invalidEdit = await call("PATCH", `/series/${randomUUID()}`, {
		cookie: owner.cookie,
		body: { code: "F0-1", isDefault: false },
	});

	assert.equal(invalidEdit.status, 400, JSON.stringify(invalidEdit.body));
	assert.equal(invalidEdit.body?.issues?.[0]?.message, CODIGO_INVALIDO);

	// El parametro de ruta tambien se valida, y antes que el body.
	const badId = await call("PATCH", "/series/no-es-uuid", {
		cookie: owner.cookie,
		body: { code: "F001", isDefault: false },
	});

	assert.equal(badId.status, 400, JSON.stringify(badId.body));
});
