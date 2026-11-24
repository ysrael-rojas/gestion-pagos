// Tests del formulario de alta de una nota (T4 del slice 3: S4, S8, S9 y S11 de
// `odd/tasks/port-vertical-notas.md`).
//
// Lo que se fija aca es lo que NO puede cambiar al portar, y todo se prueba por la superficie
// publica del modulo (nada de estados internos):
//
//   * Los valores iniciales del alta (el "hoy" del negocio via `getTodayLocalDate()`, motivo vacio)
//     y que el referenciado viaje fijo: la nota nace desde el detalle del comprobante (L3.f).
//   * El catalogo de motivos filtrado por el TIPO de la nota (S9): 9 de credito, 3 de debito.
//   * Los montos derivados del total con `saleAmounts` (S4: una sola formula del 18 %), incluidos
//     los totales que todavia no son un numero.
//   * El tope disponible (S5): lo que queda del total del referenciado despues de las notas de
//     credito ya aplicadas. Una nota de debito NO lo consume (S2/S9).
//   * El preview del numero desde la serie por defecto del tipo de la nota (S3/S11) y el body que
//     efectivamente viaja, que NO lleva el numero (lo asigna la base).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  notaSchema,
  notaWriteSchema,
  type VoucherAdjustmentRow,
} from "@gestion/shared/lib/schemas/nota.ts";
import { saleAmounts } from "@gestion/shared/lib/ventas/montos.ts";
import { getTodayLocalDate } from "@gestion/shared/lib/utils.ts";

import type { VoucherSeries } from "../ventas/types.ts";
import {
  availableCredit,
  createEmptyNotaFormValues,
  creditNotesTotal,
  debitNotesTotal,
  notaAmounts,
  notaMotiveLabel,
  notaMotiveOptions,
  previewNotaNumber,
  toNotaRequestBody,
} from "./formulario.ts";

/** Fila de nota de un comprobante (`GET /notes?voucherId=`), con lo que cada caso cambia. */
function nota(overrides: Partial<VoucherAdjustmentRow> = {}): VoucherAdjustmentRow {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    voucherType: "NOTA_CREDITO",
    voucherNumber: "FC01-000001",
    issueDate: "2026-11-24",
    motiveCode: "01",
    total: 118,
    ...overrides,
  };
}

function serie(
  voucherType: VoucherSeries["voucherType"],
  overrides: Partial<VoucherSeries> = {}
): VoucherSeries {
  return {
    id: `${voucherType}-1`,
    voucherType,
    code: voucherType.slice(0, 4),
    lastNumber: 0,
    isDefault: true,
    ...overrides,
  };
}

describe("createEmptyNotaFormValues", () => {
  it("arranca con el hoy del negocio, el referenciado fijo y el motivo vacio", () => {
    const values = createEmptyNotaFormValues({
      voucherType: "NOTA_CREDITO",
      referencedComprobanteId: "550e8400-e29b-41d4-a716-446655440000",
    });

    // S9: la fecha es la del NEGOCIO (`America/Lima`), nunca `toISOString()`.
    assert.equal(values.issueDate, getTodayLocalDate());
    assert.equal(values.voucherType, "NOTA_CREDITO");
    assert.equal(values.referencedComprobanteId, "550e8400-e29b-41d4-a716-446655440000");
    // S8: el motivo es obligatorio, pero el formulario arranca sin elegirlo a proposito.
    assert.equal(values.motiveCode, "");
    assert.equal(values.total, "");
    // S3/S11: el numero lo asigna la base; el formulario solo muestra el preview.
    assert.equal(values.voucherNumber, "");
  });

  it("el tipo es el de la nota que se esta registrando, no una opcion del formulario", () => {
    assert.equal(
      createEmptyNotaFormValues({
        voucherType: "NOTA_DEBITO",
        referencedComprobanteId: "550e8400-e29b-41d4-a716-446655440000",
      }).voucherType,
      "NOTA_DEBITO"
    );
  });
});

describe("notaMotiveOptions", () => {
  it("ofrece el catalogo de S9 del tipo de la nota, en su orden y sin el 08", () => {
    assert.deepEqual(
      notaMotiveOptions("NOTA_CREDITO").map((option) => option.value),
      ["01", "02", "03", "04", "05", "06", "07", "09", "10"]
    );
    assert.deepEqual(
      notaMotiveOptions("NOTA_DEBITO").map((option) => option.value),
      ["01", "02", "03"]
    );
  });

  it("etiqueta el motivo elegido con el catalogo de SU tipo de nota", () => {
    // `01` es "Anulación de la operación" en credito e "Intereses por mora" en debito: el mismo
    // codigo significa otra cosa, y por eso el catalogo se elige por tipo (S9).
    assert.equal(notaMotiveLabel("NOTA_CREDITO", "01"), "Anulación de la operación");
    assert.equal(notaMotiveLabel("NOTA_DEBITO", "01"), "Intereses por mora");
    assert.equal(notaMotiveLabel("NOTA_CREDITO", "10"), "Otros conceptos");
    // Una fila sin motivo (o con un codigo que no esta en el catalogo) no inventa una etiqueta.
    assert.equal(notaMotiveLabel("NOTA_CREDITO", null), "—");
    assert.equal(notaMotiveLabel("NOTA_CREDITO", "99"), "—");
  });
});

describe("notaAmounts", () => {
  it("deriva subtotal e IGV del total con la unica formula del 18 % (S4)", () => {
    assert.deepEqual(notaAmounts(118), { subtotal: 100, igv: 18 });
    assert.deepEqual(notaAmounts(118), saleAmounts(118));
  });

  it("un total vacio o no numerico no rompe el preview: muestra ceros", () => {
    // Mientras el usuario no escribio nada, el campo esta en `""`: `Number("")` da 0 pero
    // `Number("abc")` da NaN, y `saleAmounts(NaN)` pintaria "S/ NaN".
    assert.deepEqual(notaAmounts(""), { subtotal: 0, igv: 0 });
    assert.deepEqual(notaAmounts("abc"), { subtotal: 0, igv: 0 });
  });
});

describe("el tope disponible (S5)", () => {
  it("suma solo las notas de credito y solo las de debito", () => {
    const notas = [
      nota({ id: "a", total: 118 }),
      nota({ id: "b", total: 82 }),
      nota({ id: "c", voucherType: "NOTA_DEBITO", total: 50 }),
    ];

    assert.equal(creditNotesTotal(notas), 200);
    assert.equal(debitNotesTotal(notas), 50);
  });

  it("es el total del referenciado menos las notas de credito ya aplicadas", () => {
    // 1000 de total, 118 de NC: quedan 882 de tope. La ND de 50 no lo consume (S2).
    const notas = [
      nota({ id: "a", total: 118 }),
      nota({ id: "b", voucherType: "NOTA_DEBITO", total: 50 }),
    ];

    assert.equal(availableCredit(1000, notas), 882);
    assert.equal(availableCredit(1000, []), 1000);
  });

  it("nunca es negativo: un tope agotado se muestra como 0", () => {
    // El tope es una invariante de base (S5), asi que este caso solo puede venir de datos
    // historicos; mostrar un negativo seria peor que mostrar 0.
    assert.equal(availableCredit(100, [nota({ total: 150 })]), 0);
  });
});

describe("previewNotaNumber", () => {
  it("muestra el proximo correlativo de la serie por defecto del tipo de la nota (S3)", () => {
    const series = [
      serie("FACTURA", { code: "F001", lastNumber: 9 }),
      serie("NOTA_CREDITO", { code: "FC01", lastNumber: 5 }),
      serie("NOTA_DEBITO", { code: "FD01", lastNumber: 41 }),
    ];

    assert.equal(previewNotaNumber("NOTA_CREDITO", series), "FC01-000006");
    assert.equal(previewNotaNumber("NOTA_DEBITO", series), "FD01-000042");
  });

  it("sin serie por defecto del tipo no inventa un numero", () => {
    // Es el caso de la pantalla bloqueada de S3: sin serie no hay numero, y no se muestra el de
    // otro tipo.
    assert.equal(previewNotaNumber("NOTA_CREDITO", [serie("FACTURA", { code: "F001" })]), "");
    assert.equal(previewNotaNumber("NOTA_CREDITO", []), "");
  });

  it("ignora una serie del tipo que no es la predeterminada", () => {
    const series = [
      serie("NOTA_CREDITO", { id: "a", code: "FC01", lastNumber: 5, isDefault: false }),
      serie("NOTA_CREDITO", { id: "b", code: "FC02", lastNumber: 0 }),
    ];

    assert.equal(previewNotaNumber("NOTA_CREDITO", series), "FC02-000001");
  });
});

describe("toNotaRequestBody", () => {
  const values = notaSchema.parse({
    issueDate: "2026-11-24",
    voucherType: "NOTA_CREDITO",
    voucherNumber: "FC01-000006",
    total: 118,
    motiveCode: "01",
    referencedComprobanteId: "550e8400-e29b-41d4-a716-446655440000",
  });

  it("NO manda el numero: lo asigna la base desde la serie del tipo (S3)", () => {
    const body = toNotaRequestBody(values);

    assert.equal("voucherNumber" in body, false);
    // Y el body sigue siendo valido para el contrato del API, que ya no lo exige.
    assert.equal(notaWriteSchema.safeParse(body).success, true);
  });

  it("manda los cinco datos que SI viajan, sin los que se heredan del referenciado (S4)", () => {
    assert.deepEqual(toNotaRequestBody(values), {
      issueDate: "2026-11-24",
      voucherType: "NOTA_CREDITO",
      total: 118,
      motiveCode: "01",
      referencedComprobanteId: "550e8400-e29b-41d4-a716-446655440000",
    });
  });
});
