// Movimientos de caja: el puente entre el formulario y `POST /payments` (C6, S8).
//
// Port de `lib/caja/movimientos.ts` del origen (23 lineas), incluido su comentario de SPEC 50. Un
// movimiento de caja NO es una ruta nueva del API: es un recibo sin entidad y sin asignaciones,
// marcado con `isCashMovement: true`, que nunca se ofrece para asignar a comprobantes. La bandera
// es lo que lo saca del circuito de cartera (`AssignState: MOVIMIENTO`).
//
// La decision que se copia tal cual: la direccion la elige el usuario (un movimiento puede ser un
// ingreso —aporte de capital— o un egreso —retiro del dueno—), a diferencia del cargo bancario, que
// siempre es un egreso.
//
// Sin `mapError` ni traduccion: el API responde con los mensajes del vertical y el `ApiError` los
// lleva al `toast` de la pantalla.
import type { PaymentFormValues } from "@gestion/shared/lib/schemas/payment.ts";
import type { CashMovementFormValues } from "@gestion/shared/lib/schemas/cash-movement.ts";

/** Convierte el formulario de movimiento de caja en el body de `POST /payments`. */
export function cashMovementToPayment(values: CashMovementFormValues): PaymentFormValues {
  return {
    entityId: undefined,
    direction: values.direction,
    paymentDate: values.movementDate,
    amount: values.amount,
    methodId: values.methodId,
    cashAccountId: values.cashAccountId,
    categoryId: values.categoryId,
    reference: values.reference,
    notes: values.notes,
    allocations: [],
    isCashMovement: true,
  };
}
