// Proyeccion de flujo de caja a cuatro semanas (C7 del vertical de cajas-bancos).
//
// Port de `tests/unit/lib/caja/proyeccion.test.ts` del origen (vitest) a `node:test`. La regla que
// se prueba es el reparto de comprobantes pendientes en semanas lunes-domingo con saldo en cascada:
// vencidos a la semana 1 como "atrasado", credito sin fecha aparte (no suma) y lo que cae despues
// de la semana 4 fuera. Los casos son los del origen, con las mismas fechas, para que el port se
// pueda comparar linea por linea.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VoucherBalance } from "../api/client.ts";
import { buildCashFlowProjection, PROJECTION_WEEKS, startOfWeek } from "./proyeccion.ts";

function voucher(overrides: Partial<VoucherBalance> = {}): VoucherBalance {
  return {
    comprobanteId: "c-1",
    entityId: "e-1",
    voucherKind: "VENTA",
    voucherType: "FACTURA",
    voucherNumber: "F001-000001",
    issueDate: "2026-10-01",
    effectiveDueDate: "2026-10-30",
    paymentType: "CREDITO",
    total: 100,
    paidAmount: 0,
    balance: 100,
    ...overrides,
  };
}

describe("PROJECTION_WEEKS", () => {
  it("proyecta cuatro semanas (SPEC 52)", () => {
    assert.equal(PROJECTION_WEEKS, 4);
  });
});

describe("startOfWeek", () => {
  it("devuelve el lunes de la semana en curso", () => {
    // 2026-10-28 es miercoles -> lunes 2026-10-26.
    assert.equal(startOfWeek("2026-10-28"), "2026-10-26");
  });

  it("un domingo pertenece a la semana que empezo el lunes anterior", () => {
    assert.equal(startOfWeek("2026-11-01"), "2026-10-26");
  });

  it("un lunes devuelve el mismo dia", () => {
    assert.equal(startOfWeek("2026-10-26"), "2026-10-26");
  });
});

describe("buildCashFlowProjection", () => {
  it("reparte cobranzas y pagos en 4 semanas con saldo en cascada", () => {
    const projection = buildCashFlowProjection({
      today: "2026-10-28",
      currentBalance: 15450,
      receivables: [
        voucher({ comprobanteId: "r-vencida", effectiveDueDate: "2026-10-20", balance: 1500 }),
        voucher({ comprobanteId: "r-sem1", effectiveDueDate: "2026-10-30", balance: 2000 }),
        voucher({ comprobanteId: "r-sem2", effectiveDueDate: "2026-11-04", balance: 800 }),
      ],
      payables: [
        voucher({
          comprobanteId: "p-sem1",
          voucherKind: "COMPRA",
          effectiveDueDate: "2026-10-31",
          balance: 3500,
        }),
        voucher({
          comprobanteId: "p-vencida",
          voucherKind: "COMPRA",
          effectiveDueDate: "2026-10-01",
          balance: 500,
        }),
      ],
    });

    assert.equal(projection.weeks.length, 4);
    assert.deepEqual(projection.weeks[0], {
      index: 0,
      start: "2026-10-26",
      end: "2026-11-01",
      overdueCollections: 1500,
      overduePayments: 500,
      collections: 2000,
      payments: 3500,
      // 15,450 + 1,500 - 500 + 2,000 - 3,500
      closingBalance: 14950,
    });
    assert.deepEqual(projection.weeks[1], {
      index: 1,
      start: "2026-11-02",
      end: "2026-11-08",
      overdueCollections: 0,
      overduePayments: 0,
      collections: 800,
      payments: 0,
      closingBalance: 15750,
    });
    assert.equal(projection.weeks[2]?.closingBalance, 15750);
    assert.equal(projection.weeks[3]?.closingBalance, 15750);
    assert.equal(projection.currentBalance, 15450);
    assert.equal(projection.hasNegativeWeek, false);
    assert.equal(projection.firstNegativeWeekIndex, null);
  });

  it("separa el credito sin fecha y no lo suma", () => {
    const projection = buildCashFlowProjection({
      today: "2026-10-28",
      currentBalance: 0,
      receivables: [voucher({ comprobanteId: "r-sin-fecha", effectiveDueDate: null, balance: 1200 })],
      payables: [],
    });

    assert.equal(projection.unassigned.collections, 1200);
    assert.equal(projection.unassigned.payments, 0);
    assert.equal(
      projection.weeks.every((week) => week.closingBalance === 0),
      true,
    );
  });

  it("ignora lo que vence despues de la cuarta semana", () => {
    const projection = buildCashFlowProjection({
      today: "2026-10-28",
      currentBalance: 100,
      receivables: [voucher({ comprobanteId: "r-lejos", effectiveDueDate: "2026-12-15", balance: 999 })],
      payables: [],
    });

    assert.equal(
      projection.weeks.every((week) => week.collections === 0),
      true,
    );
    assert.equal(projection.weeks[3]?.closingBalance, 100);
  });

  it("marca la primera semana negativa", () => {
    const projection = buildCashFlowProjection({
      today: "2026-10-28",
      currentBalance: 100,
      receivables: [],
      payables: [
        voucher({
          comprobanteId: "p-grande",
          voucherKind: "COMPRA",
          effectiveDueDate: "2026-10-29",
          balance: 500,
        }),
      ],
    });

    assert.equal(projection.weeks[0]?.closingBalance, -400);
    assert.equal(projection.hasNegativeWeek, true);
    assert.equal(projection.firstNegativeWeekIndex, 0);
  });

  it("ignora comprobantes sin saldo pendiente", () => {
    const projection = buildCashFlowProjection({
      today: "2026-10-28",
      currentBalance: 100,
      receivables: [voucher({ comprobanteId: "r-pagado", balance: 0 })],
      payables: [],
    });

    assert.equal(
      projection.weeks.every((week) => week.collections === 0),
      true,
    );
    assert.equal(projection.weeks[3]?.closingBalance, 100);
  });

  it("redondea los totales a dos decimales", () => {
    const projection = buildCashFlowProjection({
      today: "2026-10-28",
      currentBalance: 0.1,
      receivables: [voucher({ comprobanteId: "r-1", balance: 0.2 })],
      payables: [],
    });

    assert.equal(projection.weeks[0]?.closingBalance, 0.3);
  });
});
