// Operaciones de pagos del lado de la UI (port de `lib/pagos/pagos.ts` del origen, 526 lineas).
//
// Que cambio y por que: el origen hablaba con Supabase desde el navegador —`supabase.from(
// "payment")`, la RPC `create_payment_with_allocations` y `mapError` traduciendo codigos de
// PostgreSQL—. Aca cada funcion es una llamada al API (`lib/api/client.ts`), que hace el trabajo
// en una transaccion con la identidad de la sesion (`withOwner`).
//
// Lo que se conserva, porque es la superficie que usan los componentes:
//   listPayments(direction)            -> GET  /payments?direction=
//   getPaymentDetail(id)               -> GET  /payments/:id
//   getPaymentHistory(comprobanteId)   -> GET  /payments/:comprobanteId/history
//   createPayment(values)              -> POST /payments
//   addAllocations(id, items, entity)  -> POST /payments/:id/allocations
//   voidPayment(id, reason)            -> POST /payments/:id/void
//   markPaymentsProcessed(ids)         -> POST /payments/mark-processed
//   listOpenVouchers(direction, ent)   -> GET  /vouchers/open
//
// Lo que se va, con su motivo:
//   - `mapError`: los mensajes de dominio ("La cuenta de caja no existe", "El pago ya está
//     anulado…") ahora los produce el servidor y el cliente los muestra tal cual
//     (`apiErrorMessage`). Traducir codigos PG en el navegador ya no tiene sentido: el navegador
//     nunca ve un error de PostgreSQL.
//   - `PAYMENT_SELECT` y los `map*Row`: el API devuelve el contrato ya armado, con `amount` como
//     numero y los nombres de catalogo resueltos por join.
import {
	type AllocationInput,
	type Payment,
	type PaymentDetail,
	type PaymentDirection,
	type PaymentHistoryEntry,
	type PaymentListItem,
	type PaymentStatus,
	type VoucherBalance,
	type PaymentListFilters,
	addAllocations as addAllocationsRequest,
	createPayment as createPaymentRequest,
	getPaymentDetail as getPaymentDetailRequest,
	getPaymentHistory as getPaymentHistoryRequest,
	listOpenVouchers as listOpenVouchersRequest,
	listPayments as listPaymentsRequest,
	markPaymentsProcessed as markProcessedRequest,
	voidPayment as voidPaymentRequest,
} from "@/lib/api/client";
import type { PaymentFormValues } from "@gestion/shared";
import { collectAllPages } from "./pagination";

/** Tamano de pagina que usa el endpoint: es su maximo y su valor por defecto. */
const PAYMENT_PAGE_SIZE = 100;

/**
 * Pagos de una direccion, con el saldo pendiente de asignar (SPEC 48).
 *
 * El origen pedia la direccion y nada mas y recibia la lista entera. El endpoint pagina de a 100,
 * asi que aca se recorren todas las paginas: sin eso, el pago 101 desaparece de la pantalla sin
 * error. Los filtros de fecha y estado siguen pasando al servidor, igual que antes.
 */
export async function listPayments(
	direction: PaymentDirection,
	filters: Omit<PaymentListFilters, "direction" | "page" | "pageSize"> = {},
): Promise<PaymentListItem[]> {
	return collectAllPages(
		(page, pageSize) => listPaymentsRequest({ ...filters, direction, page, pageSize }),
		{ pageSize: PAYMENT_PAGE_SIZE },
	);
}

/** Detalle de un pago con sus asignaciones y saldos. */
export function getPaymentDetail(id: string): Promise<PaymentDetail> {
	return getPaymentDetailRequest(id);
}

/** Historial de un comprobante: todas las asignaciones que lo tocaron, con sus pagos. */
export function getPaymentHistory(comprobanteId: string): Promise<PaymentHistoryEntry[]> {
	return getPaymentHistoryRequest(comprobanteId);
}

/** Alta del pago (la RPC del origen) y devuelta del detalle ya armado. */
export function createPayment(values: PaymentFormValues): Promise<PaymentDetail> {
	return createPaymentRequest(values);
}

/**
 * Asignacion de saldo a comprobantes.
 *
 * Diferencia de transporte con el origen: alla eran dos escrituras desde el cliente (UPDATE del
 * `entity_id` del anticipo y despues INSERT de las asignaciones); aca es una sola peticion y el
 * API las hace en la misma transaccion, asi que no puede quedar una asignacion sin entidad.
 */
export async function addAllocations(
	paymentId: string,
	items: AllocationInput[],
	entityId?: string
): Promise<void> {
	if (items.length === 0) {
		return;
	}

	await addAllocationsRequest(paymentId, items, entityId);
}

/**
 * Anulacion con motivo.
 *
 * El origen leia el estado del pago y despues hacia un UPDATE condicionado para no pisar una
 * anulacion concurrente. El API hace esa misma comprobacion dentro de su transaccion y responde
 * 409 con el mensaje del origen ("El pago ya está anulado o cambió de estado."), que la UI
 * muestra tal cual.
 */
export async function voidPayment(id: string, reason: string): Promise<void> {
	await voidPaymentRequest(id, reason);
}

/**
 * EN_REVISION -> PROCESADO en bloque (SPEC 33).
 *
 * Lo usa el vertical de cajas-bancos (cuadres), no la pantalla de pagos; se porta ahora porque
 * pertenece al mismo contrato y es una linea.
 */
export async function markPaymentsProcessed(paymentIds: string[]): Promise<number> {
	if (paymentIds.length === 0) {
		return 0;
	}

	return markProcessedRequest(paymentIds);
}

/** Comprobantes con saldo abierto de una entidad (`listOpenVouchers(direction, entityId)`). */
export function listOpenVouchers(
	direction: PaymentDirection,
	entityId: string
): Promise<VoucherBalance[]> {
	return listOpenVouchersRequest(direction, entityId);
}

export type {
	AllocationInput,
	Payment,
	PaymentDetail,
	PaymentDirection,
	PaymentHistoryEntry,
	PaymentListItem,
	PaymentStatus,
	VoucherBalance,
};
