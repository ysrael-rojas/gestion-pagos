// Tests de la tabla de notas del detalle de un comprobante (T4 del slice 3: S1, S9 y S11 de
// `odd/tasks/port-vertical-notas.md`).
//
// La fila se arma en el modelo y no en el JSX para poder afirmar los textos de S11 sin montar
// React: `Tipo`, `Número`, `Emisión`, `Motivo` y `Total` con el formato de la casa (`dd/mm/yyyy` y
// `S/`), y los dos totales de la seccion (`Notas de crédito`, `Notas de débito`).
//
// Lo que se fija: la etiqueta del tipo, el motivo traducido con el catalogo de SU tipo (el codigo
// `01` significa otra cosa en credito y en debito, S9), la marca `—` cuando no hay motivo y que los
// totales NO mezclen credito con debito (la ND aumenta el saldo, la NC lo baja: S2).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VoucherAdjustmentRow } from "@gestion/shared/lib/schemas/nota.ts";
import { formatCurrency } from "@gestion/shared/lib/utils.ts";

import { hasNotas, notaTotals, toNotaTableRow, toNotaTableRows } from "./tabla.ts";

function nota(overrides: Partial<VoucherAdjustmentRow> = {}): VoucherAdjustmentRow {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    voucherType: "NOTA_CREDITO",
    voucherNumber: "FC01-000001",
    issueDate: "2026-11-24",
    motiveCode: "07",
    total: 118,
    ...overrides,
  };
}

describe("toNotaTableRow", () => {
  it("resuelve el tipo, la fecha y el total con los textos y formatos del detalle", () => {
    const row = toNotaTableRow(nota());

    assert.equal(row.voucherTypeLabel, "Nota de crédito");
    assert.equal(row.voucherNumber, "FC01-000001");
    assert.equal(row.issueDateLabel, "24/11/2026");
    assert.equal(row.totalLabel, formatCurrency(118));
    // Las columnas crudas se conservan: son las que ordenan y filtran.
    assert.equal(row.issueDate, "2026-11-24");
    assert.equal(row.total, 118);
  });

  it("traduce el motivo con el catalogo del TIPO de la nota (S9)", () => {
    assert.equal(toNotaTableRow(nota()).motiveLabel, "Devolución por ítem");
    assert.equal(
      toNotaTableRow(nota({ voucherType: "NOTA_DEBITO", motiveCode: "01" })).motiveLabel,
      "Intereses por mora"
    );
    assert.equal(toNotaTableRow(nota()).voucherTypeLabel, "Nota de crédito");
    assert.equal(
      toNotaTableRow(nota({ voucherType: "NOTA_DEBITO" })).voucherTypeLabel,
      "Nota de débito"
    );
  });

  it("una fila sin motivo (o con un codigo fuera del catalogo) no inventa una etiqueta", () => {
    assert.equal(toNotaTableRow(nota({ motiveCode: null })).motiveLabel, "—");
    assert.equal(toNotaTableRow(nota({ motiveCode: "99" })).motiveLabel, "—");
  });

  it("conserva el orden del API (emision mas reciente primero)", () => {
    const rows = toNotaTableRows([
      nota({ id: "a", voucherNumber: "FC01-000002" }),
      nota({ id: "b", voucherNumber: "FC01-000001" }),
    ]);

    assert.deepEqual(
      rows.map((row) => row.voucherNumber),
      ["FC01-000002", "FC01-000001"]
    );
  });
});

describe("los totales de la seccion (S11)", () => {
  it("suma por separado las notas de credito y las de debito", () => {
    const totals = notaTotals([
      nota({ id: "a", total: 118 }),
      nota({ id: "b", total: 82 }),
      nota({ id: "c", voucherType: "NOTA_DEBITO", total: 50 }),
    ]);

    assert.equal(totals.credit, 200);
    assert.equal(totals.debit, 50);
    assert.equal(totals.creditLabel, formatCurrency(200));
    assert.equal(totals.debitLabel, formatCurrency(50));
  });

  it("sin notas los dos totales son cero (la seccion muestra el vacio de S11)", () => {
    const totals = notaTotals([]);

    assert.equal(totals.credit, 0);
    assert.equal(totals.debit, 0);
    assert.equal(hasNotas([]), false);
    assert.equal(hasNotas([nota()]), true);
  });
});
