// Lectura de posiciones de caja y banco (C3 del vertical de cajas-bancos).
//
// Fuente: `lib/caja/caja.ts` del proyecto de origen — `getCashPosition` (lineas 433-447),
// `listCashPositionsConsolidated` (lineas 453-476) y `listLastMovementDates` (lineas 478-500) — y
// `lib/caja/dashboard.ts` `summarizePositions`, que define que campos se consumen. Lo que cambia
// es el transporte: el origen hablaba PostgREST con la sesion de Supabase, aca es una transaccion
// con la identidad del request puesta por `withOwner` (RLS + rol `authenticated`).
//
// S2 — EL SALDO LO CALCULA LA BASE. Las tres operaciones son un `select` sobre funciones que ya
// existen; ninguna suma ni resta importes en TypeScript. La formula del dominio vive en
// `private.cash_expected_balance` (`20261027205153_spec49_fix_cash_expected_balance_coalesce.sql:1`)
// y las dos RPC de lectura la REPLICAN inline —no la llaman— con la misma aritmetica:
// `opening_balance + ingresos - egresos (status <> 'ANULADO') +- transferencias`, filtrado por
// fecha. Que la app recalcule tambien seria una tercera copia de la formula, y ademas divergiria:
// aca el corte por fecha, los anulados y las transferencias los resuelve PostgreSQL.
//
//   public.get_cash_position(p_cash_account_id uuid, p_as_of date)
//     -> numeric, `20261014215713_mark_payments_processed.sql:105` (version vigente: la de
//        `20261014165429_create_cash_transfer.sql:125` mas transferencias)
//   public.get_cash_positions(p_as_of date)
//     -> table(account_id, name, type, currency, balance), `20261015004702_add_get_cash_positions_rpc.sql:13`
//   public.list_last_movement_dates()
//     -> table(cash_account_id, last_date), `20261028162157_spec55_last_movement_dates_rpc.sql:1`
//
// S6 — EL DUENO SALE DE LA SESION. Ninguna entrada puede fijarlo: no hay `ownerId` en ningun body
// ni query, y `withOwner` fija `app.user_id` + el rol `authenticated`, asi que la RLS de
// `cash_account`, `payment` y `cash_transfer` recorta las filas ANTES de que este codigo las vea.
// Los `where owner_id = ...` y el `exists` que aparecen abajo son defensa en profundidad (la
// garantia son las politicas), igual que en `cash-accounts.service.ts`.
//
// DESVIO DELIBERADO respecto del origen (uno solo, y es el motivo de la ruta): el origen pedia
// `listCashAccounts()` y la RPC de posiciones en paralelo y las cruzaba en el cliente, con
// `balance: map.get(id) ?? 0` para una cuenta que la RPC no devolviera. Aca la union la hace SQL
// en una sola consulta y una cuenta que la RPC no devuelve simplemente NO aparece: el `?? 0` del
// origen inventaba un saldo de cero para una cuenta que la base habia excluido (por ejemplo, una
// cuenta que dejo de estar activa entre las dos llamadas).
//
// `numeric` -> number: node-postgres entrega `numeric` como string exacto (preserva los 12,2 que
// no tienen representacion binaria). La conversion a number ocurre UNA vez, en `toPosition` /
// `toBalance`, que es el borde JSON: es lo que el origen recibia ya casteado de PostgREST y lo
// que la UI formatea. No se opera con esos numeros aca.
import { Inject, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/db.provider";
import { withOwner } from "../db/with-owner";
import { cashAccountNotFound, toCashHttpException } from "./cash.errors.ts";
import type {
	CashAccountPosition,
	CashAccountPositionRow,
	LastMovementDateRow,
	LastMovementDates,
} from "./positions.types.ts";

/** Fila cruda -> contrato de salida (mismo reparto que `cash-accounts.service.ts`). */
function toPosition(row: CashAccountPositionRow): CashAccountPosition {
	return {
		accountId: row.account_id,
		name: row.name,
		type: row.type,
		currency: row.currency,
		// `numeric(12,2)` viaja como string desde el driver: se convierte en el borde JSON.
		balance: Number(row.balance),
		bankName: row.bank_name,
		closingPeriodicity: row.closing_periodicity,
		isPettyCash: row.is_petty_cash,
	};
}

@Injectable()
export class PositionsService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /cash-positions` — una fila por cuenta viva y activa del dueno, con su saldo a `asOf`.
	 *
	 * `asOf` es la fecha del corte (`p_as_of` de la RPC, que por defecto usa `current_date`). La
	 * RPC ya excluye las cuentas borradas y las inactivas y ordena por nombre; el `order by` de
	 * abajo es el mismo orden, explicito, para que no dependa de como se materialice la union.
	 */
	async list(ownerId: string, asOf: string | null): Promise<CashAccountPosition[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<CashAccountPositionRow>(sql`
					select
						p.account_id,
						p.name,
						p.type,
						p.currency,
						p.balance,
						a.bank_name,
						a.closing_periodicity,
						a.is_petty_cash
					from public.get_cash_positions(coalesce(${asOf}::date, current_date)) p
					join public.cash_account a on a.id = p.account_id
					where a.owner_id = ${ownerId}::uuid
					order by a.name
				`);

				return result.rows.map(toPosition);
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}

	/**
	 * `GET /cash-accounts/:id/position` — el saldo de UNA cuenta (`get_cash_position`).
	 *
	 * Devuelve el numero pelado porque es lo que devolvia `getCashPosition` del origen y lo que
	 * consumen las pantallas que lo llaman (el modal de cierre y el de arqueo lo muestran tal
	 * cual). `get_cash_position` devuelve NULL para una cuenta que la RLS no deja ver, pero un
	 * saldo de apertura en 0 tambien es un saldo valido, asi que la existencia de la cuenta NO se
	 * deduce del numero: la decide el `from public.cash_account` de abajo (0 filas = 404).
	 *
	 * Un id de otro dueno, inexistente o de una cuenta dada de baja responde 404 con el mismo
	 * mensaje que `GET /cash-accounts/:id`: para esta ruta esa cuenta no existe.
	 */
	async forAccount(
		ownerId: string,
		accountId: string,
		asOf: string | null,
	): Promise<number> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ balance: string }>(sql`
					select public.get_cash_position(
						a.id,
						coalesce(${asOf}::date, current_date)
					)::text as balance
					from public.cash_account a
					where a.id = ${accountId}::uuid
						and a.owner_id = ${ownerId}::uuid
						and a.deleted_at is null
				`);

				const row = result.rows[0];

				if (!row) {
					throw cashAccountNotFound();
				}

				return Number(row.balance);
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}

	/**
	 * `GET /last-movement-dates` — ultimo recibo NO anulado por cuenta
	 * (`list_last_movement_dates`, SPEC 55).
	 *
	 * Mapa y no lista porque el consumidor es un lookup por cuenta
	 * (`cuentas-view.tsx:268`, `lastMovements[account.id] ?? null`). Una cuenta sin movimientos no
	 * aparece; el origen filtraba las filas sin `last_date` en el cliente y aca lo hace el `where`.
	 *
	 * `last_date::text` evita que node-postgres convierta el `date` a `Date` y el dia se corra de
	 * zona horaria al serializar: la UI compara y muestra "YYYY-MM-DD".
	 */
	async lastMovementDates(ownerId: string): Promise<LastMovementDates> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<LastMovementDateRow>(sql`
					select t.cash_account_id, t.last_date::text as last_date
					from public.list_last_movement_dates() t
					where t.last_date is not null
						and exists (
							select 1
							from public.cash_account a
							where a.id = t.cash_account_id
								and a.owner_id = ${ownerId}::uuid
						)
				`);

				const dates: LastMovementDates = {};

				for (const row of result.rows) {
					dates[row.cash_account_id] = row.last_date;
				}

				return dates;
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}
}
