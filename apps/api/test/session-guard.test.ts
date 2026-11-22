// Prueba de la guardia de sesion: 401 antes de validar y antes de tocar la base.
//
// Por que una guardia y no un chequeo dentro de cada handler: en Nest los pipes (la validacion
// de Zod) corren DESPUES de las guardias. Un chequeo de sesion en el cuerpo del handler dejaria
// que `GET /payments?direction=NOPE` sin sesion respondiera 400 en vez de 401, y ese 400 lo
// produce el pipeline, no el dominio. La guardia es el unico lugar donde la sesion se resuelve.
//
// El test carga el bundle del harness (esbuild) porque la guardia usa decoradores de Nest y el
// transformador de tipos de Node no los soporta; la clase probada es exactamente la que corre en
// el API, no una copia.
//
// Afirma las dos mitades: sin sesion lanza UnauthorizedException consultando solo
// `auth.api.getSession`; con sesion adjunta el usuario al request (de donde los servicios toman
// el `owner_id`, nunca del cliente).
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ExecutionContext } from "@nestjs/common";
import type { HarnessModule } from "./support/harness-loader.ts";
import { loadApiHarness, removeApiHarnessBundle } from "./support/harness-loader.ts";

let module: HarnessModule;

before(async () => {
	module = await loadApiHarness();
});

after(() => {
	removeApiHarnessBundle();
});

interface Call {
	method: string;
}

function createContext(headers: Record<string, string> = {}) {
	const request = { headers, sessionUser: undefined as unknown };
	const context = {
		switchToHttp: () => ({ getRequest: () => request }),
	} as unknown as ExecutionContext;

	return { context, request };
}

function createAuthStub(user: { id: string; email: string } | null) {
	const calls: Call[] = [];
	const auth = {
		api: {
			getSession: async (input: unknown) => {
				calls.push({ method: "getSession" });
				assert.ok(input, "getSession necesita las cabeceras del request");
				return user ? { session: {}, user } : null;
			},
		},
	};

	return { auth, calls };
}

test("sin sesion la guardia responde 401 y no deja pasar el request", async () => {
	const { auth, calls } = createAuthStub(null);
	const { context, request } = createContext();
	const guard = new module.SessionGuard(auth as never);

	await assert.rejects(guard.canActivate(context), (error: unknown) => {
		assert.equal((error as { status?: number }).status, 401);
		assert.equal((error as { message?: string }).message, "Sesion requerida.");
		return true;
	});

	assert.deepEqual(calls, [{ method: "getSession" }], "no se consulta nada mas que la sesion");
	assert.equal(request.sessionUser, undefined, "no se adjunta usuario sin sesion");
});

test("con sesion la guardia adjunta el usuario del request y devuelve true", async () => {
	const user = { id: "7f9e00ea-c5a0-4ddb-b72c-4f6ad912f782", email: "demo@example.test" };
	const { auth } = createAuthStub(user);
	const { context, request } = createContext({ cookie: "better-auth.session_token=x.y" });
	const guard = new module.SessionGuard(auth as never);

	assert.equal(await guard.canActivate(context), true);
	assert.deepEqual(request.sessionUser, user);
	assert.deepEqual(module.sessionUserOf(request.sessionUser as never), user);
});

test("sessionUserOf falla si la guardia no corrio", () => {
	assert.throws(() => module.sessionUserOf(undefined), (error: unknown) => {
		assert.equal((error as { status?: number }).status, 401);
		return true;
	});
});
