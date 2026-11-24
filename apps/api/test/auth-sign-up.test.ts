// L77: el alta publica del API esta cerrada.
//
// La regla que el repo documenta en `docs/operacion/crear-usuario.md` es "solo el dueno crea
// cuentas". Hasta ahora era solo de interfaz: `emailAndPassword` estaba habilitado sin
// `disableSignUp`, asi que `POST /api/auth/sign-up/email` daba de alta a cualquiera que alcanzara el
// puerto del API.
//
// Este test fija las dos mitades que importan: la funcion server-side que ejecuta el handler HTTP
// rechaza el alta, y **no queda ninguna fila** en `auth.users` — un rechazo que igual persiste un
// usuario a medias es peor que no tener test.
//
// No se golpea `/api/auth/*` por HTTP a proposito: el harness levanta la app con el handler montado,
// pero los POST de Better Auth exigen cabecera `Origin` contra `trustedOrigins`, y un 403 por origen
// haria pasar este test por el motivo equivocado. `auth.api.signUpEmail` es exactamente lo que el
// handler HTTP ejecuta.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { ApiHarness } from "./support/harness.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

/** Contrasena valida (>= 8) para que el rechazo no pueda atribuirse a la validacion de clave. */
const PASSWORD = "alta-cerrada-passw0rd";

let api: ApiHarness;

before(async () => {
	const harness = await loadApiHarness();
	api = await harness.startApi();
});

after(async () => {
	await api.close();
	removeApiHarnessBundle();
});

test("el API rechaza el alta publica y no deja usuario creado", async () => {
	const email = `alta-cerrada-${randomUUID()}@example.test`;

	await assert.rejects(
		() => api.auth.api.signUpEmail({ body: { email, password: PASSWORD, name: "Alta cerrada" } }),
		(error: unknown) => {
			// El motivo tiene que ser el alta deshabilitada, no otra cosa (email invalido, clave corta,
			// base caida). El codigo es el contrato de Better Auth para esta bandera.
			const body = (error as { body?: { code?: string; message?: string } }).body;

			assert.equal(body?.code, "EMAIL_PASSWORD_SIGN_UP_DISABLED");
			assert.equal(body?.message, "Email and password sign up is not enabled");

			return true;
		}
	);

	const created = await api.pool.query<{ count: number }>(
		"select count(*)::int as count from auth.users where lower(email) = lower($1)",
		[email]
	);

	assert.equal(created.rows[0]?.count, 0, "un alta rechazada no puede dejar filas en auth.users");
});
