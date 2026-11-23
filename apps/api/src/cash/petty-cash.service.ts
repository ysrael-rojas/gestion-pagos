// Vales de caja chica (C6 del vertical de cajas-bancos).
//
// Fuente: `lib/caja/caja-chica.ts` del proyecto de origen (`listVales`, `getVale`, `createVale`,
// `anularVale`, `replenishPettyCash`). Las cinco operaciones son las mismas; lo que cambia es el
// transporte: el origen hablaba PostgREST con la sesion de Supabase, aca es una transaccion con la
// identidad del request puesta por `withOwner` (RLS + rol `authenticated`).
//
//   GET  /petty-cash/vales?accountId&status   `select` sobre `petty_cash_vale`, por serial
//   GET  /petty-cash/vales/:id                `select` por id
//   POST /petty-cash/vales                    `select public.create_petty_cash_vale(...)` (7 args)
//   POST /petty-cash/vales/:id/void           `select public.void_petty_cash_vale(...)` (1 arg)
//   POST /petty-cash/replenish                `select public.replenish_petty_cash(...)` (3 args)
//
// S5 — LA SECUENCIA Y LAS TRANSICIONES LAS DECIDE LA BASE. `serial` sale de
// `max(serial) + 1` con la fila de `cash_account` bloqueada (`for update`), asi que dos vales
// concurrentes de la misma cuenta se serializan; el `unique (account_id, serial)` es la red por
// si alguna vez cambiara la forma del candado. Este archivo NUNCA lee el maximo ni propone un
// numero, y tampoco escribe `status`: PENDIENTE -> REPUESTO lo hace `replenish_petty_cash` y
// PENDIENTE -> ANULADO lo hace `void_petty_cash_vale`.
//
// S8 — EL DINERO CIRCULA POR EL CAMINO QUE YA EXISTE. `create_petty_cash_vale` inserta el recibo
// de egreso en `public.payment` (SPEC 49, con `is_cash_movement = true` desde SPEC 50) y lo deja
// en `petty_cash_vale.payment_id`; `void_petty_cash_vale` anula ese recibo con su motivo y fecha.
// El API no toca `payment` ni `petty_cash_vale`: las tres escrituras son RPC `security definer`
// sobre tablas que solo tienen politica de SELECT (un INSERT directo muere con `42501`, lo pina
// el e2e).
//
// S2 — AQUI NO SE CALCULA NADA. Ni el total de los vales a reponer (lo suma `replenish_petty_cash`
// con `numeric(12,2)`, y ese total es el monto de la transferencia) ni el estado resultante (se
// RELEE despues del RPC). La unica aritmetica permitida es `Number(...)` en el borde JSON.
//
// S6 — EL DUENO SALE DE LA SESION. Ningun body acepta `owner_id` y `withOwner` fija el GUC
// `app.user_id` que leen tanto la RLS como `auth.uid()` dentro de las RPC. Los `where owner_id` de
// las lecturas son defensa en profundidad; la garantia es la politica.
import { Inject, Injectable } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { pettyCashVale } from "../db/schema/petty-cash-vale.ts";
import { withOwner } from "../db/with-owner";
import { pettyCashValeNotFound, toCashMovementHttpException } from "./cash.errors.ts";
import type {
	PettyCashReplenishBody,
	PettyCashValeBody,
	PettyCashValeListQuery,
} from "./petty-cash.query.ts";
import type {
	PettyCashReplenishResult,
	PettyCashValeRecord,
	PettyCashValeRow,
	PettyCashValeVoidResult,
} from "./petty-cash.types.ts";

/**
 * Las columnas de `PettyCashValeRecord`, una sola vez para las cuatro lecturas.
 *
 * No estan `owner_id` (el dueno no viaja al cliente: lo recorta la RLS) ni el total de pendientes.
 */
const VALE_COLUMNS = {
	id: pettyCashVale.id,
	accountId: pettyCashVale.accountId,
	serial: pettyCashVale.serial,
	valeDate: pettyCashVale.valeDate,
	paidTo: pettyCashVale.paidTo,
	concept: pettyCashVale.concept,
	amount: pettyCashVale.amount,
	hasReceipt: pettyCashVale.hasReceipt,
	status: pettyCashVale.status,
	paymentId: pettyCashVale.paymentId,
	createdAt: pettyCashVale.createdAt,
};

/** Fila cruda -> contrato de salida (mismo reparto que `closes.service.ts`). */
function toPettyCashValeRecord(row: PettyCashValeRow): PettyCashValeRecord {
	return {
		id: row.id,
		accountId: row.accountId,
		// El correlativo lo asigno la RPC (S5): se transporta, no se calcula.
		serial: row.serial,
		// `date` viaja como "YYYY-MM-DD" sin conversion, para no mover el dia por zona horaria.
		valeDate: row.valeDate,
		paidTo: row.paidTo,
		concept: row.concept,
		// `numeric(12,2)` llega como string exacto del driver: se convierte en el borde JSON.
		amount: Number(row.amount),
		hasReceipt: row.hasReceipt,
		// El estado lo escribio la base; el API no lo deriva ni lo propone.
		status: row.status,
		paymentId: row.paymentId,
		createdAt: row.createdAt.toISOString(),
	};
}

@Injectable()
export class PettyCashService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /petty-cash/vales` — los vales de una caja chica, por correlativo ascendente.
	 *
	 * El orden es el del origen (`order("serial", { ascending: true })`), que es el orden en que el
	 * custodio archiva los vales fisicos. `status` es el filtro de la tabla; una caja de otro dueno
	 * devuelve `[]` porque la RLS ya la hace invisible (no hay 403: no se puede distinguir "no
	 * existe" de "no es tuya").
	 */
	async list(ownerId: string, query: PettyCashValeListQuery): Promise<PettyCashValeRecord[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select(VALE_COLUMNS)
					.from(pettyCashVale)
					.where(
						and(
							eq(pettyCashVale.ownerId, ownerId),
							eq(pettyCashVale.accountId, query.accountId),
							query.status === undefined
								? undefined
								: eq(pettyCashVale.status, query.status),
						),
					)
					.orderBy(asc(pettyCashVale.serial));

				return rows.map(toPettyCashValeRecord);
			});
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/**
	 * `GET /petty-cash/vales/:id` — un vale del dueno.
	 *
	 * Un id inexistente o de otro dueno responde 404 con el mismo mensaje: la RLS de
	 * `petty_cash_vale` ya lo hace invisible.
	 */
	async detail(ownerId: string, id: string): Promise<PettyCashValeRecord> {
		try {
			return await withOwner(this.db, ownerId, (tx) => this.valeWithin(tx, ownerId, id));
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/**
	 * `POST /petty-cash/vales` — el vale, por `create_petty_cash_vale` (7 argumentos).
	 *
	 * Los argumentos son los de `20261027213455_spec50_payment_cash_movement.sql:74-82`, en ese
	 * orden exacto: (cuenta, fecha del vale, pagado a, concepto, monto, tiene comprobante,
	 * categoria del gasto). La RPC valida la caja chica, el limite por gasto, el texto obligatorio,
	 * la categoria EGRESO de la cuenta y el metodo de pago EFECTIVO, asigna el `serial` bajo el
	 * bloqueo de la cuenta y crea el recibo de egreso (S5/S8).
	 *
	 * La respuesta es la fila RELEIDA en la misma transaccion: el `serial`, el `status` y el
	 * `paymentId` son de la base, no del body.
	 */
	async create(ownerId: string, body: PettyCashValeBody): Promise<PettyCashValeRecord> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ id: string }>(sql`
					select public.create_petty_cash_vale(
						${body.accountId}::uuid,
						${body.valeDate}::date,
						${body.paidTo}::varchar,
						${body.concept}::varchar,
						${body.amount}::numeric,
						${body.hasReceipt}::boolean,
						${body.categoryId}::uuid
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("create_petty_cash_vale no devolvio el id del vale.");
				}

				return this.valeWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/**
	 * `POST /petty-cash/vales/:id/void` — anula un vale PENDIENTE (`void_petty_cash_vale`).
	 *
	 * La RPC es la que decide: un vale que no es PENDIENTE (o que no es del dueno) se rechaza con
	 * su mensaje, y el recibo de egreso asociado queda ANULADO con el motivo y la fecha. La
	 * respuesta es `{ id, status }` con el estado RELEIDO, para no contestar un ANULADO que la base
	 * no escribio.
	 */
	async voidVale(ownerId: string, id: string): Promise<PettyCashValeVoidResult> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				await tx.execute(sql`select public.void_petty_cash_vale(${id}::uuid)`);

				const row = await this.valeWithin(tx, ownerId, id);

				return { id: row.id, status: row.status };
			});
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/**
	 * `POST /petty-cash/replenish` — repone el fondo (`replenish_petty_cash`, 3 argumentos).
	 *
	 * Argumentos de `20261014194051_create_cash_denomination_and_petty_cash.sql:379-383`, en ese
	 * orden: (caja chica, cuenta de origen, vales elegidos). La RPC valida que los vales sean de
	 * esa caja y esten PENDIENTES, suma el total, crea la transferencia de reposicion con
	 * `create_cash_transfer` (por eso hereda sus reglas: cuentas distintas, PEN, periodo abierto) y
	 * marca los vales como REPUESTOS; devuelve el id de la TRANSFERENCIA, no el de un vale.
	 *
	 * La lista de vales se RELEE despues del RPC —mismo transaccion— porque el `status` que viaja
	 * tiene que ser el que la base acaba de escribir.
	 */
	async replenish(
		ownerId: string,
		body: PettyCashReplenishBody,
	): Promise<PettyCashReplenishResult> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				// `sql.param` y no `${body.valeIds}`: drizzle expande un array suelto como una TUPLA
				// `($1, $2)`, y aca hace falta UN parametro de tipo `uuid[]` (lo que node-postgres
				// serializa como `{...}`).
				const result = await tx.execute<{ transfer_id: string }>(sql`
					select public.replenish_petty_cash(
						${body.accountId}::uuid,
						${body.sourceAccountId}::uuid,
						${sql.param(body.valeIds)}::uuid[]
					) as transfer_id
				`);

				const transferId = result.rows[0]?.transfer_id;

				if (!transferId) {
					throw new Error("replenish_petty_cash no devolvio el id de la transferencia.");
				}

				const rows = await tx
					.select(VALE_COLUMNS)
					.from(pettyCashVale)
					.where(
						and(
							eq(pettyCashVale.ownerId, ownerId),
							inArray(pettyCashVale.id, body.valeIds),
						),
					)
					.orderBy(asc(pettyCashVale.serial));

				return { transferId, vales: rows.map(toPettyCashValeRecord) };
			});
		} catch (error) {
			throw toCashMovementHttpException(error);
		}
	}

	/** Lectura compartida por `detail`, `create` y `void` (una sola definicion de "el vale"). */
	private async valeWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<PettyCashValeRecord> {
		const rows = await tx
			.select(VALE_COLUMNS)
			.from(pettyCashVale)
			.where(and(eq(pettyCashVale.id, id), eq(pettyCashVale.ownerId, ownerId)))
			.limit(1);

		const row = rows[0];

		if (!row) {
			throw pettyCashValeNotFound();
		}

		return toPettyCashValeRecord(row);
	}
}
