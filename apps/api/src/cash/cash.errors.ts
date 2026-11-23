// Traduccion de errores de PostgreSQL a HTTP para el vertical de cajas y bancos (C2: cuentas;
// C6: transferencias y caja chica).
//
// POR QUE NO SE REUSA `payments.errors.ts` NI `entities.errors.ts`: cada vertical redacta los
// mensajes que ve su usuario final. `payments.errors.ts` mapea `23505` a "El comprobante ya esta
// asignado a este pago."; un alta de cuenta jamas puede contestar eso. Los mensajes de aca son los
// del origen (`lib/cuentas/entidades.ts:96-111`, `mapError`), que es el unico lugar donde el
// vertical tenia un diccionario de errores de `cash_account`.
//
// El codigo de PostgreSQL llega en `error.code`; drizzle 0.45 envuelve el original en
// `DrizzleQueryError`, asi que se mira `cause` antes de rendirse. En un `23514` el nombre de la
// constraint viaja en `error.constraint` y es lo que distingue las seis CHECK de la tabla.
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
	constraint?: string;
}

const GENERIC = "No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/**
 * Textual del origen (`lib/cuentas/entidades.ts:99-101`). `cash_account` no tiene hoy ningun
 * indice unico, asi que este codigo es inalcanzable por la ruta de escritura; se mapea igual
 * porque un indice unico futuro no puede hacer aparecer un mensaje de pagos.
 */
export const DUPLICATE_ACCOUNT_MESSAGE = "Ya existe una cuenta con esos datos.";

/** Textual del origen (`lib/cuentas/entidades.ts:102-105`), para un CHECK sin mensaje propio. */
export const INVALID_ACCOUNT_DATA_MESSAGE =
	"Los datos no cumplen las reglas de validación (verifica los campos requeridos).";

/**
 * Mensajes por constraint de `cash_account`.
 *
 * Son la traduccion a un mensaje de campo de las reglas que el origen validaba en el formulario
 * (`cashAccountFormSchema`) y que la base vuelve a exigir como CHECK. No se reimplementan en Node:
 * el parseo del body las deja pasar y el SQL las rechaza con este texto (ver
 * `cash-accounts.query.ts`).
 *
 * `cash_account_bank_requires_name` cubre DOS casos con una sola constraint (un banco necesita
 * banco / una caja no tiene datos bancarios), y el error de PostgreSQL no dice cual se violo, asi
 * que el mensaje nombra la regla completa en vez de elegir una rama y mentir en la otra.
 */
const CHECK_MESSAGES: Record<string, string> = {
	cash_account_name_nonempty: "Nombre requerido.",
	cash_account_opening_balance_nonnegative: "El saldo inicial no puede ser negativo.",
	cash_account_bank_requires_name:
		"Una cuenta bancaria necesita banco y una caja no tiene datos bancarios.",
	cash_account_change_fund_check: "El fondo no puede ser negativo.",
	cash_account_petty_expense_limit_check: "El límite debe ser mayor a cero.",
	cash_account_petty_cash_type_check: "Un banco no puede ser caja chica.",
};

/** `42501` viene del privilegio con un mensaje de dominio; "permission denied" es de grants. */
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

/** Convierte el error de una query de cuentas en la excepcion HTTP correspondiente. */
export function toCashHttpException(error: unknown): HttpException {
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
		case "23505":
			return new ConflictException(DUPLICATE_ACCOUNT_MESSAGE);
		case "23514": {
			const known = postgres.constraint ? CHECK_MESSAGES[postgres.constraint] : undefined;

			return new BadRequestException(known ?? INVALID_ACCOUNT_DATA_MESSAGE);
		}
		case "42501":
			// Un grant revocado sobre `cash_account` seria un hallazgo: se reporta, no se sortea.
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
export function cashAccountNotFound(): NotFoundException {
	return new NotFoundException("La cuenta no existe o fue eliminada.");
}

// ------------------------------------------------------------------------------------------
// C6 — transferencias (`cash_transfer`) y caja chica (`petty_cash_vale`).
//
// POR QUE UNA TABLA DE MENSAJES Y NO UN SWITCH POR CODIGO: las cuatro RPC de este slice
// (`create_cash_transfer`, `create_petty_cash_vale`, `replenish_petty_cash`,
// `void_petty_cash_vale`) levantan `P0001` para TODAS sus reglas de negocio, con el mensaje ya
// redactado para el usuario. Mapear `P0001` a un unico status (lo que hace `toCashHttpException`
// para las cuentas) borraria la diferencia entre "la cuenta no existe" y "el monto debe ser mayor
// a cero", que son cosas distintas para el cliente: la primera es 404 (la RLS ya la hace
// invisible, igual que un id inexistente) y la segunda 400 (la peticion esta mal). El codigo de
// PostgreSQL NUNCA decide solo: aporta la familia (excepcion de dominio, unique, check, permisos)
// y el MENSAJE elige el status dentro de la familia.

/**
 * Status que este slice devuelve para un mensaje de negocio.
 *
 * 404 = el recurso no es visible para el dueno de la sesion (cuenta o vale inexistente o ajeno:
 * la RLS no distingue los dos casos y el mensaje tampoco).
 * 400 = la base rechazo una peticion que el usuario puede corregir.
 */
type CashMovementStatus = 404 | 400;

/**
 * Los mensajes de negocio del slice, textuales de las RPC.
 *
 * Los que llevan un valor interpolado (`%`) se anclan con una expresion regular en vez de
 * comparar por igualdad: el limite del vale trae el monto y el limite (`El monto del vale (150.00)
 * supera el limite por gasto de la caja chica (100.00)`) y la fecha del vale puede caer en un
 * periodo cerrado. Comparar por igualdad dejaria esas ramas en el 400 generico.
 *
 * Los mensajes de `private.assert_account_open_for` estan porque las dos RPC de alta los
 * propagan: la cuenta cerrada hasta una fecha y la fecha anterior al saldo inicial se rechazan
 * igual que cualquier otra regla, con el texto de la base.
 */
const MOVEMENT_DOMAIN_RULES: ReadonlyArray<{ pattern: RegExp; status: CashMovementStatus }> = [
	// create_cash_transfer
	{ pattern: /^La cuenta de origen no existe$/, status: 404 },
	{ pattern: /^La cuenta de destino no existe$/, status: 404 },
	{ pattern: /^Origen y destino deben ser cuentas distintas$/, status: 400 },
	{ pattern: /^Solo se permiten transferencias entre cuentas en PEN$/, status: 400 },
	{ pattern: /^El monto debe ser mayor a cero$/, status: 400 },
	// create_petty_cash_vale / replenish_petty_cash
	{ pattern: /^La cuenta de caja chica no existe$/, status: 404 },
	{ pattern: /^La cuenta no está marcada como caja chica$/, status: 400 },
	{ pattern: /^El monto del vale debe ser mayor a cero$/, status: 400 },
	{
		pattern: /^El monto del vale \(.+\) supera el límite por gasto de la caja chica \(.+\)$/,
		status: 400,
	},
	{ pattern: /^Indica a quién se pagó el vale$/, status: 400 },
	{ pattern: /^Indica el concepto del vale$/, status: 400 },
	{ pattern: /^Selecciona la categoría del gasto del vale$/, status: 400 },
	{ pattern: /^La categoría del vale no es válida$/, status: 400 },
	{ pattern: /^No existe el método de pago Efectivo para esta cuenta$/, status: 400 },
	// replenish_petty_cash
	{ pattern: /^Selecciona al menos un vale para reponer$/, status: 400 },
	{
		pattern: /^Algún vale no existe, no pertenece a la caja chica o no está pendiente$/,
		status: 400,
	},
	{ pattern: /^El total de los vales debe ser mayor a cero$/, status: 400 },
	// void_petty_cash_vale
	{ pattern: /^El vale no existe$/, status: 404 },
	{ pattern: /^Solo se pueden anular vales pendientes$/, status: 400 },
	// private.assert_account_open_for, que llaman las dos RPC de alta
	{ pattern: /^La cuenta no existe$/, status: 404 },
	{
		pattern: /^La fecha del recibo \(.+\) es anterior al saldo inicial de la cuenta \(.+\)\.$/,
		status: 400,
	},
	{
		pattern:
			/^La cuenta ya fue cerrada hasta .+\. No se pueden registrar ni modificar recibos con fecha anterior o igual\.$/,
		status: 400,
	},
];

/**
 * Mensaje de `23505` sobre `unique (account_id, serial)`.
 *
 * Inalcanzable por estas rutas: `create_petty_cash_vale` bloquea la cuenta con `for update` y
 * calcula `serial = max(serial) + 1` dentro del mismo bloqueo (S5), asi que dos vales
 * concurrentes se serializan y el segundo recibe el numero siguiente. Se traduce igual para no
 * filtrar un texto de la base si la carrera alguna vez cambia de forma.
 */
export const DUPLICATE_VALE_MESSAGE = "Ya existe un vale con ese número en la cuenta.";

/**
 * `23505` en una tabla sin otro indice unico que la PK. Hoy es inalcanzable (la PK la genera la
 * base y `cash_transfer` no tiene indices unicos de negocio); mismo criterio que el anterior.
 */
export const DUPLICATE_MOVEMENT_MESSAGE = "Ya existe un registro con esos datos.";

/**
 * `23514` sin constraint reconocida. Textual del origen (`lib/caja/transferencias.ts:26-28` y
 * `lib/caja/caja-chica.ts:31-33`, `mapError`).
 *
 * Inalcanzable por estas rutas: los dos CHECK de `cash_transfer` (monto > 0, cuentas distintas) y
 * los tres de `petty_cash_vale` (monto > 0, serial > 0, serial unico) los revalida la RPC antes de
 * insertar, con su propio mensaje de dominio.
 */
export const INVALID_MOVEMENT_DATA_MESSAGE = "Los datos no cumplen las reglas de validación.";

/** `23503`: una FK que no resuelve. Textual del origen, mismo texto que los cierres. */
export const MISSING_REFERENCE_MESSAGE = "La cuenta referenciada no existe.";

/**
 * `42501` del trigger `private.assert_owner_consistency`.
 *
 * Inalcanzable por el API: las RPC validan la pertenencia ANTES de insertar (y con el mismo texto
 * para "no existe" y "es de otro", para no filtrar la existencia de cuentas ajenas), y la RLS de
 * las dos tablas solo permite SELECT. Se conserva el mapeo porque el trigger existe y porque el
 * mensaje de la base es el que el usuario debe ver si algun dia la escritura directa vuelve a ser
 * posible.
 */
const FOREIGN_OWNER_PATTERN = /^La transferencia referencia una cuenta de otro usuario$/;

/**
 * Textos de `42501` que SI se le pueden mostrar al usuario.
 *
 * En cualquier otro caso el `42501` viene de un privilegio o de una politica RLS y su texto
 * nombra tablas y sentencias: se reemplaza por el mensaje de sesion, que es lo que hacia
 * `toCashHttpException` antes de este slice.
 */
const SESSION_PERMISSION_MESSAGE =
	"No tienes permisos para esta operación. Cierra sesión y vuelve a entrar.";

/** Texto de un `42501`: el de la base si es de dominio, el de sesion si es un grant/RLS. */
function privilegeMessageOf(message: string): string {
	if (isPrivilegeDenial(message) || message === "") {
		return SESSION_PERMISSION_MESSAGE;
	}

	return FOREIGN_OWNER_PATTERN.test(message) ? message : SESSION_PERMISSION_MESSAGE;
}

/** Status de un mensaje de negocio, o `null` si el mensaje no es de este slice. */
function movementStatusOf(message: string): CashMovementStatus | null {
	for (const rule of MOVEMENT_DOMAIN_RULES) {
		if (rule.pattern.test(message)) {
			return rule.status;
		}
	}

	return null;
}

/** La excepcion concreta de Nest que corresponde al status (misma forma de body que C2). */
function movementException(status: CashMovementStatus, message: string): HttpException {
	return status === 404 ? new NotFoundException(message) : new BadRequestException(message);
}

/**
 * Convierte el error de una RPC o de una lectura de transferencias / vales en la excepcion HTTP
 * correspondiente.
 *
 * El mensaje de la base viaja TAL CUAL: es el que el usuario ve (mismo criterio que
 * `closes.service.ts` y `payments.errors.ts`). Un `P0001` que no este en la tabla cae en 400 con
 * su texto: una regla nueva de la RPC se muestra al usuario en vez de convertirse en un 500.
 */
export function toCashMovementHttpException(error: unknown): HttpException {
	if (error instanceof HttpException) {
		return error;
	}

	const postgres = normalizePostgresError(error);

	if (!postgres?.code) {
		return new InternalServerErrorException(GENERIC);
	}

	const message = postgres.message ?? "";
	const known = movementStatusOf(message);

	switch (postgres.code) {
		case "P0001":
			// Excepcion de dominio de PL/pgSQL: el mensaje ya esta redactado y el status lo elige
			// la tabla de arriba (400 cuando el mensaje es nuevo y nadie lo clasifico todavia).
			return movementException(known ?? 400, message || GENERIC);
		case "42501":
			// Trigger de consistencia de dueno o privilegio/RLS: el mensaje decide, no el codigo.
			return new ForbiddenException(privilegeMessageOf(message));
		case "23505":
			return new ConflictException(
				postgres.constraint === "petty_cash_vale_serial_unique"
					? DUPLICATE_VALE_MESSAGE
					: DUPLICATE_MOVEMENT_MESSAGE,
			);
		case "23514":
			return new BadRequestException(INVALID_MOVEMENT_DATA_MESSAGE);
		case "23503":
			return new BadRequestException(MISSING_REFERENCE_MESSAGE);
		default:
			return new InternalServerErrorException(GENERIC);
	}
}

/** La transferencia no existe o es de otro dueno: la RLS ya la hace invisible. */
export function cashTransferNotFound(): NotFoundException {
	return new NotFoundException("La transferencia no existe.");
}

/** El vale no existe o es de otro dueno: mismo criterio que la transferencia. */
export function pettyCashValeNotFound(): NotFoundException {
	return new NotFoundException("El vale no existe.");
}

// ------------------------------------------------------------------------------------------
// C7 — conciliacion bancaria (`bank_reconciliation` + `bank_reconciliation_item`).
//
// Las ocho reglas de la RPC `public.save_bank_reconciliation` (SPEC 53) levantan `P0001` con el
// mensaje ya redactado para el usuario. Igual que en C6, el CODIGO no decide solo: aporta la
// familia (excepcion de dominio, unique, check, permisos) y el MENSAJE elige el status dentro de
// la familia. Comparar por codigo nada mas convertiria "Solo se concilian cuentas bancarias" y
// "La cuenta no existe" en el mismo 400, y son cosas distintas para el cliente.
//
// El texto viaja TAL CUAL, sin reescribirlo: es el que el origen mostraba
// (`lib/caja/conciliacion.ts:45-46`, `mapError`) y el que la pantalla de conciliacion muestra.
const RECONCILIATION_ACCOUNT_MISSING = /^La cuenta no existe$/;

/**
 * Status de un `P0001` de la conciliacion.
 *
 * 404 = la cuenta no es visible para el dueno de la sesion (no existe o es de otro: la RPC usa el
 * MISMO texto para los dos casos a proposito, para no filtrar la existencia de cuentas ajenas).
 * 400 = la base rechazo una peticion que el usuario puede corregir (tipo de cuenta, periodo,
 * saldos o partidas).
 */
function reconciliationStatusOf(message: string): 404 | 400 {
	return RECONCILIATION_ACCOUNT_MISSING.test(message) ? 404 : 400;
}

/**
 * `23505` sobre el triplete `(cash_account_id, period_start, period_end)`.
 *
 * MUERTO por esta ruta, y el comentario anterior decia lo contrario: la RPC hace
 * `on conflict (cash_account_id, period_start, period_end) do update`, asi que ese indice no puede
 * levantar `23505`, y el INSERT directo esta bloqueado por los revokes y por la politica SELECT.
 * Se conserva por simetria con los otros mapeos, pero que nadie lea aca un guard de duplicados de
 * la conciliacion: el que existe es el upsert, y PISA la fila anterior.
 */
export const DUPLICATE_RECONCILIATION_MESSAGE = "Ya existe una conciliación para ese período.";

/**
 * `23503`: una FK que no resuelve. Textual del origen (`lib/caja/conciliacion.ts:51-52`).
 *
 * Inalcanzable por esta ruta: la RPC valida la cuenta con `for update` ANTES del upsert, asi que
 * una cuenta inexistente responde su mensaje de dominio. Se conserva por la misma razon que los
 * otros mensajes inalcanzables del vertical: una constraint nueva no puede hacer aparecer el texto
 * de otro vertical.
 */
const MISSING_RECONCILIATION_ACCOUNT_MESSAGE = "La cuenta bancaria seleccionada no existe.";

/** `23514` sin constraint reconocida. Textual del origen (`lib/caja/conciliacion.ts:54-55`). */
const INVALID_RECONCILIATION_DATA_MESSAGE = "Los datos de la conciliación no son válidos.";

/**
 * Convierte el error de la RPC de conciliacion (o de su lectura por Drizzle) en HTTP.
 *
 * Un `P0001` que no este en la tabla cae en 400 con su texto: una regla nueva de la RPC se le
 * muestra al usuario en vez de convertirse en un 500.
 */
export function toReconciliationHttpException(error: unknown): HttpException {
	if (error instanceof HttpException) {
		return error;
	}

	const postgres = normalizePostgresError(error);

	if (!postgres?.code) {
		return new InternalServerErrorException(GENERIC);
	}

	const message = postgres.message ?? "";

	switch (postgres.code) {
		case "P0001": {
			// Excepcion de dominio de PL/pgSQL: mensaje textual, status por la tabla de arriba.
			const status = reconciliationStatusOf(message);

			return status === 404
				? new NotFoundException(message || GENERIC)
				: new BadRequestException(message || GENERIC);
		}
		case "23505":
			return new ConflictException(DUPLICATE_RECONCILIATION_MESSAGE);
		case "23514":
			return new BadRequestException(INVALID_RECONCILIATION_DATA_MESSAGE);
		case "23503":
			return new BadRequestException(MISSING_RECONCILIATION_ACCOUNT_MESSAGE);
		case "42501":
			// Las dos tablas solo tienen politica de SELECT: un DML directo o un grant que falte
			// es un hallazgo, no algo a sortear aca.
			return new ForbiddenException(
				isPrivilegeDenial(message)
					? "No tienes permisos para esta operación. Cierra sesión y vuelve a entrar."
					: message || "No tienes permisos para esta operación.",
			);
		default:
			return new InternalServerErrorException(GENERIC);
	}
}

/** La conciliacion no existe o es de otro dueno: la RLS ya la hace invisible. */
export function bankReconciliationNotFound(): NotFoundException {
	return new NotFoundException("La conciliación no existe.");
}
