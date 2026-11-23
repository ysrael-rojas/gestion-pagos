// Movimiento de caja: el vale/ingreso sin comprobante se registra como un recibo (C6, S8).
//
// Port de `tests/unit/lib/caja/movimientos.test.ts` del origen (vitest) a `node:test`. La regla
// que se prueba es la de S8: un movimiento de caja NO es una ruta nueva, es `POST /payments` con
// `isCashMovement: true`, sin entidad y sin asignaciones (SPEC 50). Si el mapper dejara de marcar
// la bandera, el movimiento entraria al circuito de asignacion de comprobantes y apareceria como
// saldo por asignar; si mandara `entityId`, la RPC lo ataria a una entidad que nadie eligio.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cashMovementToPayment } from "./movimientos.ts";

const values = () => ({
  cashAccountId: "550e8400-e29b-41d4-a716-446655440000",
  direction: "EGRESO" as const,
  methodId: "550e8400-e29b-41d4-a716-446655440010",
  categoryId: "550e8400-e29b-41d4-a716-446655440011",
  amount: 25,
  movementDate: "2026-10-20",
  reference: "OP-1",
  notes: "Aporte",
});

describe("cashMovementToPayment", () => {
  it("mapea el movimiento a un recibo sin entidad, sin asignaciones y marcado", () => {
    assert.deepEqual(cashMovementToPayment(values()), {
      entityId: undefined,
      direction: "EGRESO",
      paymentDate: "2026-10-20",
      amount: 25,
      methodId: "550e8400-e29b-41d4-a716-446655440010",
      cashAccountId: "550e8400-e29b-41d4-a716-446655440000",
      categoryId: "550e8400-e29b-41d4-a716-446655440011",
      reference: "OP-1",
      notes: "Aporte",
      allocations: [],
      isCashMovement: true,
    });
  });

  it("respeta la direccion de ingreso", () => {
    assert.equal(cashMovementToPayment({ ...values(), direction: "INGRESO" }).direction, "INGRESO");
  });
});
