// e2e de las ESCRITURAS de catalogo del vertical de cajas-bancos (C7) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que metodos de pago y categorias de recibo se pueden dar de alta y
// modificar por HTTP sin salir de `withOwner`, con las mismas reglas del origen y sin cambiar
// NADA de lo que hoy devuelven las cuatro lecturas de catalogo (`catalogs.e2e.test.ts` las pinnea):
//
//   - `POST /payment-methods` normaliza el codigo como el origen (trim, mayusculas, espacios a
//     guion bajo, maximo 40) y responde 201 con la fila;
//   - `PATCH /payment-methods/:id` renombra y desactiva, y el `code` es INMUTABLE despues del
//     alta: si el body lo manda, se descarta;
//   - `POST /receipt-categories` DERIVA el `code` del nombre con `categoryCodeFromName` del origen
//     (slug alfanumerico en mayusculas) y rechaza un nombre sin letras ni numeros con el mensaje
//     del origen. El cliente NO manda `code`: la columna es `not null` y unica por dueno, asi que
//     la deriva en un solo lugar;
//   - `PATCH /receipt-categories/:id` renombra y desactiva sin tocar el `code`;
//   - un codigo repetido responde 409 con un mensaje que NOMBRA el codigo, no el `23505` crudo;
//   - NO hay borrado: desactivar es `isActive: false`, y la fila sigue en la base;
//   - el aislamiento por dueno vale tambien para estas escrituras: modificar un catalogo ajeno
//     responde 404 y no toca la fila ajena (S6).
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: dos duenos nuevos por SQL y `signInEmail`, igual que
// `catalogs.e2e.test.ts`. El teardown los borra con `deleteOwnerFixtures`, que ya conoce
// `payment_method` y `cash_receipt_category`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import { deleteOwnerFixtures, createSecondOwner, type OwnerSession } from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Las cuatro rutas nuevas con una entrada valida, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{
		method: "POST",
		path: "/payment-methods",
		body: { code: "EFECTIVO", name: "Efectivo", isActive: true },
	},
	{
		method: "PATCH",
		path: `/payment-methods/${randomUUID()}`,
		body: { name: "Efectivo", isActive: false },
	},
	{
		method: "POST",
		path: "/receipt-categories",
		body: { direction: "INGRESO", name: "Cobranza", isActive: true },
	},
	{
		method: "PATCH",
		path: `/receipt-categories/${randomUUID()}`,
		body: { name: "Cobranza", isActive: false },
	},
];

let harness: ApiHarness;
let pool: Pool;
let owner: OwnerSession;
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

/** Filas de un catalogo del dueno, contadas por SQL (para probar que un rechazo no escribe). */
async function countOf(table: "payment_method" | "cash_receipt_category", ownerId: string) {
	const result = await pool.query<{ n: number }>(
		`select count(*)::int as n from public.${table} where owner_id = $1`,
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

/** La fila cruda de un catalogo, para comparar contra lo que devolvio el API. */
async function storedMethod(id: string): Promise<Record<string, unknown>> {
	const result = await pool.query<Record<string, unknown>>(
		"select code, name, is_active from public.payment_method where id = $1",
		[id],
	);

	return result.rows[0] as Record<string, unknown>;
}

async function storedCategory(id: string): Promise<Record<string, unknown>> {
	const result = await pool.query<Record<string, unknown>>(
		"select direction::text, code, name, is_active from public.cash_receipt_category where id = $1",
		[id],
	);

	return result.rows[0] as Record<string, unknown>;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de escritura de catalogos corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-catalogos-write-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	owner = await createSecondOwner(harness.pool, harness.auth);
	intruder = await createSecondOwner(harness.pool, harness.auth);
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

test("sin sesion las rutas de escritura de catalogos responden 401 antes de validar el body", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	const forged = await call("POST", "/payment-methods", {
		cookie: "better-auth.session_token=forged.sig",
		body: { code: "EFECTIVO", name: "Efectivo" },
	});

	assert.equal(forged.status, 401);
});

test("POST /payment-methods normaliza el codigo como el origen y GET lo lista con la forma de siempre", async () => {
	const created = await call("POST", "/payment-methods", {
		cookie: owner.cookie,
		body: { code: "  mi metodo  ", name: "Mi método", isActive: true },
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	// `paymentMethodSchema` compartido: trim, mayusculas y espacios a guion bajo.
	assert.deepEqual(
		{
			code: created.body.code,
			name: created.body.name,
			isActive: created.body.isActive,
		},
		{ code: "MI_METODO", name: "Mi método", isActive: true },
	);
	assert.equal(typeof created.body.id, "string");

	const listed = await call("GET", "/payment-methods", { cookie: owner.cookie });

	assert.equal(listed.status, 200);
	assert.deepEqual(
		listed.body.map((item: Record<string, unknown>) => item),
		[created.body],
		"la lectura del catalogo no cambio de forma: la misma fila, ni una clave mas",
	);
	assert.deepEqual(
		Object.keys(listed.body[0]).sort(),
		["code", "id", "isActive", "name"],
		"contrato pineado por catalogs.e2e.test.ts",
	);

	// `isActive` tiene default `true` en el schema compartido.
	const defaulted = await call("POST", "/payment-methods", {
		cookie: owner.cookie,
		body: { code: "tarjeta", name: "Tarjeta" },
	});

	assert.equal(defaulted.status, 201, JSON.stringify(defaulted.body));
	assert.equal(defaulted.body.isActive, true);
	assert.equal(defaulted.body.code, "TARJETA");
});

test("PATCH /payment-methods/:id renombra y desactiva, y el code es inmutable", async () => {
	const created = await call("POST", "/payment-methods", {
		cookie: owner.cookie,
		body: { code: "TRANSFERENCIA", name: "Transferencia", isActive: true },
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	const patched = await call("PATCH", `/payment-methods/${created.body.id}`, {
		cookie: owner.cookie,
		// `code` viaja a proposito: el schema de PATCH no lo declara y Zod lo descarta.
		body: { name: "Transferencia interbancaria", isActive: false, code: "OTRO" },
	});

	assert.equal(patched.status, 200, JSON.stringify(patched.body));
	assert.equal(patched.body.id, created.body.id);
	assert.equal(patched.body.code, "TRANSFERENCIA", "el codigo no cambia despues del alta");
	assert.equal(patched.body.name, "Transferencia interbancaria");
	assert.equal(patched.body.isActive, false);

	assert.deepEqual(await storedMethod(created.body.id), {
		code: "TRANSFERENCIA",
		name: "Transferencia interbancaria",
		is_active: false,
	});

	// No hay borrado: la fila sigue existiendo y sale con `onlyActive=false`.
	const all = await call("GET", "/payment-methods?onlyActive=false", { cookie: owner.cookie });
	const active = await call("GET", "/payment-methods", { cookie: owner.cookie });

	assert.equal(all.status, 200);
	assert.ok(
		all.body.some((item: { id: string }) => item.id === created.body.id),
		"desactivar no borra",
	);
	assert.ok(
		!active.body.some((item: { id: string }) => item.id === created.body.id),
		"el metodo desactivado no viaja en la lectura por defecto",
	);

	// Un PATCH sin campos es un no-op valido: devuelve la fila tal como esta.
	const noop = await call("PATCH", `/payment-methods/${created.body.id}`, {
		cookie: owner.cookie,
		body: {},
	});

	assert.equal(noop.status, 200, JSON.stringify(noop.body));
	assert.deepEqual(noop.body, patched.body, "sin campos no cambia nada");
});

test("un codigo de metodo repetido responde 409 con un mensaje que nombra el codigo y no escribe", async () => {
	const first = await call("POST", "/payment-methods", {
		cookie: owner.cookie,
		body: { code: "DEPOSITO", name: "Depósito", isActive: true },
	});

	assert.equal(first.status, 201, JSON.stringify(first.body));

	const before = await countOf("payment_method", owner.ownerId);

	// "deposito" se normaliza al MISMO codigo: el choque es del indice unico, no del texto.
	const duplicate = await call("POST", "/payment-methods", {
		cookie: owner.cookie,
		body: { code: "deposito", name: "Otro nombre", isActive: true },
	});

	assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
	assert.equal(
		duplicate.body.message,
		"Ya existe un método de pago con el código DEPOSITO.",
		"el 409 nombra el codigo; no filtra el texto crudo del 23505",
	);
	assert.equal(await countOf("payment_method", owner.ownerId), before, "el rechazo no escribe");
});

test("POST /receipt-categories deriva el code del nombre con la regla del origen", async () => {
	const titled = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "INGRESO", name: "Comisión mensual", isActive: true },
	});

	assert.equal(titled.status, 201, JSON.stringify(titled.body));

	// `categoryCodeFromName`: sin acentos, mayusculas y todo lo no alfanumerico a guion bajo.
	assert.equal(titled.body.code, "COMISION_MENSUAL");
	assert.equal(titled.body.direction, "INGRESO");
	assert.equal(titled.body.name, "Comisión mensual");
	assert.equal(titled.body.isActive, true);

	const spaced = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "EGRESO", name: "  Gastos  varios 2026  " },
	});

	assert.equal(spaced.status, 201, JSON.stringify(spaced.body));
	assert.equal(spaced.body.code, "GASTOS_VARIOS_2026");
	assert.equal(spaced.body.name, "Gastos  varios 2026", "el nombre se guarda trimeado");

	// La lectura por direccion no cambio de forma (cinco claves, pineadas por catalogs.e2e).
	const listed = await call("GET", "/receipt-categories?direction=INGRESO", {
		cookie: owner.cookie,
	});

	assert.equal(listed.status, 200);
	assert.deepEqual(listed.body.map((item: Record<string, unknown>) => item), [titled.body]);
	assert.deepEqual(
		Object.keys(listed.body[0]).sort(),
		["code", "direction", "id", "isActive", "name"],
	);

	// Un nombre sin letras ni numeros no tiene slug: se rechaza con el mensaje del origen y sin fila.
	const before = await countOf("cash_receipt_category", owner.ownerId);

	const symbols = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "INGRESO", name: "!!! ???" },
	});

	assert.equal(symbols.status, 400, JSON.stringify(symbols.body));
	assert.equal(symbols.body.message, "El nombre de la categoría debe contener letras o números.");
	assert.equal(await countOf("cash_receipt_category", owner.ownerId), before);
});

test("un codigo de categoria repetido responde 409 con un mensaje que nombra el codigo", async () => {
	const before = await countOf("cash_receipt_category", owner.ownerId);

	// Mismo slug, nombre distinto y OTRA direccion: el unico que se viola es `(owner_id, code)`.
	const duplicate = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "EGRESO", name: "comision-mensual" },
	});

	assert.equal(duplicate.status, 409, JSON.stringify(duplicate.body));
	assert.equal(duplicate.body.message, "Ya existe una categoría con el código COMISION_MENSUAL.");
	assert.equal(await countOf("cash_receipt_category", owner.ownerId), before);
});

test("PATCH /receipt-categories/:id renombra y desactiva sin tocar el code", async () => {
	const created = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "EGRESO", name: "Luz del local", isActive: true },
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.equal(created.body.code, "LUZ_DEL_LOCAL");

	const patched = await call("PATCH", `/receipt-categories/${created.body.id}`, {
		cookie: owner.cookie,
		body: { name: "Luz y agua del local", isActive: false },
	});

	assert.equal(patched.status, 200, JSON.stringify(patched.body));
	assert.equal(patched.body.code, "LUZ_DEL_LOCAL", "el codigo es estable: no se re-deriva");
	assert.equal(patched.body.name, "Luz y agua del local");
	assert.equal(patched.body.isActive, false);
	assert.deepEqual(await storedCategory(created.body.id), {
		direction: "EGRESO",
		code: "LUZ_DEL_LOCAL",
		name: "Luz y agua del local",
		is_active: false,
	});
});

test("una categoria desactivada sigue listada con onlyActive=false y no vuelve en el default", async () => {
	const created = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "EGRESO", name: "Flete del mes", isActive: true },
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));

	const patched = await call("PATCH", `/receipt-categories/${created.body.id}`, {
		cookie: owner.cookie,
		body: { isActive: false },
	});

	assert.equal(patched.status, 200, JSON.stringify(patched.body));

	const activeOnly = await call("GET", "/receipt-categories?direction=EGRESO", {
		cookie: owner.cookie,
	});
	const all = await call("GET", "/receipt-categories?direction=EGRESO&onlyActive=false", {
		cookie: owner.cookie,
	});

	assert.equal(activeOnly.status, 200, JSON.stringify(activeOnly.body));
	assert.equal(all.status, 200, JSON.stringify(all.body));

	// El default es el contrato que ya consumian el formulario de pagos y el sembrado: sin el
	// parametro la respuesta no cambia.
	assert.ok(
		!activeOnly.body.some((row: { id: string }) => row.id === created.body.id),
		"sin onlyActive el listado tiene que seguir devolviendo solo activas",
	);

	// Con `onlyActive=false` la desactivada sigue en pantalla, que es lo unico que permite
	// reactivarla: su PATCH necesita el id de una fila que se ve.
	assert.ok(
		all.body.some((row: { id: string }) => row.id === created.body.id),
		"onlyActive=false tiene que devolver la desactivada o la desactivacion es irreversible",
	);
});

test("renombrar una categoria a un nombre que ya existe en su direccion responde 409", async () => {
	// Dos categorias propias de este test: no depende del estado que dejen las anteriores.
	const target = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "EGRESO", name: "Alquiler", isActive: true },
	});
	const other = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "EGRESO", name: "Mantenimiento", isActive: true },
	});

	assert.equal(target.status, 201, JSON.stringify(target.body));
	assert.equal(other.status, 201, JSON.stringify(other.body));

	const before = await storedCategory(other.body.id);

	// `unique (owner_id, direction, name)` de la tabla: un 409 legible, no el 23505 crudo.
	const collision = await call("PATCH", `/receipt-categories/${other.body.id}`, {
		cookie: owner.cookie,
		body: { name: "Alquiler" },
	});

	assert.equal(collision.status, 409, JSON.stringify(collision.body));
	assert.equal(collision.body.message, "Ya existe una categoría con ese nombre.");
	assert.deepEqual(await storedCategory(other.body.id), before, "el rechazo no modifica la fila");
});

test("el aislamiento por dueno vale tambien para las escrituras de catalogo (S6)", async () => {
	const foreignMethod = await call("POST", "/payment-methods", {
		cookie: intruder.cookie,
		body: { code: "AJENO", name: "Método ajeno", isActive: true },
	});
	const foreignCategory = await call("POST", "/receipt-categories", {
		cookie: intruder.cookie,
		body: { direction: "INGRESO", name: "Categoría ajena", isActive: true },
	});

	assert.equal(foreignMethod.status, 201, JSON.stringify(foreignMethod.body));
	assert.equal(foreignCategory.status, 201, JSON.stringify(foreignCategory.body));

	const methodBefore = await storedMethod(foreignMethod.body.id);
	const categoryBefore = await storedCategory(foreignCategory.body.id);

	// La RLS recorta la fila: el UPDATE no encuentra nada y el borde responde 404.
	const methodAttempt = await call("PATCH", `/payment-methods/${foreignMethod.body.id}`, {
		cookie: owner.cookie,
		body: { name: "Secuestrado", isActive: false },
	});

	assert.equal(methodAttempt.status, 404, JSON.stringify(methodAttempt.body));
	assert.equal(methodAttempt.body.message, "El método de pago no existe.");

	const categoryAttempt = await call("PATCH", `/receipt-categories/${foreignCategory.body.id}`, {
		cookie: owner.cookie,
		body: { name: "Secuestrada", isActive: false },
	});

	assert.equal(categoryAttempt.status, 404, JSON.stringify(categoryAttempt.body));
	assert.equal(categoryAttempt.body.message, "La categoría no existe.");

	// Ni una columna de las filas ajenas cambio.
	assert.deepEqual(await storedMethod(foreignMethod.body.id), methodBefore);
	assert.deepEqual(await storedCategory(foreignCategory.body.id), categoryBefore);

	// El otro dueno sigue pudiendo modificar lo suyo: fue aislamiento, no una ruta rota.
	const ownPatch = await call("PATCH", `/payment-methods/${foreignMethod.body.id}`, {
		cookie: intruder.cookie,
		body: { name: "Método ajeno editado", isActive: false },
	});

	assert.equal(ownPatch.status, 200, JSON.stringify(ownPatch.body));
	assert.equal(ownPatch.body.name, "Método ajeno editado");
	assert.equal(ownPatch.body.code, "AJENO");

	// Un dueno no ve los catalogos del otro en las lecturas.
	const listed = await call("GET", "/receipt-categories?direction=INGRESO", {
		cookie: owner.cookie,
	});

	assert.equal(listed.status, 200);
	assert.ok(
		!listed.body.some((item: { id: string }) => item.id === foreignCategory.body.id),
		"la categoria del otro dueno no aparece en el listado",
	);
});

test("las escrituras de catalogo se validan con el pipe de Zod", async () => {
	const method = await call("POST", "/payment-methods", {
		cookie: owner.cookie,
		body: { code: "X".repeat(41), name: "Codigo largo" },
	});

	assert.equal(method.status, 400, JSON.stringify(method.body));

	const emptyName = await call("POST", "/payment-methods", {
		cookie: owner.cookie,
		body: { code: "SIN_NOMBRE", name: "   " },
	});

	assert.equal(emptyName.status, 400, JSON.stringify(emptyName.body));

	const badDirection = await call("POST", "/receipt-categories", {
		cookie: owner.cookie,
		body: { direction: "OTRO", name: "Categoria" },
	});

	assert.equal(badDirection.status, 400, JSON.stringify(badDirection.body));

	const badId = await call("PATCH", "/payment-methods/no-es-uuid", {
		cookie: owner.cookie,
		body: { name: "Nombre", isActive: true },
	});

	assert.equal(badId.status, 400, JSON.stringify(badId.body));

	const badCategoryId = await call("PATCH", "/receipt-categories/no-es-uuid", {
		cookie: owner.cookie,
		body: { name: "Nombre", isActive: true },
	});

	assert.equal(badCategoryId.status, 400, JSON.stringify(badCategoryId.body));
});
