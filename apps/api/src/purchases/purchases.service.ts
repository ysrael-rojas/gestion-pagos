// Servicio del vertical de compras (T3): alta, edicion, listado y detalle de comprobantes de COMPRA.
// S6, S8 y S10 de `odd/tasks/port-vertical-compras.md`.
//
// Las cuatro decisiones que no son de estilo, y en que se diferencian de `vouchers.service.ts`:
//
// 1. LAS ESCRITURAS VAN POR RPC, NO POR DML (S3). `authenticated` no tiene UPDATE ni DELETE sobre
//    `comprobante` (`20261124090000_revoke_payments_writes.sql`), asi que el alta y la edicion son
//    `crear_compra` / `editar_compra` (`20261128090000_compras_rpcs.sql`), `security definer`,
//    llamadas con `withOwner` (fija `app.user_id` y cambia el rol a `authenticated` antes del
//    `select`). Es el mismo camino que ventas, series y notas.
//
// 2. EL NUMERO ES UN DATO DEL CLIENTE (S2/L3a): viaja en el body, la RPC lo recibe como
//    `p_voucher_number` y la edicion lo REESCRIBE. Es la diferencia deliberada con la venta, donde
//    lo asigna la base desde la serie por defecto y es inmutable. El limite no lo pone este
//    servicio: lo pone `comprobante_protect_paid`, que con pagos congela numero, tipo, importe,
//    proveedor y fecha (y su P0001 llega al cliente con su texto).
//
// 3. LOS MONTOS NO SE CALCULAN ACA (S5): salen de `saleAmounts` de `packages/shared`, la unica
//    formula del 18 % con redondeo a 2 decimales. El servicio la usa y manda `subtotal` e `igv` a la
//    RPC, que los guarda sin recalcular (recalcular en PL/pgSQL seria una segunda formula).
//
// 4. EL SALDO ES UNA LECTURA APARTE (S6). El detalle lee `public.comprobante` y despues
//    `public.voucher_balance`, igual que el origen y que el detalle de una venta, porque las dos
//    consultas pueden fallar por motivos distintos y el usuario tiene dos mensajes distintos.
//
// `voucher_kind` NO viaja en el body y tampoco se lee del payload: la RPC escribe `'COMPRA'` por
// construccion y nunca lo cambia. `status` NO se escribe (lo deriva la tabla y lo recalcula
// `private.refresh_comprobante_status`); el body lo trae porque es parte del contrato del formulario
// y se ignora a proposito. `due_date` tampoco se escribe: es una columna generada y la calcula la
// base. `registrationDate` la pone el default de la tabla.
//
// FUERA DE ALCANCE, decidido y escrito: no hay serie para compras (el numero lo puso el proveedor,
// S2) y no hay notas recibidas sobre una compra en este slice (L3e). La retencion del IGV tampoco se
// modela (S6): el total es el del comprobante del proveedor.
import { Inject, Injectable } from "@nestjs/common";
import type {
	PaymentType,
	VoucherStatus,
	VoucherType,
} from "@gestion/shared/components/comprobantes/types.ts";
import { BASE_VOUCHER_TYPES } from "@gestion/shared/lib/data/sale-options.ts";
import { saleAmounts } from "@gestion/shared/lib/ventas/montos.ts";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { comprobante, entidad, voucherBalance } from "../db/schema";
import { withOwner } from "../db/with-owner";
import {
	toPurchaseHttpException,
	voucherBalanceFailure,
	voucherNotFound,
} from "./purchases.errors.ts";
import type { PurchaseBody } from "./purchases.query.ts";
import type { PurchaseDetail, PurchaseListItem } from "./purchases.types.ts";

/**
 * Tipos base de comprobante, de `@gestion/shared`: este slice solo registra FACTURA, BOLETA y
 * NOTA_VENTA (la RPC acota lo mismo). Las notas de credito/debito y la retencion ajustan a un
 * comprobante base y `voucher_balance` solo expone los tipos base, asi que una nota en el listado
 * seria una fila sin saldo en el detalle.
 */
const PURCHASE_VOUCHER_TYPES: VoucherType[] = BASE_VOUCHER_TYPES;

/** Fila de `comprobante` join `entidad`, tal como la devuelve Drizzle (`numeric` como string). */
interface PurchaseRow {
	id: string;
	entityId: string;
	entityName: string;
	voucherType: VoucherType;
	voucherNumber: string;
	issueDate: string;
	registrationDate: string;
	subtotal: string;
	igv: string;
	total: string;
	paymentType: PaymentType;
	creditDays: number | null;
	dueDate: string | null;
	status: VoucherStatus;
}

/** Las columnas de `PurchaseRow`, una sola vez para las lecturas de detalle. */
const PURCHASE_COLUMNS = {
	id: comprobante.id,
	entityId: comprobante.entityId,
	entityName: entidad.name,
	voucherType: comprobante.voucherType,
	voucherNumber: comprobante.voucherNumber,
	issueDate: comprobante.issueDate,
	registrationDate: comprobante.registrationDate,
	subtotal: comprobante.subtotal,
	igv: comprobante.igv,
	total: comprobante.total,
	paymentType: comprobante.paymentType,
	creditDays: comprobante.creditDays,
	dueDate: comprobante.dueDate,
	status: comprobante.status,
};

/** `numeric` (string exacto del driver) -> number, solo en el borde JSON. */
function toAmount(value: string): number {
	return Number(value);
}

/** Fila -> contrato de salida, sin el saldo (que viene de la vista). */
function toPurchaseRecord(row: PurchaseRow): Omit<PurchaseDetail, "paidAmount" | "balance"> {
	return {
		id: row.id,
		entityId: row.entityId,
		entityName: row.entityName,
		voucherType: row.voucherType,
		voucherNumber: row.voucherNumber,
		issueDate: row.issueDate,
		registrationDate: row.registrationDate,
		subtotal: toAmount(row.subtotal),
		igv: toAmount(row.igv),
		total: toAmount(row.total),
		paymentType: row.paymentType,
		creditDays: row.creditDays,
		dueDate: row.dueDate,
		status: row.status,
	};
}

@Injectable()
export class PurchasesService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /purchases` — las compras del dueno, de la emision mas reciente a la mas vieja.
	 *
	 * Los filtros de la pantalla (Desde/Hasta/Estado pago y la busqueda) se aplican en el cliente,
	 * igual que en el resto de los listados portados (S10), asi que la query no los recibe. El orden
	 * desempata por `created_at` para que dos comprobantes del mismo dia no salgan en orden arbitrario
	 * entre requests.
	 */
	async list(ownerId: string): Promise<PurchaseListItem[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select({
						id: comprobante.id,
						entityId: comprobante.entityId,
						entityName: entidad.name,
						issueDate: comprobante.issueDate,
						voucherType: comprobante.voucherType,
						voucherNumber: comprobante.voucherNumber,
						total: comprobante.total,
						paymentType: comprobante.paymentType,
						dueDate: comprobante.dueDate,
						status: comprobante.status,
					})
					.from(comprobante)
					.innerJoin(entidad, eq(entidad.id, comprobante.entityId))
					.where(and(eq(comprobante.ownerId, ownerId), ...PURCHASE_FILTER))
					.orderBy(desc(comprobante.issueDate), desc(comprobante.createdAt));

				return rows.map((row) => ({
					id: row.id,
					entityId: row.entityId,
					entityName: row.entityName,
					issueDate: row.issueDate,
					voucherType: row.voucherType,
					voucherNumber: row.voucherNumber,
					total: toAmount(row.total),
					paymentType: row.paymentType,
					dueDate: row.dueDate,
					status: row.status,
				}));
			});
		} catch (error) {
			throw toPurchaseHttpException(error);
		}
	}

	/**
	 * `GET /purchases/:id` — la compra con su saldo por pagar.
	 *
	 * Un id inexistente, de otro dueno o de una venta responde 404 con el mismo texto: la RLS ya hace
	 * invisibles las filas ajenas y la RPC usa el mismo mensaje para las tres ramas (S8).
	 */
	async detail(ownerId: string, id: string): Promise<PurchaseDetail> {
		try {
			return await withOwner(this.db, ownerId, (tx) => this.detailWithin(tx, ownerId, id));
		} catch (error) {
			throw toPurchaseHttpException(error);
		}
	}

	/**
	 * `POST /purchases` — alta por `crear_compra` (9 argumentos posicionales, S3).
	 *
	 * Argumentos de `20261128090000_compras_rpcs.sql`, en ese orden: (entidad, tipo, NUMERO, fecha de
	 * emision, subtotal, igv, total, tipo de pago, dias de credito). El `owner_id` y el
	 * `voucher_kind = 'COMPRA'` los pone la RPC: no viajan en el body. El numero SI viaja: es el del
	 * comprobante que emitio el proveedor (S2) y la respuesta devuelve el que quedo escrito, ya
	 * recortado por la base.
	 *
	 * `creditDays` llega ya normalizado por el contrato compartido (null en CONTADO), asi que el CHECK
	 * `comprobante_credit_days` no se viola por un valor viejo del formulario.
	 */
	async create(ownerId: string, body: PurchaseBody): Promise<PurchaseDetail> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const { subtotal, igv } = saleAmounts(body.total);
				const result = await tx.execute<{ id: string }>(sql`
					select public.crear_compra(
						${body.entityId}::uuid,
						${body.voucherType}::public.voucher_type,
						${body.voucherNumber}::text,
						${body.issueDate}::date,
						${subtotal}::numeric,
						${igv}::numeric,
						${body.total}::numeric,
						${body.paymentType}::public.payment_type,
						${body.creditDays}::integer
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("crear_compra no devolvio el id del comprobante.");
				}

				// El detalle se lee en la MISMA transaccion: la respuesta muestra exactamente la fila
				// que quedo escrita (con el vencimiento que calculo la base) y no una lectura posterior
				// que podria ver otra cosa.
				return this.detailWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toPurchaseHttpException(error);
		}
	}

	/**
	 * `PATCH /purchases/:id` — edicion por `editar_compra` (10 argumentos: el id primero, S3).
	 *
	 * El dueno sale de la FILA (la RPC la bloquea con `for update` y la compara con `auth.uid()`), no
	 * del payload. El numero y el tipo se REESCRIBEN (son datos del documento del proveedor, L3a/L3g),
	 * y el `voucher_kind` no se toca nunca. Si la compra tiene pagos, el trigger
	 * `comprobante_protect_paid` responde su mensaje y la RPC lo re-lanza sin tocar: este servicio no
	 * lo puede saltar (S8).
	 */
	async edit(ownerId: string, id: string, body: PurchaseBody): Promise<PurchaseDetail> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const { subtotal, igv } = saleAmounts(body.total);
				const result = await tx.execute<{ id: string }>(sql`
					select public.editar_compra(
						${id}::uuid,
						${body.entityId}::uuid,
						${body.voucherType}::public.voucher_type,
						${body.voucherNumber}::text,
						${body.issueDate}::date,
						${subtotal}::numeric,
						${igv}::numeric,
						${body.total}::numeric,
						${body.paymentType}::public.payment_type,
						${body.creditDays}::integer
					) as id
				`);

				const written = result.rows[0]?.id;

				if (!written) {
					throw new Error("editar_compra no devolvio el id del comprobante.");
				}

				return this.detailWithin(tx, ownerId, written);
			});
		} catch (error) {
			throw toPurchaseHttpException(error);
		}
	}

	/** Lectura compartida por `detail`, `create` y `edit`: la compra y su saldo. */
	private async detailWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<PurchaseDetail> {
		const [row] = await tx
			.select(PURCHASE_COLUMNS)
			.from(comprobante)
			.innerJoin(entidad, eq(entidad.id, comprobante.entityId))
			.where(and(eq(comprobante.id, id), eq(comprobante.ownerId, ownerId), ...PURCHASE_FILTER))
			.limit(1);

		if (!row) {
			throw voucherNotFound();
		}

		// El `where owner_id` de arriba es defensa en profundidad; la garantia es la politica RLS.
		const balance = await this.balanceWithin(tx, id);

		return { ...toPurchaseRecord(row), ...balance };
	}

	/**
	 * Saldo POR PAGAR desde `public.voucher_balance` (vista `security_invoker`: la RLS de
	 * `comprobante` / `payment_allocation` / `payment` la filtra).
	 *
	 * La vista ya resta los pagos no anulados, sin importar si son INGRESO o EGRESO: para una COMPRA
	 * el saldo es lo que falta pagar (S6). Su falla tiene mensaje PROPIO
	 * (`No se pudo cargar el saldo de los comprobantes.`): el cliente tiene que saber que lo que no se
	 * pudo leer es el saldo y no el comprobante.
	 */
	private async balanceWithin(
		tx: Transaction,
		id: string,
	): Promise<{ paidAmount: number; balance: number }> {
		try {
			const [row] = await tx
				.select({
					paidAmount: voucherBalance.paidAmount,
					balance: voucherBalance.balance,
				})
				.from(voucherBalance)
				.where(eq(voucherBalance.comprobanteId, id))
				.limit(1);

			if (!row) {
				// La vista solo expone comprobantes base vivos: si la fila no esta, la lectura no
				// devolvio lo que el detalle necesita, y eso es el mensaje del saldo, no un 404 (el
				// comprobante si existe: se acaba de leer).
				throw new Error("voucher_balance no devolvio el saldo del comprobante.");
			}

			return {
				paidAmount: toAmount(row.paidAmount ?? "0"),
				balance: toAmount(row.balance ?? "0"),
			};
		} catch (error) {
			throw voucherBalanceFailure(error);
		}
	}
}

/**
 * El filtro que define "una compra registrada por el vertical" (S1): viva, de tipo COMPRA y de un
 * tipo base.
 *
 * Se aplica a las tres lecturas y a ningun listado de otro vertical. `voucher_kind` es lo que
 * separa compras de ventas, y es la razon por la que una VENTA con el mismo numero no aparece aca ni
 * bloquea el alta de la compra (S2: la unicidad es por `(owner_id, voucher_kind, voucher_number)`).
 */
const PURCHASE_FILTER = [
	eq(comprobante.voucherKind, "COMPRA"),
	inArray(comprobante.voucherType, PURCHASE_VOUCHER_TYPES),
	isNull(comprobante.deletedAt),
] as const;
