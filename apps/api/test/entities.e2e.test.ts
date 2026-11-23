// e2e de las escrituras del vertical de clientes (T5c) contra la base viva `gestion_pagos_dev`.
//
// Que prueba, en una frase: que `POST /entities`, `PATCH /entities/:id` y
// `POST /entities/:id/delete` escriben SOLO filas del dueno de la sesion, con las mismas reglas
// del origen (SIN_DOCUMENTO sin numero, `is_client` fijado en el alta, baja logica), y que cada
// rechazo deja la base como estaba.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: las dos salen de la API server-side de Better Auth (`signInEmail` / `signUpEmail`),
// el mismo camino que ejecuta el handler HTTP. El dueno demo aporta la sesion intrusa: con ella
// se intenta modificar y borrar la fila del otro dueno (aislamiento), y al final no se borra
// nada suyo -- solo su credencial de prueba, que revoca.
//
// Todas las filas de dominio las crea el TEST, por la ruta real del API, bajo el segundo dueno;
// el teardown las borra junto con su `auth.users`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import {
	deleteOwnerFixtures,
	grantDemoCredential,
	revokeDemoCredential,
	signIn,
	signUpSecondOwner,
	TEST_PASSWORD,
	type OwnerSession,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Mensaje exacto del origen (`lib/clientes/entidades.ts:52`); la UI lo muestra tal cual. */
const DUPLICATE_MESSAGE = "Ya existe un cliente con ese tipo y número de documento.";

/** Mensaje que `payments.errors.ts` usa para el mismo codigo: no debe aparecer en clientes. */
const PAYMENTS_CONFLICT_MESSAGE = "El comprobante ya está asignado a este pago.";

const SOME_UUID = "11111111-1111-4111-8111-111111111111";

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las escrituras de este test (`signUpEmail`, sin filas de dominio previas). */
let owner: OwnerSession;
/** Dueno demo sembrado: aporta la sesion intrusa para probar el aislamiento. */
let intruder: OwnerSession;

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

/** Body valido de cliente; cada test cambia lo que le interesa. */
function clientBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		documentType: "SIN_DOCUMENTO",
		documentNumber: "",
		name: "Cliente e2e",
		address: "Av. e2e 100",
		phone: "999888777",
		contactName: "Contacto e2e",
		billingEmail: "facturacion-e2e@example.test",
		managementEmail: "",
		isSupplier: false,
		...overrides,
	};
}

/** Dueno con mas entidades sembradas: la demo de `seed-demo.sql`, sin hardcodear su uuid. */
async function findSeededEntityOwnerId(): Promise<string> {
	const result = await pool.query<{ owner_id: string }>(
		"select owner_id from public.entidad where is_client and deleted_at is null group by owner_id order by count(*) desc limit 1",
	);

	const ownerId = result.rows[0]?.owner_id;

	if (!ownerId) {
		throw new Error("No hay entidades sembradas: el e2e necesita la demo de seed-demo.sql.");
	}

	return ownerId;
}

/** Filas vivas de entidad de un dueno, para probar que un rechazo no dejo nada escrito. */
async function liveEntityCount(ownerId: string): Promise<number> {
	const result = await pool.query<{ count: number }>(
		"select count(*)::int as count from public.entidad where owner_id = $1 and deleted_at is null",
		[ownerId],
	);

	return result.rows[0]?.count ?? 0;
}

/** Fila cruda, para mirar lo que la respuesta HTTP no muestra (`owner_id`, `deleted_at`). */
async function rawRow(id: string): Promise<{
	owner_id: string;
	document_type: string;
	document_number: string;
	is_client: boolean;
	name: string;
	deleted_at: string | null;
} | null> {
	const result = await pool.query(
		"select owner_id, document_type, document_number, is_client, name, deleted_at from public.entidad where id = $1",
		[id],
	);

	return result.rows[0] ?? null;
}

/** Altas que cada test necesita: devuelve el id de la fila creada por la ruta real. */
async function createEntity(body: Record<string, unknown>, session: OwnerSession = owner): Promise<string> {
	const created = await call("POST", "/entities", { cookie: session.cookie, body });

	assert.equal(created.status, 201, `el alta deberia responder 201: ${JSON.stringify(created.body)}`);
	assert.equal(typeof created.body?.id, "string");

	return created.body.id as string;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de clientes corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-clientes-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await signUpSecondOwner(harness.auth);

	const intruderOwnerId = await findSeededEntityOwnerId();
	const intruderEmail = await grantDemoCredential(pool, intruderOwnerId);
	intruder = await signIn(harness.auth, intruderEmail, TEST_PASSWORD);
});

after(async () => {
	if (pool && owner) {
		await deleteOwnerFixtures(pool, owner.ownerId);
	}

	if (pool && intruder) {
		await revokeDemoCredential(pool, intruder.ownerId, intruder.sessionTokens);
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las escrituras de entidad responden 401 antes de validar el body", async () => {
	const routes: Array<{ method: string; path: string; body?: unknown }> = [
		{ method: "POST", path: "/entities", body: clientBody() },
		{ method: "PATCH", path: `/entities/${SOME_UUID}`, body: clientBody() },
		{ method: "POST", path: `/entities/${SOME_UUID}/delete` },
	];

	for (const route of routes) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(result.status, 401, `${route.method} ${route.path} deberia ser 401`);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve antes del pipe: un body invalido sin sesion sigue siendo 401.
	const invalidBody = await call("POST", "/entities", {
		body: clientBody({ documentType: "RUC", documentNumber: "123" }),
	});

	assert.equal(invalidBody.status, 401);

	const forged = await call("POST", "/entities", {
		cookie: "better-auth.session_token=forged.sig",
		body: clientBody(),
	});

	assert.equal(forged.status, 401);
});

test("POST /entities crea el cliente del dueno y normaliza SIN_DOCUMENTO a numero vacio", async () => {
	const body = clientBody({
		documentType: "SIN_DOCUMENTO",
		// El formulario manda lo que quedo escrito antes de elegir "sin documento": el servidor
		// lo descarta, como `mapFormValues` del origen.
		documentNumber: "12345678",
		name: "Cliente sin documento e2e",
		isSupplier: true,
	});

	const created = await call("POST", "/entities", { cookie: owner.cookie, body });

	assert.equal(created.status, 201);
	assert.equal(created.body.documentNumber, "", "SIN_DOCUMENTO no guarda numero");
	assert.equal(created.body.isClient, true, "un alta por esta ruta siempre es cliente");
	assert.equal(created.body.isSupplier, true, "is_supplier viene del formulario");
	assert.equal(created.body.name, body.name);

	const row = await rawRow(created.body.id as string);

	assert.ok(row, "la fila existe en la base");
	assert.equal(row.owner_id, owner.ownerId, "owner_id sale de la sesion, no del payload");
	assert.equal(row.document_type, "SIN_DOCUMENTO");
	assert.equal(row.document_number, "");
	assert.equal(row.is_client, true);
	assert.equal(row.deleted_at, null);

	// El listado del dueno lo ve; el de otro dueno no (RLS + owner_id en la lectura).
	const own = await call("GET", "/entities?role=client", { cookie: owner.cookie });

	assert.equal(own.status, 200);
	assert.ok(
		own.body.some((item: { id: string }) => item.id === created.body.id),
		"el cliente creado aparece en el listado del dueno",
	);

	const otherList = await call("GET", "/entities?role=client", { cookie: intruder.cookie });

	assert.equal(otherList.status, 200);
	assert.equal(
		otherList.body.some((item: { id: string }) => item.id === created.body.id),
		false,
		"otro dueno no ve el cliente",
	);
});

test("un documento duplicado responde 409 con el mensaje del vertical", async () => {
	const document = "20123456789";
	const before = await liveEntityCount(owner.ownerId);

	await createEntity(clientBody({ documentType: "RUC", documentNumber: document, name: "RUC original" }));

	const duplicate = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: document, name: "RUC duplicado" }),
	});

	assert.equal(duplicate.status, 409);
	assert.equal(duplicate.body?.message, DUPLICATE_MESSAGE);
	assert.notEqual(duplicate.body?.message, PAYMENTS_CONFLICT_MESSAGE);

	assert.equal(
		await liveEntityCount(owner.ownerId),
		before + 1,
		"el duplicado rechazado no creo una segunda fila",
	);
});

test("PATCH actualiza los campos, no toca is_client y normaliza el paso a SIN_DOCUMENTO", async () => {
	const id = await createEntity(
		clientBody({ documentType: "DNI", documentNumber: "12345678", name: "DNI original" }),
	);

	const updated = await call("PATCH", `/entities/${id}`, {
		cookie: owner.cookie,
		body: clientBody({
			// Justo el caso que en la base violaria `entidad_document_type_required` si el
			// servidor no normalizara: tipo sin documento y numero todavia presente.
			documentType: "SIN_DOCUMENTO",
			documentNumber: "12345678",
			name: "DNI modificado",
			address: "Jr. e2e 200",
			isSupplier: true,
		}),
	});

	assert.equal(updated.status, 200);
	assert.equal(updated.body.name, "DNI modificado");
	assert.equal(updated.body.address, "Jr. e2e 200");
	assert.equal(updated.body.documentType, "SIN_DOCUMENTO");
	assert.equal(updated.body.documentNumber, "");
	assert.equal(updated.body.isClient, true, "is_client no lo mueve una modificacion");
	assert.equal(updated.body.isSupplier, true);

	const row = await rawRow(id);

	assert.equal(row?.name, "DNI modificado");
	assert.equal(row?.document_type, "SIN_DOCUMENTO");
	assert.equal(row?.document_number, "");

	// Aislamiento: otro dueno no puede modificar la fila, y la fila no cambia.
	const intrusion = await call("PATCH", `/entities/${id}`, {
		cookie: intruder.cookie,
		body: clientBody({ name: "Secuestrado" }),
	});

	assert.equal(intrusion.status, 404, "para otro dueno la fila no existe");
	assert.equal((await rawRow(id))?.name, "DNI modificado", "la fila intacta tras el intento");

	const missing = await call("PATCH", `/entities/${SOME_UUID}`, {
		cookie: owner.cookie,
		body: clientBody(),
	});

	assert.equal(missing.status, 404);
	assert.equal(missing.body?.message, "El cliente no existe o fue eliminado.");
});

test("la baja logica saca la fila del listado, la marca y libera el numero de documento", async () => {
	const document = "20987654321";
	const id = await createEntity(
		clientBody({ documentType: "RUC", documentNumber: document, name: "RUC a borrar" }),
	);

	const deleted = await call("POST", `/entities/${id}/delete`, { cookie: owner.cookie });

	assert.equal(deleted.status, 200);
	assert.equal(deleted.body?.deleted, true);

	assert.notEqual((await rawRow(id))?.deleted_at, null, "deleted_at quedo marcado, la fila persiste");

	// Recarga: el listado se vuelve a pedir y la fila ya no esta (no es estado de cliente).
	const reload = await call("GET", "/entities?role=client", { cookie: owner.cookie });

	assert.equal(reload.status, 200);
	assert.equal(
		reload.body.some((item: { id: string }) => item.id === id),
		false,
		"la fila borrada no vuelve al listado",
	);

	// El indice unico es parcial (`where deleted_at is null`): el mismo documento se puede dar
	// de alta otra vez, igual que en el origen.
	const reused = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: document, name: "RUC reuse" }),
	});

	assert.equal(reused.status, 201);

	// Segunda baja del mismo id: ya no hay fila viva que borrar.
	const again = await call("POST", `/entities/${id}/delete`, { cookie: owner.cookie });

	assert.equal(again.status, 404);

	// Otro dueno tampoco puede borrarla: la fila nueva es de `owner`, y para el intruso no existe.
	const foreign = await call("POST", `/entities/${reused.body.id}/delete`, {
		cookie: intruder.cookie,
	});

	assert.equal(foreign.status, 404);
	assert.equal((await rawRow(reused.body.id as string))?.deleted_at, null, "sigue viva");
});

test("un payload invalido responde 400 con el issue del contrato compartido y no escribe nada", async () => {
	const before = await liveEntityCount(owner.ownerId);

	const badDocument = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: "123" }),
	});

	assert.equal(badDocument.status, 400);
	assert.equal(badDocument.body?.issues?.[0]?.path, "documentNumber");
	assert.equal(badDocument.body?.issues?.[0]?.message, "Número de documento inválido");

	const badEmail = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ billingEmail: "no-es-un-correo" }),
	});

	assert.equal(badEmail.status, 400);
	assert.equal(badEmail.body?.issues?.[0]?.path, "billingEmail");

	assert.equal(
		await liveEntityCount(owner.ownerId),
		before,
		"ningun rechazo dejo una fila nueva",
	);

	// El nombre vacio tambien lo corta el contrato, no la base.
	const badName = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ name: "" }),
	});

	assert.equal(badName.status, 400);
	assert.equal(badName.body?.issues?.[0]?.message, "El nombre es requerido");
});

test("un owner_id en el body se ignora: el dueno sale siempre de la sesion", async () => {
	// Cierra el agujero que dejo la verificacion independiente: sin este caso, un cambio que
	// aceptara `owner_id` desde el payload no rompia ningun test. El schema compartido no declara
	// la columna, asi que Zod la descarta antes del servicio.
	const intruderBefore = await liveEntityCount(intruder.ownerId);

	const forged = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: { ...clientBody({ name: "Alta con dueno inyectado" }), owner_id: intruder.ownerId },
	});

	assert.equal(forged.status, 201, "la columna sobrante no invalida el payload, se descarta");
	assert.equal(
		(await rawRow(forged.body.id as string))?.owner_id,
		owner.ownerId,
		"la fila es del dueno de la SESION, no del que vino en el body",
	);
	assert.equal(
		await liveEntityCount(intruder.ownerId),
		intruderBefore,
		"el otro dueno no recibio ninguna fila",
	);
});

test("modificar un cliente a un documento ya usado responde 409 con el mensaje del vertical", async () => {
	// La rama `23505` del update no tenia test: solo se probaba el duplicado en el alta.
	const taken = `2099${randomUUID().replace(/[^0-9]/g, "").padEnd(7, "3").slice(0, 7)}`;
	const free = `2077${randomUUID().replace(/[^0-9]/g, "").padEnd(7, "5").slice(0, 7)}`;

	const first = await createEntity(
		clientBody({ documentType: "RUC", documentNumber: taken, name: "RUC ocupado" }),
	);
	await createEntity(clientBody({ documentType: "RUC", documentNumber: free, name: "RUC libre" }));

	const before = await liveEntityCount(owner.ownerId);
	const collision = await call("PATCH", `/entities/${first}`, {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: free, name: "RUC ocupado" }),
	});

	assert.equal(collision.status, 409);
	assert.equal(collision.body?.message, DUPLICATE_MESSAGE);
	assert.notEqual(collision.body?.message, PAYMENTS_CONFLICT_MESSAGE);
	assert.equal((await rawRow(first))?.document_number, taken, "la fila rechazada no cambio");
	assert.equal(await liveEntityCount(owner.ownerId), before);
});

test("el documento es unico POR DUENO: otro dueno puede registrar el mismo RUC", async () => {
	// L7 cerrado (`odd/tasks/entidad-unico-por-dueno.md`): `entidad_document_unique` lleva
	// `owner_id`, asi que la unicidad es de cada dueno. Antes era global y en un esquema
	// multi-tenant eso impedia registrar una contraparte que otro negocio ya tenia, ademas de
	// confirmarle por 409 que existia.
	const ruc = `20${randomUUID().replace(/[^0-9]/g, "").padEnd(9, "7").slice(0, 9)}`;

	const own = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: ruc, name: "RUC del dueno" }),
	});

	assert.equal(own.status, 201);
	assert.equal(ruc.length, 11, "el RUC de prueba tiene 11 digitos");

	// Dentro del mismo dueno no cambia nada: el duplicado sigue rechazado con su mensaje.
	const sameOwner = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: ruc, name: "RUC repetido" }),
	});

	assert.equal(sameOwner.status, 409, "el mismo dueno no puede repetir el documento");
	assert.equal(sameOwner.body?.message, DUPLICATE_MESSAGE);

	const foreignCountBefore = await liveEntityCount(intruder.ownerId);

	const foreign = await call("POST", "/entities", {
		cookie: intruder.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: ruc, name: "RUC del intruso" }),
	});

	assert.equal(foreign.status, 201, "otro dueno si puede: la unicidad es por dueno");
	assert.equal(await liveEntityCount(intruder.ownerId), foreignCountBefore + 1);
	assert.equal(
		(await rawRow(foreign.body.id as string))?.owner_id,
		intruder.ownerId,
		"la fila nueva es del dueno que la creo",
	);

	// El intruso es el dueno demo sembrado, y el teardown solo limpia al dueno desechable: esta
	// fila se borra aca para no dejar la demo modificada.
	if (typeof foreign.body?.id === "string") {
		await pool.query("delete from public.entidad where id = $1", [foreign.body.id]);
	}
});

test("el tipo de documento es parte de la clave: el mismo numero con otro tipo es otra fila", async () => {
	// Agregado por la verificacion independiente: ningun test usaba el mismo numero con dos tipos
	// para un mismo dueno, asi que sacar `document_type` del indice no rompia nada. Un numero de 11
	// digitos es valido como RUC y tambien como carnet de extranjeria (9 a 12 alfanumericos).
	const number = `20${randomUUID().replace(/[^0-9]/g, "").padEnd(9, "4").slice(0, 9)}`;

	const asRuc = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: number, name: "Mismo numero RUC" }),
	});

	assert.equal(asRuc.status, 201);

	const asCarnet = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({
			documentType: "CARNET_EXTRANJERIA",
			documentNumber: number,
			name: "Mismo numero carnet",
		}),
	});

	assert.equal(asCarnet.status, 201, "otro tipo es otra fila del mismo dueno");

	const repeated = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "RUC", documentNumber: number, name: "RUC repetido" }),
	});

	assert.equal(repeated.status, 409);
	assert.equal(repeated.body?.message, DUPLICATE_MESSAGE);
});

test("el contrato compartido valida los formatos de documento del formulario", async () => {
	// Portado de `tests/unit/lib/schemas/client.test.ts` del origen, pero por el borde HTTP: el
	// schema vive en `@gestion/shared` y ese paquete no tiene runner propio (su barrel solo
	// resuelve con bundler), asi que la unica forma honesta de probarlo aca es el endpoint.
	const validCarnet = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({
			documentType: "CARNET_EXTRANJERIA",
			documentNumber: "C1A2B3C4D5",
			name: "Carnet valido",
		}),
	});

	assert.equal(validCarnet.status, 201, "un carnet de 10 alfanumericos es valido");

	const shortCarnet = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({
			documentType: "CARNET_EXTRANJERIA",
			documentNumber: "C1A2",
			name: "Carnet corto",
		}),
	});

	assert.equal(shortCarnet.status, 400);
	assert.equal(shortCarnet.body?.issues?.[0]?.message, "Número de documento inválido");

	const shortDni = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ documentType: "DNI", documentNumber: "1234567", name: "DNI corto" }),
	});

	assert.equal(shortDni.status, 400);
	assert.equal(shortDni.body?.issues?.[0]?.path, "documentNumber");

	const badManagementEmail = await call("POST", "/entities", {
		cookie: owner.cookie,
		body: clientBody({ managementEmail: "tampoco" }),
	});

	assert.equal(badManagementEmail.status, 400);
	assert.equal(badManagementEmail.body?.issues?.[0]?.path, "managementEmail");
});

test("ids inexistentes y malformados no tocan la base", async () => {
	const malformed = await call("PATCH", "/entities/no-es-un-uuid", {
		cookie: owner.cookie,
		body: clientBody(),
	});

	assert.equal(malformed.status, 400);
	assert.equal(malformed.body?.issues?.[0]?.path, "id");

	const counts = await liveEntityCount(owner.ownerId);
	const random = randomUUID();
	const nowhere = await call("POST", `/entities/${random}/delete`, { cookie: owner.cookie });

	assert.equal(nowhere.status, 404);
	assert.equal(await liveEntityCount(owner.ownerId), counts);
});
