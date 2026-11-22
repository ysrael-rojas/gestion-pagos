// Traduccion de filas SQL al contrato de salida (port de los `map*Row` de `lib/pagos/*`).
//
// Todo lo que cruza este archivo es explicito: `numeric(12,2)` llega como string exacto desde
// node-postgres y sale como number (lo que consume la UI); `timestamptz` llega como Date y sale
// como ISO string; `date` viaja como "YYYY-MM-DD" sin conversion, para no mover el dia por
// zona horaria.
import type {
	Payment,
	PaymentAllocation,
	PaymentHistoryEntry,
	PaymentStatus,
	VoucherBalance,
	VoucherKind,
	VoucherType,
} from "./payments.types.ts";

/** Fila de `payment` con los tres joins de catalogo que arma `PAYMENT_SELECT` en el origen. */
export interface PaymentRow {
	id: string;
	entityId: string | null;
	direction: "INGRESO" | "EGRESO";
	paymentDate: string;
	receiptNumber: string | null;
	amount: string;
	methodId: string;
	methodName: string | null;
	cashAccountId: string;
	cashAccountName: string | null;
	currency: string | null;
	categoryId: string;
	categoryName: string | null;
	reference: string | null;
	status: PaymentStatus;
	voidReason: string | null;
	voidedAt: Date | null;
	notes: string | null;
	isCashMovement: boolean;
}

export interface AllocationRow {
	id: string;
	paymentId: string;
	comprobanteId: string;
	amount: string;
}

export interface VoucherBalanceRow {
	comprobanteId: string | null;
	entityId: string | null;
	voucherKind: VoucherKind | null;
	voucherType: VoucherType | null;
	voucherNumber: string | null;
	issueDate: string | null;
	effectiveDueDate: string | null;
	paymentType: "CONTADO" | "CREDITO" | null;
	total: string | null;
	paidAmount: string | null;
	balance: string | null;
}

/** `numeric` -> number. Los montos ya vienen redondeados a 2 decimales desde la base. */
export function toAmount(value: string | null): number {
	return value === null ? 0 : Number(value);
}

function toIsoString(value: Date | null): string | null {
	return value === null ? null : value.toISOString();
}

export function mapPaymentRow(row: PaymentRow): Payment {
	return {
		id: row.id,
		entityId: row.entityId,
		direction: row.direction,
		paymentDate: row.paymentDate,
		receiptNumber: row.receiptNumber ?? "",
		amount: toAmount(row.amount),
		// El origen deriva la moneda de la cuenta de caja, no de una columna del pago.
		currency: row.currency === "USD" ? "USD" : "PEN",
		methodId: row.methodId,
		methodName: row.methodName ?? "",
		cashAccountId: row.cashAccountId,
		cashAccountName: row.cashAccountName ?? "",
		categoryId: row.categoryId,
		categoryName: row.categoryName ?? "",
		reference: row.reference,
		status: row.status,
		voidReason: row.voidReason,
		voidedAt: toIsoString(row.voidedAt),
		notes: row.notes,
		isCashMovement: row.isCashMovement,
	};
}

export function mapAllocationRow(
	row: AllocationRow,
	voucher?: VoucherBalanceRow,
): PaymentAllocation {
	return {
		id: row.id,
		paymentId: row.paymentId,
		comprobanteId: row.comprobanteId,
		amount: toAmount(row.amount),
		voucherNumber: voucher?.voucherNumber ?? "",
		voucherType: voucher?.voucherType ?? "FACTURA",
	};
}

export function mapVoucherBalanceRow(row: VoucherBalanceRow): VoucherBalance {
	return {
		comprobanteId: row.comprobanteId ?? "",
		entityId: row.entityId ?? "",
		voucherKind: row.voucherKind ?? "VENTA",
		voucherType: row.voucherType ?? "FACTURA",
		voucherNumber: row.voucherNumber ?? "",
		issueDate: row.issueDate ?? "",
		effectiveDueDate: row.effectiveDueDate,
		paymentType: row.paymentType ?? "CONTADO",
		total: toAmount(row.total),
		paidAmount: toAmount(row.paidAmount),
		balance: toAmount(row.balance),
	};
}

/** Fila de historial: una asignacion con los datos del pago que la produjo. */
export interface PaymentHistoryRow {
	allocationId: string;
	payment: Payment;
	allocationAmount: number;
	receiptSerial: number;
}

export function mapPaymentHistoryRow(row: PaymentHistoryRow): PaymentHistoryEntry {
	return {
		allocationId: row.allocationId,
		paymentId: row.payment.id,
		receiptNumber: row.payment.receiptNumber,
		paymentDate: row.payment.paymentDate,
		direction: row.payment.direction,
		methodName: row.payment.methodName,
		cashAccountName: row.payment.cashAccountName,
		categoryName: row.payment.categoryName,
		reference: row.payment.reference,
		paymentAmount: row.payment.amount,
		amount: row.allocationAmount,
		status: row.payment.status,
		voidedAt: row.payment.voidedAt,
		voidReason: row.payment.voidReason,
		notes: row.payment.notes,
	};
}
