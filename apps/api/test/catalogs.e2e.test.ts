// e2e de los catalogos del vertical de pagos (T5b2) contra la base viva `gestion_pagos_dev`.
//
// Que prueba, en una frase: que las cuatro lecturas que necesita el formulario de pagos
// (entidades, cuentas de caja, metodos de pago, categorias de recibo) devuelven solo los
// catalogos del dueno de la SESION, y que la unica escritura —`POST /catalogs/ensure`— siembra
// las semillas del origen una sola vez, de forma idempotente y sin tocar los catalogos de otro
// dueno.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: igual que `payments.e2e.test.ts`, las dos salen de la API server-side de Better Auth
// (`signInEmail` / `signUpEmail`), que es el mismo camino que ejecuta el handler HTTP.
//
// El segundo dueno se da de alta SIN catalogos a proposito: es lo que un usuario nuevo ve antes
// de que la app siembre nada, y es el caso que ejercita `POST /catalogs/ensure`.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import {
	APP_TODAY,
	deleteOwnerFixtures,
	findSeededOwnerId,
	grantDemoCredential,
	revokeDemoCredential,
	signIn,
	signUpSecondOwner,
	TEST_PASSWORD,
	type OwnerSession,
} from "./support/fixtures.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

const SOME_UUID = "11111111-1111-4111-8111-111111111111";

/** Semillas de `lib/caja/defaults.ts` del proyecto de origen (mismos codigos y nombres). */
const SEED_METHODS = [
	{ code: "EFECTIVO", name: "Efectivo" },
	{ code: "TRANSFERENCIA_BCP", name: "Transferencia BCP" },
	{ code: "TARJETA_CREDITO", name: "Tarjeta de crédito" },
];

const SEED_CATEGORIES = {
	INGRESO: [
		{ code: "COBRANZA_VENTA", name: "Cobranza de venta" },
		{ code: "ANTICIPO_CLIENTE", name: "Anticipo de cliente" },
		{ code: "APORTE_PROPIETARIO", name: "Aporte del propietario" },
		{ code: "ABONO_BANCARIO", name: "Abono bancario" },
		{ code: "OTRO_INGRESO", name: "Otro ingreso" },
	],
	EGRESO: [
		{ code: "PAGO_PROVEEDOR", name: "Pago a proveedor" },
		{ code: "ANTICIPO_PROVEEDOR", name: "Anticipo a proveedor" },
		{ code: "GASTO_OPERATIVO", name: "Gasto operativo" },
		{ code: "RETIRO_PROPIETARIO", name: "Retiro del propietario" },
		{ code: "ITF", name: "ITF" },
		{ code: "COMISION_BANCARIA", name: "Comisión bancaria" },
		{ code: "DETRACCION_SPOT", name: "Detracción SPOT" },
		{ code: "OTRO_EGRESO", name: "Otro egreso" },
	],
};

let harness: ApiHarness;
let pool: Pool;
let demo: OwnerSession;
let second: OwnerSession;

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

/** Rutas de catalogo con entradas validas, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/entities?role=client" },
	{ method: "GET", path: "/entities?role=supplier" },
	{ method: "GET", path: "/cash-accounts" },
	{ method: "GET", path: "/payment-methods" },
	{ method: "GET", path: "/receipt-categories?direction=INGRESO" },
	{ method: "POST", path: "/catalogs/ensure" },
];

/** Conteos de catalogo de un dueno, para probar que una escritura no toco al otro. */
async function catalogCounts(ownerId: string): Promise<Record<string, number>> {
	const result = await pool.query<{
		methods: number;
		categories: number;
		accounts: number;
		entities: number;
	}>(
		`select
		   (select count(*)::int from public.payment_method where owner_id = $1) as methods,
		   (select count(*)::int from public.cash_receipt_category where owner_id = $1) as categories,
		   (select count(*)::int from public.cash_account where owner_id = $1) as accounts,
		   (select count(*)::int from public.entidad where owner_id = $1) as entities`,
		[ownerId],
	);

	return result.rows[0] as unknown as Record<string, number>;
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de catalogos corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-catalogos-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	const demoOwnerId = await findSeededOwnerId(pool);
	const demoEmail = await grantDemoCredential(pool, demoOwnerId);
	demo = await signIn(harness.auth, demoEmail, TEST_PASSWORD);

	// El segundo dueno arranca sin catalogos: `signUpEmail` no siembra nada.
	second = await signUpSecondOwner(harness.auth);
});

after(async () => {
	if (pool && second) {
		await deleteOwnerFixtures(pool, second.ownerId);
	}

	if (pool && demo) {
		await revokeDemoCredential(pool, demo.ownerId, demo.sessionTokens);
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las rutas de catalogo responden 401 antes de validar la query", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve antes del pipe: una query invalida sin sesion sigue siendo 401.
	const invalid = await call("GET", "/entities?role=nope");

	assert.equal(invalid.status, 401);

	const forged = await call("GET", "/payment-methods", {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("GET /payment-methods y /receipt-categories devuelven solo los catalogos del dueno", async () => {
	const methods = await call("GET", "/payment-methods", { cookie: demo.cookie });

	assert.equal(methods.status, 200);
	assert.ok(Array.isArray(methods.body));
	assert.ok(methods.body.length >= 3, "el dueno demo tiene el catalogo sembrado");

	for (const method of methods.body) {
		assert.equal(typeof method.id, "string");
		assert.equal(typeof method.code, "string");
		assert.equal(typeof method.name, "string");
		assert.equal(typeof method.isActive, "boolean");
	}

	const demoMethodCodes = new Set(methods.body.map((item: { code: string }) => item.code));

	assert.ok(demoMethodCodes.has("EFECTIVO"), "el metodo EFECTIVO decide caja vs banco en el form");

	// El otro dueno no tiene catalogo todavia: no hereda el del demo (RLS + owner_id).
	const otherMethods = await call("GET", "/payment-methods", { cookie: second.cookie });

	assert.equal(otherMethods.status, 200);
	assert.deepEqual(otherMethods.body, [], "un dueno nuevo no ve metodos de otro dueno");

	const otherCategories = await call("GET", "/receipt-categories?direction=INGRESO", {
		cookie: second.cookie,
	});

	assert.equal(otherCategories.status, 200);
	assert.deepEqual(otherCategories.body, []);

	const demoCategories = await call("GET", "/receipt-categories?direction=INGRESO", {
		cookie: demo.cookie,
	});

	assert.equal(demoCategories.status, 200);

	for (const category of demoCategories.body) {
		assert.equal(category.direction, "INGRESO");
		assert.equal(typeof category.code, "string");
		assert.equal(typeof category.isActive, "boolean");
	}

	// El filtro por direccion no mezcla: EGRESO solo trae egresos.
	const demoExpenses = await call("GET", "/receipt-categories?direction=EGRESO", {
		cookie: demo.cookie,
	});

	assert.equal(demoExpenses.status, 200);

	for (const category of demoExpenses.body) {
		assert.equal(category.direction, "EGRESO");
	}
});

test("POST /catalogs/ensure siembra las semillas del origen una sola vez", async () => {
	const demoBefore = await catalogCounts(demo.ownerId);

	const first = await call("POST", "/catalogs/ensure", { cookie: second.cookie });

	assert.equal(first.status, 200);
	assert.deepEqual(
		{ methods: first.body.methods, categories: first.body.categories },
		{ methods: SEED_METHODS.length, categories: 5 + 8 },
		"la primera llamada crea las 3 semillas de metodos y las 13 de categorias",
	);

	// Idempotente: la segunda llamada no crea nada.
	const secondCall = await call("POST", "/catalogs/ensure", { cookie: second.cookie });

	assert.equal(secondCall.status, 200);
	assert.deepEqual(
		{ methods: secondCall.body.methods, categories: secondCall.body.categories },
		{ methods: 0, categories: 0 },
	);

	const methods = await call("GET", "/payment-methods", { cookie: second.cookie });

	assert.equal(methods.status, 200);
	assert.deepEqual(
		methods.body.map((item: { code: string; name: string }) => ({ code: item.code, name: item.name })),
		[...SEED_METHODS].sort((a, b) => (a.name < b.name ? -1 : 1)),
		"los metodos sembrados son los del origen, con el mismo nombre y orden (por nombre)",
	);

	for (const direction of ["INGRESO", "EGRESO"] as const) {
		const categories = await call(`GET`, `/receipt-categories?direction=${direction}`, {
			cookie: second.cookie,
		});

		assert.equal(categories.status, 200);
		assert.deepEqual(
			categories.body.map((item: { code: string; name: string; direction: string }) => ({
				code: item.code,
				name: item.name,
				direction: item.direction,
			})),
			[...SEED_CATEGORIES[direction]]
				.sort((a, b) => (a.name < b.name ? -1 : 1))
				.map((item) => ({ ...item, direction })),
			`las categorias de ${direction} son las del origen, con el mismo codigo y nombre`,
		);
	}

	// Y la escritura no toco los catalogos del otro dueno.
	assert.deepEqual(await catalogCounts(demo.ownerId), demoBefore);
});

test("GET /cash-accounts devuelve las cuentas propias con los campos que usa el formulario", async () => {
	const accountId = randomUUID();
	const tag = second.ownerId.slice(0, 8);

	// `cash_account_bank_requires_name`: una cuenta bancaria exige nombre de banco.
	await pool.query(
		`insert into public.cash_account (id, type, name, currency, bank_name, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'BANK_ACCOUNT', $2, 'USD', 'BCP', 0, ${APP_TODAY}, $3)`,
		[accountId, `E2E banco ${tag}`, second.ownerId],
	);

	const mine = await call("GET", "/cash-accounts", { cookie: second.cookie });

	assert.equal(mine.status, 200);
	assert.equal(mine.body.length, 1, "el dueno nuevo solo ve la cuenta que se le creo");
	assert.deepEqual(
		{
			id: mine.body[0].id,
			name: mine.body[0].name,
			type: mine.body[0].type,
			currency: mine.body[0].currency,
			isActive: mine.body[0].isActive,
		},
		{
			id: accountId,
			name: `E2E banco ${tag}`,
			type: "BANK_ACCOUNT",
			currency: "USD",
			isActive: true,
		},
	);

	const demoAccounts = await call("GET", "/cash-accounts", { cookie: demo.cookie });

	assert.equal(demoAccounts.status, 200);

	const demoIds = new Set(demoAccounts.body.map((item: { id: string }) => item.id));

	assert.ok(!demoIds.has(accountId), "la cuenta del otro dueno no aparece en el listado");

	// Una cuenta soft-deleted no se ofrece para registrar pagos.
	await pool.query("update public.cash_account set deleted_at = now() where id = $1", [accountId]);

	const afterDelete = await call("GET", "/cash-accounts", { cookie: second.cookie });

	assert.equal(afterDelete.status, 200);
	assert.deepEqual(afterDelete.body, []);
});

test("GET /entities filtra por rol y excluye las entidades borradas", async () => {
	const clientId = randomUUID();
	const supplierId = randomUUID();
	const tag = second.ownerId.slice(0, 8);

	await pool.query(
		`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, is_supplier, owner_id)
		 values ($1, 'RUC', $2, $3, $4, true, false, $6),
		        ($5, 'SIN_DOCUMENTO', '', $7, $8, false, true, $6)`,
		[
			clientId,
			`20${tag}00001`.slice(0, 11),
			`E2E cliente ${tag}`,
			`cliente-${tag}@example.test`,
			supplierId,
			second.ownerId,
			`E2E proveedor ${tag}`,
			`proveedor-${tag}@example.test`,
		],
	);

	const clients = await call("GET", "/entities?role=client", { cookie: second.cookie });

	assert.equal(clients.status, 200);
	assert.deepEqual(
		clients.body.map((item: { id: string }) => item.id),
		[clientId],
		"role=client solo trae entidades marcadas como cliente",
	);

	const client = clients.body[0];

	assert.deepEqual(
		{
			name: client.name,
			documentType: client.documentType,
			documentNumber: client.documentNumber,
			billingEmail: client.billingEmail,
			isSupplier: client.isSupplier,
		},
		{
			name: `E2E cliente ${tag}`,
			documentType: "RUC",
			documentNumber: `20${tag}00001`.slice(0, 11),
			billingEmail: `cliente-${tag}@example.test`,
			isSupplier: false,
		},
		"la entidad viaja con los campos que consume el autocomplete",
	);

	const suppliers = await call("GET", "/entities?role=supplier", { cookie: second.cookie });

	assert.equal(suppliers.status, 200);
	assert.deepEqual(
		suppliers.body.map((item: { id: string }) => item.id),
		[supplierId],
		"role=supplier solo trae proveedores",
	);

	// Borrado logico: deja de ofrecerse, sin perder la fila.
	await pool.query("update public.entidad set deleted_at = now() where id = $1", [clientId]);

	const afterDelete = await call("GET", "/entities?role=client", { cookie: second.cookie });

	assert.equal(afterDelete.status, 200);
	assert.deepEqual(afterDelete.body, []);

	const stillThere = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.entidad where id = $1",
		[clientId],
	);

	assert.equal(stillThere.rows[0]?.n, 1, "el borrado logico no borra la fila");
});

test("las queries de catalogo se validan con el pipe de Zod", async () => {
	const cases = [
		{ path: "/entities?role=nope" },
		{ path: "/payment-methods?onlyActive=nope" },
		{ path: "/receipt-categories?direction=NOPE" },
	];

	for (const item of cases) {
		const result = await call("GET", item.path, { cookie: demo.cookie });

		assert.equal(result.status, 400, `${item.path} deberia responder 400`);
	}

	// Entradas validas: 200, y `onlyActive=false` incluye las inactivas.
	const inactiveCode = `INACTIVO_${randomUUID().slice(0, 8)}`.toUpperCase();

	await pool.query(
		`insert into public.payment_method (code, name, is_active, owner_id)
		 values ($1, 'Metodo inactivo', false, $2)`,
		[inactiveCode, demo.ownerId],
	);

	const activeOnly = await call("GET", "/payment-methods", { cookie: demo.cookie });

	assert.equal(activeOnly.status, 200);
	assert.ok(
		!activeOnly.body.some((item: { code: string }) => item.code === inactiveCode),
		"por defecto solo viajan los metodos activos",
	);

	const all = await call("GET", "/payment-methods?onlyActive=false", { cookie: demo.cookie });

	assert.equal(all.status, 200);
	assert.ok(
		all.body.some((item: { code: string }) => item.code === inactiveCode),
		"onlyActive=false incluye los inactivos",
	);

	await pool.query("delete from public.payment_method where owner_id = $1 and code = $2", [
		demo.ownerId,
		inactiveCode,
	]);
});

// `SOME_UUID` documenta que ningun id de URL participa de estas rutas: son catalogos del dueno.
void SOME_UUID;
