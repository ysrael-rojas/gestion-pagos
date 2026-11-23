// Cargo bancario: el puente entre el modal y `POST /payments` (C7 del vertical de cajas-bancos).
//
// Port de `lib/caja/cargos.ts` del origen (24 lineas) mas las tres constantes que su modal
// necesitaba (`BANK_CHARGE_CATEGORY_CODES` de `lib/caja/defaults.ts:15-19`).
//
// UN CARGO BANCARIO NO ES UNA RUTA NUEVA (S8): es un recibo de EGRESO sin entidad y sin
// asignaciones, marcado con `isCashMovement: true`, que descuenta el banco de la cuenta (ITF,
// comision, detraccion SPOT). No paga una factura, asi que `entityId` va `undefined` y
// `allocations` vacio; la bandera lo saca del circuito de cartera igual que a un movimiento de
// caja (`AssignMode: MOVIMIENTO`).
//
// La diferencia con `movimientos.ts` es la direccion: un movimiento de caja la elige el usuario
// (puede ser un aporte de capital), un cargo bancario SIEMPRE es un egreso. Por eso el mapeo fija
// `direction: "EGRESO"` y no la recibe del formulario.
//
// Sin `mapError` ni traduccion: el API responde con los mensajes del vertical y el `ApiError` los
// lleva al `toast` de la pantalla.
import type { BankChargeFormValues } from "@gestion/shared/lib/schemas/bank-charge.ts";
import type { PaymentFormValues } from "@gestion/shared/lib/schemas/payment.ts";

/**
 * Categorias de EGRESO que ofrece "Registrar cargo bancario" (SPEC 33), resueltas por `code`.
 *
 * Son tres de las semillas del API (`apps/api/src/payments/catalogs.defaults.ts`): ITF, comision
 * bancaria y detraccion SPOT. Se filtra por codigo y no por nombre porque el dueño puede renombrar
 * una categoria sin que el combo de cargos deje de funcionar (SPEC 49/37).
 */
export const BANK_CHARGE_CATEGORY_CODES = [
  "ITF",
  "COMISION_BANCARIA",
  "DETRACCION_SPOT",
] as const;

/** Convierte el formulario de cargo bancario en el body de `POST /payments`. */
export function bankChargeToPayment(values: BankChargeFormValues): PaymentFormValues {
  return {
    entityId: undefined,
    direction: "EGRESO",
    paymentDate: values.chargeDate,
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
