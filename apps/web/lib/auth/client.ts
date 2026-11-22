// Cliente de Better Auth de apps/web (S1: `better-auth/react`).
//
// Apunta al handler que `apps/api` monta en `/api/auth/*` (S6, `toNodeHandler`), con la misma
// base que el resto del cliente HTTP (`lib/api/client.ts`): `NEXT_PUBLIC_API_URL` para el
// bundle del navegador, `API_URL` para el servidor, y `http://localhost:3001` como default.
//
// Donde se usa, y por que no en el navegador: `apps/api` no habilita CORS, asi que un fetch
// desde el navegador a otro origen no puede ni leer la respuesta ni llevar credenciales. Las
// llamadas de auth salen del servidor de Next (Server Actions y Server Components), donde el
// origen no aplica, y la sesion viaja como cookie `HttpOnly` que el propio Next reenvia
// (`next/headers`). Por eso este modulo lo importan solo modulos de servidor.
//
// Requisito de despliegue en apps/api: su chequeo de origen de Better Auth (`origin-check`)
// rechaza con `403 INVALID_ORIGIN` cualquier POST cuyo `Origin` no este en los origenes
// confiables. Better Auth ya lee `BETTER_AUTH_TRUSTED_ORIGINS` (lista separada por comas) sin
// necesidad de tocar su configuracion, asi que el API tiene que arrancar con el origen de esta
// app, p. ej. `BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:3000`. Sin esa variable el login
// falla con "Invalid origin" y el mensaje se muestra tal cual en la pantalla.
import { createAuthClient } from "better-auth/react";
import { API_BASE_URL } from "@/lib/api/client";

/** Mismo path que `AUTH_BASE_PATH` en `apps/api/src/auth/auth.token.ts`. */
export const AUTH_BASE_PATH = "/api/auth";

/** Base absoluta del handler de Better Auth. */
export const AUTH_BASE_URL = `${API_BASE_URL}${AUTH_BASE_PATH}`;

export const authClient = createAuthClient({ baseURL: AUTH_BASE_URL });
