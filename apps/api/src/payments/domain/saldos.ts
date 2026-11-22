// Port literal de `lib/pagos/saldos.ts` del proyecto de origen.
//
// Esta en `apps/api` y no en `@gestion/shared` porque el paquete compartido solo expone hoy los
// schemas Zod y `lib/utils` (su barrel es angosto a proposito, ver `packages/shared/src/index.ts`):
// `lib/pagos` no se porto a shared. Si T5b2 lo necesita tambien en el frontend, el lugar correcto
// es moverlo a `packages/shared/src/lib/pagos` y reexportarlo desde ahi, no duplicarlo.
export function computeBalance(total: number, paidAmount: number): number {
	const balance = Math.round((total - paidAmount) * 100) / 100;

	return balance > 0 ? balance : 0;
}

export function isOverdue(
	effectiveDueDate: string | null,
	balance: number,
	today: string,
): boolean {
	if (!effectiveDueDate || balance <= 0) {
		return false;
	}

	return effectiveDueDate < today;
}
