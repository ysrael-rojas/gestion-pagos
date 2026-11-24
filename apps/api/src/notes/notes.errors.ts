// Traduccion de errores de PostgreSQL a HTTP para el vertical de notas (T3, S10 de
// `odd/tasks/port-vertical-notas.md`).
//
// POR QUE UN MAPA PROPIO Y NO `vouchers.errors.ts` NI `series.errors.ts`: cada vertical redacta los
// mensajes de SU usuario final, que es el criterio que ya siguen `payments.errors.ts`,
// `cash.errors.ts`, `entities.errors.ts`, `vouchers.errors.ts` y `series.errors.ts`. En una nota,
// `23505` es "Ya registraste una nota con ese número de comprobante." y no la venta duplicada; y
// `23514` es "Los datos de la nota no son válidos." y no la serie. La FORMA del mapa (mensaje ->
// status, y codigo de PostgreSQL -> familia) SI se copia: `P0001` es la excepcion de PL/pgSQL con el
// texto ya redactado, `23505`/`23514`/`23502`/`23503` son las familias que `public.crear_nota`
// re-lanza conservando el codigo y `42501` es un privilegio, la RLS o el trigger de consistencia.
//
// LA RAMA QUE NO ES COPIA: `42501` del trigger `comprobante_owner_consistency` (`20261028194204`).
// Cuando la nota referencia un comprobante de otro dueno, la RPC no levanta un error propio: HEREDA
// `entity_id` del referenciado y muere en el trigger con su texto
// (`El comprobante referencia una entidad o comprobante de otro usuario`) y con 42501. Ese texto
// nombra la regla de la base y no es el contrato del API, asi que se REEMPLAZA por el de S10
// (`El comprobante referenciado es de otro usuario.`), con 404 como el resto de los "no existe para
// esta sesion": la RLS ya hace invisibles las filas ajenas y el texto de S10 tampoco las confirma.
//
// El codigo de PostgreSQL llega en `error.code`; drizzle 0.45 envuelve el original en
// `DrizzleQueryError`, asi que se mira `cause` antes de rendirse.
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
}

/**
 * Mensajes textuales de S10. Son el contrato visible: se exportan para que las pruebas y el e2e los
 * comparen sin copiar el texto.
 */
export const REFERENCED_VOUCHER_NOT_FOUND = "El comprobante referenciado no existe.";
export const NOT_A_BASE_SALE_VOUCHER = "Solo puedes referenciar factura, boleta o nota de venta.";
export const DUPLICATE_NOTE = "Ya registraste una nota con ese número de comprobante.";
export const INVALID_NOTE_DATA = "Los datos de la nota no son válidos.";
export const CREDIT_CEILING_EXCEEDED =
	"Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.";
export const REFERENCED_VOUCHER_OTHER_OWNER = "El comprobante referenciado es de otro usuario.";
export const GENERIC_DATABASE_FAILURE =
	"No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/**
 * Textual del trigger `comprobante_owner_consistency` (`20261028194204`), que la RPC re-lanza sin
 * tocar. No se muestra: es la señal que se traduce al 404 de S10 (ver la cabecera).
 */
const OTHER_OWNER_TRIGGER_MESSAGE =
	"El comprobante referencia una entidad o comprobante de otro usuario";

/** `42501` de un grant o de una politica RLS: su texto nombra tablas y sentencias. */
const SESSION_PERMISSION_MESSAGE =
	"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.";

/**
 * Status que este vertical devuelve para un mensaje de negocio.
 *
 * 404 = el comprobante referenciado no es visible para el dueno de la sesion (no existe, esta dado
 * de baja o es de otro dueno). Es el mismo criterio que `El comprobante no existe.` del slice 1.
 * 409 = el estado del comprobante referenciado impide la operacion (tope de S5 agotado, o un numero
 * que el indice unico ya tiene): la peticion esta bien formada y el usuario la resuelve con otra
 * nota.
 * 400 = la base rechazo datos que el usuario puede corregir (un tipo que no es nota, un importe
 * invalido, un comprobante que no es base de venta).
 */
type NoteStatus = 404 | 409 | 400;

/**
 * Los mensajes de dominio de `public.crear_nota`, con su status.
 *
 * Se comparan por igualdad (no por `includes`) porque son textos cerrados: una regla nueva de la RPC
 * que no este aca cae en el 400 con su propio texto, que es el comportamiento por defecto de
 * `cash.errors.ts` para un `P0001` sin clasificar. El de S3 ("No hay una serie por defecto...") es
 * uno de esos: 400 y su texto tal cual.
 */
const DOMAIN_RULES: ReadonlyArray<{ message: string; status: NoteStatus }> = [
	{ message: REFERENCED_VOUCHER_NOT_FOUND, status: 404 },
	{ message: NOT_A_BASE_SALE_VOUCHER, status: 400 },
	{ message: DUPLICATE_NOTE, status: 409 },
	{ message: INVALID_NOTE_DATA, status: 400 },
	{ message: CREDIT_CEILING_EXCEEDED, status: 409 },
];

/** Status de un mensaje de negocio, o `null` si nadie lo clasifico. */
function domainStatusOf(message: string): NoteStatus | null {
	return DOMAIN_RULES.find((rule) => rule.message === message)?.status ?? null;
}

/** La excepcion concreta de Nest que corresponde al status. */
function domainException(status: NoteStatus, message: string): HttpException {
	switch (status) {
		case 404:
			return new NotFoundException(message);
		case 409:
			return new ConflictException(message);
		default:
			return new BadRequestException(message);
	}
}

/** `42501` viene del trigger o de la RPC con un mensaje de dominio; "permission denied" es de grants. */
function isPrivilegeDenial(message: string): boolean {
	return /permission denied/i.test(message);
}

/** Busca el codigo de PostgreSQL en la cadena de `cause` (drizzle envuelve el error original). */
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

/**
 * Convierte el error de `public.crear_nota` o de una lectura de notas en la excepcion HTTP
 * correspondiente.
 *
 * El mensaje de la base viaja TAL CUAL cuando es de dominio: S10 fija los seis textos. El CODIGO
 * aporta la familia y el MENSAJE elige el status dentro de la familia.
 */
export function toNoteHttpException(error: unknown): HttpException {
	if (error instanceof HttpException) {
		return error;
	}

	const postgres = normalizePostgresError(error);

	if (!postgres?.code) {
		return new InternalServerErrorException(GENERIC_DATABASE_FAILURE);
	}

	const message = postgres.message ?? "";

	switch (postgres.code) {
		case "P0001": {
			// Excepcion de dominio: el status lo elige la tabla y el texto es el de la base.
			return domainException(domainStatusOf(message) ?? 400, message || GENERIC_DATABASE_FAILURE);
		}
		case "23505":
			// `comprobante_owner_kind_number_key`, traducido por la RPC a este mismo texto. El juez de
			// la unicidad sigue siendo el indice (S2): aca solo se elige el status.
			return new ConflictException(DUPLICATE_NOTE);
		case "23514":
		case "23502":
			// CHECK `comprobante_ajuste_check` (referencia y motivo obligatorios), `total > 0` o
			// NOT NULL, ya traducidos por la RPC o rechazados por la tabla antes de que los envuelva.
			return new BadRequestException(INVALID_NOTE_DATA);
		case "23503":
			// El referenciado desaparecio entre el lock y el INSERT (carrera con una baja).
			return new NotFoundException(REFERENCED_VOUCHER_NOT_FOUND);
		case "22P02":
			// El contrato del body NO exige uuid en `referencedComprobanteId` (`notaWriteSchema` es el
			// del formulario, y ahi el id sale de un selector): un id con otra forma muere en el cast
			// `::uuid` de la RPC. Es un dato invalido de la nota, no una falla de la base.
			return new BadRequestException(INVALID_NOTE_DATA);
		case "42501": {
			// El trigger de consistencia de dueno nombra la regla de la base y su texto no es el
			// contrato: se reemplaza por el de S10.
			if (message === OTHER_OWNER_TRIGGER_MESSAGE) {
				return new NotFoundException(REFERENCED_VOUCHER_OTHER_OWNER);
			}

			// `Sesion no valida` de la RPC es un texto de dominio y se reenvia; el de una politica o de
			// un grant se reemplaza, porque nombra objetos de la base.
			return new ForbiddenException(
				isPrivilegeDenial(message) || message === "" ? SESSION_PERMISSION_MESSAGE : message,
			);
		}
		default:
			// `XX000` cae aca con el mismo texto que ya mando la RPC.
			return new InternalServerErrorException(GENERIC_DATABASE_FAILURE);
	}
}
