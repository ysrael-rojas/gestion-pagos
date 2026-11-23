// Traduccion de errores de PostgreSQL a HTTP para el vertical de clientes.
//
// POR QUE NO SE REUSA `payments.errors.ts`: ese traductor mapea `23505` a "El comprobante ya
// esta asignado a este pago." Un alta de cliente duplicado mostraria un mensaje de pagos. El
// vertical tiene sus propios mensajes (S5 del doc `odd/tasks/port-vertical-clientes.md`), y el
// duplicado es el que el usuario final ve en el formulario.
//
// El mensaje de duplicado es textual del origen: `lib/clientes/entidades.ts:52`.
//
// El codigo de PostgreSQL llega en `error.code`; drizzle 0.45 envuelve el original en
// `DrizzleQueryError`, asi que se mira `cause` antes de rendirse. Las constraints violadas
// llegan en `error.constraint`, que es lo que distingue los dos CHECK de la tabla.
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";

interface PostgresError {
	code?: string;
	message?: string;
	detail?: string;
	constraint?: string;
}

const GENERIC = "No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/** Textual del origen (`lib/clientes/entidades.ts:52`). La UI lo muestra tal cual. */
export const DUPLICATE_DOCUMENT_MESSAGE = "Ya existe un cliente con ese tipo y número de documento.";

/** Mensaje del `entidad_document_type_required` (el CHECK de la tabla, no del cliente). */
const DOCUMENT_TYPE_MESSAGE = "El número de documento no corresponde al tipo seleccionado.";

/** Mensaje del `entidad_some_role`: toda fila tiene que ser cliente o proveedor. */
const SOME_ROLE_MESSAGE = "El registro debe ser cliente o proveedor.";

/** `42501` viene del trigger/RPC con un mensaje de dominio; "permission denied" es de privilegios. */
function isPrivilegeDenial(message: string): boolean {
	return /permission denied/i.test(message);
}

function normalizePostgresError(error: unknown): PostgresError | null {
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

/** Convierte el error de una escritura de entidad en la excepcion HTTP correspondiente. */
export function toEntityHttpException(error: unknown): HttpException {
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
			// Excepcion de dominio de PL/pgSQL, con su mensaje ya redactado.
			return new BadRequestException(message || GENERIC);
		case "23503":
			return new BadRequestException("La entidad seleccionada no existe.");
		case "23505":
			// Unico indice unico de la tabla: `entidad_document_unique` (parcial, ignora las filas
			// borradas y las que no tienen numero).
			return new ConflictException(DUPLICATE_DOCUMENT_MESSAGE);
		case "23514":
			// Dos CHECK posibles; `constraint` dice cual. El servicio normaliza
			// `SIN_DOCUMENTO` a numero vacio, asi que en la practica no deberia llegar ninguno.
			switch (postgres.constraint) {
				case "entidad_document_type_required":
					return new BadRequestException(DOCUMENT_TYPE_MESSAGE);
				case "entidad_some_role":
					return new BadRequestException(SOME_ROLE_MESSAGE);
				default:
					return new BadRequestException("Los datos del cliente no son válidos.");
			}
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

/** Fila ausente o ya borrada: la escritura no encontro a quien apuntaba. */
export function entityNotFound(): NotFoundException {
	return new NotFoundException("El cliente no existe o fue eliminado.");
}
