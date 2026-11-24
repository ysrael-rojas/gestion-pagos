// Servicio del vertical de ventas, slice 1: comprobantes de VENTA (alta, edicion, listado y
// detalle). T3 del port (`odd/tasks/port-vertical-ventas.md`), S5/S6/S9.
//
// Tres decisiones que no son de estilo:
//
// 1. LAS ESCRITURAS VAN POR RPC, NO POR DML (S8). `authenticated` no tiene UPDATE ni DELETE sobre
//    `comprobante` ni sobre `voucher_series` (`20261124090000_revoke_payments_writes.sql`), y el
//    avance del correlativo tiene que pasar en la MISMA transaccion que el comprobante. Por eso
//    `crear_venta` / `editar_venta` (`20261124120000_ventas_rpcs.sql`), `security definer`, se
//    llaman con `withOwner`, que fija `app.user_id` y cambia el rol a `authenticated` antes del
//    `select`. Es el mismo camino que `cash/closes.service.ts`.
//
// 2. LOS MONTOS NO SE CALCULAN ACA (S2): salen de `saleAmounts` de `packages/shared`, que es la
//    unica formula del 18 % con redondeo a 2 decimales. El servicio la usa y manda `subtotal` e
//    `igv` a la RPC, que los guarda sin recalcular (recalcular en PL/pgSQL seria una segunda
//    formula de la misma regla).
//
// 3. EL SALDO ES UNA LECTURA APARTE (S6). El detalle lee `public.comprobante` y despues
//    `public.voucher_balance`, igual que el origen, porque las dos consultas pueden fallar por
//    motivos distintos y el usuario tiene dos mensajes distintos. Fundirlas borraria esa
//    distincion y el sintoma pasaria a ser el generico "No se pudo completar la operación...".
//
// `status` NO se escribe: lo deriva la tabla (`default 'PENDIENTE'`) y lo recalcula
// `private.refresh_comprobante_status` al asignar o anular pagos. El body lo trae porque es parte
// de `voucherFormSchema`, y se ignora a proposito (L8 del doc de la feature). `due_date` tampoco se
// escribe: es una columna generada (`issue_date + credit_days`) y la base la calcula sola (S9).
//
// FUERA DE ALCANCE, decidido y escrito (S5): la regla "FACTURA exige cliente con RUC" NO se valida
// aca. No esta en `voucherFormSchema` ni en la base, es una regla de PANTALLA del origen, y
// validarla en el API romperia la edicion de comprobantes historicos emitidos antes de esa regla
// (y el formulario es compartido con compras). Queda como validacion de UI en T4, con los mensajes
// de S5. Si alguna vez se quiere como invariante de datos, va a la base, no a este servicio.
import { Inject, Injectable } from "@nestjs/common";
import type {
	PaymentType,
	VoucherStatus,
	VoucherType,
} from "@gestion/shared/components/comprobantes/types.ts";
// El subpath necesita la extension: el `exports` de `@gestion/shared` mapea `./*` -> `./src/*` y
// ni esbuild ni el runner de Node agregan `.ts` al resolver (misma razon que en `apps/web`).
import { BASE_VOUCHER_TYPES } from "@gestion/shared/lib/data/sale-options.ts";
import { saleAmounts } from "@gestion/shared/lib/ventas/montos.ts";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { entidad, voucherBalance } from "../db/schema";
import { withOwner } from "../db/with-owner";
import { comprobante } from "./comprobante.table.ts";
import {
	toVoucherHttpException,
	voucherBalanceFailure,
	voucherNotFound,
} from "./vouchers.errors.ts";
import type { VoucherBody } from "./vouchers.query.ts";
import type { VoucherDetail, VoucherListItem } from "./vouchers.types.ts";

/**
 * Tipos base de comprobante, de `@gestion/shared`: el slice 1 solo registra FACTURA, BOLETA y
 * NOTA_VENTA. Las notas de credito/debito y la retencion ajustan a un comprobante base y son del
 * slice 2 (S1); ademas `voucher_balance` solo expone los tipos base, asi que una nota en el listado
 * seria una fila sin saldo en el detalle.
 */
const SALE_VOUCHER_TYPES: VoucherType[] = BASE_VOUCHER_TYPES;

/** Fila de `comprobante` join `entidad`, tal como la devuelve Drizzle (`numeric` como string). */
interface VoucherRow {
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
	createdAt: Date;
}

/** Las columnas de `VoucherRow`, una sola vez para las tres lecturas. */
const VOUCHER_COLUMNS = {
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
	createdAt: comprobante.createdAt,
};

/** `numeric` (string exacto del driver) -> number, solo en el borde JSON. */
function toAmount(value: string): number {
	return Number(value);
}

/** Fila -> contrato de salida, sin el saldo (que viene de la vista). */
function toVoucherRecord(row: VoucherRow): Omit<VoucherDetail, "paidAmount" | "balance"> {
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
export class VouchersService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /vouchers` — las ventas del dueno, de la emision mas reciente a la mas vieja.
	 *
	 * Los filtros de la pantalla (Desde/Hasta/Estado pago y la busqueda) se aplican en el cliente,
	 * igual que en el resto de los listados portados (S10), asi que la query no los recibe. El orden
	 * desempata por `created_at` para que dos comprobantes del mismo dia no salgan en orden
	 * arbitrario entre requests.
	 */
	async list(ownerId: string): Promise<VoucherListItem[]> {
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
					.where(and(eq(comprobante.ownerId, ownerId), ...VOUCHER_FILTER))
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
			throw toVoucherHttpException(error);
		}
	}

	/**
	 * `GET /vouchers/:id` — el comprobante con su saldo.
	 *
	 * Un id inexistente, de otro dueno o de una compra responde 404 con el mismo texto: la RLS ya
	 * hace invisibles las filas ajenas y la RPC usa el mismo mensaje para las tres ramas (L10).
	 */
	async detail(ownerId: string, id: string): Promise<VoucherDetail> {
		try {
			return await withOwner(this.db, ownerId, (tx) => this.detailWithin(tx, ownerId, id));
		} catch (error) {
			throw toVoucherHttpException(error);
		}
	}

	/**
	 * `POST /vouchers` — alta por `crear_venta` (9 argumentos posicionales, S8).
	 *
	 * Argumentos de `20261124120000_ventas_rpcs.sql`, en ese orden: (entidad, tipo, numero, fecha de
	 * emision, subtotal, igv, total, tipo de pago, dias de credito). El `owner_id` y el
	 * `voucher_kind = 'VENTA'` los pone la RPC: no viajan en el body.
	 *
	 * `creditDays` llega ya normalizado por `voucherFormSchema` (null en CONTADO, S3), asi que el
	 * CHECK `comprobante_credit_days` no se viola por un valor viejo del formulario.
	 */
	async create(ownerId: string, body: VoucherBody): Promise<VoucherDetail> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const { subtotal, igv } = saleAmounts(body.total);
				const result = await tx.execute<{ id: string }>(sql`
					select public.crear_venta(
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
					throw new Error("crear_venta no devolvio el id del comprobante.");
				}

				// El detalle se lee en la MISMA transaccion: la respuesta muestra exactamente la fila
				// que quedo escrita (con el vencimiento que calculo la base) y no una lectura posterior
				// que podria ver otra cosa.
				return this.detailWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toVoucherHttpException(error);
		}
	}

	/**
	 * `PATCH /vouchers/:id` — edicion por `editar_venta` (10 argumentos: el id primero, S8).
	 *
	 * El dueno sale de la FILA (la RPC la bloquea con `for update` y la compara con `auth.uid()`),
	 * no del payload. Si el comprobante tiene pagos, el trigger `comprobante_protect_paid` responde
	 * su mensaje y la RPC lo re-lanza sin tocar: este servicio no lo puede saltar (S6).
	 */
	async edit(ownerId: string, id: string, body: VoucherBody): Promise<VoucherDetail> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const { subtotal, igv } = saleAmounts(body.total);
				const result = await tx.execute<{ id: string }>(sql`
					select public.editar_venta(
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
					throw new Error("editar_venta no devolvio el id del comprobante.");
				}

				return this.detailWithin(tx, ownerId, written);
			});
		} catch (error) {
			throw toVoucherHttpException(error);
		}
	}

	/** Lectura compartida por `detail`, `create` y `edit`: el comprobante y su saldo. */
	private async detailWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<VoucherDetail> {
		const [row] = await tx
			.select(VOUCHER_COLUMNS)
			.from(comprobante)
			.innerJoin(entidad, eq(entidad.id, comprobante.entityId))
			.where(and(eq(comprobante.id, id), eq(comprobante.ownerId, ownerId), ...VOUCHER_FILTER))
			.limit(1);

		if (!row) {
			throw voucherNotFound();
		}

		// El `where owner_id` de arriba es defensa en profundidad; la garantia es la politica RLS.
		const balance = await this.balanceWithin(tx, id);

		return { ...toVoucherRecord(row), ...balance };
	}

	/**
	 * Saldo del comprobante desde `public.voucher_balance` (vista `security_invoker`: la RLS de
	 * `comprobante` / `payment_allocation` / `payment` la filtra).
	 *
	 * Su falla tiene mensaje PROPIO (`No se pudo cargar el saldo de los comprobantes.`, S6): el
	 * cliente tiene que saber que lo que no se pudo leer es el saldo y no el comprobante.
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
 * El filtro que define "una venta registrada por el vertical" (S1): viva, de tipo VENTA y de un
 * tipo base. Se aplica a las tres lecturas y a ningun listado de otro vertical.
 */
const VOUCHER_FILTER = [
	eq(comprobante.voucherKind, "VENTA"),
	inArray(comprobante.voucherType, SALE_VOUCHER_TYPES),
	isNull(comprobante.deletedAt),
] as const;
