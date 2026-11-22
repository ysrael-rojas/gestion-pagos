// Portado tal cual de `lib/pagos/auto-distribuir.ts` del origen (63 lineas, sin cambios de
// logica). Unico cambio: el tipo de comprobante se importa del contrato local.
//
// Es el boton "Auto-distribuir" del formulario: reparte el importe del pago sobre los
// comprobantes con saldo, cubriendo primero las deudas mas antiguas.
//
// Reglas (las del origen, fijadas en auto-distribuir.test.ts):
// - Ordena por `effectiveDueDate ?? issueDate` ascendente; empate por `issueDate`.
// - Asigna `min(balance, restante)` a cada comprobante hasta agotar el importe.
// - El excedente (importe mayor a la suma de saldos) NO se asigna.
// - Trabaja en centavos enteros (`Math.round(x * 100)`) para evitar drift de redondeo.
import type { VoucherBalance } from "@/components/pagos/types";

export function distributeOldestFirst(
	vouchers: VoucherBalance[],
	amountToApply: number
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
