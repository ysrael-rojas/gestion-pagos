import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

function leerCredencialesPublicas(): { url: string; clavePublicable: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clavePublicable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !clavePublicable) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copia .env.template a .env y completa ambas variables.",
    );
  }

  return { url, clavePublicable };
}

/**
 * Refresca la sesión en cada request y aplica el chequeo optimista de acceso.
 *
 * No consulta la base de datos: solo valida el JWT con `getClaims()`. La
 * comprobación real (perfil y `active`) vive en la DAL, junto al dato.
 *
 * Por eso aquí **no** se redirige `/login` a `/`: un JWT vigente no implica un
 * Usuario utilizable (`active = false` o sin perfil). La redirección del login
 * la decide la propia página con la DAL, que sí conoce el perfil. Si el proxy
 * redirigiera `/login` a `/` con solo el JWT, la DAL devolvería `/` a `/login`
 * y se entraría en un bucle de redirecciones.
 */
export async function updateSession(request: NextRequest) {
  const { url, clavePublicable } = leerCredencialesPublicas();

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(url, clavePublicable, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesAEscribir, headers) {
        cookiesAEscribir.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        supabaseResponse = NextResponse.next({ request });

        cookiesAEscribir.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([clave, valor]) => {
          supabaseResponse.headers.set(clave, valor);
        });
      },
    },
  });

  // No debe haber código entre crear el cliente y validar la sesión: si el
  // refresco de token termina después de la respuesta, las cookies se pierden.
  const { data } = await supabase.auth.getClaims();

  const hayUsuario = Boolean(data?.claims);
  const esLogin = request.nextUrl.pathname === "/login";

  if (!hayUsuario && !esLogin) {
    return redirigirA(request, "/login", supabaseResponse);
  }

  return supabaseResponse;
}

/** Conserva las cookies refrescadas al redirigir. */
function redirigirA(
  request: NextRequest,
  ruta: string,
  respuesta: NextResponse,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = ruta;

  const redireccion = NextResponse.redirect(url);

  respuesta.cookies.getAll().forEach((cookie) => {
    redireccion.cookies.set(cookie);
  });

  return redireccion;
}
