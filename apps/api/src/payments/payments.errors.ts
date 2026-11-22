// Traduccion de errores de PostgreSQL a errores HTTP con los mensajes del proyecto de origen.
//
// Fuente: `mapError` de `lib/pagos/pagos.ts` (los mensajes en espanol son los que la UI ya
// muestra). Lo que cambia es el transporte: el origen lanzaba `Error` y la UI lo mostraba; aca es
// una `HttpException` para que el status sea el correcto (`42501` es 403, no 500).
//
// El codigo de PostgreSQL llega en `error.code`; drizzle 0.45 envuelve el error original en
// `DrizzleQueryError`, asi que se mira `cause` antes de rendirse.
import { BadRequestException, ConflictException, ForbiddenException, HttpException, InternalServerErrorException } from "@nestjs/common";

interface PostgresError {
	code?: string;
	message?: string;
	detail?: string;
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
