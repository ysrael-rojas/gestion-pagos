// Resumenes del reporte de cuadre y del extracto (C5 del vertical de cajas-bancos).
//
// Port de `tests/unit/lib/caja/reportes.test.ts` del origen (vitest) a `node:test`. Las dos
// funciones son las que arman el acta impresa: la secuencia de recibos del periodo (SPEC 49) y
// los totales del extracto (SPEC 51). `summarizeStatement` no tenia consumidor en C5 (la tabla de
// movimientos del reporte usaba los recibos directos); desde C6 lo consume la pantalla de extractos,
// asi que la regla que se prueba aca es la que se ve: los anulados no suman.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatReceiptRanges,
  summarizeReceiptSequence,
  summarizeStatement,
} from "./reportes.ts";

describe("summarizeReceiptSequence", () => {
  it("calcula el primer y ultimo recibo por prefijo", () => {
    const summary = summarizeReceiptSequence([
      { receiptNumber: "RI-000012", status: "EN_REVISION" },
      { receiptNumber: "RI-000031", status: "PROCESADO" },
      { receiptNumber: "RI-000020", status: "EN_REVISION" },
      { receiptNumber: "RE-000004", status: "EN_REVISION" },
      { receiptNumber: "RE-000006", status: "EN_REVISION" },
    ]);

    assert.deepEqual(summary.ranges, [
      { prefix: "RE-", first: "RE-000004", last: "RE-000006", count: 2 },
      { prefix: "RI-", first: "RI-000012", last: "RI-000031", count: 3 },
    ]);
    assert.equal(
      formatReceiptRanges(summary),
      "RE-000004 → RE-000006 · RI-000012 → RI-000031",
    );
  });

  it("cuenta los recibos anulados del periodo", () => {
    const summary = summarizeReceiptSequence([
      { receiptNumber: "RI-000001", status: "ANULADO" },
      { receiptNumber: "RI-000002", status: "EN_REVISION" },
      { receiptNumber: "RI-000003", status: "ANULADO" },
    ]);

    assert.equal(summary.annulled, 2);
  });

  it("muestra un solo numero cuando el rango es de un recibo", () => {
    const summary = summarizeReceiptSequence([
      { receiptNumber: "RI-000005", status: "EN_REVISION" },
    ]);

    assert.equal(formatReceiptRanges(summary), "RI-000005");
  });

  it("devuelve — sin recibos e ignora numeros vacios", () => {
    assert.equal(formatReceiptRanges(summarizeReceiptSequence([])), "—");
    // Un recibo sin numero (dato historico) no arma rango pero SI cuenta como anulado.
    assert.equal(
      formatReceiptRanges(
        summarizeReceiptSequence([{ receiptNumber: "  ", status: "ANULADO" }]),
      ),
      "—",
    );
    assert.equal(
      summarizeReceiptSequence([{ receiptNumber: "", status: "ANULADO" }]).annulled,
      1,
    );
  });
});

describe("summarizeStatement", () => {
  it("suma ingresos y egresos sin anulados y cuenta transferencias", () => {
    const summary = summarizeStatement(
      [
        { direction: "INGRESO", amount: 100, status: "EN_REVISION" },
        { direction: "INGRESO", amount: 50, status: "ANULADO" },
        { direction: "EGRESO", amount: 30, status: "PROCESADO" },
      ],
      [{ id: "t-1" }, { id: "t-2" }],
    );

    assert.deepEqual(summary, {
      income: 100,
      expense: 30,
      movements: 2,
      transfers: 2,
    });
  });

  it("devuelve cero sin movimientos", () => {
    assert.deepEqual(summarizeStatement([], []), {
      income: 0,
      expense: 0,
      movements: 0,
      transfers: 0,
    });
  });

  it("redondea los totales a dos decimales", () => {
    const summary = summarizeStatement(
      [
        { direction: "INGRESO", amount: 0.1, status: "EN_REVISION" },
        { direction: "INGRESO", amount: 0.2, status: "EN_REVISION" },
      ],
      [],
    );

    assert.equal(summary.income, 0.3);
  });
});
