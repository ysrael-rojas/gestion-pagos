// L77, la mitad que ve el mundo: el handler HTTP montado en `/api/auth/*`.
//
// `auth-sign-up.test.ts` prueba la funcion server-side. Este archivo prueba lo que responde el
// servidor Nest de verdad, con `Origin` incluido (Better Auth rechaza los POST sin el), porque un
// cambio de montaje —un prefijo distinto, el handler desactivado— dejaria la funcion cerrada y el
// endpoint abierto, o al reves.
//
// La segunda prueba es la contracara: el camino que SI queda abierto (entrar) tiene que funcionar
// para el usuario que se crea por SQL, que desde este cambio es el unico procedimiento de alta.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { hashPassword } from "better-auth/crypto";
import type { ApiHarness } from "./support/harness.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/**
 * `Origin` que Better Auth compara contra su `baseURL`: sale del mismo entorno que lee el API, no
 * del puerto efimero del harness. Los dos tienen que coincidir o el POST se rechaza por origen y el
 * test pasaria por el motivo equivocado.
 */
const ORIGIN = (process.env.BETTER_AUTH_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");

let api: ApiHarness;

before(async () => {
	const harness = await loadApiHarness();
	api = await harness.startApi();
});

after(async () => {
	await api.close();
	removeApiHarnessBundle();
});

async function countUsers(email: string): Promise<number> {
	const result = await api.pool.query<{ count: number }>(
		"select count(*)::int as count from auth.users where lower(email) = lower($1)",
		[email]
	);

	return result.rows[0]?.count ?? -1;
}

test("POST /api/auth/sign-up/email responde 400 y no crea usuario", async () => {
	const email = `alta-http-${randomUUID()}@example.test`;
	const response = await fetch(`${api.url}/api/auth/sign-up/email`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: ORIGIN },
		body: JSON.stringify({ name: "Alta cerrada", email, password: "alta-http-passw0rd" }),
	});
	const body = (await response.json()) as { code?: string; message?: string };

	assert.equal(response.status, 400);
	assert.equal(body.code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
	assert.equal(body.message, "Email and password sign up is not enabled");
	assert.equal(await countUsers(email), 0, "el rechazo no puede dejar una fila en auth.users");
});

test("el usuario creado por SQL entra por POST /api/auth/sign-in/email", async () => {
	const email = `alta-sql-${randomUUID()}@example.test`;
	const password = "alta-sql-passw0rd";
	const ownerId = randomUUID();

	await api.pool.query(
		"insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, true)",
		[ownerId, "Alta SQL", email]
	);
	await api.pool.query(
		`insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
		 values ($1, $2, 'credential', $3, $4, now(), now())`,
		[randomUUID(), ownerId, ownerId, await hashPassword(password)]
	);

	try {
		const response = await fetch(`${api.url}/api/auth/sign-in/email`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: ORIGIN },
			body: JSON.stringify({ email, password }),
		});
		const body = (await response.json()) as { user?: { id?: string } };

		assert.equal(response.status, 200);
		assert.equal(body.user?.id, ownerId);
	} finally {
		// Cascada: se lleva la credencial y la sesion que emitio el login.
		await api.pool.query("delete from auth.users where id = $1", [ownerId]);
	}
});
