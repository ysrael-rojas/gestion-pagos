// Puente entre las cabeceras `Set-Cookie` de Better Auth y el cookie jar de Next.
//
// El navegador nunca habla con `apps/api`: el inicio de sesion es una Server Action, el servidor
// de Next llama a Better Auth server-to-server y recibe la sesion como `Set-Cookie` crudo.
// `cookies().set()` necesita la cookie desglosada, y perder un atributo no es cosmetico: sin
// `Max-Age=0` el cierre de sesion no borra nada, y sin `Path=/` la cookie no viaja en las rutas
// siguientes.
//
// Se parsea a mano en vez de usar un paquete porque la forma es un subconjunto fijo del RFC 6265
// que Better Auth emite (`name=value` + `Max-Age`/`Expires`/`Path`/`Domain`/`HttpOnly`/`Secure`/
// `SameSite`), y porque asi el comportamiento queda cubierto por un test puro.
//
// Atributos que se ignoran a proposito: `Priority` y `Partitioned`. Next no los modela en
// `cookies().set()`, y ninguna de las dos afecta a que la cookie viaje en las rutas de esta app.

/** Opciones equivalentes a `ResponseCookie` de Next, ya normalizadas. */
export interface CookieOptions {
  path?: string;
  domain?: string;
  maxAge?: number;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "lax" | "strict" | "none";
}

export interface ParsedSetCookie {
  name: string;
  value: string;
  options: CookieOptions;
}

const SAME_SITE_VALUES = new Set(["lax", "strict", "none"]);

/**
 * Desglosa una cabecera `Set-Cookie`.
 *
 * Solo el primer `=` separa el nombre del valor: los valores de Better Auth llevan `%2B`/`%2F`
 * y los base64 pueden terminar en `==`. Los atributos se separan por `;`, nunca por `,`, porque
 * `Expires` trae una coma (`Wed, 21 Oct 2015 07:28:00 GMT`).
 */
export function parseSetCookie(raw: string): ParsedSetCookie {
  const [pair = "", ...attributes] = raw.split(";");
  const separator = pair.indexOf("=");

  const name = (separator === -1 ? pair : pair.slice(0, separator)).trim();
  const value = separator === -1 ? "" : pair.slice(separator + 1).trim();

  const options: CookieOptions = {};

  for (const attribute of attributes) {
    const index = attribute.indexOf("=");
    const key = (index === -1 ? attribute : attribute.slice(0, index)).trim().toLowerCase();
    const rawValue = index === -1 ? "" : attribute.slice(index + 1).trim();

    switch (key) {
      case "path":
        options.path = rawValue;
        break;
      case "domain":
        options.domain = rawValue;
        break;
      case "max-age": {
        const seconds = Number.parseInt(rawValue, 10);
        // `Max-Age=0` es un borrado valido: solo se descarta lo que no es un numero.
        if (Number.isFinite(seconds)) options.maxAge = seconds;
        break;
      }
      case "expires": {
        const expires = new Date(rawValue);
        if (!Number.isNaN(expires.getTime())) options.expires = expires;
        break;
      }
      case "httponly":
        options.httpOnly = true;
        break;
      case "secure":
        options.secure = true;
        break;
      case "samesite": {
        const sameSite = rawValue.toLowerCase();
        if (SAME_SITE_VALUES.has(sameSite)) {
          options.sameSite = sameSite as CookieOptions["sameSite"];
        }
        break;
      }
      default:
        break;
    }
  }

  return { name, value, options };
}

/**
 * Todas las `Set-Cookie` de una respuesta, en orden.
 *
 * `Headers.getSetCookie()` es la unica forma de no perder cookies cuando hay varias (un
 * `headers.get("set-cookie")` las devuelve concatenadas). Existe en Node >= 20, que es el
 * runtime de `apps/api` y el de las Server Actions.
 */
export function readSetCookies(headers: Headers): ParsedSetCookie[] {
  return headers.getSetCookie().map(parseSetCookie);
}

/**
 * Valor listo para `cookies().set()`.
 *
 * `next/headers` serializa el valor con `encodeURIComponent`, y Better Auth emite la cookie ya
 * codificada. Guardarla tal cual la deja doblemente codificada: medido en esta tarea, la cookie
 * pasaba de 83 a 89 caracteres, la firma dejaba de coincidir y `GET /api/auth/get-session`
 * respondia `null` con una sesion valida. Decodificar una vez deja el valor en la forma cuya
 * re-codificacion devuelve exactamente el original.
 *
 * Un `%` que no abre un escape valido (`100%`) no se puede decodificar: se guarda tal cual.
 */
export function toNextCookieValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
