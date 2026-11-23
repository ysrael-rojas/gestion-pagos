// Escrituras y lectura completa de `public.cash_account` (C2 del vertical de cajas-bancos).
//
// Fuente: `lib/cuentas/entidades.ts` del proyecto de origen (`listCashAccounts`,
// `createCashAccount`, `updateCashAccount`, `softDeleteCashAccount`). Las operaciones son las
// mismas; lo que cambia es el transporte: el origen hablaba PostgREST con la sesion de Supabase,
// aca es una transaccion con la identidad del request puesta por `withOwner` (RLS + rol
// `authenticated`).
//
// Ninguna entrada puede fijar el dueno (S6): `owner_id` ni siquiera esta en el contrato del body y
// la columna tiene `default auth.uid()`, que dentro de `withOwner` es exactamente el usuario de la
// sesion. Los `where ownerId` de abajo son defensa en profundidad (la garantia es la politica
// `cash_account_*`), no la garantia.
//
// DESVIOS DELIBERADOS respecto del origen, los tres chicos:
//
//   1. Un id inexistente, borrado o de otro dueno responde 404 con un mensaje legible. El origen
//      dejaba escapar el error de PostgREST (`PGRST116`, "0 rows" en un `.single()`) y lo mostraba
//      como error generico.
//   2. Las reglas por tipo que el origen validaba en el formulario (banco sin banco, caja con
//      datos bancarios, banco caja chica) las decide la BASE, y el mensaje lo pone
//      `cash.errors.ts`. El borde HTTP no las reimplementa.
//   3. `numeric(12,2)` se escribe como string (es como la declara el schema) y se lee como number:
//      el origen recibia el numero de PostgREST ya casteado y lo pasaba tal cual a la UI.
//
// La lectura del catalogo de pagos (`GET /cash-accounts`, cinco columnas) NO vive aca: es
// `CatalogsService.cashAccounts` y no se toco.
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/db.provider";
import { cashAccount } from "../db/schema/cash-account.ts";
import { withOwner } from "../db/with-owner";
import { cashAccountNotFound, toCashHttpException } from "./cash.errors.ts";
import type { CashAccountBody } from "./cash-accounts.query.ts";
import type { CashAccountRecord, CashAccountRow } from "./cash-accounts.types.ts";

/** Las columnas de `CashAccountRecord`, una sola vez para las cuatro operaciones. */
const CASH_ACCOUNT_COLUMNS = {
	id: cashAccount.id,
	type: cashAccount.type,
	name: cashAccount.name,
	currency: cashAccount.currency,
	bankName: cashAccount.bankName,
	accountNumber: cashAccount.accountNumber,
	cci: cashAccount.cci,
	closingPeriodicity: cashAccount.closingPeriodicity,
	openingBalance: cashAccount.openingBalance,
	openingBalanceDate: cashAccount.openingBalanceDate,
	notes: cashAccount.notes,
	isActive: cashAccount.isActive,
	isPettyCash: cashAccount.isPettyCash,
	changeFund: cashAccount.changeFund,
	pettyExpenseLimit: cashAccount.pettyExpenseLimit,
	custodianName: cashAccount.custodianName,
	createdAt: cashAccount.createdAt,
	updatedAt: cashAccount.updatedAt,
	deletedAt: cashAccount.deletedAt,
};

/**
 * Las columnas que escriben las dos escrituras, con los defaults que la tabla ya tiene como
 * columnas NOT NULL con default.
 *
 * `id`, `owner_id`, `created_at` y `updated_at` NO estan: el id lo genera la base, el dueno sale
 * de `auth.uid()` y las marcas de tiempo del default o del trigger `cash_account_set_updated_at`.
 *
 * Los textos opcionales del schema compartido llegan como `undefined` cuando vienen vacios, y la
 * columna es `null` (no cadena vacia): el CHECK `cash_account_bank_requires_name` distingue
 * `bank_name is null` de `bank_name = ''`, y el origen guardaba `null` (`mapMutation`,
 * `lib/cuentas/entidades.ts:81-92`).
 */
function writableFields(values: CashAccountBody) {
	return {
		type: values.type,
		name: values.name,
		currency: values.currency,
		bankName: values.bankName ?? null,
		accountNumber: values.accountNumber ?? null,
		cci: values.cci ?? null,
		closingPeriodicity: values.closingPeriodicity ?? null,
		openingBalance: String(values.openingBalance),
		openingBalanceDate: values.openingBalanceDate,
		notes: values.notes ?? null,
		isActive: values.isActive,
		isPettyCash: values.isPettyCash,
		changeFund: String(values.changeFund),
		pettyExpenseLimit:
			values.pettyExpenseLimit === undefined ? null : String(values.pettyExpenseLimit),
		custodianName: values.custodianName ?? null,
	};
}

/** Condicion de fila "viva" del dueno de la sesion: lo que la politica RLS ya recorta, explicito. */
function liveRowOfOwner(ownerId: string, id: string) {
	return and(
		eq(cashAccount.id, id),
		eq(cashAccount.ownerId, ownerId),
		isNull(cashAccount.deletedAt),
	);
}

/** Fila cruda -> contrato de salida (mismo reparto que `payments.mapper.ts`). */
function toCashAccountRecord(row: CashAccountRow): CashAccountRecord {
	return {
		id: row.id,
		type: row.type,
		name: row.name,
		currency: row.currency,
		bankName: row.bankName,
		accountNumber: row.accountNumber,
		cci: row.cci,
		closingPeriodicity: row.closingPeriodicity,
		openingBalance: Number(row.openingBalance),
		// `date` viaja como "YYYY-MM-DD" sin conversion, para no mover el dia por zona horaria.
		openingBalanceDate: row.openingBalanceDate,
		notes: row.notes,
		isActive: row.isActive,
		isPettyCash: row.isPettyCash,
		changeFund: Number(row.changeFund),
		pettyExpenseLimit: row.pettyExpenseLimit === null ? null : Number(row.pettyExpenseLimit),
		custodianName: row.custodianName,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
	};
}

@Injectable()
export class CashAccountsService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /cash-accounts/:id` — la fila completa de una cuenta viva del dueno.
	 *
	 * Es la lectura que el formulario de cuentas necesita para editar (el catalogo de pagos solo
	 * trae cinco columnas). Una cuenta borrada o de otro dueno no existe para esta ruta: 404.
	 */
	async get(ownerId: string, id: string): Promise<CashAccountRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select(CASH_ACCOUNT_COLUMNS)
					.from(cashAccount)
					.where(liveRowOfOwner(ownerId, id))
					.limit(1);
				const row = rows[0];

				if (!row) {
					throw cashAccountNotFound();
				}

				return toCashAccountRecord(row);
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}

	/**
	 * `POST /cash-accounts` — alta (`createCashAccount` del origen).
	 *
	 * `type` viene en el body porque la fila del origen lo recibia aparte del formulario; el resto
	 * de las reglas por tipo las aplica la base (`cash_account_bank_requires_name` y compania) y
	 * `cash.errors.ts` traduce el `23514` a un mensaje de campo.
	 */
	async create(ownerId: string, values: CashAccountBody): Promise<CashAccountRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.insert(cashAccount)
					.values(writableFields(values))
					.returning(CASH_ACCOUNT_COLUMNS);
				const created = rows[0];

				if (!created) {
					throw toCashHttpException(null);
				}

				return toCashAccountRecord(created);
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}

	/**
	 * `PATCH /cash-accounts/:id` — modificacion (`updateCashAccount` del origen).
	 *
	 * REEMPLAZA las columnas editables: el formulario manda la fila completa, igual que el
	 * `mapMutation` del origen. `updated_at` lo mueve el trigger, no esta en `writableFields`.
	 */
	async update(ownerId: string, id: string, values: CashAccountBody): Promise<CashAccountRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.update(cashAccount)
					.set(writableFields(values))
					.where(liveRowOfOwner(ownerId, id))
					.returning(CASH_ACCOUNT_COLUMNS);
				const updated = rows[0];

				if (!updated) {
					throw cashAccountNotFound();
				}

				return toCashAccountRecord(updated);
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}

	/**
	 * `POST /cash-accounts/:id/delete` — baja logica (`softDeleteCashAccount` del origen).
	 *
	 * Solo `deleted_at`: la fila persiste porque los pagos, cierres y vales la referencian. El
	 * origen escribia `new Date().toISOString()` desde el cliente; aca la hora la pone la base
	 * (`now()`), que es la unica que sabe la hora del servidor.
	 */
	async softDelete(ownerId: string, id: string): Promise<void> {
		try {
			await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.update(cashAccount)
					.set({ deletedAt: sql`now()` })
					.where(liveRowOfOwner(ownerId, id))
					.returning({ id: cashAccount.id });

				if (rows.length === 0) {
					throw cashAccountNotFound();
				}
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}
}
