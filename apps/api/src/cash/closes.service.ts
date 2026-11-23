// Cierres y arqueos de caja: LECTURA por Drizzle y ESCRITURA por RPC (C4 del vertical).
//
// Fuente: `lib/caja/caja.ts` (`getCashClose`, `listCashCloses`, `listCloseDenominations`,
// `closeCashAccount`) y `lib/caja/arqueos.ts` (`listCashCounts`, `getCashCount`,
// `createCashCount`) del proyecto de origen. El reparto es el mismo que tenia el origen contra
// PostgREST, con dos diferencias de transporte:
//
//   - Las lecturas son una transaccion con la identidad del request puesta por `withOwner`
//     (RLS + rol `authenticated`), no el cliente de Supabase.
//   - Las escrituras NO son INSERT: son `select public.close_cash_account(...)` /
//     `select public.register_cash_count(...)`, funciones `security definer` (S3). Las cuatro
//     tablas (`cash_close`, `cash_close_denomination`, `cash_count`, `cash_count_denomination`)
//     no se escriben desde aca ni desde ningun otro archivo del API. Ese es el contrato, no una
//     preferencia de estilo: `authenticated` conserva el privilegio INSERT pero las tablas solo
//     tienen politica de SELECT, asi que un INSERT directo muere con `42501` —lo pina el e2e—.
//
// S2 — EL DINERO LO CALCULA LA BASE. `expected_balance`, `difference`, `income_total`,
// `expense_total`, `opening_balance`, los dos totales de transferencia, `change_fund`,
// `difference_tolerance` y `pen_usd_rate` los escriben las RPC. Este archivo no suma ni resta
// importes ni antes ni despues: solo convierte `numeric` (string exacto del driver) a number en
// el borde JSON. Tampoco decide si un cierre se permite (S4/S5): el periodo ya cerrado, la fecha
// futura, el periodo anterior al saldo inicial, la tolerancia sin motivo, la denominacion
// invalida y la cuenta ajena los rechaza PostgreSQL, y aca solo se TRADUCEN a HTTP.
//
// S6 — EL DUENO SALE DE LA SESION. Ningun body acepta `owner_id`, y `withOwner` fija el GUC
// `app.user_id` que leen tanto las politicas RLS como `auth.uid()` dentro de las RPC. Los
// `where owner_id = ...` de las lecturas son defensa en profundidad; la garantia es la politica.
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	HttpException,
	Inject,
	Injectable,
	InternalServerErrorException,
	NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { cashClose, cashCloseDenomination } from "../db/schema/cash-close.ts";
import { cashCount } from "../db/schema/cash-count.ts";
import { withOwner } from "../db/with-owner";
import type { CashCloseBody, CashCountBody } from "./closes.query.ts";
import type {
	CashCloseDetail,
	CashCloseRecord,
	CashCloseRow,
	CashCountRecord,
	CashCountRow,
	CloseDenomination,
	CloseDenominationRow,
} from "./closes.types.ts";

const GENERIC = "No se pudo completar la operación con la base de datos. Intenta nuevamente.";

/**
 * Mensaje de `23514` en el origen (`lib/caja/arqueos.ts:26-28`, `mapError`).
 *
 * Es inalcanzable por estas rutas —`closing_periodicity` lo pone la RPC y los CHECK de las
 * cuatro tablas los violaria solo una escritura directa, que la RLS rechaza antes— y se mapea
 * igual porque una constraint nueva no puede hacer aparecer el mensaje de otro vertical.
 */
const INVALID_DATA_MESSAGE = "Los datos no cumplen las reglas de validación.";

/**
 * Mensaje de `23503` en el origen (`lib/caja/arqueos.ts:29-31`).
 *
 * Hoy es inalcanzable: las RPC validan la cuenta con `for update` ANTES de insertar y responden
 * `La cuenta no existe` (`P0001`) cuando no es del dueno. Se conserva por la misma razon que el
 * de `23514`.
 */
const MISSING_ACCOUNT_MESSAGE = "La cuenta referenciada no existe.";

/**
 * Mensaje de `23505` sobre `unique (cash_account_id, period_end)`.
 *
 * En la practica no se alcanza: `close_cash_account` bloquea la cuenta con `for update` y
 * revalida el ultimo cierre antes de insertar, asi que dos cierres simultaneos se serializan y el
 * segundo recibe el mensaje de dominio (`El periodo ya esta cerrado hasta %`). Se traduce igual
 * para no filtrar un texto de la base si la carrera alguna vez cambia de forma (S5).
 */
const DUPLICATE_PERIOD_MESSAGE = "Ya existe un cierre para ese periodo.";

interface PostgresError {
	code?: string;
	message?: string;
}

/** `42501` viene de la politica/privilegio con un mensaje de dominio; "permission denied" no. */
function isPrivilegeDenial(message: string): boolean {
	return /permission denied/i.test(message);
}

/**
 * Busca el codigo de PostgreSQL en la cadena de `cause`: drizzle 0.45 envuelve el error original
 * en `DrizzleQueryError`. Mismo recorrido que `cash.errors.ts` / `settings.service.ts`; vive aca
 * porque los mensajes de cierres y arqueos son propios y `cash.errors.ts` (fuera de la superficie
 * de este slice) habla de cuentas.
 */
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
 * Traduce el error de una RPC o de una lectura de cierre/arqueo a HTTP.
 *
 * `P0001` es la excepcion de dominio de PL/pgSQL y su mensaje ya esta redactado para el usuario
 * (`El periodo ya esta cerrado hasta 2026-03-10`, `La diferencia (5.00) supera la tolerancia
 * (0.50). Registra el motivo de la diferencia`, ...): se devuelve tal cual, sin reescribirlo. Es
 * el mismo criterio que `payments.errors.ts` y `settings.service.ts`.
 */
function toCloseHttpException(error: unknown): HttpException {
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
			return new BadRequestException(message || GENERIC);
		case "23505":
			return new ConflictException(DUPLICATE_PERIOD_MESSAGE);
		case "23514":
			return new BadRequestException(INVALID_DATA_MESSAGE);
		case "23503":
			return new BadRequestException(MISSING_ACCOUNT_MESSAGE);
		case "42501":
			// Un grant/RLS que rechaza la operacion es el contrato (S3), no algo a sortear aca.
			return new ForbiddenException(
				isPrivilegeDenial(message)
					? "No tienes permisos para esta operación. Cierra sesión y vuelve a entrar."
					: message || "No tienes permisos para esta operación.",
			);
		default:
			return new InternalServerErrorException(GENERIC);
	}
}

/** Fila ausente, borrada o de otro dueno: la RLS ya la hace invisible, el mensaje es el mismo. */
function closeNotFound(): NotFoundException {
	return new NotFoundException("El cierre no existe.");
}

/** `numeric` (string exacto) -> number, solo en el borde JSON. */
function toNumber(value: string): number;
function toNumber(value: string | null): number | null;
function toNumber(value: string | null): number | null {
	return value === null ? null : Number(value);
}

/** Fila de `cash_close` -> contrato de salida. */
function toCashCloseRecord(row: CashCloseRow): CashCloseRecord {
	return {
		id: row.id,
		cashAccountId: row.cashAccountId,
		periodicity: row.periodicity,
		periodStart: row.periodStart,
		periodEnd: row.periodEnd,
		openingBalance: toNumber(row.openingBalance),
		incomeTotal: toNumber(row.incomeTotal),
		expenseTotal: toNumber(row.expenseTotal),
		expectedBalance: toNumber(row.expectedBalance),
		transferInTotal: toNumber(row.transferInTotal),
		transferOutTotal: toNumber(row.transferOutTotal),
		countedBalance: toNumber(row.countedBalance),
		changeFund: toNumber(row.changeFund),
		difference: toNumber(row.difference),
		differenceReason: row.differenceReason,
		differenceTolerance: toNumber(row.differenceTolerance),
		countedBy: row.countedBy,
		verifiedBy: row.verifiedBy,
		penUsdRate: toNumber(row.penUsdRate),
		notes: row.notes,
		// `timestamptz` llega como `Date`: el contrato del origen lo tenia como ISO string.
		createdAt: row.createdAt.toISOString(),
	};
}

/** Fila de `cash_close_denomination` -> contrato de salida. */
function toCloseDenomination(row: CloseDenominationRow): CloseDenomination {
	return { denomination: toNumber(row.denomination), quantity: row.quantity };
}

/** Fila de `cash_count` -> contrato de salida. */
function toCashCountRecord(row: CashCountRow): CashCountRecord {
	return {
		id: row.id,
		accountId: row.cashAccountId,
		countDate: row.countDate,
		countedBalance: toNumber(row.countedBalance),
		expectedBalance: toNumber(row.expectedBalance),
		difference: toNumber(row.difference),
		changeFund: toNumber(row.changeFund),
		countedBy: row.countedBy,
		isSurprise: row.isSurprise,
		notes: row.notes,
		createdAt: row.createdAt.toISOString(),
	};
}

/**
 * Las filas del conteo que viajan a la RPC: solo las cantidades efectivamente contadas (> 0),
 * como hacia `toDenominationPayload` del origen (`lib/caja/denominaciones.ts:60-73`), y `null`
 * cuando no quedo ninguna.
 *
 * `null` y no `[]` es la diferencia que importa en un cierre de caja: con `[]` la RPC sumaria
 * cero y compararia `difference = -expected`, mientras que con `null` deja el conteo en lo que
 * venga en `p_counted_balance` (o en `null` para un banco, que es "sin comparacion").
 */
function denominationPayload(
	rows: CashCloseBody["denominations"] | CashCountBody["denominations"],
): string | null {
	const counted = (rows ?? []).filter((row) => (row.quantity ?? 0) > 0);

	if (counted.length === 0) {
		return null;
	}

	return JSON.stringify(
		counted.map((row) => ({ denomination: row.denomination, quantity: row.quantity })),
	);
}

@Injectable()
export class ClosesService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /cash-closes` — los cierres del dueno, del mas reciente al mas antiguo.
	 *
	 * `accountId` es el filtro de la pantalla de cuadres (`listCashCloses(accountId)`,
	 * `cuadres-view.tsx:337`). El orden `period_end desc` es el del origen, y `created_at desc`
	 * como desempate para que dos cuentas con el mismo corte tengan un orden estable.
	 */
	async list(ownerId: string, accountId: string | null): Promise<CashCloseRecord[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select(CLOSE_COLUMNS)
					.from(cashClose)
					.where(
						and(
							eq(cashClose.ownerId, ownerId),
							accountId === null ? undefined : eq(cashClose.cashAccountId, accountId),
						),
					)
					.orderBy(desc(cashClose.periodEnd), desc(cashClose.createdAt));

				return rows.map(toCashCloseRecord);
			});
		} catch (error) {
			throw toCloseHttpException(error);
		}
	}

	/**
	 * `GET /cash-closes/:id` — el cierre con su arqueo por denominacion.
	 *
	 * Un id inexistente o de otro dueno responde 404 con el mismo mensaje: la RLS de `cash_close`
	 * (y la de `cash_close_denomination`, que la hereda del padre) ya lo hace invisible, asi que
	 * no hay forma de distinguirlos ni de devolver el detalle ajeno.
	 */
	async detail(ownerId: string, id: string): Promise<CashCloseDetail> {
		try {
			return await withOwner(this.db, ownerId, (tx) => this.detailWithin(tx, ownerId, id));
		} catch (error) {
			throw toCloseHttpException(error);
		}
	}

	/**
	 * `POST /cash-closes` — el cierre, por `close_cash_account` (8 argumentos posicionales).
	 *
	 * Los argumentos son los de `20261027232454_spec51_cash_close_signatures.sql:13-22`, en ese
	 * orden exacto: (cuenta, fecha de corte, saldo contado, notas, denominaciones, motivo de la
	 * diferencia, quien conto, quien reviso). Los cuatro textos viajan como `""` y no como `null`
	 * cuando el modal los deja vacios, igual que el origen (`lib/caja/caja.ts:652-663`): la RPC
	 * los normaliza a `NULL` con `nullif(trim(...), '')`, asi que un texto vacio y uno ausente
	 * son el mismo cierre.
	 *
	 * `countedBalance` puede ser `null` (cierre de banco sin comparacion contra el extracto):
	 * entonces la RPC deja `counted_balance` y `difference` en NULL. En una CAJA con
	 * denominaciones la RPC ignora el saldo contado y suma el detalle (S2).
	 */
	async create(ownerId: string, body: CashCloseBody): Promise<CashCloseDetail> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ id: string }>(sql`
					select public.close_cash_account(
						${body.cashAccountId}::uuid,
						${body.periodEnd}::date,
						${body.countedBalance ?? null}::numeric,
						${body.notes ?? ""}::text,
						${denominationPayload(body.denominations)}::jsonb,
						${body.differenceReason ?? ""}::text,
						${body.countedBy ?? ""}::text,
						${body.verifiedBy ?? ""}::text
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("close_cash_account no devolvio el id del cierre.");
				}

				// El detalle se lee en la MISMA transaccion: asi el acta no puede mostrar un cierre
				// y un arqueo de momentos distintos, y un cierre invisible seria un 404 coherente.
				return this.detailWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toCloseHttpException(error);
		}
	}

	/**
	 * `GET /cash-counts` — los arqueos del dueno, del mas reciente al mas antiguo.
	 *
	 * Mismo filtro opcional que los cierres (la tabla de arqueos y el panel de caja chica lo
	 * pasan siempre: `cuadres-view.tsx:338`, `petty-cash-panel.tsx:129`). El orden es el del
	 * origen (`count_date desc`, `created_at desc`) para que dos arqueos del mismo dia no
	 * aparezcan en orden arbitrario.
	 */
	async listCounts(ownerId: string, accountId: string | null): Promise<CashCountRecord[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select(COUNT_COLUMNS)
					.from(cashCount)
					.where(
						and(
							eq(cashCount.ownerId, ownerId),
							accountId === null ? undefined : eq(cashCount.cashAccountId, accountId),
						),
					)
					.orderBy(desc(cashCount.countDate), desc(cashCount.createdAt));

				return rows.map(toCashCountRecord);
			});
		} catch (error) {
			throw toCloseHttpException(error);
		}
	}

	/**
	 * `POST /cash-counts` — un arqueo sorpresivo, por `register_cash_count` (6 argumentos).
	 *
	 * Argumentos de `20261027203718_spec49_cash_surprise_count.sql:74-81`, en ese orden: (cuenta,
	 * fecha del arqueo, saldo contado, denominaciones, quien conto, notas).
	 *
	 * `countedBalance` viaja como `null` cuando el modal solo mando denominaciones y como
	 * `null` tambien cuando no mando nada: en el primer caso la RPC suma el detalle, en el
	 * segundo responde `Indica el efectivo contado (mayor o igual a cero)`, que es su regla y no
	 * se adelanta aca.
	 *
	 * No hay `GET /cash-counts/:id`: el origen tenia `getCashCount` para releer el arqueo recien
	 * creado, y aca la lectura ocurre dentro de la misma transaccion, asi que la ruta sobra.
	 */
	async createCount(ownerId: string, body: CashCountBody): Promise<CashCountRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ id: string }>(sql`
					select public.register_cash_count(
						${body.accountId}::uuid,
						${body.countDate}::date,
						${body.countedBalance ?? null}::numeric,
						${denominationPayload(body.denominations)}::jsonb,
						${body.countedBy ?? ""}::text,
						${body.notes ?? ""}::text
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("register_cash_count no devolvio el id del arqueo.");
				}

				const rows = await tx
					.select(COUNT_COLUMNS)
					.from(cashCount)
					.where(and(eq(cashCount.id, id), eq(cashCount.ownerId, ownerId)))
					.limit(1);

				const row = rows[0];

				if (!row) {
					throw new Error("El arqueo recien creado no se pudo leer.");
				}

				return toCashCountRecord(row);
			});
		} catch (error) {
			throw toCloseHttpException(error);
		}
	}

	/** Lectura compartida por `detail` y `create` (una sola definicion de "el cierre y su arqueo"). */
	private async detailWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<CashCloseDetail> {
		const [row] = await tx
			.select(CLOSE_COLUMNS)
			.from(cashClose)
			.where(and(eq(cashClose.id, id), eq(cashClose.ownerId, ownerId)))
			.limit(1);

		if (!row) {
			throw closeNotFound();
		}

		// El orden de las denominaciones es el del origen (mayor a menor); las de cantidad 0 no
		// existen en la tabla porque la RPC filtra `quantity > 0` al insertarlas.
		//
		// El join es para poder filtrar por dueno: `cash_close_denomination` no tiene `owner_id`
		// (lo hereda del cierre padre, y su politica RLS lo resuelve con un `exists` sobre
		// `cash_close`). La politica ya deja invisible el arqueo ajeno, asi que este `where` no
		// cambia ninguna respuesta observable; esta porque la politica es la garantia y el filtro
		// explicito la defensa en profundidad (doctrina de `src/db/with-owner.ts`), y porque una
		// query sin predicado de dueno es la que se copia a la proxima pantalla que lea la tabla.
		const denominations = await tx
			.select({ denomination: cashCloseDenomination.denomination, quantity: cashCloseDenomination.quantity })
			.from(cashCloseDenomination)
			.innerJoin(cashClose, eq(cashClose.id, cashCloseDenomination.cashCloseId))
			.where(
				and(
					eq(cashCloseDenomination.cashCloseId, id),
					eq(cashClose.ownerId, ownerId),
				),
			)
			.orderBy(desc(cashCloseDenomination.denomination));

		return {
			...toCashCloseRecord(row),
			denominations: denominations.map(toCloseDenomination),
		};
	}
}

/** Las columnas de `CashCloseRecord`, una sola vez para las tres lecturas. */
const CLOSE_COLUMNS = {
	id: cashClose.id,
	cashAccountId: cashClose.cashAccountId,
	periodicity: cashClose.periodicity,
	periodStart: cashClose.periodStart,
	periodEnd: cashClose.periodEnd,
	openingBalance: cashClose.openingBalance,
	incomeTotal: cashClose.incomeTotal,
	expenseTotal: cashClose.expenseTotal,
	expectedBalance: cashClose.expectedBalance,
	transferInTotal: cashClose.transferInTotal,
	transferOutTotal: cashClose.transferOutTotal,
	countedBalance: cashClose.countedBalance,
	changeFund: cashClose.changeFund,
	difference: cashClose.difference,
	differenceReason: cashClose.differenceReason,
	differenceTolerance: cashClose.differenceTolerance,
	countedBy: cashClose.countedBy,
	verifiedBy: cashClose.verifiedBy,
	penUsdRate: cashClose.penUsdRate,
	notes: cashClose.notes,
	createdAt: cashClose.createdAt,
};

/** Las columnas de `CashCountRecord`, una sola vez para las dos lecturas. */
const COUNT_COLUMNS = {
	id: cashCount.id,
	cashAccountId: cashCount.cashAccountId,
	countDate: cashCount.countDate,
	countedBalance: cashCount.countedBalance,
	expectedBalance: cashCount.expectedBalance,
	difference: cashCount.difference,
	changeFund: cashCount.changeFund,
	countedBy: cashCount.countedBy,
	isSurprise: cashCount.isSurprise,
	notes: cashCount.notes,
	createdAt: cashCount.createdAt,
};
