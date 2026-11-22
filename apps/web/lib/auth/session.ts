// Sesion de Better Auth del lado del servidor de Next: el unico lugar de `apps/web` que
// responde "quien esta pidiendo esto".
//
// S8: la web no toca la base ni firma tokens; le pregunta al handler de `apps/api` y reenvia la
// cookie `HttpOnly` que el navegador ya tiene. Hay tres operaciones y ninguna otra:
//
//   getSessionUser()        -> layout protegido y paginas (Server Components).
//   signInWithEmail(...)    -> Server Action de /login.
//   signOutSession()        -> Server Action del boton de cerrar sesion.
//
// La cookie es `HttpOnly`: el JavaScript del navegador nunca la ve, y no hace falta que la vea
// porque todas las llamadas al API salen del servidor.
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { authClient } from "./client";
import { type ParsedSetCookie, readSetCookies, toNextCookieValue } from "./cookies";

/** Usuario de la sesion, reducido a lo que la UI muestra. */
export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Marca las cookies que emite Better Auth. Se usa como red de seguridad al cerrar sesion: si el
 * API no devuelve la cookie de borrado, igual se limpia lo que este servidor tenga en el jar.
 */
const AUTH_COOKIE_HINT = "better-auth";

const TRANSPORT_FALLBACK = "No se pudo completar la operacion. Intenta nuevamente.";

/**
 * Sesion del request actual, o `null` si no hay.
 *
 * `cache` la deduplica dentro del mismo render: el layout y la pagina piden la sesion y al API
 * le llega una sola peticion.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const cookie = (await cookies()).toString();

  if (!cookie) return null;

  const result = await authClient.getSession({
    fetchOptions: { headers: { cookie }, cache: "no-store" },
  });

  const user = result.data?.user;

  if (!user) return null;

  return { id: user.id, email: user.email, name: user.name ?? "" };
});

/**
 * Inicia sesion con correo y contrasena (`emailAndPassword` esta habilitado en apps/api) y deja
 * la cookie de sesion en la respuesta de Next.
 *
 * Devuelve el mensaje del API tal cual cuando falla: la pantalla de login lo muestra en vez de
 * un texto generico, asi que un 403 por origen no confiable o un 401 por credenciales se leen
 * distintos.
 */
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<{ error: string | null }> {
  const origin = (await headers()).get("origin");
  let issued: ParsedSetCookie[] = [];

  try {
    const result = await authClient.signIn.email(
      { email, password },
      {
        // El chequeo de origen de Better Auth corre en apps/api: se le pasa el origen real del
        // navegador, no uno inventado.
        headers: origin ? { origin } : {},
        onSuccess: (context) => {
          issued = readSetCookies(context.response.headers);
        },
      },
    );

    if (result.error) {
      return { error: result.error.message ?? TRANSPORT_FALLBACK };
    }
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : TRANSPORT_FALLBACK,
    };
  }

  await writeCookies(issued);

  return { error: null };
}

/** Cierra la sesion contra el API y borra la cookie del navegador. */
export async function signOutSession(): Promise<void> {
  const jar = await cookies();
  const cookie = jar.toString();
  const origin = (await headers()).get("origin");
  let cleared: ParsedSetCookie[] = [];

  try {
    // `signOut` no tiene body: sus opciones van anidadas en `fetchOptions` (a diferencia de
    // `signIn.email`, que las recibe como segundo argumento).
    await authClient.signOut({
      fetchOptions: {
        headers: { cookie, ...(origin ? { origin } : {}) },
        onSuccess: (context) => {
          cleared = readSetCookies(context.response.headers);
        },
      },
    });
  } catch {
    // El API caido no puede impedir el cierre de sesion local: se limpia igual mas abajo.
  }

  await writeCookies(cleared);

  // Red de seguridad: si el API no devolvio el borrado, la cookie local se borra igual. Sin
  // esto, un fallo de red dejaria al usuario "sin sesion" en el API pero con la cookie en el
  // navegador, y el siguiente request volveria a entrar.
  for (const held of jar.getAll()) {
    if (held.name.includes(AUTH_COOKIE_HINT)) jar.delete(held.name);
  }
}

/** Aplica al request saliente de Next las cookies que emitio el API. */
async function writeCookies(parsed: ParsedSetCookie[]): Promise<void> {
  if (parsed.length === 0) return;

  const jar = await cookies();

  for (const cookie of parsed) {
    if (!cookie.name) continue;

    // `toNextCookieValue`: Next vuelve a codificar el valor al serializar la cookie (ver
    // lib/auth/cookies.ts); sin esto la sesion llega al navegador con doble codificacion y el
    // API la rechaza.
    jar.set({ name: cookie.name, value: toNextCookieValue(cookie.value), ...cookie.options });
  }
}
