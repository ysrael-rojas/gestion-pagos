// e2e de los ajustes generales del vertical de cajas-bancos (C1) contra la base viva
// `gestion_pagos_dev`.
//
// Que prueba, en una frase: que `GET /settings` solo lee, que `PATCH /settings` valida con los
// mensajes del origen y escribe solo los ajustes del dueno de la SESION, y que
// `POST /settings/ensure` siembra las tres semillas del origen una sola vez (`{created: 3}` y
// despues `{created: 0}`) sin tocar a otro dueno. Es la deuda L67: sin estas filas
// `close_cash_account` cae a `DAILY`/`0.50` y `create_petty_cash_vale` no encuentra el metodo
// `EFECTIVO` ni una categoria EGRESO.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL         la base sembrada.
//   BETTER_AUTH_SECRET   firma de las cookies de sesion; si falta se genera uno efimero.
//
// Sesiones: igual que `catalogs.e2e.test.ts`, salen de la API server-side de Better Auth
// (`signInEmail` / `signUpEmail`), que es el mismo camino que ejecuta el handler HTTP.
//
// Los duenos nuevos se dan de alta SIN ajustes a proposito: es lo que ve un usuario recien creado
// antes de que la app siembre nada, y es el caso que ejercita `POST /settings/ensure`. Los tests
// comparten esos duenos y corren en el orden en que se declaran (node:test dentro de un archivo),
// asi que cada uno deja el estado que el siguiente espera.
//
// `app_setting` NO esta en `deleteOwnerFixtures` (fixtures.ts no es parte de esta tarea), asi que
// este test borra sus propias filas de ajustes en el teardown ademas de las del fixture.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Pool } from "pg";
import type { ApiHarness } from "./support/harness.ts";
import {
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

/**
 * Las tres semillas del origen, con el valor textual que queda en `app_setting.value`.
 *
 * `lib/caja/caja.ts:51` (`DAILY`), `:54` (`"3.75"`) y `:56` (`DEFAULT_DIFFERENCE_TOLERANCE = 0.5`,
 * que se empuja con `String(...)` en la linea 377); la tolerancia se siembra `"0.50"` para que un
 * dueno nuevo quede igual que los que migro
 * `20261027202707_spec49_cash_close_tolerance_and_reason.sql:35`, que inserto `'0.50'`. El SQL
 * castea `value::numeric(12,2)`: el numero es 0.5 en los dos casos.
 */
const SEED_SETTINGS = {
	default_closing_periodicity: "DAILY",
	pen_usd_rate: "3.75",
	cash_difference_tolerance: "0.50",
};

/** Textuales del origen (`general-settings-card.tsx:80` y `:85`). */
const RATE_ERROR = "El tipo de cambio debe ser mayor a 0.";
const TOLERANCE_ERROR = "La tolerancia de diferencia debe ser mayor o igual a 0.";

let harness: ApiHarness;
let pool: Pool;
let demo: OwnerSession;
/** Segundo dueno: el que se siembra, se edita y se compara contra el demo. */
let second: OwnerSession;
/** Tercer dueno desechable: prueba el upsert de PATCH sin sembrar antes. */
let spare: OwnerSession;

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

/** Rutas de ajustes con entradas validas, para el barrido de 401. */
const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
	{ method: "GET", path: "/settings" },
	{ method: "PATCH", path: "/settings", body: { pen_usd_rate: 3.8 } },
	{ method: "POST", path: "/settings/ensure", body: {} },
];

/** Filas de `app_setting` que existen hoy para un dueno (via SQL, no via el API). */
async function rowCount(ownerId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.app_setting where owner_id = $1",
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

/** Valor textual guardado de una clave, o `null` si la fila no existe. */
async function storedValue(ownerId: string, key: string): Promise<string | null> {
	const result = await pool.query<{ value: string }>(
		"select value from public.app_setting where owner_id = $1 and key = $2",
		[ownerId, key],
	);

	return result.rows[0]?.value ?? null;
}

/** Mensajes de los `issues` del pipe de Zod, por path (`{ "pen_usd_rate": "..." }`). */
function issuesByPath(body: unknown): Record<string, string> {
	const issues =
		(body as { issues?: Array<{ path: string; message: string }> } | null)?.issues ?? [];

	return Object.fromEntries(issues.map((issue) => [issue.path, issue.message]));
}

before(async () => {
	if (!process.env.DATABASE_URL?.trim()) {
		throw new Error(
			"Falta DATABASE_URL: los e2e de ajustes corren contra la base sembrada (no hay valor por defecto).",
		);
	}

	process.env.BETTER_AUTH_SECRET ??= "e2e-ajustes-secret-no-persistido";
	process.env.BETTER_AUTH_URL ??= "http://127.0.0.1:3001";

	const module = await loadApiHarness();
	harness = await module.startApi();
	pool = harness.pool;

	const demoOwnerId = await findSeededOwnerId(pool);
	const demoEmail = await grantDemoCredential(pool, demoOwnerId);
	demo = await signIn(harness.auth, demoEmail, TEST_PASSWORD);

	// Los dos duenos nuevos arrancan sin ajustes: `signUpEmail` no siembra nada.
	second = await signUpSecondOwner(harness.auth);
	spare = await signUpSecondOwner(harness.auth);
});

after(async () => {
	// `app_setting` no tiene FK a `auth.users` (migracion `20261006063301`, lineas 51-57) y
	// `deleteOwnerFixtures` no la borra: sin estas dos lineas quedarian filas huerfanas en la base
	// de desarrollo.
	for (const owner of [second, spare]) {
		if (owner) {
			await pool.query("delete from public.app_setting where owner_id = $1", [owner.ownerId]);
		}
	}

	if (pool && second) {
		await deleteOwnerFixtures(pool, second.ownerId);
	}

	if (pool && spare) {
		await deleteOwnerFixtures(pool, spare.ownerId);
	}

	if (pool && demo) {
		await revokeDemoCredential(pool, demo.ownerId, demo.sessionTokens);
	}

	if (harness) {
		await harness.close();
	}

	removeApiHarnessBundle();
});

test("sin sesion las rutas de ajustes responden 401 antes de validar el body", async () => {
	for (const route of ROUTES) {
		const result = await call(route.method, route.path, { body: route.body });

		assert.equal(
			result.status,
			401,
			`${route.method} ${route.path} deberia responder 401 sin sesion, respondio ${result.status}`,
		);
		assert.equal(result.body?.message, "Sesion requerida.");
	}

	// La sesion se resuelve antes del pipe: un body invalido sin sesion sigue siendo 401.
	const invalid = await call("PATCH", "/settings", {
		body: { pen_usd_rate: -1, default_closing_periodicity: "NOPE" },
	});

	assert.equal(invalid.status, 401);

	const forged = await call("GET", "/settings", {
		cookie: "better-auth.session_token=forged.sig",
	});

	assert.equal(forged.status, 401);
});

test("GET /settings de un dueno sin filas devuelve el mapa vacio y no siembra nada", async () => {
	const empty = await call("GET", "/settings", { cookie: second.cookie });

	assert.equal(empty.status, 200);
	assert.deepEqual(empty.body, {}, "un dueno nuevo no hereda los ajustes de otro");

	// Un GET que escribe es justo lo que S7/L67 prohibe: la lectura no crea las semillas.
	assert.equal(await rowCount(second.ownerId), 0, "GET /settings no debe sembrar nada");

	// Y lo que ve el otro dueno son sus propias filas, no las del demo.
	const demoBefore = await call("GET", "/settings", { cookie: demo.cookie });

	assert.equal(demoBefore.status, 200);
	assert.equal(typeof demoBefore.body, "object");
	assert.equal(Object.keys(demoBefore.body).length, await rowCount(demo.ownerId));
});

test("POST /settings/ensure siembra las tres semillas del origen una sola vez", async () => {
	const demoBefore = await call("GET", "/settings", { cookie: demo.cookie });

	const first = await call("POST", "/settings/ensure", { cookie: second.cookie });

	assert.equal(first.status, 200);
	assert.deepEqual(first.body, { created: 3 }, "la primera llamada crea las tres semillas");

	const settings = await call("GET", "/settings", { cookie: second.cookie });

	assert.equal(settings.status, 200);
	assert.deepEqual(
		settings.body,
		SEED_SETTINGS,
		"las tres claves y sus valores por defecto son los del origen",
	);

	// Los valores guardados son los mismos strings: la tolerancia queda "0.50" (el SQL la castea).
	assert.equal(await storedValue(second.ownerId, "default_closing_periodicity"), "DAILY");
	assert.equal(await storedValue(second.ownerId, "pen_usd_rate"), "3.75");
	assert.equal(await storedValue(second.ownerId, "cash_difference_tolerance"), "0.50");

	// Idempotente: la segunda llamada no crea nada.
	const again = await call("POST", "/settings/ensure", { cookie: second.cookie });

	assert.equal(again.status, 200);
	assert.deepEqual(again.body, { created: 0 });
	assert.equal(await rowCount(second.ownerId), 3, "y no duplica filas");

	// La escritura no toco los ajustes del otro dueno.
	const demoAfter = await call("GET", "/settings", { cookie: demo.cookie });

	assert.equal(demoAfter.status, 200);
	assert.deepEqual(demoAfter.body, demoBefore.body, "el demo conserva sus ajustes intactos");
});

test("PATCH /settings rechaza valores invalidos con los mensajes del origen", async () => {
	const cases: Array<{ body: unknown; path: string; message: string }> = [
		{ body: { pen_usd_rate: 0 }, path: "pen_usd_rate", message: RATE_ERROR },
		{ body: { pen_usd_rate: -1 }, path: "pen_usd_rate", message: RATE_ERROR },
		{ body: { cash_difference_tolerance: -0.01 }, path: "cash_difference_tolerance", message: TOLERANCE_ERROR },
		{ body: { default_closing_periodicity: "QUARTERLY" }, path: "default_closing_periodicity", message: "" },
	];

	for (const item of cases) {
		const result = await call("PATCH", "/settings", { cookie: second.cookie, body: item.body });

		assert.equal(result.status, 400, `${JSON.stringify(item.body)} deberia responder 400`);

		const issues = issuesByPath(result.body);

		assert.ok(item.path in issues, `el 400 nombra ${item.path}: ${JSON.stringify(issues)}`);

		if (item.message) {
			assert.equal(issues[item.path], item.message, "el mensaje es textual del origen");
		}
	}

	// Un body vacio o con una clave desconocida tampoco es un PATCH valido.
	for (const body of [{}, { owner_id: "11111111-1111-4111-8111-111111111111" }]) {
		const result = await call("PATCH", "/settings", { cookie: second.cookie, body });

		assert.equal(result.status, 400, `${JSON.stringify(body)} deberia responder 400`);
	}

	// Nada de lo rechazado se guardo.
	const afterRejected = await call("GET", "/settings", { cookie: second.cookie });

	assert.deepEqual(afterRejected.body, SEED_SETTINGS, "un PATCH rechazado no cambia los ajustes");
});

test("PATCH /settings guarda las tres claves del dueno y no toca al otro dueno", async () => {
	const demoBefore = await call("GET", "/settings", { cookie: demo.cookie });

	const updated = await call("PATCH", "/settings", {
		cookie: second.cookie,
		body: {
			default_closing_periodicity: "WEEKLY",
			pen_usd_rate: 3.85,
			cash_difference_tolerance: 0.5,
		},
	});

	assert.equal(updated.status, 200);
	assert.deepEqual(
		updated.body,
		{
			default_closing_periodicity: "WEEKLY",
			pen_usd_rate: "3.85",
			cash_difference_tolerance: "0.50",
		},
		"la respuesta es el mapa guardado, con los numeros normalizados como en el origen",
	);

	const reread = await call("GET", "/settings", { cookie: second.cookie });

	assert.deepEqual(reread.body, updated.body, "el PATCH persiste lo que devolvio");

	// La tolerancia quedo con dos decimales en la columna: es lo que castea `close_cash_account`.
	assert.equal(await storedValue(second.ownerId, "cash_difference_tolerance"), "0.50");

	// Un PATCH parcial no borra las otras claves.
	const partial = await call("PATCH", "/settings", {
		cookie: second.cookie,
		body: { cash_difference_tolerance: 1 },
	});

	assert.equal(partial.status, 200);
	assert.deepEqual(partial.body, {
		default_closing_periodicity: "WEEKLY",
		pen_usd_rate: "3.85",
		cash_difference_tolerance: "1.00",
	});

	// Y el otro dueno sigue con lo suyo.
	const demoAfter = await call("GET", "/settings", { cookie: demo.cookie });

	assert.deepEqual(demoAfter.body, demoBefore.body, "el PATCH del segundo dueno no llega al demo");
});

test("POST /settings/ensure no pisa un valor propio y crea solo lo que falta", async () => {
	// Se borra una semilla por SQL (como owner) para simular un dueno al que le falta una clave.
	await pool.query("delete from public.app_setting where owner_id = $1 and key = $2", [
		second.ownerId,
		"pen_usd_rate",
	]);

	const ensured = await call("POST", "/settings/ensure", { cookie: second.cookie });

	assert.equal(ensured.status, 200);
	assert.deepEqual(ensured.body, { created: 1 }, "solo crea la fila que faltaba");

	const settings = await call("GET", "/settings", { cookie: second.cookie });

	assert.deepEqual(
		settings.body,
		{
			default_closing_periodicity: "WEEKLY",
			pen_usd_rate: "3.75",
			cash_difference_tolerance: "1.00",
		},
		"la semilla que ya existia conserva el valor del dueno; la que faltaba vuelve al default",
	);
});

test("PATCH /settings funciona antes de sembrar (upsert) y ensure crea solo el resto", async () => {
	const empty = await call("GET", "/settings", { cookie: spare.cookie });

	assert.deepEqual(empty.body, {}, "el tercer dueno arranca sin filas");

	const patched = await call("PATCH", "/settings", {
		cookie: spare.cookie,
		body: { pen_usd_rate: 4.1 },
	});

	assert.equal(patched.status, 200);
	assert.deepEqual(patched.body, { pen_usd_rate: "4.1" }, "el upsert no necesita ensure previo");
	assert.equal(await rowCount(spare.ownerId), 1);

	const ensured = await call("POST", "/settings/ensure", { cookie: spare.cookie });

	assert.deepEqual(ensured.body, { created: 2 }, "solo faltaban las otras dos claves");

	const settings = await call("GET", "/settings", { cookie: spare.cookie });

	assert.deepEqual(settings.body, {
		default_closing_periodicity: "DAILY",
		pen_usd_rate: "4.1",
		cash_difference_tolerance: "0.50",
	});
});
