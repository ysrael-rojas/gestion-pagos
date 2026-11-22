// Port literal de `lib/pagos/asignacion.ts` del proyecto de origen.
//
// `AssignState` no se persiste: sale siempre de `payment_balance.unassigned_amount` mas
// `payment.is_cash_movement`. SPEC 50 agrega MOVIMIENTO: un recibo marcado como movimiento de
// caja (cargo bancario, vale) no se asigna a comprobantes.
import type { AssignState, PaymentStatus } from "../payments.types.ts";

export type { AssignState };

export const ASSIGN_STATE_LABELS: Record<AssignState, string> = {
	POR_ASIGNAR: "Por asignar",
	ASIGNADO: "Asignado",
	ANULADO: "Anulado",
	MOVIMIENTO: "Movimiento de caja",
};

export function getAssignState(
	status: PaymentStatus,
	unassignedAmount: number,
	isCashMovement = false,
): AssignState {
	if (status === "ANULADO") {
		return "ANULADO";
	}

	if (isCashMovement) {
		return "MOVIMIENTO";
	}

	return unassignedAmount > 0 ? "POR_ASIGNAR" : "ASIGNADO";
}
