// Resumen de posiciones del listado de cuentas (C5 del vertical de cajas-bancos).
//
// Port de `tests/unit/lib/caja/dashboard.test.ts` del origen (vitest) a `node:test`, reducido a
// la mitad que este slice consume: `summarizePositions` (los cuatro totales del listado de
// cuentas) y `toPen` (la consolidacion a soles, SPEC 52). El flujo del mes
// (`getMonthRange`/`summarizeCashFlow`) es del dashboard de C7 y no se prueba aca.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizePositions, toPen } from "./dashboard.ts";

describe("summarizePositions", () => {
  it("totaliza y separa caja de banco", () => {
    const summary = summarizePositions([
      { type: "CASH_BOX", balance: 500 },
      { type: "BANK_ACCOUNT", balance: 9320 },
      { type: "CASH_BOX", balance: 462 },
    ]);

    assert.deepEqual(summary, {
      total: 10282,
      cashTotal: 962,
      bankTotal: 9320,
      count: 3,
    });
  });

  it("el total cuadra con la suma de las cuentas individuales", () => {
    const positions = [
      { type: "CASH_BOX" as const, balance: 125.25 },
      { type: "BANK_ACCOUNT" as const, balance: 300.75 },
    ];

    assert.equal(
      summarizePositions(positions).total,
      positions.reduce((sum, position) => sum + position.balance, 0),
    );
  });

  it("redondea a dos decimales para no arrastrar ruido de punto flotante", () => {
    const summary = summarizePositions([
      { type: "CASH_BOX", balance: 0.1 },
      { type: "CASH_BOX", balance: 0.2 },
    ]);

    assert.equal(summary.total, 0.3);
    assert.equal(summary.cashTotal, 0.3);
  });

  it("devuelve ceros sin cuentas", () => {
    assert.deepEqual(summarizePositions([]), {
      total: 0,
      cashTotal: 0,
      bankTotal: 0,
      count: 0,
    });
  });
});

describe("toPen", () => {
  it("deja los saldos en soles igual", () => {
    assert.equal(toPen(100, "PEN", 3.75), 100);
  });

  it("convierte dolares con el tipo de cambio", () => {
    assert.equal(toPen(100, "USD", 3.75), 375);
  });

  it("cuenta los dolares como 0 sin tipo de cambio", () => {
    // SPEC 52: sin TC configurado la cuenta en USD no se suma y la pantalla avisa.
    assert.equal(toPen(100, "USD", null), 0);
  });
});
