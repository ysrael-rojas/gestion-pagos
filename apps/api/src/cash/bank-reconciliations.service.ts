// Conciliacion bancaria: LECTURA por Drizzle y ESCRITURA por RPC (C7 del vertical).
//
// Fuente: `lib/caja/conciliacion.ts` del proyecto de origen (`getReconciliation`,
// `saveReconciliation`, `mapRow`, `mapItemRow`) y la migracion
// `packages/db/migrations/20261028074215_spec53_bank_reconciliation.sql`. El reparto es el mismo
// que tenia el origen contra PostgREST, con una diferencia de transporte y dos de forma:
//
//   - La escritura NO es un INSERT: es `select public.save_bank_reconciliation(p_reconciliation,
//     p_items)`, `security definer` (S8), que valida el dueno y el tipo de cuenta con
//     `for update`, hace el upsert de la cabecera sobre `(cash_account_id, period_start,
//     period_end)` y REEMPLAZA las partidas (delete-then-insert) en la misma transaccion. Las dos
//     tablas son de solo lectura para el API: la migracion revoca `insert, update, delete` a
//     `authenticated` y ademas solo tienen politica de SELECT.
//   - La lectura la hace este archivo con Drizzle, porque no hay vista ni RPC de lectura (el
//     origen leia las dos tablas por PostgREST). El match es el TRIPLETE EXACTO del origen, no un
//     rango, y "no hay conciliacion para ese periodo" es `null`, no un error: es un estado normal
//     que abre un formulario en blanco.
//   - La respuesta del alta es la fila RELEIDA dentro de la misma transaccion (cabecera +
//     partidas), como el `saveReconciliation` del origen (que volvia a llamar a
//     `getReconciliation` despues del RPC), y nunca el id solo.
//
// S2 — EL DINERO LO CALCULA LA BASE. `statementBalance` y `booksBalance` los escribe el usuario y
// los persiste la RPC; este archivo no los suma, no los compara y no deriva `difference` ni
// `reconciledBalance`: ese calculo es el helper de DISPLAY de la web (`computeReconciliation`,
// tolerancia de un centimo) y NO es lo que guarda la RPC. Tampoco se "valida" nada con el antes de
// insertar. La unica aritmetica permitida es `Number(...)` en el borde JSON.
//
// S6 — EL DUENO SALE DE LA SESION. Ningun body acepta `owner_id`, y `withOwner` fija el GUC
// `app.user_id` que leen tanto las politicas RLS como `auth.uid()` dentro de la RPC. Los
// `where owner_id = ...` de las lecturas son defensa en profundidad; la garantia es la politica.
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import {
	bankReconciliation,
	bankReconciliationItem,
} from "../db/schema/bank-reconciliation.ts";
import { withOwner } from "../db/with-owner";
import { bankReconciliationNotFound, toReconciliationHttpException } from "./cash.errors.ts";
import type { BankReconciliationBody, BankReconciliationTripleQuery } from "./bank-reconciliations.query.ts";
import type {
	BankReconciliation,
	BankReconciliationItem,
	BankReconciliationItemRow,
	BankReconciliationRow,
} from "./bank-reconciliations.types.ts";

/** Las columnas de la cabecera, una sola vez para las tres lecturas. */
const HEADER_COLUMNS = {
	id: bankReconciliation.id,
	cashAccountId: bankReconciliation.cashAccountId,
	periodStart: bankReconciliation.periodStart,
	periodEnd: bankReconciliation.periodEnd,
	statementBalance: bankReconciliation.statementBalance,
	booksBalance: bankReconciliation.booksBalance,
	preparedBy: bankReconciliation.preparedBy,
	reviewedBy: bankReconciliation.reviewedBy,
	notes: bankReconciliation.notes,
	updatedAt: bankReconciliation.updatedAt,
};

/** Las columnas de una partida: el `id` lo genera la base, el resto lo escribio el usuario. */
const ITEM_COLUMNS = {
	id: bankReconciliationItem.id,
	kind: bankReconciliationItem.kind,
	description: bankReconciliationItem.description,
	amount: bankReconciliationItem.amount,
};

/** `numeric` (string exacto) -> number, solo en el borde JSON. */
function toNumber(value: string): number {
	return Number(value);
}

/** Fila de `bank_reconciliation` -> contrato de salida (sin las partidas). */
function toHeader(row: BankReconciliationRow) {
	return {
		id: row.id,
		accountId: row.cashAccountId,
		periodStart: row.periodStart,
		periodEnd: row.periodEnd,
		statementBalance: toNumber(row.statementBalance),
		booksBalance: toNumber(row.booksBalance),
		preparedBy: row.preparedBy,
		reviewedBy: row.reviewedBy,
		notes: row.notes,
		// `timestamptz` llega como `Date`: el contrato del origen lo tenia como ISO string.
		updatedAt: row.updatedAt.toISOString(),
	};
}

/** Fila de `bank_reconciliation_item` -> contrato de salida. */
function toItem(row: BankReconciliationItemRow): BankReconciliationItem {
	return {
		id: row.id,
		kind: row.kind,
		description: row.description,
		amount: toNumber(row.amount),
	};
}

/**
 * El `p_reconciliation` del RPC, con las claves snake_case que lee la funcion.
 *
 * `null` y no `undefined` para un campo ausente: `JSON.stringify` borra las claves `undefined`, y
 * la RPC distingue el caso con `is null` sobre `->>`; las dos formas llegan a NULL en `->>`, pero
 * un `null` explicito deja el payload completo en el log de la base y no depende de que el
 * serializador borre la clave.
 */
function reconciliationPayload(body: BankReconciliationBody) {
	return {
		cash_account_id: body.accountId ?? null,
		period_start: body.periodStart ?? null,
		period_end: body.periodEnd ?? null,
		statement_balance: body.statementBalance ?? null,
		books_balance: body.booksBalance ?? null,
		prepared_by: body.preparedBy ?? null,
		reviewed_by: body.reviewedBy ?? null,
		notes: body.notes ?? null,
	};
}

/**
 * El `p_items` del RPC: clase, descripcion y monto, y nada mas.
 *
 * El `id` que el formulario pudiera traer no viaja: la RPC borra y reinserta las partidas, asi que
 * el id de la fila anterior no significa nada (el origen tampoco lo mandaba).
 */
function itemPayload(body: BankReconciliationBody) {
	return body.items.map((item) => ({
		kind: item.kind,
		description: item.description ?? null,
		amount: item.amount ?? null,
	}));
}

@Injectable()
export class BankReconciliationsService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /bank-reconciliations?accountId=&periodStart=&periodEnd=` — la conciliacion del triplete.
	 *
	 * Match EXACTO, como `getReconciliation` del origen: no es una busqueda por rango y no devuelve
	 * la del periodo vecino. `null` cuando no hay ninguna (el controlador lo escribe como `null`
	 * literal).
	 */
	async find(
		ownerId: string,
		query: BankReconciliationTripleQuery,
	): Promise<BankReconciliation | null> {
		try {
			return await withOwner(this.db, ownerId, (tx) =>
				this.readWithin(
					tx,
					ownerId,
					and(
						eq(bankReconciliation.cashAccountId, query.accountId),
						eq(bankReconciliation.periodStart, query.periodStart),
						eq(bankReconciliation.periodEnd, query.periodEnd),
					) as SQL,
				),
			);
		} catch (error) {
			throw toReconciliationHttpException(error);
		}
	}

	/**
	 * `GET /bank-reconciliations/:id` — el acta con sus partidas.
	 *
	 * Un id inexistente o de otro dueno responde 404 con el mismo mensaje: la RLS de la cabecera (y
	 * la de las partidas, que la hereda del padre) ya lo hace invisible, asi que no hay forma de
	 * distinguirlos ni de devolver el acta ajena.
	 */
	async detail(ownerId: string, id: string): Promise<BankReconciliation> {
		try {
			return await withOwner(this.db, ownerId, (tx) => this.detailWithin(tx, ownerId, id));
		} catch (error) {
			throw toReconciliationHttpException(error);
		}
	}

	/**
	 * `POST /bank-reconciliations` — el acta por `save_bank_reconciliation`.
	 *
	 * Dos argumentos con nombre, los de
	 * `20261028074215_spec53_bank_reconciliation.sql:104-106`:
	 * `(p_reconciliation jsonb, p_items jsonb default '[]')`. La RPC es un UPSERT sobre
	 * `(cash_account_id, period_start, period_end)`: guardar dos veces el mismo periodo no crea una
	 * segunda fila, actualiza la cabecera y reemplaza las partidas.
	 *
	 * La respuesta se lee en la MISMA transaccion, asi que el acta no puede mostrar una cabecera y
	 * unas partidas de momentos distintos.
	 */
	async save(ownerId: string, body: BankReconciliationBody): Promise<BankReconciliation> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ id: string }>(sql`
					select public.save_bank_reconciliation(
						${JSON.stringify(reconciliationPayload(body))}::jsonb,
						${JSON.stringify(itemPayload(body))}::jsonb
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("save_bank_reconciliation no devolvio el id de la conciliacion.");
				}

				return this.detailWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toReconciliationHttpException(error);
		}
	}

	/** Lectura compartida por `detail` y `save` (una sola definicion de "el acta y sus partidas"). */
	private async detailWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<BankReconciliation> {
		const found = await this.readWithin(tx, ownerId, eq(bankReconciliation.id, id));

		if (!found) {
			throw bankReconciliationNotFound();
		}

		return found;
	}

	/**
	 * La cabecera que matchea `condition` (mas el filtro de dueno) con sus partidas, en el orden del
	 * origen (`created_at` ascendente), o `null` si no hay ninguna.
	 *
	 * Un defecto real que encontro la verificacion independiente de este slice: esto no es atomico.
	 * Son DOS sentencias bajo READ COMMITTED (el pool no fija otro nivel), asi que un guardado
	 * concurrente puede devolver el encabezado de una version y las partidas de la siguiente. No
	 * importa para el uso real — una conciliacion por periodo y por dueno, un usuario por cuenta — y
	 * arreglarlo costaria serializar tambien la lectura. El camino de ESCRITURA si es atomico, porque
	 * la RPC toma `for update` sobre la cuenta antes del upsert. Queda escrito para que nadie vuelva
	 * a decir que esta lectura es "la misma transaccion": no lo es.
	 *
	 * El join de las partidas es para poder filtrar por dueno: `bank_reconciliation_item` no tiene
	 * `owner_id` (lo hereda del padre, y su politica RLS lo resuelve con un `exists`). La politica ya
	 * deja invisible la partida ajena, asi que este `where` no cambia ninguna respuesta observable;
	 * esta porque la politica es la garantia y el filtro explicito la defensa en profundidad, y
	 * porque una query sin predicado de dueno es la que se copia a la proxima pantalla.
	 */
	private async readWithin(
		tx: Transaction,
		ownerId: string,
		condition: SQL,
	): Promise<BankReconciliation | null> {
		const rows = await tx
			.select(HEADER_COLUMNS)
			.from(bankReconciliation)
			.where(and(eq(bankReconciliation.ownerId, ownerId), condition))
			.limit(1);

		const row = rows[0];

		if (!row) {
			return null;
		}

		const items = await tx
			.select(ITEM_COLUMNS)
			.from(bankReconciliationItem)
			.innerJoin(
				bankReconciliation,
				eq(bankReconciliation.id, bankReconciliationItem.reconciliationId),
			)
			.where(
				and(
					eq(bankReconciliationItem.reconciliationId, row.id),
					eq(bankReconciliation.ownerId, ownerId),
				),
			)
			.orderBy(asc(bankReconciliationItem.createdAt));

		return { ...toHeader(row), items: items.map(toItem) };
	}
}
