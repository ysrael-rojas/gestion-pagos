// Traduccion de errores del vertical de compras (S8 del port del vertical compras, T3).
//
// Por que una prueba unitaria y no solo e2e: tres ramas del mapa no se pueden alcanzar desde HTTP sin
// romper el esquema —`Los datos del comprobante no son válidos.` la filtra antes el contrato
// compartido, `XX000` la RPC solo lo levanta cuando la base falla de verdad, y `No se pudo cargar el
// saldo de los comprobantes.` exige que falle la lectura de `voucher_balance`—. El contrato
// (status + texto verbatim de S8) se fija aca, igual que en `vouchers.errors.test.ts`.
//
// La diferencia con el mapa de ventas, que este archivo deja escrita: el texto del proveedor no es el
// del cliente, y en compras NO existe la regla "el tipo de un comprobante emitido no se puede
// cambiar": el tipo de una compra es corregible mientras no tenga pagos (L3g).
import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpException } from "@nestjs/common";
import {
	DUPLICATE_PURCHASE,
	GENERIC_DATABASE_FAILURE,
	INVALID_VOUCHER_DATA,
	SUPPLIER_NOT_FOUND,
	VOUCHER_BALANCE_FAILURE,
	VOUCHER_NOT_FOUND,
	VOUCHER_WITH_PAYMENTS,
	toPurchaseHttpException,
	voucherBalanceFailure,
	voucherNotFound,
} from "../src/purchases/purchases.errors.ts";

/** Error de PostgreSQL como lo ve el mapeador: `code` y `message` en el nivel superior. */
function pgError(code: string, message = ""): Error {
	return Object.assign(new Error(message), { code });
}

/** El `body` que Nest arma para una excepcion lanzada con un texto. */
function bodyOf(exception: HttpException): { message: string } {
	return exception.getResponse() as { message: string };
}

test("los mensajes de S8 se mapean a su status sin reescribir el texto", () => {
	const cases: Array<{ error: unknown; status: number; message: string }> = [
		// P0001: excepcion de dominio de las RPC de compra, con el mensaje ya redactado.
		{ error: pgError("P0001", SUPPLIER_NOT_FOUND), status: 404, message: SUPPLIER_NOT_FOUND },
		{
			error: pgError("P0001", DUPLICATE_PURCHASE),
			status: 409,
			message: DUPLICATE_PURCHASE,
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
		// `editar_compra` responde este texto cuando la fila no es una COMPRA del dueno.
		{ error: pgError("P0001", VOUCHER_NOT_FOUND), status: 404, message: VOUCHER_NOT_FOUND },
		// Familias de SQLSTATE que las RPC re-lanzan conservando el codigo (S8).
		{ error: pgError("23505", "duplicate key value"), status: 409, message: DUPLICATE_PURCHASE },
		{
			error: pgError("23514", "new row violates check"),
			status: 400,
			message: INVALID_VOUCHER_DATA,
		},
		{ error: pgError("23503", "fk violation"), status: 404, message: SUPPLIER_NOT_FOUND },
		// `XX000` es el generico de la RPC; cualquier otro codigo desconocido cae en el mismo 500.
		{
			error: pgError("XX000", GENERIC_DATABASE_FAILURE),
			status: 500,
			message: GENERIC_DATABASE_FAILURE,
		},
		{
			error: pgError("40001", "serialization failure"),
			status: 500,
			message: GENERIC_DATABASE_FAILURE,
		},
	];

	for (const testCase of cases) {
		const exception = toPurchaseHttpException(testCase.error);

		assert.equal(
			exception.getStatus(),
			testCase.status,
			`status de ${JSON.stringify(testCase.error)}`,
		);
		assert.equal(bodyOf(exception).message, testCase.message);
	}
});

test("los cinco textos de S8 son los del origen, verbatim", () => {
	// Se comparan literalmente porque son el contrato visible: un cambio de tilde o de punto final
	// es un cambio de producto, no de estilo.
	assert.equal(SUPPLIER_NOT_FOUND, "El proveedor seleccionado no existe.");
	assert.equal(DUPLICATE_PURCHASE, "Ya registraste una compra con ese número de comprobante.");
	assert.equal(INVALID_VOUCHER_DATA, "Los datos del comprobante no son válidos.");
	assert.equal(VOUCHER_NOT_FOUND, "El comprobante no existe.");
	assert.equal(
		GENERIC_DATABASE_FAILURE,
		"No se pudo completar la operación con la base de datos. Intenta nuevamente.",
	);
});

test("el tipo de una compra NO es inmutable: su texto no esta en el mapa (L3g)", () => {
	// La RPC `editar_compra` no levanta "El tipo de un comprobante emitido no se puede cambiar."
	// (eso es de la venta, cuyo numero publico una serie). Si ese texto llegara igual, seria un
	// P0001 sin clasificar y se mostraria con 400, no con 409: la comprobacion deja escrito que la
	// regla de ventas no se copio por inercia.
	const exception = toPurchaseHttpException(
		pgError("P0001", "El tipo de un comprobante emitido no se puede cambiar."),
	);

	assert.equal(exception.getStatus(), 400);
	assert.equal(
		bodyOf(exception).message,
		"El tipo de un comprobante emitido no se puede cambiar.",
	);
});

test("un P0001 sin clasificar se muestra con su texto y status 400", () => {
	// Criterio de `cash.errors.ts`: una regla nueva de la RPC se le muestra al usuario en vez de
	// convertirse en un 500, y el status por defecto de una excepcion de dominio es "la peticion
	// esta mal".
	const exception = toPurchaseHttpException(pgError("P0001", "Una regla que todavia no existia"));

	assert.equal(exception.getStatus(), 400);
	assert.equal(bodyOf(exception).message, "Una regla que todavia no existia");
});

test("un P0001 sin mensaje cae en el generico de S8", () => {
	const exception = toPurchaseHttpException(pgError("P0001"));

	assert.equal(exception.getStatus(), 400);
	assert.equal(bodyOf(exception).message, GENERIC_DATABASE_FAILURE);
});

test("42501 de un privilegio o de la RLS no se le muestra al usuario", () => {
	// El texto de `permission denied for table comprobante` nombra objetos de la base.
	const exception = toPurchaseHttpException(
		pgError("42501", "permission denied for table comprobante"),
	);

	assert.equal(exception.getStatus(), 403);
	assert.equal(
		bodyOf(exception).message,
		"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.",
	);
});

test("42501 de dominio (sesion no valida) se reenvia con su texto", () => {
	// La RPC levanta `Sesion no valida` con 42501 cuando `auth.uid()` es nulo: no nombra objetos.
	const exception = toPurchaseHttpException(pgError("42501", "Sesion no valida"));

	assert.equal(exception.getStatus(), 403);
	assert.equal(bodyOf(exception).message, "Sesion no valida");
});

test("drizzle envuelve el error original: el codigo se busca en la cadena de `cause`", () => {
	const wrapper = Object.assign(new Error("DrizzleQueryError"), {
		cause: Object.assign(new Error("Failed query"), {
			cause: pgError("23505", "duplicate key value"),
		}),
	});

	const exception = toPurchaseHttpException(wrapper);

	assert.equal(exception.getStatus(), 409);
	assert.equal(bodyOf(exception).message, DUPLICATE_PURCHASE);
});

test("un error sin codigo de PostgreSQL es un 500 con el generico de S8", () => {
	const exception = toPurchaseHttpException(new Error("boom"));

	assert.equal(exception.getStatus(), 500);
	assert.equal(bodyOf(exception).message, GENERIC_DATABASE_FAILURE);
});

test("una HttpException ya traducida no se vuelve a traducir", () => {
	const original = new HttpException("Sesion requerida.", 401);

	assert.equal(toPurchaseHttpException(original), original);
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

test("la compra ausente responde 404 con el texto de la RPC", () => {
	const exception = voucherNotFound();

	assert.equal(exception.getStatus(), 404);
	assert.equal(bodyOf(exception).message, VOUCHER_NOT_FOUND);
});
