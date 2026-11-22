// Arranque real de la app Nest para los tests e2e.
//
// Este archivo NO se ejecuta con `node --experimental-transform-types`: los decoradores de
// Nest no son sintaxis que el transformador de tipos de Node soporte (probado: `SyntaxError`
// en `@Injectable()`). Por eso `harness-loader.ts` lo compila con esbuild a
// `apps/api/dist/test-harness.cjs` y el test lo requiere desde ahi.
//
// Diferencias con `src/main.ts`, y por que:
//   - El body parser de Nest queda ACTIVO (Nest por defecto) porque los tests hablan JSON con
//     las rutas de dominio. `/api/auth/*` no se ejercita por HTTP: la sesion se acuna llamando
//     a la API server-side de Better Auth (`auth.api.signInEmail`), que es el mismo camino que
//     usa el handler HTTP.
//   - `listen(0)`: puerto efimero, para no chocar con un API ya levantado en 3001.
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Pool } from "pg";
import { AppModule } from "../../src/app.module";
import type { Auth } from "../../src/auth/auth";
import { AUTH } from "../../src/auth/auth.token";
import { DATABASE, PG_POOL, type Database } from "../../src/db/db.provider";

export interface ApiHarness {
	/** Origen HTTP (`http://127.0.0.1:<puerto>`) del API levantado. */
	url: string;
	auth: Auth;
	db: Database;
	pool: Pool;
	close(): Promise<void>;
}

/** Reexportados para poder probar la guardia real sin importar sus decoradores en Node. */
export { SessionGuard, sessionUserOf } from "../../src/auth/session.guard";

export async function startApi(): Promise<ApiHarness> {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });

	await app.listen(0);

	const address = app.getHttpServer().address();

	if (typeof address !== "object" || address === null) {
		await app.close();
		throw new Error("El servidor de prueba no expuso un puerto TCP.");
	}

	return {
		url: `http://127.0.0.1:${address.port}`,
		auth: app.get(AUTH) as Auth,
		db: app.get(DATABASE) as Database,
		pool: app.get(PG_POOL) as Pool,
		close: () => app.close(),
	};
}
