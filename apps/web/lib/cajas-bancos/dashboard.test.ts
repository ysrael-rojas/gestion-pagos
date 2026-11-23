// Resumen de posiciones y flujo del mes del dashboard (C5 y C7 del vertical de cajas-bancos).
//
// Port de `tests/unit/lib/caja/dashboard.test.ts` del origen (vitest) a `node:test`. En C5 se
// porto la mitad de posiciones (`summarizePositions`, los cuatro totales del listado de cuentas, y
// `toPen`, la consolidacion a soles de SPEC 52); C7 suma la mitad del flujo
// (`summarizeCashFlow`: ingresos, egresos y neto).
//
// DONDE NO ESTA `getMonthRange`: vive en `periodo.ts` desde C5 (es aritmetica de calendario y
// tiene dos consumidores) y se prueba en `periodo.test.ts`. No se duplica aca.
//
// POR QUE NO HAY UN CASO DE RECIBO ANULADO ACA: `FlowLike` tiene direccion e importe y nada mas, y
// el filtro `status <> 'ANULADO'` lo aplica el SQL de `GET /cash-flow/monthly` (S2). El caso del
// anulado esta donde vive la regla, en el test del cliente (`lib/cajas-bancos/flujo.test.ts`): un
// recibo anulado nunca llega a esta funcion, y agregarle un `status` para volver a filtrarlo aca
// seria una segunda definicion de "anulado" en el mismo repo.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { summarizeCashFlow, summarizePositions, toPen } from "./dashboard.ts";

describe("summarizeCashFlow", () => {
  it("suma ingresos y egresos y calcula el neto", () => {
    const totals = summarizeCashFlow([
      { direction: "INGRESO", amount: 1000 },
      { direction: "INGRESO", amount: 250.5 },
      { direction: "EGRESO", amount: 400 },
    ]);

    assert.deepEqual(totals, { income: 1250.5, expense: 400, net: 850.5 });
  });

  it("devuelve ceros cuando no hay movimientos", () => {
    assert.deepEqual(summarizeCashFlow([]), { income: 0, expense: 0, net: 0 });
  });

  it("permite un neto negativo", () => {
    const totals = summarizeCashFlow([
      { direction: "INGRESO", amount: 100 },
      { direction: "EGRESO", amount: 350 },
    ]);

    assert.equal(totals.net, -250);
  });

  it("redondea a dos decimales para evitar ruido de punto flotante", () => {
    const totals = summarizeCashFlow([
      { direction: "INGRESO", amount: 0.1 },
      { direction: "INGRESO", amount: 0.2 },
    ]);

    assert.equal(totals.income, 0.3);
    assert.equal(totals.net, 0.3);
  });

  it("no cuenta filas sin direccion de caja", () => {
    const totals = summarizeCashFlow([
      { direction: "INGRESO", amount: 500 },
      // Una fila que no es ingreso ni egreso no suma a ninguno de los dos lados.
      { direction: null as unknown as "INGRESO", amount: 999 },
    ]);

    assert.deepEqual(totals, { income: 500, expense: 0, net: 500 });
  });
});

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
