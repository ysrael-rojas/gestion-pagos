// Servicio del vertical de pagos: todas las lecturas y escrituras del origen, sobre las tablas
// base (`payment`, `payment_allocation`) y las dos vistas `security_invoker`
// (`voucher_balance`, `payment_balance`).
//
// Contrato de acceso a datos (S2): CADA metodo abre su transaccion con `withOwner`, que fija
// `app.user_id` desde la sesion y cambia el rol a `authenticated`. El `where owner_id = ...` que
// aparece en algunas queries es defensa en profundidad; la garantia la da la RLS, y las vistas
// `security_invoker` se evaluan con esos privilegios. El `owner_id` no llega nunca por HTTP.
//
// Las escrituras van por las funciones PL/pgSQL del esquema portado donde el origen las usa
// (`create_payment_with_allocations`, `mark_payments_processed`): son `SECURITY DEFINER` y
// validan pertenencia, saldo y periodo cerrado. Anular y asignar van por DML directo, igual que
// en el origen, con la matriz de privilegios de columna que dejo el hardening del historial.
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PaymentFormValues } from "@gestion/shared";
import { and, desc, eq, gt, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { payment, paymentAllocation, paymentBalance, voucherBalance } from "../db/schema";
import { withOwner } from "../db/with-owner";
import { getAssignState } from "./domain/asignacion.ts";
import {
	mapAllocationRow,
	mapPaymentHistoryRow,
	mapPaymentRow,
	type VoucherBalanceRow,
} from "./payments.mapper.ts";
import { toHttpException } from "./payments.errors.ts";
import { type AddAllocationsBody, type PaymentListQuery } from "./payments.query.ts";
import { selectPaymentRows } from "./payments.select.ts";
import type {
	Payment,
	PaymentAssignState,
	PaymentDetail,
	PaymentDirection,
	PaymentHistoryEntry,
	PaymentListItem,
	PaymentStatus,
} from "./payments.types.ts";

/** Estados de recibo que cuentan como "vivos" en `payment_balance` (el origen excluye ANULADO). */
const ACTIVE_STATUSES: PaymentStatus[] = ["EN_REVISION", "PROCESADO"];

@Injectable()
export class PaymentsService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * Listado de pagos del dueno con los filtros del origen (`desde`/`hasta` sobre `payment_date`,
	 * `estado` sobre `payment.status`) y paginacion.
	 *
	 * SPEC 48: el saldo por asignar sale de `payment_balance` y los anulados quedan en 0 porque la
	 * segunda consulta solo mira EN_REVISION/PROCESADO. Se hace con dos queries y merge en memoria,
	 * igual que el origen, para no cambiar el significado de `unassignedAmount` en filas anuladas.
	 */
	async list(ownerId: string, filters: PaymentListQuery): Promise<PaymentListItem[]> {
		const conditions = [eq(payment.ownerId, ownerId)];

		if (filters.direction) conditions.push(eq(payment.direction, filters.direction));
		if (filters.desde) conditions.push(gte(payment.paymentDate, filters.desde));
		if (filters.hasta) conditions.push(lte(payment.paymentDate, filters.hasta));
		if (filters.estado !== "TODOS") conditions.push(eq(payment.status, filters.estado));

		return withOwner(this.db, ownerId, async (tx) => {
			const rows = await selectPaymentRows(tx)
				.where(and(...conditions))
				.orderBy(desc(payment.paymentDate), desc(payment.receiptSerial))
				.limit(filters.pageSize)
				.offset((filters.page - 1) * filters.pageSize);

			const balanceConditions = [inArray(paymentBalance.status, ACTIVE_STATUSES)];

			if (filters.direction) {
				balanceConditions.push(eq(paymentBalance.direction, filters.direction));
			}

			const balances = await tx
				.select({
					paymentId: paymentBalance.paymentId,
					unassignedAmount: paymentBalance.unassignedAmount,
				})
				.from(paymentBalance)
				.where(and(...balanceConditions));

			const unassignedByPayment = new Map<string, number>();

			for (const row of balances) {
				if (row.paymentId) {
					unassignedByPayment.set(row.paymentId, Number(row.unassignedAmount ?? 0));
				}
			}

			return rows.map((row) => ({
				...mapPaymentRow(row),
				unassignedAmount: unassignedByPayment.get(row.id) ?? 0,
			}));
		});
	}

	/** Detalle de un pago con sus asignaciones y saldos (`getPaymentDetail`). */
	async detail(ownerId: string, paymentId: string): Promise<PaymentDetail> {
		return withOwner(this.db, ownerId, (tx) => this.detailWithin(tx, ownerId, paymentId));
	}

	/**
	 * Historial de un COMPROBANTE: todas las asignaciones que lo tocaron, con los datos de cada
	 * pago (`getPaymentHistory(comprobanteId)` en el origen). Orden: fecha de pago descendente y,
	 * dentro del mismo dia, recibo descendente.
	 */
	async history(ownerId: string, comprobanteId: string): Promise<PaymentHistoryEntry[]> {
		return withOwner(this.db, ownerId, async (tx) => {
			const allocations = await tx
				.select({
					id: paymentAllocation.id,
					paymentId: paymentAllocation.paymentId,
					comprobanteId: paymentAllocation.comprobanteId,
					amount: paymentAllocation.amount,
				})
				.from(paymentAllocation)
				.where(eq(paymentAllocation.comprobanteId, comprobanteId));

			if (allocations.length === 0) {
				return [];
			}

			const paymentIds = [...new Set(allocations.map((row) => row.paymentId))];

			const payments = await selectPaymentRows(tx).where(inArray(payment.id, paymentIds));
			const paymentById = new Map(payments.map((row) => [row.id, row]));

			const entries = allocations.flatMap((allocation) => {
				const row = paymentById.get(allocation.paymentId);

				if (!row) return [];

				const mapped = mapPaymentRow(row);

				return [
					mapPaymentHistoryRow({
						allocationId: allocation.id,
						payment: mapped,
						allocationAmount: Number(allocation.amount),
						receiptSerial: row.receiptSerial,
					}),
				];
			});

			const serialByPayment = new Map(payments.map((row) => [row.id, row.receiptSerial]));

			entries.sort((a, b) => {
				if (a.paymentDate !== b.paymentDate) {
					return a.paymentDate < b.paymentDate ? 1 : -1;
				}

				return (
					(serialByPayment.get(b.paymentId) ?? 0) - (serialByPayment.get(a.paymentId) ?? 0)
				);
			});

			return entries;
		});
	}

	/**
	 * Alta de pago por la RPC `create_payment_with_allocations` (SPEC 33/50/57).
	 *
	 * Orden de argumentos leido de
	 * `packages/db/migrations/20261028194239_spec57_owner_consistency_rpc.sql` (la version
	 * vigente, que reemplaza a `20261014215713`):
	 *   p_entity_id, p_direction, p_payment_date, p_amount, p_method_id, p_cash_account_id,
	 *   p_category_id, p_reference, p_notes, p_allocations, p_is_cash_movement
	 * La RPC valida que cuenta, metodo, categoria y entidad sean del dueno de la sesion
	 * (`auth.uid()`), asi que un id ajeno muere con `42501` y no escribe nada.
	 */
	async create(ownerId: string, values: PaymentFormValues): Promise<PaymentDetail> {
		const allocations = values.allocations.map((item) => ({
			comprobante_id: item.comprobanteId,
			amount: item.amount,
		}));

		let paymentId: string;

		try {
			paymentId = await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ id: string }>(sql`
					select public.create_payment_with_allocations(
						${values.entityId ?? null}::uuid,
						${values.direction}::payment_direction,
						${values.paymentDate}::date,
						${values.amount}::numeric,
						${values.methodId}::uuid,
						${values.cashAccountId}::uuid,
						${values.categoryId}::uuid,
						${values.reference ?? ""}::text,
						${values.notes ?? ""}::text,
						${JSON.stringify(allocations)}::jsonb,
						${values.isCashMovement ?? false}::boolean
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("create_payment_with_allocations no devolvio el id del pago.");
				}

				return id;
			});
		} catch (error) {
			throw toHttpException(error);
		}

		return this.detail(ownerId, paymentId);
	}

	/**
	 * Anulacion (`voidPayment`): EN_REVISION|PROCESADO -> ANULADO con motivo y fecha.
	 *
	 * El UPDATE toca solo `status`, `void_reason` y `voided_at`, que son exactamente las columnas
	 * con privilegio de UPDATE para `authenticated` (hardening del historial financiero). El
	 * `where status = <el leido>` es el control de concurrencia del origen: si otro proceso ya
	 * cambio el estado, no se escribe nada y se informa.
	 */
	async void(ownerId: string, paymentId: string, reason: string): Promise<void> {
		try {
			await withOwner(this.db, ownerId, async (tx) => {
				const [found] = await tx
					.select({ id: payment.id, status: payment.status })
					.from(payment)
					.where(and(eq(payment.id, paymentId), eq(payment.ownerId, ownerId)))
					.limit(1);

				if (!found) {
					throw new NotFoundException("El pago no existe.");
				}

				if (found.status === "ANULADO") {
					throw new ConflictException(
						"El pago ya está anulado o no se encuentra disponible.",
					);
				}

				const updated = await tx
					.update(payment)
					.set({ status: "ANULADO", voidReason: reason, voidedAt: new Date() })
					.where(and(eq(payment.id, paymentId), eq(payment.status, found.status)))
					.returning({ id: payment.id });

				if (updated.length === 0) {
					throw new ConflictException("El pago ya está anulado o cambió de estado.");
				}
			});
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/**
	 * Asignacion de saldo a comprobantes (`addAllocations`).
	 *
	 * Un pago sin entidad (anticipo generico) se liga a la entidad elegida; el UPDATE es un no-op
	 * si el pago ya tiene entidad, igual que el `.is("entity_id", null)` del origen. Los triggers
	 * `validate_allocation` y `assert_owner_consistency` rechazan comprobantes de otro dueno, de
	 * otro tipo o que superen el saldo.
	 */
	async addAllocations(
		ownerId: string,
		paymentId: string,
		body: AddAllocationsBody,
	): Promise<void> {
		if (body.items.length === 0) {
			return;
		}

		try {
			await withOwner(this.db, ownerId, async (tx) => {
				const [found] = await tx
					.select({ id: payment.id })
					.from(payment)
					.where(and(eq(payment.id, paymentId), eq(payment.ownerId, ownerId)))
					.limit(1);

				if (!found) {
					throw new NotFoundException("El pago no existe.");
				}

				if (body.entityId) {
					await tx
						.update(payment)
						.set({ entityId: body.entityId })
						.where(and(eq(payment.id, paymentId), isNull(payment.entityId)));
				}

				await tx.insert(paymentAllocation).values(
					body.items.map((item) => ({
						paymentId,
						comprobanteId: item.comprobanteId,
						amount: String(item.amount),
					})),
				);
			});
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/**
	 * Recibos de una direccion con saldo por asignar (`listUnassignedPayments`).
	 *
	 * Devuelve `Payment[]` como el origen: la UI de pagos solo usa los ids de esta lista para
	 * filtrar el listado completo. SPEC 50: los movimientos de caja (`is_cash_movement`) no son
	 * cartera asignable, se excluyen.
	 */
	async unassigned(ownerId: string, direction: PaymentDirection): Promise<Payment[]> {
		return withOwner(this.db, ownerId, async (tx) => {
			const balances = await tx
				.select({ paymentId: paymentBalance.paymentId })
				.from(paymentBalance)
				.where(
					and(
						inArray(paymentBalance.status, ACTIVE_STATUSES),
						eq(paymentBalance.direction, direction),
						gt(paymentBalance.unassignedAmount, "0"),
					),
				);

			const paymentIds = balances
				.map((row) => row.paymentId)
				.filter((id): id is string => Boolean(id));

			if (paymentIds.length === 0) {
				return [];
			}

			const rows = await selectPaymentRows(tx)
				.where(
					and(
						inArray(payment.id, paymentIds),
						eq(payment.isCashMovement, false),
						eq(payment.ownerId, ownerId),
					),
				)
				.orderBy(desc(payment.paymentDate), desc(payment.receiptSerial));

			return rows.map(mapPaymentRow);
		});
	}

	/**
	 * Estado derivado de cada pago (`getAssignState`).
	 *
	 * El helper puro del origen recibe (status, saldo sin asignar, is_cash_movement) por fila; aca
	 * se resuelve para todo el dueno con una sola lectura de `payment_balance` + `payment`, que es
	 * lo que necesita el listado. `AssignState` no se persiste.
	 */
	async assignState(
		ownerId: string,
		direction?: PaymentDirection,
	): Promise<PaymentAssignState[]> {
		return withOwner(this.db, ownerId, async (tx) => {
			const rows = await tx
				.select({
					paymentId: paymentBalance.paymentId,
					status: paymentBalance.status,
					unassignedAmount: paymentBalance.unassignedAmount,
					isCashMovement: payment.isCashMovement,
				})
				.from(paymentBalance)
				.innerJoin(payment, eq(payment.id, paymentBalance.paymentId))
				.where(
					direction
						? and(eq(paymentBalance.direction, direction), eq(payment.ownerId, ownerId))
						: eq(payment.ownerId, ownerId),
				)
				.orderBy(desc(payment.paymentDate), desc(payment.receiptSerial));

			return rows.flatMap((row) => {
				if (!row.paymentId) return [];

				const status = row.status ?? "EN_REVISION";
				const unassignedAmount = Number(row.unassignedAmount ?? 0);
				const isCashMovement = Boolean(row.isCashMovement);

				return [
					{
						paymentId: row.paymentId,
						status,
						unassignedAmount,
						isCashMovement,
						assignState: getAssignState(status, unassignedAmount, isCashMovement),
					},
				];
			});
		});
	}

	/**
	 * Marca recibos verificados (EN_REVISION -> PROCESADO) con la RPC `mark_payments_processed`.
	 *
	 * La funcion valida que cada id sea del dueno de la sesion y este EN_REVISION; si alguno no
	 * cumple, levanta excepcion y no marca ninguno. Devuelve cuantos marco.
	 */
	async markProcessed(ownerId: string, paymentIds: string[]): Promise<number> {
		if (paymentIds.length === 0) {
			return 0;
		}

		try {
			// El array se arma con un cast por elemento: `node-postgres` no serializa un array de JS
			// como `uuid[]` cuando viaja como un unico parametro (lo manda como texto plano y
			// PostgreSQL falla con 22P02).
			const ids = sql.join(
				paymentIds.map((id) => sql`${id}::uuid`),
				sql`, `,
			);

			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ processed: number }>(sql`
					select public.mark_payments_processed(array[${ids}]::uuid[]) as processed
				`);

				return Number(result.rows[0]?.processed ?? 0);
			});
		} catch (error) {
			throw toHttpException(error);
		}
	}

	/** Detalle compartido por `detail` y `create` (mismo shape que el origen). */
	private async detailWithin(
		tx: Transaction,
		ownerId: string,
		paymentId: string,
	): Promise<PaymentDetail> {
		const [row] = await selectPaymentRows(tx)
			.where(and(eq(payment.id, paymentId), eq(payment.ownerId, ownerId)))
			.limit(1);

		if (!row) {
			// No se distingue "no existe" de "es de otro dueno": la RLS ya lo hace invisible.
			throw new NotFoundException("El pago no existe.");
		}

		const [balance] = await tx
			.select({
				assignedAmount: paymentBalance.assignedAmount,
				unassignedAmount: paymentBalance.unassignedAmount,
			})
			.from(paymentBalance)
			.where(eq(paymentBalance.paymentId, paymentId))
			.limit(1);

		const allocations = await tx
			.select({
				id: paymentAllocation.id,
				paymentId: paymentAllocation.paymentId,
				comprobanteId: paymentAllocation.comprobanteId,
				amount: paymentAllocation.amount,
			})
			.from(paymentAllocation)
			.where(eq(paymentAllocation.paymentId, paymentId));

		const comprobanteIds = allocations.map((allocation) => allocation.comprobanteId);
		const voucherByComprobante = new Map<string, VoucherBalanceRow>();

		if (comprobanteIds.length > 0) {
			const vouchers = await tx
				.select({
					comprobanteId: voucherBalance.comprobanteId,
					entityId: voucherBalance.entityId,
					voucherKind: voucherBalance.voucherKind,
					voucherType: voucherBalance.voucherType,
					voucherNumber: voucherBalance.voucherNumber,
					issueDate: voucherBalance.issueDate,
					effectiveDueDate: voucherBalance.effectiveDueDate,
					paymentType: voucherBalance.paymentType,
					total: voucherBalance.total,
					paidAmount: voucherBalance.paidAmount,
					balance: voucherBalance.balance,
				})
				.from(voucherBalance)
				.where(inArray(voucherBalance.comprobanteId, comprobanteIds));

			for (const voucher of vouchers) {
				if (voucher.comprobanteId) {
					voucherByComprobante.set(voucher.comprobanteId, voucher);
				}
			}
		}

		return {
			...mapPaymentRow(row),
			allocations: allocations.map((allocation) =>
				mapAllocationRow(allocation, voucherByComprobante.get(allocation.comprobanteId)),
			),
			assignedAmount: Number(balance?.assignedAmount ?? 0),
			// Sin fila en la vista (pago sin asignaciones) el saldo pendiente es el importe total.
			unassignedAmount: Number(balance?.unassignedAmount ?? row.amount),
		};
	}
}
