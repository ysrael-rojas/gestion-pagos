// Traduccion de errores del modulo de notas (S10 del port del vertical notas, T3).
//
// Por que una prueba unitaria ademas del e2e: dos ramas del mapa no se alcanzan desde HTTP sin
// romper el esquema. `XX000` solo aparece cuando la base falla de verdad, `42501` de un grant es
// un estado de infraestructura y no una accion del usuario, y `23505` exige una fila escrita por
// fuera de la RPC con el correlativo adelantado (el e2e no puede producirla por su propia ruta).
// El contrato (status + texto verbatim) de S10 se fija aca.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import {
	CREDIT_CEILING_EXCEEDED,
	DUPLICATE_NOTE,
	GENERIC_DATABASE_FAILURE,
	INVALID_NOTE_DATA,
	NOT_A_BASE_SALE_VOUCHER,
	REFERENCED_VOUCHER_NOT_FOUND,
	REFERENCED_VOUCHER_OTHER_OWNER,
	toNoteHttpException,
} from "../src/notes/notes.errors.ts";

/** Textual del trigger `comprobante_owner_consistency` (`20261028194204`), que la RPC re-lanza. */
const TRIGGER_OTHER_OWNER =
	"El comprobante referencia una entidad o comprobante de otro usuario";

/** Error de PostgreSQL como lo ve el mapeador: `code` y `message` en el nivel superior. */
function pgError(code: string, message = ""): Error {
	return Object.assign(new Error(message), { code });
}

/** El `body` que Nest arma para una excepcion lanzada con un texto. */
function bodyOf(exception: HttpException): { message: string } {
	return exception.getResponse() as { message: string };
}

test("los seis mensajes de S10 se mapean a su status sin reescribir el texto", () => {
	const cases: Array<{ error: unknown; status: number; message: string }> = [
		// P0001: excepcion de dominio de `crear_nota`, con el texto ya redactado para el usuario.
		{ error: pgError("P0001", REFERENCED_VOUCHER_NOT_FOUND), status: 404, message: REFERENCED_VOUCHER_NOT_FOUND },
		{ error: pgError("P0001", NOT_A_BASE_SALE_VOUCHER), status: 400, message: NOT_A_BASE_SALE_VOUCHER },
		{ error: pgError("P0001", CREDIT_CEILING_EXCEEDED), status: 409, message: CREDIT_CEILING_EXCEEDED },
		// Familias de SQLSTATE que la RPC re-lanza conservando el codigo.
		{ error: pgError("23505", "duplicate key value"), status: 409, message: DUPLICATE_NOTE },
		{ error: pgError("23514", "new row violates check"), status: 400, message: INVALID_NOTE_DATA },
		{ error: pgError("23502", "null value in column"), status: 400, message: INVALID_NOTE_DATA },
		// El referenciado desaparecio entre el lock y el INSERT (carrera con una baja).
		{ error: pgError("23503", "fk violation"), status: 404, message: REFERENCED_VOUCHER_NOT_FOUND },
		// El contrato del body no exige uuid en el id referenciado: un id con otra forma muere en el
		// cast `::uuid` de la RPC y es un dato invalido de la nota, no una falla de la base.
		{ error: pgError("22P02", 'invalid input syntax for type uuid: "x"'), status: 400, message: INVALID_NOTE_DATA },
		// `XX000` es el generico de la RPC; cualquier otro codigo desconocido cae en el mismo 500.
		{ error: pgError("XX000", GENERIC_DATABASE_FAILURE), status: 500, message: GENERIC_DATABASE_FAILURE },
		{ error: pgError("40001", "serialization failure"), status: 500, message: GENERIC_DATABASE_FAILURE },
	];

	for (const testCase of cases) {
		const exception = toNoteHttpException(testCase.error);

		assert.equal(
			exception.getStatus(),
			testCase.status,
			`status de ${JSON.stringify(testCase.error)}`,
		);
		assert.equal(bodyOf(exception).message, testCase.message);
	}
});

test("42501 del trigger de consistencia de dueño viaja como el 404 de S10", () => {
	// `comprobante_owner_consistency` levanta su propio texto con 42501. Ese texto nombra la regla
	// de la base y no es el contrato del API: el cliente ve el mensaje de S10. Sin este mapeo el
	// usuario recibiria un 403 con el texto del trigger, que es lo que el e2e del vertical de
	// ventas no cubre porque su RPC no tiene la rama de herencia.
	const exception = toNoteHttpException(pgError("42501", TRIGGER_OTHER_OWNER));

	assert.equal(exception.getStatus(), 404);
	assert.equal(bodyOf(exception).message, REFERENCED_VOUCHER_OTHER_OWNER);
	assert.equal(
		REFERENCED_VOUCHER_OTHER_OWNER,
		"El comprobante referenciado es de otro usuario.",
	);
});

test("42501 de un privilegio o de la RLS no se le muestra al usuario", () => {
	// `permission denied for function crear_nota` nombra objetos de la base.
	const exception = toNoteHttpException(pgError("42501", "permission denied for function crear_nota"));

	assert.equal(exception.getStatus(), 403);
	assert.equal(
		bodyOf(exception).message,
		"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.",
	);
});

test("42501 de dominio (sesion no valida) se reenvia con su texto", () => {
	// `Sesion no valida` de la RPC es texto de dominio y no nombra objetos.
	const exception = toNoteHttpException(pgError("42501", "Sesion no valida"));

	assert.equal(exception.getStatus(), 403);
	assert.equal(bodyOf(exception).message, "Sesion no valida");
});

test("un P0001 sin clasificar se muestra con su texto y status 400", () => {
	// Mismo criterio que `vouchers.errors.ts` / `series.errors.ts`: una regla nueva de la RPC se le
	// muestra al usuario en vez de convertirse en un 500.
	const exception = toNoteHttpException(pgError("P0001", "Una regla que todavia no existia"));

	assert.equal(exception.getStatus(), 400);
	assert.equal(bodyOf(exception).message, "Una regla que todavia no existia");
});

test("drizzle envuelve el error original: el codigo se busca en la cadena de `cause`", () => {
	const wrapper = Object.assign(new Error("DrizzleQueryError"), {
		cause: Object.assign(new Error("Failed query"), {
			cause: pgError("23505", "duplicate key value"),
		}),
	});

	const exception = toNoteHttpException(wrapper);

	assert.equal(exception.getStatus(), 409);
	assert.equal(bodyOf(exception).message, DUPLICATE_NOTE);
});

test("un error sin codigo de PostgreSQL es un 500 con el generico", () => {
	const exception = toNoteHttpException(new Error("boom"));

	assert.equal(exception.getStatus(), 500);
	assert.equal(bodyOf(exception).message, GENERIC_DATABASE_FAILURE);
});

test("una HttpException ya traducida no se vuelve a traducir", () => {
	const original = new HttpException("Sesion requerida.", 401);

	assert.equal(toNoteHttpException(original), original);
});
