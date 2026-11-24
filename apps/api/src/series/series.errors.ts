// Traduccion de errores de PostgreSQL a HTTP para el vertical de series (T3, S6 del port de
// series).
//
// POR QUE UN MAPA PROPIO Y NO `vouchers.errors.ts`: cada vertical redacta los mensajes de SU
// usuario final, que es el criterio que ya siguen `payments.errors.ts`, `cash.errors.ts`,
// `entities.errors.ts` y `vouchers.errors.ts`. `vouchers.errors.ts` mapea `23505` a "Ya registraste
// una venta con ese número de comprobante.", que en un alta de serie es falso; aca el `23505` es el
// indice `voucher_series_owner_type_code_idx`. La FORMA del mapa (mensaje -> status, y codigo de
// PostgreSQL -> familia) SI se copia de `vouchers.errors.ts` / `cash.errors.ts`, no se inventa una.
//
// El codigo de PostgreSQL llega en `error.code`; drizzle 0.45 envuelve el original en
// `DrizzleQueryError`, asi que se mira `cause` antes de rendirse.
//
// `Los datos de la serie no son válidos.` es alcanzable por la RPC pero no por HTTP: el contrato
// compartido (S7) filtra el codigo vacio y el de mas de 4 caracteres antes. Se mapea igual porque
// la RPC es la ultima linea (CHECK del codigo, NOT NULL, tipo fuera de S4 con el mismo texto) y su
// rechazo no puede terminar en el generico. Lo pina `ventas-rpc.e2e.test.ts` en la RPC.
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
 * Mensajes textuales de S6 (`odd/tasks/port-vertical-series.md`). Son el contrato visible: se
 * exportan para que la prueba y el e2e los comparen sin copiar el texto.
 */
export const DUPLICATE_SERIES_CODE = "Ya existe una serie con ese código para ese tipo.";
export const INVALID_SERIES_DATA = "Los datos de la serie no son válidos.";
export const SERIES_NOT_FOUND = "La serie no existe.";
export const GENERIC_DATABASE_FAILURE =
	"No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/** `42501` de un grant o de una politica RLS: su texto nombra tablas y sentencias. */
const SESSION_PERMISSION_MESSAGE =
	"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.";

/**
 * Status que este vertical devuelve para un mensaje de negocio.
 *
 * 404 = la serie no es visible para el dueno de la sesion. `public.editar_serie` y
 * `public.eliminar_serie` usan el MISMO texto para "no existe", "es de otro dueno" y "esta dada de
 * baja" a proposito (no filtran la existencia de series ajenas), igual que `El comprobante no
 * existe.` del slice 1.
 * 409 = el estado del recurso impide la operacion (codigo repetido para ese tipo); la peticion esta
 * bien formada y el usuario la resuelve eligiendo otro codigo.
 * 400 = la base rechazo datos que el usuario puede corregir.
 */
type SeriesStatus = 404 | 409 | 400;

/**
 * Los mensajes de dominio de las tres RPC, con su status.
 *
 * Se comparan por igualdad (no por `includes`) porque son textos cerrados: una regla nueva de la
 * RPC que no este aca cae en el 400 con su propio texto, que es el comportamiento por defecto de
 * `cash.errors.ts` para un `P0001` sin clasificar.
 */
const DOMAIN_RULES: ReadonlyArray<{ message: string; status: SeriesStatus }> = [
	{ message: SERIES_NOT_FOUND, status: 404 },
	{ message: DUPLICATE_SERIES_CODE, status: 409 },
	{ message: INVALID_SERIES_DATA, status: 400 },
];

/** Status de un mensaje de negocio, o `null` si nadie lo clasifico. */
function domainStatusOf(message: string): SeriesStatus | null {
	return DOMAIN_RULES.find((rule) => rule.message === message)?.status ?? null;
}

/** La excepcion concreta de Nest que corresponde al status. */
function domainException(status: SeriesStatus, message: string): HttpException {
	switch (status) {
		case 404:
			return new NotFoundException(message);
		case 409:
			return new ConflictException(message);
		default:
			return new BadRequestException(message);
	}
}

/** `42501` viene de la RPC con un mensaje de dominio; "permission denied" es de grants. */
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
 * Convierte el error de una RPC o de una lectura de series en la excepcion HTTP correspondiente.
 *
 * El mensaje de la base viaja TAL CUAL cuando es de dominio: es el que el usuario ve, y S6 fija
 * los textos de este vertical. El CODIGO aporta la familia y el MENSAJE elige el status dentro de
 * la familia, igual que en `vouchers.errors.ts`: `P0001` es la excepcion de PL/pgSQL con el texto
 * ya redactado, `23505`/`23514` son las familias que la RPC re-lanza conservando el codigo y
 * `42501` es un privilegio o la RLS.
 */
export function toSeriesHttpException(error: unknown): HttpException {
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
			// `voucher_series_owner_type_code_idx`, traducido por la RPC a este mismo texto. El juez
			// de la unicidad sigue siendo el indice (S3): aca solo se elige el status.
			return new ConflictException(DUPLICATE_SERIES_CODE);
		case "23514":
		case "23502":
			// CHECK del codigo o NOT NULL, ya traducidos por la RPC (23514) o rechazados por la
			// tabla antes de que la RPC los envuelva.
			return new BadRequestException(INVALID_SERIES_DATA);
		case "42501":
			// `Sesion no valida` de la RPC es un texto de dominio y se reenvia; el de una politica o
			// de un grant se reemplaza, porque nombra objetos de la base.
			return new ForbiddenException(
				isPrivilegeDenial(message) || message === "" ? SESSION_PERMISSION_MESSAGE : message,
			);
		default:
			// La unica FK de la tabla es `owner_id -> auth.users`, que no puede violarse en una
			// sesion valida; cualquier otro codigo (`XX000` incluido) conserva el texto generico.
			return new InternalServerErrorException(GENERIC_DATABASE_FAILURE);
	}
}

/** La serie no existe, es de otro dueno o esta dada de baja: el texto de la RPC de S6. */
export function seriesNotFound(): NotFoundException {
	return new NotFoundException(SERIES_NOT_FOUND);
}
