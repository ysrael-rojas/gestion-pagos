// Port literal de `lib/pagos/auto-distribuir.ts` del proyecto de origen.
//
// Auto-distribuye un importe sobre los comprobantes con saldo, cubriendo primero las deudas mas
// antiguas (FIFO por antiguedad):
//   - ordena por `effectiveDueDate ?? issueDate` ascendente, desempate por `issueDate`;
//   - asigna `min(balance, restante)` hasta agotar el importe;
//   - el excedente (importe mayor a la suma de saldos) NO se asigna;
//   - trabaja en centavos enteros para no arrastrar drift de redondeo.
// Devuelve solo los comprobantes con asignacion > 0, en unidades monetarias.
import type { VoucherBalance } from "../payments.types.ts";

export function distributeOldestFirst(
	vouchers: VoucherBalance[],
	amountToApply: number,
): Map<string, number> {
	const assignments = new Map<string, number>();
	let remainingCents = Math.round(amountToApply * 100);

	if (remainingCents <= 0) {
		return assignments;
	}

	const sortedByAge = vouchers
		.filter((voucher) => voucher.balance > 0)
		.sort((a, b) => {
			const aDate = a.effectiveDueDate ?? a.issueDate;
			const bDate = b.effectiveDueDate ?? b.issueDate;

			if (aDate !== bDate) {
				return aDate < bDate ? -1 : 1;
			}

			if (a.issueDate !== b.issueDate) {
				return a.issueDate < b.issueDate ? -1 : 1;
			}

			return 0;
		});

	for (const voucher of sortedByAge) {
		if (remainingCents <= 0) {
			break;
		}

		const balanceCents = Math.round(voucher.balance * 100);
		// El ultimo comprobante cubierto recibe el remanente exacto.
		const appliedCents = Math.min(balanceCents, remainingCents);

		if (appliedCents <= 0) {
			continue;
		}

		assignments.set(voucher.comprobanteId, appliedCents / 100);
		remainingCents -= appliedCents;
	}

	return assignments;
}
