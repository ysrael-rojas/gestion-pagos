// Montaje del handler fetch de Better Auth dentro de NestJS (S6).
//
// El core de Better Auth es `(Request) => Response`. `toNodeHandler` lo adapta al
// IncomingMessage/ServerResponse de Node, y esta ruta catch-all lo expone en `/api/auth/*`
// (`/api/auth/sign-in/email`, `/api/auth/get-session`, ...). Better Auth parsea su propio
// body, por eso `main.ts` desactiva el body parser de Nest para esta ruta y solo para ella.
import { All, Controller, Inject, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { toNodeHandler } from "better-auth/node";
import type { Auth } from "./auth";
import { AUTH, AUTH_BASE_PATH } from "./auth.token";

@Controller(AUTH_BASE_PATH)
export class AuthController {
	private readonly handler: ReturnType<typeof toNodeHandler>;

	constructor(@Inject(AUTH) auth: Auth) {
		this.handler = toNodeHandler(auth);
	}

	// Express 5 (path-to-regexp 8) exige nombrar el comodin: `*splat`, no `*`.
	@All("*splat")
	handle(@Req() request: Request, @Res() response: Response): Promise<void> {
		return this.handler(request, response);
	}
}
