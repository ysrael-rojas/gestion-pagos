// Transferencias entre cuentas de caja/banco (C6 del vertical de cajas-bancos).
//
// Fuente: `lib/caja/transferencias.ts` del proyecto de origen (`createCashTransfer`,
// `getCashTransfer`, `listAccountTransfers`). Las tres operaciones son las mismas; lo que cambia
// es el transporte: el origen hablaba PostgREST con la sesion de Supabase, aca es una transaccion
// con la identidad del request puesta por `withOwner` (RLS + rol `authenticated`).
//
//   GET  /cash-transfers?accountId&from&to   `select` sobre `cash_transfer` (la cuenta como
//                                            origen O destino, `transfer_date` inclusive)
//   GET  /cash-transfers/:id                 `select` por id
//   POST /cash-transfers                     `select public.create_cash_transfer(...)` (5 args)
//
// S8 — EL DINERO NO SE INSERTA DESDE ACA. La unica escritura es la RPC `create_cash_transfer`
// (`20261014165429_create_cash_transfer.sql:63`), `security definer`, que es la que valida las
// cuentas, la moneda y el periodo abierto, y la que inserta la fila. La tabla `cash_transfer` solo
// tiene politica de SELECT, asi que un INSERT directo moriria con `42501` (lo pina el e2e). La
// transferencia NO crea un `payment`: el movimiento lo ven `private.cash_expected_balance`,
// `get_cash_position` y `close_cash_account` sumando/ restando la fila de `cash_transfer` (S2).
//
// S2 — AQUI NO SE CALCULA NADA. El monto viaja tal cual al SQL y el saldo resultante de las dos
// cuentas lo recalcula la base cuando se le pide; este archivo solo convierte `numeric` (string
// exacto del driver) a number en el borde JSON.
//
// S6 — EL DUENO SALE DE LA SESION. Ningun body acepta `owner_id` y `withOwner` fija el GUC
// `app.user_id` que leen tanto la RLS como `auth.uid()` dentro de la RPC. Los `where owner_id` de
// las lecturas son defensa en profundidad; la garantia es la politica.
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, gte, lte, or, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { cashTransfer } from "../db/schema/cash-transfer.ts";
import { withOwner } from "../db/with-owner";
import {
	cashTransferNotFound,
	toCashMovementHttpException,
} from "./cash.errors.ts";
import type { CashTransferBody, CashTransferListQuery } from "./cash-transfers.query.ts";
import type { CashTransferRecord, CashTransferRow } from "./cash-transfers.types.ts";

/**
 * Las columnas de `CashTransferRecord`, una sola vez para las tres operaciones.
 *
 * No estan `owner_id` (el dueno no viaja al cliente: lo recorta la RLS) ni ningun total.
 */
const CASH_TRANSFER_COLUMNS = {
	id: cashTransfer.id,
	sourceAccountId: cashTransfer.sourceAccountId,
	targetAccountId: cashTransfer.targetAccountId,
	amount: cashTransfer.amount,
	transferDate: cashTransfer.transferDate,
	notes: cashTransfer.notes,
	createdAt: cashTransfer.createdAt,
};

/** Fila cruda -> contrato de salida (mismo reparto que `closes.service.ts`). */
function toCashTransferRecord(row: CashTransferRow): CashTransferRecord {
	return {
		id: row.id,
		sourceAccountId: row.sourceAccountId,
		targetAccountId: row.targetAccountId,
		// `numeric(12,2)` llega como string exacto del driver: se convierte en el borde JSON.
		amount: Number(row.amount),
		// `date` viaja como "YYYY-MM-DD" sin conversion, para no mover el dia por zona horaria.
		transferDate: row.transferDate,
		notes: row.notes,
		// `timestamptz` llega como `Date`: el contrato del origen lo tenia como ISO string.
		createdAt: row.createdAt.toISOString(),
	};
}

@Injectable()
export class CashTransfersService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /cash-transfers` — las transferencias del periodo en las que la cuenta participa.
	 *
	 * El filtro es el del origen (`listAccountTransfers`): `source_account_id = cuenta or
	 * target_account_id = cuenta`, con `transfer_date` entre `from` y `to` INCLUSIVE. El orden
	 * tambien es el del origen (`transfer_date` ascendente), con `created_at` como desempate para
	 * que dos transferencias del mismo dia tengan un orden estable.
	 *
	 * Una cuenta de otro dueno devuelve `[]`, no 403: la RLS ya la hace invisible y la consulta
	 * no puede distinguir "no existe" de "no es tuya".
	 */
	async list(ownerId: string, query: CashTransferListQuery): Promise<CashTransferRecord[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select(CASH_TRANSFER_COLUMNS)
					.from(cashTransfer)
					.where(
						and(
							eq(cashTransfer.ownerId, ownerId),
							or(
								eq(cashTransfer.sourceAccountId, query.accountId),
								eq(cashTransfer.targetAccountId, query.accountId),
							),
							gte(cashTransfer.transferDate, query.from),
							lte(cashTransfer.transferDate, query.to),
						),
					)
					.orderBy(asc(cashTransfer.transferDate), asc(cashTransfer.createdAt));

				return rows.map(toCashTransferRecord);
			});
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/**
	 * `GET /cash-transfers/:id` — una transferencia del dueno.
	 *
	 * Un id inexistente o de otro dueno responde 404 con el mismo mensaje: la RLS de
	 * `cash_transfer` ya lo hace invisible, asi que no hay forma de distinguirlos.
	 */
	async detail(ownerId: string, id: string): Promise<CashTransferRecord> {
		try {
			return await withOwner(this.db, ownerId, (tx) => this.detailWithin(tx, ownerId, id));
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/**
	 * `POST /cash-transfers` — la transferencia, por `create_cash_transfer` (5 argumentos).
	 *
	 * Los argumentos son los de `20261014165429_create_cash_transfer.sql:63-69`, en ese orden
	 * exacto: (cuenta de origen, cuenta de destino, monto, fecha, notas). Son obligatorios los
	 * cinco: la firma no tiene defaults, asi que el borde los manda siempre y `notes` viaja como
	 * `""` cuando el modal lo deja vacio (la RPC lo normaliza a NULL con `nullif(p_notes, '')`,
	 * igual que el origen, `lib/caja/transferencias.ts:60-66`).
	 *
	 * TODAS las reglas las aplica la RPC: cuenta inexistente o ajena, cuentas iguales, moneda
	 * distinta de PEN, monto no positivo y periodo cerrado en cualquiera de las dos cuentas
	 * (`private.assert_account_open_for`). Aca solo se traduce el error; no hay ningun pre-chequeo.
	 */
	async create(ownerId: string, body: CashTransferBody): Promise<CashTransferRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ id: string }>(sql`
					select public.create_cash_transfer(
						${body.sourceAccountId}::uuid,
						${body.targetAccountId}::uuid,
						${body.amount}::numeric,
						${body.transferDate}::date,
						${body.notes ?? ""}::text
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("create_cash_transfer no devolvio el id de la transferencia.");
				}

				// La fila se relee en la MISMA transaccion: lo que se responde es lo que la base
				// guardo (monto con los 12,2 aplicados, `notes` ya normalizado), no el body.
				return this.detailWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/** Lectura compartida por `detail` y `create` (una sola definicion de "la transferencia"). */
	private async detailWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<CashTransferRecord> {
		const rows = await tx
			.select(CASH_TRANSFER_COLUMNS)
			.from(cashTransfer)
			.where(and(eq(cashTransfer.id, id), eq(cashTransfer.ownerId, ownerId)))
			.limit(1);

		const row = rows[0];

		if (!row) {
			throw cashTransferNotFound();
		}

		return toCashTransferRecord(row);
	}
}
