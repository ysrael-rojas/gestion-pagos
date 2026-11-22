// Tests de la parte pura del cliente HTTP: el armado de query strings y la traduccion de un
// error del API al mensaje que ve el usuario.
//
// Por que existen: la regla de la tarea es que "un mensaje de error del API llega al usuario tal
// cual" (el API devuelve mensajes de dominio como "La cuenta de caja no existe"). Si el cliente
// los reemplazara por un texto generico, la UI mentiria sobre la causa. Estas dos funciones son
// las unicas que pueden romper esa regla sin que se note, asi que se prueban solas.
import assert from "node:assert/strict";
import { test } from "node:test";

import { apiErrorMessage, buildQuery } from "./client.ts";

test("buildQuery arma la query string y omite lo que no se mando", () => {
	assert.equal(buildQuery({}), "");
	assert.equal(buildQuery({ direction: "INGRESO" }), "?direction=INGRESO");
	assert.equal(
		buildQuery({ direction: "INGRESO", desde: "2026-01-01", estado: "TODOS" }),
		"?direction=INGRESO&desde=2026-01-01&estado=TODOS",
	);
	// `undefined` y `null` significan "no filtrar", no "filtrar por la cadena vacia".
	assert.equal(buildQuery({ direction: undefined, desde: null }), "");
	// Un 0 explicito si viaja: `page=0` es un valor del cliente aunque el API lo rechace.
	assert.equal(buildQuery({ page: 0 }), "?page=0");
	// El orden de las claves es el de insercion, para que la URL sea predecible en los tests.
	assert.equal(buildQuery({ b: "2", a: "1" }), "?b=2&a=1");
});

test("apiErrorMessage devuelve el mensaje de dominio del API sin envolverlo", () => {
	// Forma real de Nest: { statusCode, message, error }.
	assert.equal(
		apiErrorMessage(
			403,
			JSON.stringify({
				statusCode: 403,
				message: "La cuenta de caja no existe",
				error: "Forbidden",
			}),
		),
		"La cuenta de caja no existe",
	);

	// 401 del SessionGuard tambien es un mensaje de dominio ("Sesion requerida.").
	assert.equal(
		apiErrorMessage(401, JSON.stringify({ statusCode: 401, message: "Sesion requerida." })),
		"Sesion requerida.",
	);

	// Un error de validacion de zod-pipe trae varios mensajes: se muestran todos, no el primero.
	assert.equal(
		apiErrorMessage(
			400,
			JSON.stringify({
				statusCode: 400,
				message: ["El identificador debe ser un uuid.", "Usa el formato YYYY-MM-DD."],
			}),
		),
		"El identificador debe ser un uuid. Usa el formato YYYY-MM-DD.",
	);
});

test("apiErrorMessage no inventa texto cuando el cuerpo no es el JSON esperado", () => {
	// Un proxy o un balanceador puede devolver HTML: se conserva el cuerpo tal cual, recortado,
	// en vez de decir "error desconocido" y perder la unica pista disponible.
	assert.equal(apiErrorMessage(502, "<html>Bad Gateway</html>"), "<html>Bad Gateway</html>");

	// Cuerpo vacio: hay que decir algo, y el status es el dato util.
	assert.equal(apiErrorMessage(500, ""), "El API respondió 500.");
	assert.equal(apiErrorMessage(0, ""), "No se pudo conectar con el API.");

	// JSON sin `message`: tampoco se inventa un texto de dominio.
	assert.equal(apiErrorMessage(500, JSON.stringify({ statusCode: 500 })), "El API respondió 500.");
});
