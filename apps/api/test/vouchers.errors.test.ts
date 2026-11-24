// Traduccion de errores del vertical de ventas (S6 del port del vertical ventas, T3).
//
// Por que una prueba unitaria y no solo e2e: tres de las ramas del mapa no se pueden alcanzar
// desde HTTP sin romper el esquema —`Los datos del comprobante no son válidos.` la filtra antes el
// `voucherFormSchema`, `XX000` la RPC solo lo levanta cuando la base falla de verdad, y
// `No se pudo cargar el saldo de los comprobantes.` exige que falle la lectura de
// `voucher_balance`—. El contrato (status + texto verbatim) se fija aca.
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import {
	CLIENT_NOT_FOUND,
	DUPLICATE_SALE,
	GENERIC_DATABASE_FAILURE,
	INVALID_VOUCHER_DATA,
	VOUCHER_BALANCE_FAILURE,
	VOUCHER_NOT_FOUND,
	VOUCHER_TYPE_IMMUTABLE,
	VOUCHER_WITH_PAYMENTS,
	toVoucherHttpException,
	voucherBalanceFailure,
	voucherNotFound,
} from "../src/vouchers/vouchers.errors.ts";

/** Error de PostgreSQL como lo ve el mapeador: `code` y `message` en el nivel superior. */
function pgError(code: string, message = ""): Error {
	return Object.assign(new Error(message), { code });
}

/** El `body` que Nest arma para una excepcion lanzada con un texto. */
function bodyOf(exception: HttpException): { message: string } {
	return exception.getResponse() as { message: string };
}

test("los mensajes de S6 se mapean a su status sin reescribir el texto", () => {
	const cases: Array<{ error: unknown; status: number; message: string }> = [
		// P0001: excepcion de dominio de la RPC, con el mensaje ya redactado para el usuario.
		{ error: pgError("P0001", CLIENT_NOT_FOUND), status: 404, message: CLIENT_NOT_FOUND },
		{
			error: pgError("P0001", DUPLICATE_SALE),
			status: 409,
			message: DUPLICATE_SALE,
		},
		{
			error: pgError("P0001", INVALID_VOUCHER_DATA),
			status: 400,
			message: INVALID_VOUCHER_DATA,
		},
		// El trigger `comprobante_protect_paid` no se puede saltar: su texto llega tal cual.
		{
			error: pgError("P0001", VOUCHER_WITH_PAYMENTS),
			status: 409,
			message: VOUCHER_WITH_PAYMENTS,
		},
		// `editar_venta` responde este texto cuando la fila no es una VENTA del dueno (L10).
		{ error: pgError("P0001", VOUCHER_NOT_FOUND), status: 404, message: VOUCHER_NOT_FOUND },
		// Familias de SQLSTATE que la RPC re-lanza conservando el codigo.
		{ error: pgError("23505", "duplicate key value"), status: 409, message: DUPLICATE_SALE },
		{ error: pgError("23514", "new row violates check"), status: 400, message: INVALID_VOUCHER_DATA },
		{ error: pgError("23503", "fk violation"), status: 404, message: CLIENT_NOT_FOUND },
		// `XX000` es el generico de la RPC; cualquier otro codigo desconocido cae en el mismo 500.
		{
			error: pgError("XX000", GENERIC_DATABASE_FAILURE),
			status: 500,
			message: GENERIC_DATABASE_FAILURE,
		},
		{ error: pgError("40001", "serialization failure"), status: 500, message: GENERIC_DATABASE_FAILURE },
	];

	for (const testCase of cases) {
		const exception = toVoucherHttpException(testCase.error);

		assert.equal(
			exception.getStatus(),
			testCase.status,
			`status de ${JSON.stringify(testCase.error)}`,
		);
		assert.equal(bodyOf(exception).message, testCase.message);
	}
});

test("el tipo de un comprobante emitido no se puede cambiar se mapea a 409 (S13.3)", () => {
	// `public.editar_venta` levanta este texto como excepcion de dominio cuando el body pide un
	// `voucherType` distinto al de la fila emitida. Es un rechazo por ESTADO, no por datos
	// invalidos: la peticion esta bien formada y el usuario la resuelve con una NC/ND (S6 del port
	// de series), asi que viaja como 409 igual que el comprobante con pagos.
	const exception = toVoucherHttpException(pgError("P0001", VOUCHER_TYPE_IMMUTABLE));

	assert.equal(exception.getStatus(), 409);
	assert.equal(bodyOf(exception).message, VOUCHER_TYPE_IMMUTABLE);
	assert.equal(VOUCHER_TYPE_IMMUTABLE, "El tipo de un comprobante emitido no se puede cambiar.");
});

test("un P0001 sin clasificar se muestra con su texto y status 400", () => {
	// Criterio de `cash.errors.ts`: una regla nueva de la RPC se le muestra al usuario en vez de
	// convertirse en un 500, y el status por defecto de una excepcion de dominio es "la peticion
	// esta mal".
	const exception = toVoucherHttpException(pgError("P0001", "Una regla que todavia no existia"));

	assert.equal(exception.getStatus(), 400);
	assert.equal(bodyOf(exception).message, "Una regla que todavia no existia");
});

test("un P0001 sin mensaje cae en el generico de S6", () => {
	const exception = toVoucherHttpException(pgError("P0001"));

	assert.equal(exception.getStatus(), 400);
	assert.equal(bodyOf(exception).message, GENERIC_DATABASE_FAILURE);
});

test("42501 de un privilegio o de la RLS no se le muestra al usuario", () => {
	// El texto de `permission denied for table comprobante` nombra objetos de la base.
	const exception = toVoucherHttpException(
		pgError("42501", 'permission denied for table comprobante'),
	);

	assert.equal(exception.getStatus(), 403);
	assert.equal(
		bodyOf(exception).message,
		"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.",
	);
});

test("42501 de dominio (sesion no valida) se reenvia con su texto", () => {
	// La RPC levanta `Sesion no valida` con 42501 cuando `auth.uid()` es nulo: no nombra objetos.
	const exception = toVoucherHttpException(pgError("42501", "Sesion no valida"));

	assert.equal(exception.getStatus(), 403);
	assert.equal(bodyOf(exception).message, "Sesion no valida");
});

test("drizzle envuelve el error original: el codigo se busca en la cadena de `cause`", () => {
	const wrapper = Object.assign(new Error("DrizzleQueryError"), {
		cause: Object.assign(new Error("Failed query"), { cause: pgError("23505", "duplicate key value") }),
	});

	const exception = toVoucherHttpException(wrapper);

	assert.equal(exception.getStatus(), 409);
	assert.equal(bodyOf(exception).message, DUPLICATE_SALE);
});

test("un error sin codigo de PostgreSQL es un 500 con el generico de S6", () => {
	const exception = toVoucherHttpException(new Error("boom"));

	assert.equal(exception.getStatus(), 500);
	assert.equal(bodyOf(exception).message, GENERIC_DATABASE_FAILURE);
});

test("una HttpException ya traducida no se vuelve a traducir", () => {
	const original = new HttpException("Sesion requerida.", 401);

	assert.equal(toVoucherHttpException(original), original);
});

test("la lectura del saldo falla con su propio mensaje, no con el generico (S6)", () => {
	// `voucher_balance` se leia aparte en el origen: su falla no puede parecer una falla del alta.
	const exception = voucherBalanceFailure(new Error("boom"));

	assert.equal(exception.getStatus(), 500);
	assert.equal(bodyOf(exception).message, VOUCHER_BALANCE_FAILURE);
	assert.notEqual(bodyOf(exception).message, GENERIC_DATABASE_FAILURE);
});

test("la lectura del saldo deja pasar una HttpException ya traducida", () => {
	const original = new HttpException("Sesion requerida.", 401);

	assert.equal(voucherBalanceFailure(original), original);
});

test("el comprobante ausente responde 404 con el texto de la RPC", () => {
	const exception = voucherNotFound();

	assert.equal(exception.getStatus(), 404);
	assert.equal(bodyOf(exception).message, VOUCHER_NOT_FOUND);
});
