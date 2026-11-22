// Cartera y comprobantes abiertos: port de `lib/pagos/cartera.ts` del origen.
//
// Las tres lecturas son sobre las vistas `security_invoker` (`voucher_balance`,
// `payment_balance`). Ninguna escribe en la base: los buckets se calculan aca, con los mismos
// helpers puros que porto el vertical (`isOverdue`) y el mismo criterio de redondeo a 2 decimales.
//
// SPEC 50: los movimientos de caja (`is_cash_movement = true`) no son cartera asignable, asi que
// se excluyen de los buckets "sin asignar" consultando `payment` por los ids que devuelve la
// vista. Es la misma tercera consulta que hace el origen.
import { Inject, Injectable } from "@nestjs/common";
import { getTodayLocalDate } from "@gestion/shared";
import { and, asc, between, eq, gt, inArray } from "drizzle-orm";
import { DATABASE, type Database } from "../db/db.provider";
import { payment, paymentBalance, voucherBalance } from "../db/schema";
import { withOwner } from "../db/with-owner";
import { isOverdue } from "./domain/saldos.ts";
import { mapPaymentRow, mapVoucherBalanceRow } from "./payments.mapper.ts";
import { selectPaymentRows } from "./payments.select.ts";
import type {
	CarteraBucket,
	CarteraResumen,
	Payment,
	PaymentDirection,
	PaymentStatus,
	VoucherBalance,
} from "./payments.types.ts";

const ACTIVE_STATUSES: PaymentStatus[] = ["EN_REVISION", "PROCESADO"];

function roundAmount(value: number): number {
	return Math.round(value * 100) / 100;
}

function emptyBucket(): CarteraBucket {
	return { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0 };
}

function buildVoucherBucket(vouchers: VoucherBalance[], today: string): CarteraBucket {
	const bucket = emptyBucket();
	let amount = 0;
	let overdueAmount = 0;

	for (const voucher of vouchers) {
		bucket.count += 1;
		amount += voucher.balance;

		if (isOverdue(voucher.effectiveDueDate, voucher.balance, today)) {
			bucket.overdueCount += 1;
			overdueAmount += voucher.balance;
		}
	}

	bucket.amount = roundAmount(amount);
	bucket.overdueAmount = roundAmount(overdueAmount);

	return bucket;
}

function buildUnassignedBucket(
	rows: Array<{ unassignedAmount: number; direction: PaymentDirection }>,
	direction: PaymentDirection,
): CarteraBucket {
	const bucket = emptyBucket();
	let amount = 0;

	for (const row of rows) {
		if (row.direction !== direction) continue;

		bucket.count += 1;
		amount += row.unassignedAmount;
	}

	bucket.amount = roundAmount(amount);

	return bucket;
}

@Injectable()
export class CarteraService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/** Resumen de cartera del dueno: cobranza, deuda y recibos sin asignar. */
	async resumen(ownerId: string): Promise<CarteraResumen> {
		const today = getTodayLocalDate();

		return withOwner(this.db, ownerId, async (tx) => {
			const voucherRows = await tx
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
				.where(gt(voucherBalance.balance, "0"));

			const vouchers = voucherRows.map(mapVoucherBalanceRow);

			const balanceRows = await tx
				.select({
					paymentId: paymentBalance.paymentId,
					direction: paymentBalance.direction,
					unassignedAmount: paymentBalance.unassignedAmount,
				})
				.from(paymentBalance)
				.where(
					and(
						inArray(paymentBalance.status, ACTIVE_STATUSES),
						gt(paymentBalance.unassignedAmount, "0"),
					),
				);

			const paymentIds = balanceRows
				.map((row) => row.paymentId)
				.filter((id): id is string => Boolean(id));

			const cashMovementIds = new Set<string>();

			if (paymentIds.length > 0) {
				const movements = await tx
					.select({ id: payment.id })
					.from(payment)
					.where(and(inArray(payment.id, paymentIds), eq(payment.isCashMovement, true)));

				for (const movement of movements) {
					cashMovementIds.add(movement.id);
				}
			}

			const unassigned = balanceRows
				.filter((row) => row.paymentId && !cashMovementIds.has(row.paymentId))
				.map((row) => ({
					direction: row.direction ?? "INGRESO",
					unassignedAmount: Number(row.unassignedAmount ?? 0),
				}));

			return {
				receivable: buildVoucherBucket(
					vouchers.filter((voucher) => voucher.voucherKind === "VENTA"),
					today,
				),
				payable: buildVoucherBucket(
					vouchers.filter((voucher) => voucher.voucherKind === "COMPRA"),
					today,
				),
				unassignedReceipts: buildUnassignedBucket(unassigned, "INGRESO"),
				unassignedPayments: buildUnassignedBucket(unassigned, "EGRESO"),
				today,
			};
		});
	}

	/**
	 * Movimientos de una cuenta de caja en un rango de fechas (`listAccountStatement`).
	 *
	 * La firma del origen es `(cashAccountId, from, to)`: el statement es de CUENTA, no de
	 * entidad. El aislamiento es por RLS: la cuenta de otro dueno simplemente no existe para la
	 * sesion y el resultado es un array vacio.
	 */
	async statement(
		ownerId: string,
		cashAccountId: string,
		from: string,
		to: string,
	): Promise<Payment[]> {
		return withOwner(this.db, ownerId, async (tx) => {
			const rows = await selectPaymentRows(tx)
				.where(
					and(
						eq(payment.ownerId, ownerId),
						eq(payment.cashAccountId, cashAccountId),
						between(payment.paymentDate, from, to),
					),
				)
				.orderBy(asc(payment.paymentDate), asc(payment.receiptSerial));

			return rows.map(mapPaymentRow);
		});
	}

	/**
	 * Comprobantes con saldo abierto (`listOpenVouchers`).
	 *
	 * `direction` traduce a `voucher_kind`: un INGRESO cobra VENTAS y un EGRESO paga COMPRAS.
	 * `entityId` es opcional: el selector de asignacion lo manda para filtrar por entidad.
	 */
	async openVouchers(
		ownerId: string,
		direction: PaymentDirection,
		entityId?: string,
	): Promise<VoucherBalance[]> {
		const voucherKind = direction === "INGRESO" ? "VENTA" : "COMPRA";

		return withOwner(this.db, ownerId, async (tx) => {
			const conditions = [
				eq(voucherBalance.voucherKind, voucherKind),
				gt(voucherBalance.balance, "0"),
			];

			if (entityId) conditions.push(eq(voucherBalance.entityId, entityId));

			const rows = await tx
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
				.where(and(...conditions))
				.orderBy(asc(voucherBalance.effectiveDueDate));

			return rows.map(mapVoucherBalanceRow);
		});
	}
}
