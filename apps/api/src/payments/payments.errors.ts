// Traduccion de errores de PostgreSQL a errores HTTP con los mensajes del proyecto de origen.
//
// Fuente: `mapError` de `lib/pagos/pagos.ts` (los mensajes en espanol son los que la UI ya
// muestra). Lo que cambia es el transporte: el origen lanzaba `Error` y la UI lo mostraba; aca es
// una `HttpException` para que el status sea el correcto (`42501` es 403, no 500).
//
// El codigo de PostgreSQL llega en `error.code`; drizzle 0.45 envuelve el error original en
// `DrizzleQueryError`, asi que se mira `cause` antes de rendirse.
import { BadRequestException, ConflictException, ForbiddenException, HttpException, InternalServerErrorException, NotFoundException } from "@nestjs/common";

interface PostgresError {
	code?: string;
	message?: string;
	detail?: string;
	/** Nombre de la constraint violada: distingue los dos indices unicos de `cash_receipt_category`. */
	constraint?: string;
}

const GENERIC = "No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/** `42501` viene del trigger/RPC con un mensaje de dominio; "permission denied" es de privilegios. */
function isPrivilegeDenial(message: string): boolean {
	return /permission denied/i.test(message);
}

export function normalizePostgresError(error: unknown): PostgresError | null {
	let current: unknown = error;

	for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth += 1) {
		const candidate = current as PostgresError;

		if (typeof candidate.code === "string") {
			return candidate;
		}

		current = (candidate as { cause?: unknown }).cause;
	}

	return null;
}

/** Convierte el error de una query/RPC de pagos en la excepcion HTTP correspondiente. */
export function toHttpException(error: unknown): HttpException {
	if (error instanceof HttpException) {
		return error;
	}

	const postgres = normalizePostgresError(error);

	if (!postgres?.code) {
		return new InternalServerErrorException(GENERIC);
	}

	const message = postgres.message ?? "";

	switch (postgres.code) {
		case "P0001":
			// Excepcion de dominio de las funciones PL/pgSQL, con su mensaje ya redactado.
			return new BadRequestException(message || GENERIC);
		case "23503":
			return new BadRequestException("La entidad o el comprobante seleccionado no existe.");
		case "23505":
			return new ConflictException("El comprobante ya está asignado a este pago.");
		case "23514":
			return new BadRequestException("Los datos del pago no son válidos.");
		case "40001":
			return new ConflictException("Otro proceso está modificando el comprobante. Reintenta.");
		case "42883":
			return new InternalServerErrorException(
				"No se pudo crear el pago. Ejecuta la migración de la RPC.",
			);
		case "42703":
			return new InternalServerErrorException(
				"Error interno: el esquema de la base de datos está desactualizado. Avisa al administrador.",
			);
		case "42501":
			return new ForbiddenException(
				isPrivilegeDenial(message)
					? "No tienes permisos para esta operación. Cierra sesión y vuelve a entrar."
					: message || "No tienes permisos para esta operación.",
			);
		default:
			return new InternalServerErrorException(GENERIC);
	}
}

// ------------------------------------------------------------------------------------------
// C7 del vertical de cajas-bancos: ESCRITURAS de catalogo (`payment_method`,
// `cash_receipt_category`).
//
// Las dos tablas ya existian (lectura en `catalogs.service.ts`), pero el port solo tenia lecturas.
// Dar de alta un metodo o una categoria no puede reusar `toHttpException`: ese mapa traduce el
// `23505` a "El comprobante ya esta asignado a este pago.", que en un alta de catalogo es
// simplemente falso. El duplicado que SI puede ocurrir aca es el de `unique (owner_id, code)`, y
// el usuario necesita saber QUE codigo choca.

/** Catalogo con indices unicos propios. */
export type CatalogTable = "payment_method" | "cash_receipt_category";

/**
 * Mensaje del `23505` de un catalogo.
 *
 * En `payment_method` el unico indice unico es `unique (owner_id, code)`. En
 * `cash_receipt_category` hay dos: `(owner_id, code)` y `(owner_id, direction, name)`, y la
 * constraint reportada elige el mensaje. Cuando un nombre repetido produce el mismo codigo (la
 * derivacion es determinista desde el nombre) los dos indices se violan a la vez y PostgreSQL
 * reporta uno cualquiera de los dos: los dos mensajes dicen la verdad, ninguno filtra el texto
 * crudo de la base.
 *
 * `code` es `null` en una MODIFICACION: ahi el codigo no se escribe (es inmutable), asi que el
 * mensaje no puede nombrarlo y, en la categoria, el unico indice alcanzable es el del nombre.
 */
function catalogDuplicateMessage(
	table: CatalogTable,
	constraint: string | undefined,
	code: string | null,
): string {
	if (table === "payment_method") {
		return code === null
			? "Ya existe un método de pago con ese código."
			: `Ya existe un método de pago con el código ${code}.`;
	}

	const codeCollision =
		code !== null &&
		(constraint === undefined || constraint === "cash_receipt_category_owner_id_code_key");

	return codeCollision
		? `Ya existe una categoría con el código ${code}.`
		: "Ya existe una categoría con ese nombre.";
}

/**
 * Convierte el error de una escritura de catalogo en la excepcion HTTP correspondiente.
 *
 * `code` es el codigo que el servicio intento escribir (ya normalizado o derivado) y es lo que
 * aparece en el 409 para que el usuario sepa cual repetido no puede; en una modificacion es `null`
 * porque el codigo no se toca. El resto del mapa es el de `toHttpException`: la base es la que
 * valida, aca solo se traduce.
 */
export function toCatalogHttpException(
	error: unknown,
	table: CatalogTable,
	code: string | null,
): HttpException {
	if (error instanceof HttpException) {
		return error;
	}

	const postgres = normalizePostgresError(error);

	if (!postgres?.code) {
		return new InternalServerErrorException(GENERIC);
	}

	const message = postgres.message ?? "";

	switch (postgres.code) {
		case "23505":
			return new ConflictException(
				catalogDuplicateMessage(table, postgres.constraint, code),
			);
		case "42501":
			return new ForbiddenException(
				isPrivilegeDenial(message)
					? "No tienes permisos para esta operación. Cierra sesión y vuelve a entrar."
					: message || "No tienes permisos para esta operación.",
			);
		default:
			// Ni `23503` ni `23514` ni `P0001` existen en estas tablas (no tienen FK de negocio, ni
			// CHECK propios, ni funciones): si aparecieran seria un hallazgo del esquema y el mensaje
			// generico es el correcto para un 500. `toHttpException` NO sirve de fallback aca: sus
			// textos hablan de comprobantes y pagos.
			return new InternalServerErrorException(GENERIC);
	}
}

/** El metodo de pago no existe o es de otro dueno (la RLS lo hace invisible). */
export function paymentMethodNotFound(): NotFoundException {
	return new NotFoundException("El método de pago no existe.");
}

/** La categoria no existe o es de otro dueno: mismo criterio que el metodo. */
export function receiptCategoryNotFound(): NotFoundException {
	return new NotFoundException("La categoría no existe.");
}
