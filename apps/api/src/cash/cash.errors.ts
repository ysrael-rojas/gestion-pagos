// Traduccion de errores de PostgreSQL a HTTP para las cuentas de caja y banco (C2).
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
