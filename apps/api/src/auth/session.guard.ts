// Guardia de sesion: el unico lugar donde un request de dominio se convierte en un dueno.
//
// Por que una guardia y no un chequeo en el handler: en Nest las guardias corren ANTES de los
// pipes. Con el chequeo en el cuerpo del handler, `GET /payments?direction=NOPE` sin sesion
// responderia 400 (validacion de Zod) antes que 401, y la validacion —que no toca la base—
// quedaria delante del control de identidad. Aca la sesion se resuelve primero y el request no
// llega ni al pipe ni al servicio.
//
// El `owner_id` que usan los servicios sale SIEMPRE de este objeto (`request.sessionUser`), que
// Better Auth resolvio desde la cookie. El cliente no puede elegirlo: no hay ningun parametro ni
// campo del body que llegue a `withOwner`.
import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import type { Auth } from "./auth";
import { AUTH } from "./auth.token";
import { type SessionUser, resolveSessionUser } from "./session";

/** Request de Nest con el usuario ya resuelto por la guardia. */
export interface SessionRequest extends Request {
	sessionUser?: SessionUser;
}

@Injectable()
export class SessionGuard implements CanActivate {
	constructor(@Inject(AUTH) private readonly auth: Auth) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<SessionRequest>();
		const user = await resolveSessionUser(this.auth, request.headers);

		if (!user) {
			throw new UnauthorizedException("Sesion requerida.");
		}

		request.sessionUser = user;

		return true;
	}
}

/**
 * Usuario de la sesion ya resuelto. Falla si la guardia no corrio, en vez de degradar a "sin
 * dueno": un controller protegido sin usuario es un error de cableado, no un caso valido.
 */
export function sessionUserOf(user: SessionUser | undefined): SessionUser {
	if (!user) {
		throw new UnauthorizedException("Sesion requerida.");
	}

	return user;
}
