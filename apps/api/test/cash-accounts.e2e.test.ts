// e2e de las cuentas de caja y banco del vertical de cajas-bancos (C2) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que `POST/PATCH/POST :id/delete` escriben SOLO las cuentas del dueno
// de la SESION (`withOwner`, ningun `owner_id` de entrada), que `GET /cash-accounts/:id` devuelve
// la fila completa que necesita el formulario de cuentas, y que la lectura de catalogo
// (`GET /cash-accounts`) que consume el formulario de pagos no cambio de forma.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: igual que `catalogs.e2e.test.ts`, salen de la API server-side de Better Auth
// (`signInEmail`, con el dueno creado por SQL), que es el mismo camino que ejecuta el handler HTTP.
//
// Los dos duenos son nuevos y no tienen cuentas: asi `GET /cash-accounts` arranca vacio y cada
// asercion de listado es del test, no de la demo. Los tests comparten esos duenos y corren en el
// orden en que se declaran (node:test dentro de un archivo), asi que cada uno deja el estado que
// el siguiente espera.
//
// `cash_account` no tiene hijas en este archivo (no se crean pagos, cierres ni vales), asi que
// `deleteOwnerFixtures` alcanza: borra la cuenta antes que sus hijas en el resto de los e2e
// (deuda L5 del doc de la feature, que C8 arregla), pero aca no hay hijas que borrar.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import {
	deleteOwnerFixtures,
	createSecondOwner,
	type OwnerSession,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/**
 * Las cinco claves de `CashAccountCatalogItem`: lo que devuelve `GET /cash-accounts` hoy porque
 * el formulario de pagos lo consume asi (`apps/web/components/pagos/*`). Es el contrato que este
 * slice NO puede cambiar.
 */
const CATALOG_KEYS = ["currency", "id", "isActive", "name", "type"];

/**
 * Mensaje del CHECK `cash_account_bank_requires_name`, que cubre las dos ramas de la regla (un
 * banco necesita banco, una caja no tiene datos bancarios). Lo redacta `cash.errors.ts`, no el
 * cliente.
 */
const BANK_REQUIRES_NAME_MESSAGE =
	"Una cuenta bancaria necesita banco y una caja no tiene datos bancarios.";

/** uuid de otro dueno que viaja en el body: el API lo ignora (el dueno sale de la sesion). */
const FORGED_OWNER_ID = "11111111-1111-4111-8111-111111111111";

let harness: ApiHarness;
let pool: Pool;
/** Dueno de las cuentas que se crean, leen, modifican y borran. */
let owner: OwnerSession;
/** Otro dueno: prueba que un id ajeno responde 404 y que su fila queda intacta. */
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

/** Rutas de cuentas con entradas validas, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: `/cash-accounts/${randomUUID()}` },
	{ method: "POST", path: "/cash-accounts", body: { type: "CASH_BOX", name: "Caja sin sesion" } },
	{
		method: "PATCH",
		path: `/cash-accounts/${randomUUID()}`,
		body: { type: "CASH_BOX", name: "Caja sin sesion" },
	},
	{ method: "POST", path: `/cash-accounts/${randomUUID()}/delete` },
];

/** Mensajes de los `issues` del pipe de Zod, por path (`{ "name": "Nombre" }`). */
function issuesByPath(body: unknown): Record<string, string> {
	const issues =
		(body as { issues?: Array<{ path: string; message: string }> } | null)?.issues ?? [];

	return Object.fromEntries(issues.map((issue) => [issue.path, issue.message]));
}

/** Cuentas que existen hoy para un dueno (via SQL, no via el API). */
async function rowCount(ownerId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.cash_account where owner_id = $1",
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

/** La fila cruda de una cuenta, leida como `dev_user` (owner de la tabla: se salta RLS). */
async function rawRow(id: string): Promise<{ owner_id: string; deleted_at: Date | null } | null> {
	const result = await pool.query<{ owner_id: string; deleted_at: Date | null }>(
		"select owner_id, deleted_at from public.cash_account where id = $1",
		[id],
	);

	return result.rows[0] ?? null;
}

/** Payload valido de cuenta bancaria con TODAS las columnas escritas por la ruta. */
function bankPayload(tag: string) {
	return {
		type: "BANK_ACCOUNT",
		name: `E2E banco ${tag}`,
		currency: "USD",
		// 20 digitos: el schema compartido lo exige si viene.
		cci: "00219300234567809156",
		accountNumber: "193-2345678-0-91",
		bankName: "BCP",
		closingPeriodicity: "MONTHLY",
		openingBalance: 1500.5,
		openingBalanceDate: "2026-01-15",
		notes: "cuenta operativa",
		isActive: true,
		isPettyCash: false,
		changeFund: 0,
	};
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de cuentas corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-cuentas-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	// Los dos duenos arrancan sin cuentas: el alta por SQL no siembra nada.
	owner = await createSecondOwner(harness.pool, harness.auth);
	intruder = await createSecondOwner(harness.pool, harness.auth);
});

after(async () => {
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

test("sin sesion las rutas de cuentas responden 401 antes de validar el body", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve antes del pipe: un payload invalido sin sesion sigue siendo 401.
	const invalid = await call("POST", "/cash-accounts", { body: { name: "" } });

	assert.equal(invalid.status, 401);

	const forged = await call("GET", `/cash-accounts/${randomUUID()}`, {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("POST /cash-accounts rechaza con 400 los payloads que no cumplen el schema compartido", async () => {
	const tag = owner.ownerId.slice(0, 8);
	const cases: Array<{ body: unknown; path: string; message: string }> = [
		{ body: { type: "CASH_BOX", name: "" }, path: "name", message: "Nombre requerido" },
		{
			body: { ...bankPayload(tag), openingBalance: -1 },
			path: "openingBalance",
			message: "El saldo inicial no puede ser negativo",
		},
		{
			body: { ...bankPayload(tag), openingBalanceDate: "15-01-2026" },
			path: "openingBalanceDate",
			message: "Fecha inválida (YYYY-MM-DD)",
		},
		{
			body: { ...bankPayload(tag), closingPeriodicity: "QUARTERLY" },
			path: "closingPeriodicity",
			message: "",
		},
		// El tipo es lo unico que el schema de la fila no trae: lo pone el body del alta.
		{ body: { name: "Cuenta sin tipo" }, path: "type", message: "" },
	];

	for (const item of cases) {
		const result = await call("POST", "/cash-accounts", { cookie: owner.cookie, body: item.body });

		assert.equal(result.status, 400, `${JSON.stringify(item.body)} deberia responder 400`);

		const issues = issuesByPath(result.body);

		assert.ok(item.path in issues, `el 400 nombra ${item.path}: ${JSON.stringify(issues)}`);

		if (item.message) {
			assert.equal(issues[item.path], item.message, "el mensaje es el del schema compartido");
		}
	}

	// Nada de lo rechazado se guardo.
	assert.equal(await rowCount(owner.ownerId), 0, "un payload rechazado no crea filas");
});

test("POST /cash-accounts de un banco sin nombre de banco responde el error de dominio", async () => {
	const tag = owner.ownerId.slice(0, 8);
	const payload = bankPayload(tag);
	// `cash_account_bank_requires_name`: la base exige `bank_name` no vacio para un banco.
	const { bankName: _bankName, ...withoutBank } = payload;

	const bank = await call("POST", "/cash-accounts", { cookie: owner.cookie, body: withoutBank });

	assert.equal(bank.status, 400, "un CHECK violado no es un 500");
	assert.equal(bank.body?.message, BANK_REQUIRES_NAME_MESSAGE);
	// El traductor es propio del vertical: no puede aparecer un mensaje de pagos.
	assert.ok(
		!/comprobante|pago/i.test(String(bank.body?.message)),
		"el mensaje es de cuentas, no de pagos",
	);

	// La otra rama del mismo CHECK: una caja no tiene datos bancarios.
	const cashBox = await call("POST", "/cash-accounts", {
		cookie: owner.cookie,
		body: { type: "CASH_BOX", name: `E2E caja con banco ${tag}`, bankName: "BCP" },
	});

	assert.equal(cashBox.status, 400);
	assert.equal(cashBox.body?.message, BANK_REQUIRES_NAME_MESSAGE);

	assert.equal(await rowCount(owner.ownerId), 0, "ninguna de las dos filas se creo");
});

test("POST /cash-accounts crea la fila completa y GET /:id la devuelve entera", async () => {
	const tag = owner.ownerId.slice(0, 8);
	const payload = bankPayload(tag);

	// `owner_id` viaja en el body a proposito: el schema lo descarta y el dueno sale de la sesion.
	const created = await call("POST", "/cash-accounts", {
		cookie: owner.cookie,
		body: { ...payload, owner_id: FORGED_OWNER_ID },
	});

	assert.equal(created.status, 201);

	const record = created.body;

	assert.equal(typeof record.id, "string");
	assert.deepEqual(
		{
			type: record.type,
			name: record.name,
			currency: record.currency,
			bankName: record.bankName,
			accountNumber: record.accountNumber,
			cci: record.cci,
			closingPeriodicity: record.closingPeriodicity,
			openingBalance: record.openingBalance,
			openingBalanceDate: record.openingBalanceDate,
			notes: record.notes,
			isActive: record.isActive,
			isPettyCash: record.isPettyCash,
			changeFund: record.changeFund,
			pettyExpenseLimit: record.pettyExpenseLimit,
			custodianName: record.custodianName,
			deletedAt: record.deletedAt,
		},
		{
			type: "BANK_ACCOUNT",
			name: `E2E banco ${tag}`,
			currency: "USD",
			bankName: "BCP",
			accountNumber: "193-2345678-0-91",
			cci: "00219300234567809156",
			closingPeriodicity: "MONTHLY",
			// `numeric(12,2)` vuelve como number: el formulario no formatea strings de la base.
			openingBalance: 1500.5,
			openingBalanceDate: "2026-01-15",
			notes: "cuenta operativa",
			isActive: true,
			isPettyCash: false,
			changeFund: 0,
			pettyExpenseLimit: null,
			custodianName: null,
			deletedAt: null,
		},
		"la respuesta del alta es la fila completa que necesita el formulario de cuentas",
	);

	// `createdAt`/`updatedAt` son timestamps ISO (lo que el origen leia como string).
	assert.match(String(record.createdAt), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
	assert.match(String(record.updatedAt), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);

	const read = await call("GET", `/cash-accounts/${record.id}`, { cookie: owner.cookie });

	assert.equal(read.status, 200);
	assert.deepEqual(read.body, record, "GET /:id devuelve la misma fila que devolvio el alta");

	// S6: la fila quedo del dueno de la sesion, no del uuid que vino en el body.
	const raw = await rawRow(record.id);

	assert.equal(raw?.owner_id, owner.ownerId, "el dueno sale de la sesion, nunca del payload");
	assert.notEqual(raw?.owner_id, FORGED_OWNER_ID);

	// Y el catalogo que consume el formulario de pagos no cambio: cinco claves, ni una mas.
	const list = await call("GET", "/cash-accounts", { cookie: owner.cookie });

	assert.equal(list.status, 200);

	const item = list.body.find((row: { id: string }) => row.id === record.id);

	assert.ok(item, "la cuenta nueva aparece en el catalogo");

	assert.deepEqual(
		Object.keys(item).sort(),
		CATALOG_KEYS,
		"GET /cash-accounts sigue devolviendo exactamente CashAccountCatalogItem",
	);
	assert.deepEqual(item, {
		id: record.id,
		type: "BANK_ACCOUNT",
		name: `E2E banco ${tag}`,
		currency: "USD",
		isActive: true,
	});
});

test("POST /cash-accounts guarda una caja chica con fondo, limite y custodio", async () => {
	const tag = owner.ownerId.slice(0, 8);

	const created = await call("POST", "/cash-accounts", {
		cookie: owner.cookie,
		body: {
			type: "CASH_BOX",
			name: `E2E caja chica ${tag}`,
			// "" es "usa la periodicidad global": la columna queda NULL, no "DAILY".
			closingPeriodicity: "",
			openingBalance: 0,
			openingBalanceDate: "2026-02-01",
			isPettyCash: true,
			changeFund: 200,
			pettyExpenseLimit: 150,
			custodianName: "Maria Quispe",
		},
	});

	assert.equal(created.status, 201);

	const record = created.body;

	assert.deepEqual(
		{
			type: record.type,
			currency: record.currency,
			bankName: record.bankName,
			accountNumber: record.accountNumber,
			cci: record.cci,
			closingPeriodicity: record.closingPeriodicity,
			openingBalance: record.openingBalance,
			openingBalanceDate: record.openingBalanceDate,
			notes: record.notes,
			isActive: record.isActive,
			isPettyCash: record.isPettyCash,
			changeFund: record.changeFund,
			pettyExpenseLimit: record.pettyExpenseLimit,
			custodianName: record.custodianName,
		},
		{
			type: "CASH_BOX",
			// El schema compartido pone la moneda por defecto.
			currency: "PEN",
			bankName: null,
			accountNumber: null,
			cci: null,
			closingPeriodicity: null,
			openingBalance: 0,
			openingBalanceDate: "2026-02-01",
			notes: null,
			isActive: true,
			isPettyCash: true,
			changeFund: 200,
			pettyExpenseLimit: 150,
			custodianName: "Maria Quispe",
		},
		"los campos de caja chica viajan en la fila completa",
	);

	const read = await call("GET", `/cash-accounts/${record.id}`, { cookie: owner.cookie });

	assert.equal(read.status, 200);
	assert.deepEqual(read.body, record);
});

// El schema compartido es el contrato del body del API y tambien el de la fila, y el formulario de
// la web manda la SALIDA ya parseada: una caja sin periodicidad propia llega como
// `closingPeriodicity: null`, no como "". Hasta C8 el contrato rechazaba su propia salida (400
// `invalid_union`) y solo lo veia el navegador, porque ningun test de API mandaba `null`. Este caso
// fija el limite HTTP para que el defecto no vuelva por la puerta de atras.
test("POST /cash-accounts acepta en null la periodicidad que el schema produce", async () => {
	const tag = owner.ownerId.slice(0, 8);

	const created = await call("POST", "/cash-accounts", {
		cookie: owner.cookie,
		body: {
			type: "CASH_BOX",
			name: `E2E caja sin periodicidad ${tag}`,
			closingPeriodicity: null,
			openingBalance: 0,
			openingBalanceDate: "2026-02-01",
		},
	});

	assert.equal(created.status, 201, JSON.stringify(created.body));
	assert.equal(created.body.closingPeriodicity, null);

	const read = await call("GET", `/cash-accounts/${created.body.id}`, { cookie: owner.cookie });

	assert.equal(read.status, 200);
	assert.equal(read.body.closingPeriodicity, null);
});

test("PATCH /cash-accounts/:id actualiza las columnas editables y devuelve la fila nueva", async () => {
	const tag = owner.ownerId.slice(0, 8);

	const created = await call("POST", "/cash-accounts", {
		cookie: owner.cookie,
		body: bankPayload(tag),
	});

	assert.equal(created.status, 201);

	const id = created.body.id;
	// El PATCH del origen manda la fila completa (`mapMutation`), no un diff.
	const updated = await call("PATCH", `/cash-accounts/${id}`, {
		cookie: owner.cookie,
		body: {
			type: "BANK_ACCOUNT",
			name: `E2E banco editado ${tag}`,
			currency: "PEN",
			bankName: "Interbank",
			accountNumber: "200-1234567-89",
			cci: "",
			closingPeriodicity: "WEEKLY",
			openingBalance: 42.75,
			openingBalanceDate: "2026-01-20",
			notes: "editada",
			isActive: false,
			isPettyCash: false,
			changeFund: 0,
		},
	});

	assert.equal(updated.status, 200);
	assert.equal(updated.body.id, id, "el PATCH conserva el id");
	assert.deepEqual(
		{
			name: updated.body.name,
			currency: updated.body.currency,
			bankName: updated.body.bankName,
			accountNumber: updated.body.accountNumber,
			cci: updated.body.cci,
			closingPeriodicity: updated.body.closingPeriodicity,
			openingBalance: updated.body.openingBalance,
			openingBalanceDate: updated.body.openingBalanceDate,
			notes: updated.body.notes,
			isActive: updated.body.isActive,
		},
		{
			name: `E2E banco editado ${tag}`,
			currency: "PEN",
			bankName: "Interbank",
			accountNumber: "200-1234567-89",
			// "" en un texto opcional del schema compartido se guarda como NULL.
			cci: null,
			closingPeriodicity: "WEEKLY",
			openingBalance: 42.75,
			openingBalanceDate: "2026-01-20",
			notes: "editada",
			isActive: false,
		},
	);

	// El trigger `cash_account_set_updated_at` movio la marca; el alta y la edicion se distinguen.
	assert.notEqual(updated.body.updatedAt, created.body.updatedAt);

	const read = await call("GET", `/cash-accounts/${id}`, { cookie: owner.cookie });

	assert.deepEqual(read.body, updated.body, "GET /:id persiste lo que devolvio el PATCH");
});

test("PATCH /cash-accounts/:id de otro dueno responde 404 y deja la fila intacta", async () => {
	const tag = owner.ownerId.slice(0, 8);

	const created = await call("POST", "/cash-accounts", {
		cookie: owner.cookie,
		body: bankPayload(tag),
	});

	assert.equal(created.status, 201);

	const id = created.body.id;

	const intruderPatch = await call("PATCH", `/cash-accounts/${id}`, {
		cookie: intruder.cookie,
		body: { ...bankPayload(tag), name: "Secuestrada" },
	});

	assert.equal(intruderPatch.status, 404, "un id ajeno no existe para el otro dueno");
	assert.equal(intruderPatch.body?.message, "La cuenta no existe o fue eliminada.");

	// Y tampoco la puede leer ni borrar.
	assert.equal(
		(await call("GET", `/cash-accounts/${id}`, { cookie: intruder.cookie })).status,
		404,
	);
	assert.equal(
		(await call("POST", `/cash-accounts/${id}/delete`, { cookie: intruder.cookie })).status,
		404,
	);

	// La fila del dueno no se movio.
	const read = await call("GET", `/cash-accounts/${id}`, { cookie: owner.cookie });

	assert.equal(read.status, 200);
	assert.deepEqual(read.body, created.body, "el intento del otro dueno no cambio ni un campo");

	const raw = await rawRow(id);

	assert.equal(raw?.owner_id, owner.ownerId);
	assert.equal(raw?.deleted_at, null);
});

test("POST /cash-accounts/:id/delete borra logicamente: sale del listado y GET /:id responde 404", async () => {
	const tag = owner.ownerId.slice(0, 8);

	const created = await call("POST", "/cash-accounts", {
		cookie: owner.cookie,
		body: { type: "CASH_BOX", name: `E2E caja baja ${tag}` },
	});

	assert.equal(created.status, 201);

	const id = created.body.id;

	const deleted = await call("POST", `/cash-accounts/${id}/delete`, { cookie: owner.cookie });

	assert.equal(deleted.status, 200, "POST responde 200: no se creo ningun recurso");
	assert.deepEqual(deleted.body, { deleted: true });

	assert.equal(
		(await call("GET", `/cash-accounts/${id}`, { cookie: owner.cookie })).status,
		404,
		"una cuenta borrada ya no se lee por id",
	);

	const list = await call("GET", "/cash-accounts", { cookie: owner.cookie });

	assert.ok(
		!list.body.some((row: { id: string }) => row.id === id),
		"y tampoco se ofrece en el catalogo de pagos",
	);

	// La fila sigue en la base: es una baja logica, no un delete.
	const raw = await rawRow(id);

	assert.equal(raw?.owner_id, owner.ownerId);
	assert.ok(raw?.deleted_at instanceof Date, "deleted_at quedo marcado");

	// Y una cuenta borrada no se puede volver a editar ni borrar por la ruta de escritura.
	assert.equal(
		(await call("PATCH", `/cash-accounts/${id}`, {
			cookie: owner.cookie,
			body: { type: "CASH_BOX", name: `E2E caja baja ${tag}` },
		})).status,
		404,
	);
	assert.equal(
		(await call("POST", `/cash-accounts/${id}/delete`, { cookie: owner.cookie })).status,
		404,
	);
});
