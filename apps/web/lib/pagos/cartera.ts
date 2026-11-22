// Cartera y comprobantes abiertos del lado de la UI (port de `lib/pagos/cartera.ts`, 228 lineas).
//
// El origen calculaba los cuatro buckets en el navegador: leia `voucher_balance` y
// `payment_balance` y los agregaba con `isOverdue`. Ese calculo ahora lo hace `apps/api`
// (`CarteraService.resumen`, port del mismo archivo) porque las dos vistas tienen RLS encima y
// era una decision de T5b1 exponerlas o no por API: se expusieron derrivando el resumen.
//
// Consecuencia, y es la unica: el navegador ya no agrega nada. Lo que la UI muestra es lo que el
// servidor calculo con los mismos helpers (esta probado en `apps/api/test/payments.e2e.test.ts`).
import {
	type Payment,
	type PaymentDirection,
	type VoucherBalance,
	getCarteraResumen as getCarteraResumenRequest,
	listOpenVouchers as listOpenVouchersRequest,
	listUnassignedPayments as listUnassignedPaymentsRequest,
} from "@/lib/api/client";
import type { CarteraResumen } from "@/components/cartera/types";

/** Resumen de cartera: cobranza, deuda y recibos sin asignar. */
export function getCarteraResumen(): Promise<CarteraResumen> {
	return getCarteraResumenRequest();
}

/** Comprobantes con saldo abierto de la direccion (todas las entidades: filtro de listado). */
export function listOpenVouchers(direction: PaymentDirection): Promise<VoucherBalance[]> {
	return listOpenVouchersRequest(direction);
}

/** Recibos con saldo sin asignar (filtro "sin asignar" del listado). */
export function listUnassignedPayments(direction: PaymentDirection): Promise<Payment[]> {
	return listUnassignedPaymentsRequest(direction);
}
