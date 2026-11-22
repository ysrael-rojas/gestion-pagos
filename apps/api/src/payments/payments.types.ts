// Contrato de salida del vertical de pagos: los mismos modelos que consume la UI portada.
//
// Fuente: `components/pagos/types.ts` y `components/cartera/types.ts` del proyecto de origen. Los
// nombres y la forma son los del origen a proposito: `apps/web` (T5b2) va a tipar sus componentes
// con estos tipos y reemplazar los imports de `@/components/pagos/types` por los del API. Cambiar
// un campo aca es cambiar el contrato del frontend.
//
// Diferencia deliberada y unica: `Payment.entityName` no existe (el origen tampoco lo tiene: el
// nombre se resuelve en el cliente con `useEntityNameResolver` desde `lib/clientes`).
import type { Currency } from "@gestion/shared";

export type PaymentDirection = "INGRESO" | "EGRESO";
export type PaymentStatus = "EN_REVISION" | "PROCESADO" | "ANULADO";
export type PaymentType = "CONTADO" | "CREDITO";
export type VoucherKind = "COMPRA" | "VENTA";
export type VoucherType =
	| "FACTURA"
	| "BOLETA"
	| "NOTA_VENTA"
	| "NOTA_CREDITO"
	| "NOTA_DEBITO"
	| "COMPROBANTE_RETENCION";

export interface Payment {
	id: string;
	/** `null` = anticipo sin entidad asignada todavia. */
	entityId: string | null;
	direction: PaymentDirection;
	/** "YYYY-MM-DD" — unica fecha del recibo (emision = pago). */
	paymentDate: string;
	/** "RI-000001" | "RE-000001" */
	receiptNumber: string;
	amount: number;
	/** Moneda de la cuenta de caja del pago (join, no columna). */
	currency: Currency;
	methodId: string;
	methodName: string;
	cashAccountId: string;
	cashAccountName: string;
	categoryId: string;
	categoryName: string;
	/** Nro de operacion BCP / autorizacion de tarjeta. */
	reference: string | null;
	status: PaymentStatus;
	voidReason: string | null;
	voidedAt: string | null;
	notes: string | null;
	/** true = movimiento de caja/cargo/vale: no se asigna a comprobantes (SPEC 50). */
	isCashMovement: boolean;
}

/** Fila del listado: agrega el saldo aun no asignado (SPEC 48). */
export interface PaymentListItem extends Payment {
	unassignedAmount: number;
}

export interface PaymentAllocation {
	id: string;
	paymentId: string;
	comprobanteId: string;
	amount: number;
	/** "F001-000001" */
	voucherNumber: string;
	voucherType: VoucherType;
}

export interface PaymentDetail extends Payment {
	allocations: PaymentAllocation[];
	assignedAmount: number;
	unassignedAmount: number;
}

export interface PaymentHistoryEntry {
	/** `payment_allocation.id` */
	allocationId: string;
	/** `payment.id` (FK para ReceiptDialog) */
	paymentId: string;
	receiptNumber: string;
	paymentDate: string;
	direction: PaymentDirection;
	methodName: string;
	cashAccountName: string;
	categoryName: string;
	reference: string | null;
	/** Importe total del pago. */
	paymentAmount: number;
	/** Importe aplicado a este comprobante (`allocation.amount`). */
	amount: number;
	status: PaymentStatus;
	voidedAt: string | null;
	voidReason: string | null;
	notes: string | null;
}

export interface VoucherBalance {
	comprobanteId: string;
	entityId: string;
	voucherKind: VoucherKind;
	voucherType: VoucherType;
	voucherNumber: string;
	issueDate: string;
	effectiveDueDate: string | null;
	paymentType: PaymentType;
	total: number;
	paidAmount: number;
	balance: number;
}

export interface CarteraBucket {
	count: number;
	amount: number;
	overdueCount: number;
	overdueAmount: number;
}

export interface CarteraResumen {
	receivable: CarteraBucket;
	payable: CarteraBucket;
	unassignedReceipts: CarteraBucket;
	unassignedPayments: CarteraBucket;
	today: string;
}

/** Estado derivado del saldo pendiente de asignar (SPEC 48/50). No se persiste. */
export type AssignState = "POR_ASIGNAR" | "ASIGNADO" | "ANULADO" | "MOVIMIENTO";

export interface PaymentAssignState {
	paymentId: string;
	status: PaymentStatus;
	unassignedAmount: number;
	isCashMovement: boolean;
	assignState: AssignState;
}
