// Traduccion de errores de PostgreSQL a HTTP para el vertical de compras (T3, S8 del port).
//
// POR QUE UN MAPA PROPIO Y NO `vouchers.errors.ts`: cada vertical redacta los mensajes de SU usuario
// final, y los de compras no son los de ventas. `CLIENT_NOT_FOUND` de ventas dice "El cliente
// seleccionado no existe."; aca la entidad es el PROVEEDOR. Y la venta mapea dos textos que en
// compras no existen (`El tipo de un comprobante emitido no se puede cambiar.`): en una compra el
// tipo es corregible, como el numero (L3g del doc de la feature). Importar el mapa de ventas
// obligaria a excluir reglas a mano, que es como se desincronizan.
//
// La FORMA (codigo -> familia, mensaje -> status) se copia de `vouchers.errors.ts` /
// `cash.errors.ts` (`MOVEMENT_DOMAIN_RULES`), no se inventa una nueva.
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
 * Mensajes textuales de S8 (`odd/tasks/port-vertical-compras.md`), verbatim del origen. Son el
 * contrato visible: se exportan para que el e2e los compare sin copiar el texto.
 */
export const SUPPLIER_NOT_FOUND = "El proveedor seleccionado no existe.";
export const DUPLICATE_PURCHASE = "Ya registraste una compra con ese número de comprobante.";
export const INVALID_VOUCHER_DATA = "Los datos del comprobante no son válidos.";
export const GENERIC_DATABASE_FAILURE =
	"No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/**
 * Mensaje de la lectura del saldo (`voucher_balance`).
 *
 * Existe como mensaje APARTE por la misma razon que en la venta: en el origen eran dos lecturas y el
 * usuario tenia dos textos. Si el detalle de la compra fundiera las dos consultas, una falla del
 * saldo se veria como el generico "No se pudo completar la operación..." y el cliente perderia la
 * unica pista de que lo que no se pudo leer es el saldo.
 */
export const VOUCHER_BALANCE_FAILURE = "No se pudo cargar el saldo de los comprobantes.";

/**
 * Textual del trigger `comprobante_protect_paid` (`20261015053016`), que la RPC re-lanza sin tocar
 * (S8): con pagos no anulados, importe, numero, proveedor y fecha quedan bloqueados. Es el mismo
 * trigger y el mismo texto que mapea la venta; aca se compara igual porque el mensaje es de la base.
 */
export const VOUCHER_WITH_PAYMENTS =
	"No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha";

/**
 * Textual de `public.editar_compra` cuando la fila no es una COMPRA del dueno de la sesion.
 *
 * Es el mismo texto que usa la venta para "no existe / es de otro / es del otro vertical" (S8): la
 * RPC no filtra la existencia de comprobantes que este vertical no edita. T3 lo mapea a 404 y lo usa
 * tambien para las lecturas: una compra invisible para la sesion es el mismo 404 que un id
 * inventado.
 */
export const VOUCHER_NOT_FOUND = "El comprobante no existe.";

/** `42501` de un grant o de una politica RLS: su texto nombra tablas y sentencias. */
const SESSION_PERMISSION_MESSAGE =
	"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.";

/**
 * Status que este vertical devuelve para un mensaje de negocio.
 *
 * 404 = el recurso no es visible para el dueno de la sesion (la compra ajena o inexistente, o el
 * proveedor de otra cuenta: la RLS no distingue los casos y el mensaje tampoco).
 * 409 = el estado del recurso (o del numero) impide la operacion pedida: numero repetido, o compra
 * con pagos que bloquea importe/numero/proveedor/fecha. No es 400: la peticion esta bien formada y
 * el usuario puede resolverlo anulando pagos o eligiendo otro numero.
 * 400 = la base rechazo una peticion que el usuario puede corregir.
 */
type PurchaseStatus = 404 | 409 | 400;

/**
 * Los mensajes de dominio de las RPC y del trigger, con su status.
 *
 * Se comparan por igualdad (no por `includes`) porque son textos cerrados: una regla nueva de la RPC
 * que no este aca cae en el 400 con su propio texto (ver `toPurchaseHttpException`), que es el
 * comportamiento por defecto documentado en `cash.errors.ts` para un `P0001` sin clasificar.
 */
const DOMAIN_RULES: ReadonlyArray<{ message: string; status: PurchaseStatus }> = [
	{ message: VOUCHER_NOT_FOUND, status: 404 },
	{ message: SUPPLIER_NOT_FOUND, status: 404 },
	{ message: DUPLICATE_PURCHASE, status: 409 },
	{ message: VOUCHER_WITH_PAYMENTS, status: 409 },
	{ message: INVALID_VOUCHER_DATA, status: 400 },
];

/** Status de un mensaje de negocio, o `null` si nadie lo clasifico. */
function domainStatusOf(message: string): PurchaseStatus | null {
	return DOMAIN_RULES.find((rule) => rule.message === message)?.status ?? null;
}

/** La excepcion concreta de Nest que corresponde al status. */
function domainException(status: PurchaseStatus, message: string): HttpException {
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
 * Convierte el error de una RPC o de una lectura de compras en la excepcion HTTP correspondiente.
 *
 * El mensaje de la base viaja TAL CUAL cuando es de dominio: es el que el usuario ve, y S8 fija los
 * cinco textos. El CODIGO aporta la familia y el MENSAJE elige el status dentro de la familia:
 * `P0001` es la excepcion de PL/pgSQL con el texto ya redactado, `23505`/`23514`/`23503` son las
 * familias que la RPC re-lanza conservando el codigo (S8), y `42501` es un privilegio o la RLS.
 */
export function toPurchaseHttpException(error: unknown): HttpException {
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
			return domainException(
				domainStatusOf(message) ?? 400,
				message || GENERIC_DATABASE_FAILURE,
			);
		}
		case "23505":
			// `comprobante_owner_kind_number_key` (por kind, S2), traducido por la RPC a este mismo
			// texto. El juez de la unicidad sigue siendo el indice: aca solo se elige el status.
			return new ConflictException(DUPLICATE_PURCHASE);
		case "23514":
			// CHECK de la tabla (por ejemplo `comprobante_credit_days`), ya traducido por la RPC.
			return new BadRequestException(INVALID_VOUCHER_DATA);
		case "23503":
			// La unica FK que la RPC puede violar es `entity_id`: la entidad desaparecio entre la
			// validacion y el INSERT/UPDATE (carrera con una baja).
			return new NotFoundException(SUPPLIER_NOT_FOUND);
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

/** La compra no existe, es de otro dueno o es una venta: la RLS ya lo hace invisible. */
export function voucherNotFound(): NotFoundException {
	return new NotFoundException(VOUCHER_NOT_FOUND);
}
