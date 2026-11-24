// Traduccion de errores de PostgreSQL a HTTP para el vertical de ventas (T3, S6 del port).
//
// POR QUE UN MAPA PROPIO Y NO `payments.errors.ts` NI `cash.errors.ts`: cada vertical redacta los
// mensajes de SU usuario final. `payments.errors.ts` mapea `23505` a "El comprobante ya esta
// asignado a este pago.", que en un alta de venta es falso; y las reglas de la RPC de ventas
// (`crear_venta` / `editar_venta`, S8) no tienen equivalente en cajas. Es el mismo criterio que
// `cash.errors.ts` y `entities.errors.ts`, y la FORMA del mapa (codigo -> familia, mensaje ->
// status) es la de `cash.errors.ts` (`MOVEMENT_DOMAIN_RULES`), no una nueva.
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
 * Mensajes textuales de S6 (`odd/tasks/port-vertical-ventas.md`). Son el contrato visible: se
 * exportan para que la prueba y el e2e los comparen sin copiar el texto.
 */
export const CLIENT_NOT_FOUND = "El cliente seleccionado no existe.";
export const DUPLICATE_SALE = "Ya registraste una venta con ese número de comprobante.";
export const INVALID_VOUCHER_DATA = "Los datos del comprobante no son válidos.";
export const GENERIC_DATABASE_FAILURE =
	"No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/**
 * Mensaje de la lectura del saldo (`voucher_balance`).
 *
 * Existe como mensaje APARTE porque en el origen era una lectura aparte: el detalle del
 * comprobante no fallaba por el comprobante sino por el saldo, y el usuario veia este texto. Si
 * esa consulta se fundiera con la del comprobante, el sintoma pasaria a ser el generico y el
 * cliente perderia la unica pista de que lo que falla es el saldo.
 */
export const VOUCHER_BALANCE_FAILURE = "No se pudo cargar el saldo de los comprobantes.";

/**
 * Textual del trigger `comprobante_protect_paid` (`20261015053016`), que la RPC re-lanza sin
 * tocar (S6/S8): con pagos no anulados, importe, numero, cliente y fecha quedan bloqueados.
 */
export const VOUCHER_WITH_PAYMENTS =
	"No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha";

/**
 * Textual de `public.editar_venta` cuando la fila no es una VENTA del dueno de la sesion.
 *
 * NO es un texto de S6: la RPC usa el mismo mensaje para "no existe", "es de otro dueno" y "es una
 * compra" a proposito (no filtra la existencia de filas ajenas), y L10 del doc de la feature decide
 * conservarlo. T3 lo mapea a 404 y lo usa tambien para las lecturas: un comprobante invisible para
 * la sesion es el mismo 404 que un id inventado.
 */
export const VOUCHER_NOT_FOUND = "El comprobante no existe.";

/**
 * Textual de `public.editar_venta` cuando cambia el tipo de un comprobante ya emitido (S13.3).
 *
 * El tipo y el numero son lo que SUNAT identifica: el numero lo asigno la serie de un tipo, y
 * publicarlo bajo otro dejaria un correlativo emitido a nombre de un comprobante que no es. El
 * comprobante se corrige con NC/ND, no cambiando de tipo.
 */
export const VOUCHER_TYPE_IMMUTABLE = "El tipo de un comprobante emitido no se puede cambiar.";

/** `42501` de un grant o de una politica RLS: su texto nombra tablas y sentencias. */
const SESSION_PERMISSION_MESSAGE =
	"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.";

/**
 * Status que este vertical devuelve para un mensaje de negocio.
 *
 * 404 = el recurso no es visible para el dueno de la sesion (el comprobante ajeno o inexistente, o
 * el cliente de otra cuenta: la RLS no distingue los dos casos y el mensaje tampoco). Es el mismo
 * criterio que `cash.errors.ts` con "La cuenta de origen no existe".
 * 409 = el estado del recurso impide la operacion que el usuario pidio (numero repetido, o
 * comprobante con pagos que bloquea importe/numero/cliente/fecha). No es un 400: la peticion esta
 * bien formada y el usuario puede resolverlo anulando pagos o eligiendo otro numero.
 * 400 = la base rechazo una peticion que el usuario puede corregir.
 */
type VoucherStatus = 404 | 409 | 400;

/**
 * Los mensajes de dominio de la RPC y del trigger, con su status.
 *
 * Se comparan por igualdad (no por `includes`) porque son textos cerrados: una regla nueva de la
 * RPC que no este aca cae en el 400 con su propio texto (ver `toVoucherHttpException`), que es lo
 * que `cash.errors.ts` documenta como comportamiento por defecto para un `P0001` sin clasificar.
 */
const DOMAIN_RULES: ReadonlyArray<{ message: string; status: VoucherStatus }> = [
	{ message: VOUCHER_NOT_FOUND, status: 404 },
	{ message: CLIENT_NOT_FOUND, status: 404 },
	{ message: DUPLICATE_SALE, status: 409 },
	{ message: VOUCHER_WITH_PAYMENTS, status: 409 },
	{ message: VOUCHER_TYPE_IMMUTABLE, status: 409 },
	{ message: INVALID_VOUCHER_DATA, status: 400 },
];

/** Status de un mensaje de negocio, o `null` si nadie lo clasifico. */
function domainStatusOf(message: string): VoucherStatus | null {
	return DOMAIN_RULES.find((rule) => rule.message === message)?.status ?? null;
}

/** La excepcion concreta de Nest que corresponde al status. */
function domainException(status: VoucherStatus, message: string): HttpException {
	switch (status) {
		case 404:
			return new NotFoundException(message);
		case 409:
			return new ConflictException(message);
		default:
			return new BadRequestException(message);
	}
}

/** `42501` viene de la RPC/trigger con un mensaje de dominio; "permission denied" es de grants. */
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
 * Convierte el error de una RPC o de una lectura de comprobantes en la excepcion HTTP
 * correspondiente.
 *
 * El mensaje de la base viaja TAL CUAL cuando es de dominio: es el que el usuario ve, y S6 fija
 * los cinco textos. El CODIGO aporta la familia y el MENSAJE elige el status dentro de la familia,
 * igual que en `cash.errors.ts`: `P0001` es la excepcion de PL/pgSQL con el texto ya redactado,
 * `23505`/`23514`/`23503` son las familias que la RPC re-lanza conservando el codigo (S8), y
 * `42501` es un privilegio o la RLS.
 */
export function toVoucherHttpException(error: unknown): HttpException {
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
			// Excepcion de dominio: el status lo elige la tabla y el texto es el de la base. Un
			// mensaje sin clasificar se muestra igual, con 400.
			return domainException(domainStatusOf(message) ?? 400, message || GENERIC_DATABASE_FAILURE);
		}
		case "23505":
			// `comprobante_owner_kind_number_key`, traducido por la RPC a este mismo texto. El juez
			// de la unicidad sigue siendo el indice (S7): aca solo se elige el status.
			return new ConflictException(DUPLICATE_SALE);
		case "23514":
			// CHECK de la tabla (por ejemplo `comprobante_credit_days`), ya traducido por la RPC.
			return new BadRequestException(INVALID_VOUCHER_DATA);
		case "23503":
			// La unica FK que la RPC puede violar es `entity_id`: la entidad desaparecio entre la
			// validacion y el INSERT/UPDATE (carrera con una baja).
			return new NotFoundException(CLIENT_NOT_FOUND);
		case "42501":
			// `Sesion no valida` de la RPC es un texto de dominio y se reenvia; el de una politica o
			// de un grant se reemplaza, porque nombra objetos de la base.
			return new ForbiddenException(
				isPrivilegeDenial(message) || message === ""
					? SESSION_PERMISSION_MESSAGE
					: message,
			);
		default:
			// `XX000` cae aca con el mismo texto que ya mando la RPC.
			return new InternalServerErrorException(GENERIC_DATABASE_FAILURE);
	}
}

/**
 * La lectura de `voucher_balance` fallo: su mensaje es propio (ver `VOUCHER_BALANCE_FAILURE`) y no
 * el generico, aunque el status sea el mismo 500.
 */
export function voucherBalanceFailure(error: unknown): HttpException {
	if (error instanceof HttpException) {
		return error;
	}

	return new InternalServerErrorException(VOUCHER_BALANCE_FAILURE);
}

/** El comprobante no existe, es de otro dueno o es una compra: la RLS ya lo hace invisible. */
export function voucherNotFound(): NotFoundException {
	return new NotFoundException(VOUCHER_NOT_FOUND);
}
