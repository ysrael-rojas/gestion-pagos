// Portado tal cual de `lib/pagos/saldos.ts` del origen (17 lineas, sin cambios).
//
// Definicion unica de "saldo" y "vencido". La usa la cartera (para los buckets), la tabla de
// comprobantes pendientes del listado y el resumen del formulario. `apps/api` tiene su propia
// copia en `src/payments/domain/saldos.ts` porque la necesita del lado del servidor para el
// resumen de cartera; las dos son la misma funcion y las dos estan cubiertas por tests.

export function computeBalance(total: number, paidAmount: number): number {
	const balance = Math.round((total - paidAmount) * 100) / 100;

	return balance > 0 ? balance : 0;
}

export function isOverdue(
	effectiveDueDate: string | null,
	balance: number,
	today: string
): boolean {
	if (!effectiveDueDate || balance <= 0) {
		return false;
	}

	return effectiveDueDate < today;
}
