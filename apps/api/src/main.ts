// Arranque del API (S6).
//
// El body parser de Nest se desactiva por completo (`bodyParser: false`) y se vuelve a
// montar como middleware expreso para todas las rutas MENOS `/api/auth/*`: Better Auth lee
// el cuerpo crudo del request, y si Nest ya lo consumio el handler recibe un stream vacio.
// El orden importa: estos middlewares se registran antes de `listen()`, que es cuando Nest
// monta el router, asi que quedan antes de las rutas.
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express, { type NextFunction, type Request, type Response } from "express";
import { AppModule } from "./app.module";
import { AUTH_BASE_PATH } from "./auth/auth.token";

function registerBodyParsers(app: NestExpressApplication): void {
	const server = app.getHttpAdapter().getInstance();
	const json = express.json({ limit: "1mb" });
	const urlencoded = express.urlencoded({ extended: true, limit: "1mb" });

	server.use((request: Request, response: Response, next: NextFunction) => {
		const isAuthRoute =
			request.path === AUTH_BASE_PATH || request.path.startsWith(`${AUTH_BASE_PATH}/`);

		if (isAuthRoute) {
			next();
			return;
		}

		json(request, response, (jsonError?: unknown) => {
			if (jsonError) {
				next(jsonError);
				return;
			}

			urlencoded(request, response, next);
		});
	});
}

async function bootstrap(): Promise<void> {
	const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

	registerBodyParsers(app);
	// Cierra el pool de pg cuando el proceso recibe SIGTERM/SIGINT.
	app.enableShutdownHooks();

	const port = Number(process.env.PORT ?? 3001);

	await app.listen(port);
	console.log(`[api] escuchando en http://localhost:${port}`);
}

void bootstrap();
