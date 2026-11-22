// Prueba de comportamiento del puente entre las cabeceras `Set-Cookie` que emite Better Auth
// (`apps/api`) y el cookie jar de Next (`next/headers`).
//
// Por que existe esta pieza: el navegador nunca habla con `apps/api` (no hay CORS en el API y
// S8 dice que la web consume el API por HTTP, no desde el browser). El inicio de sesion es una
// Server Action: el servidor de Next llama a Better Auth server-to-server y recibe la sesion
// como `Set-Cookie` crudo. `cookies().set()` necesita la cookie ya desglosada, y perder un
// atributo no es cosmetico: sin `Max-Age=0` el cierre de sesion no borra nada, y sin `Path=/`
// la cookie no viaja en las rutas siguientes.
//
// Se afirma sobre el valor exacto que devuelve el API y sobre los tres casos que rompen una
// implementacion ingenua: `=` dentro del valor (base64), `,` dentro de `Expires` (un split por
// coma corta la fecha) y `Max-Age=0` (borrado).
import assert from "node:assert/strict";
import test from "node:test";

import { parseSetCookie, readSetCookies, toNextCookieValue } from "./cookies.ts";

/** Cabecera real observada en `POST /api/auth/sign-in/email` de apps/api (valor recortado). */
const SIGN_IN =
  "better-auth.session_token=Uu2Jj9p0aQ.9fC%2B3%2F6Xy%3D; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax";

test("desglosa la cookie de sesion tal como la emite el API", () => {
  assert.deepEqual(parseSetCookie(SIGN_IN), {
    name: "better-auth.session_token",
    value: "Uu2Jj9p0aQ.9fC%2B3%2F6Xy%3D",
    options: {
      maxAge: 604800,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
    },
  });
});

test("conserva un valor con '=' y sangrado base64: solo el primer '=' separa nombre y valor", () => {
  const parsed = parseSetCookie("__Secure-x=YWJj==; Path=/; Secure");

  assert.equal(parsed.name, "__Secure-x");
  assert.equal(parsed.value, "YWJj==");
  assert.deepEqual(parsed.options, { path: "/", secure: true });
});

test("no corta Expires en la coma del formato HTTP-date", () => {
  const parsed = parseSetCookie("s=1; Expires=Wed, 21 Oct 2015 07:28:00 GMT; Path=/");

  assert.deepEqual(parsed.options.expires, new Date("Wed, 21 Oct 2015 07:28:00 GMT"));
  assert.equal(parsed.options.path, "/");
});

test("una cookie de borrado (Max-Age=0) se lee como borrado", () => {
  const parsed = parseSetCookie("better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax");

  assert.equal(parsed.value, "");
  assert.equal(parsed.options.maxAge, 0);
  assert.equal(parsed.options.httpOnly, true);
});

test("acepta atributos en cualquier capitalizacion y normaliza SameSite", () => {
  const parsed = parseSetCookie("s=1; path=/app; HTTPONLY; SameSite=Strict; domain=localhost");

  assert.deepEqual(parsed.options, {
    path: "/app",
    httpOnly: true,
    sameSite: "strict",
    domain: "localhost",
  });
});

test("no inventa atributos ausentes", () => {
  assert.deepEqual(parseSetCookie("solo=valor").options, {});
});

test("lee todas las cabeceras Set-Cookie en orden y ninguna cuando no hay", () => {
  const headers = new Headers();
  headers.append("set-cookie", "a=1; Path=/; HttpOnly");
  headers.append("set-cookie", "b=2; Path=/; SameSite=Lax");

  assert.deepEqual(
    readSetCookies(headers).map((cookie) => [cookie.name, cookie.value]),
    [
      ["a", "1"],
      ["b", "2"],
    ],
  );
  assert.deepEqual(readSetCookies(new Headers()), []);
});

test("el valor que se guarda en el jar de Next deshace la codificacion de la cabecera", () => {
  // `cookies().set()` serializa el valor con `encodeURIComponent`. Better Auth ya lo emite
  // codificado, asi que guardarlo tal cual lo dejaria doblemente codificado y el API lo
  // rechazaria (la firma cambia y `get-session` responde null).
  const header = "Uu2Jj9p0aQ.9fC%2B3%2F6Xy%3D";
  const stored = toNextCookieValue(header);

  assert.equal(stored, "Uu2Jj9p0aQ.9fC+3/6Xy=");
  // La ida y vuelta prueba que el navegador recibe exactamente lo que emitio el API.
  assert.equal(encodeURIComponent(stored), header);
});

test("no toca un valor sin escapes y tolera un '%' que no es un escape", () => {
  assert.equal(toNextCookieValue("abc123"), "abc123");
  assert.equal(toNextCookieValue("100%"), "100%");
});
