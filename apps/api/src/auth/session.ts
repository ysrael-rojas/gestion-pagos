import type { IncomingHttpHeaders } from "node:http";
import { fromNodeHeaders } from "better-auth/node";
import type { Auth } from "./auth";

export interface SessionUser {
	/** `auth.users.id`; es el valor que va al GUC `app.user_id`. */
	id: string;
	email: string;
}

/**
 * Resuelve el usuario del request a traves de la API server-side de Better Auth.
 *
 * Devuelve `null` cuando no hay sesion valida; el llamador decide (hoy: 401). Es el unico
 * lugar donde apps/api obtiene "quien esta pidiendo esto", para que no haya dos fuentes de
 * identidad en el codigo.
 */
export async function resolveSessionUser(
	auth: Auth,
	headers: IncomingHttpHeaders,
): Promise<SessionUser | null> {
	const session = await auth.api.getSession({ headers: fromNodeHeaders(headers) });

	if (!session) return null;

	return { id: session.user.id, email: session.user.email };
}
