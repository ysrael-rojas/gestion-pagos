// Series y correlativo (T4 del port del vertical ventas, S5 y S7).
//
// Dos cosas se prueban aca, y las dos son reglas del origen que no pueden cambiar al portar:
//
//   1. La SUGERENCIA del numero (`CODIGO-(last_number+1)` con relleno a 6) es una ayuda editable,
//      no una condicion: S7 y la RPC `crear_venta` dejan registrar sin serie configurada. Por eso
//      el formulario no bloquea el guardado cuando no hay series.
//   2. Los textos de S5 que viven solo en la pantalla. Se fijan VERBATIM porque son el contrato
//      visible: el usuario los lee y `Configuración → Series` nombra la pantalla destino.
//
// El origen los armaba con JSX partido en varias lineas (`{" "}` de por medio), asi que el texto
// exacto solo estaba garantizado a ojo. Aca salen de una funcion y el test los compara completos.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VoucherSeries } from "./types.ts";
import {
  CONFIGURE_SERIES_LABEL,
  NO_SALE_SERIES_HINT,
  NO_SALE_SERIES_MESSAGE,
  SERIES_CONFIG_PATH,
  defaultSeriesByType,
  formatSeriesCorrelative,
  hasAnyDefaultSaleSeries,
  isSaleSeriesBlocked,
  isVoucherTypeDisabled,
  joinLabels,
  missingDefaultSaleSeriesLabels,
  missingSeriesMessage,
  suggestVoucherNumber,
} from "./series.ts";

const series = (
  voucherType: VoucherSeries["voucherType"],
  overrides: Partial<VoucherSeries> = {}
): VoucherSeries => ({
  id: `${voucherType}-1`,
  voucherType,
  code: voucherType.slice(0, 4),
  lastNumber: 0,
  isDefault: true,
  ...overrides,
});

describe("suggestVoucherNumber", () => {
  it("sugiere CODIGO-(last_number+1) con relleno a 6 digitos", () => {
    assert.equal(suggestVoucherNumber({ code: "F001", lastNumber: 0 }), "F001-000001");
    assert.equal(suggestVoucherNumber({ code: "F001", lastNumber: 125 }), "F001-000126");
  });

  it("normaliza el codigo (trim y mayusculas) sin tocar el correlativo", () => {
    assert.equal(suggestVoucherNumber({ code: " b001 ", lastNumber: 9 }), "B001-000010");
  });

  it("no recorta un correlativo que ya supero los 6 digitos", () => {
    assert.equal(suggestVoucherNumber({ code: "F001", lastNumber: 1_234_567 }), "F001-1234568");
  });
});

describe("formatSeriesCorrelative", () => {
  it("rellena a 6 digitos el correlativo que muestra la tabla de series", () => {
    assert.equal(formatSeriesCorrelative(0), "000000");
    assert.equal(formatSeriesCorrelative(125), "000125");
  });
});

describe("defaultSeriesByType", () => {
  it("indexa solo las series por defecto y deja la ultima por tipo", () => {
    const map = defaultSeriesByType([
      series("FACTURA", { code: "F001", isDefault: false }),
      series("FACTURA", { id: "factura-vieja", code: "F000" }),
      series("FACTURA", { id: "factura-nueva", code: "F999" }),
      series("BOLETA", { code: "B001" }),
    ]);

    assert.equal(map.size, 2);
    assert.equal(map.get("FACTURA")?.code, "F999");
    assert.equal(map.get("BOLETA")?.code, "B001");
    assert.equal(map.get("NOTA_VENTA"), undefined);
  });
});

describe("hasAnyDefaultSaleSeries", () => {
  it("solo cuenta los tres tipos base de venta", () => {
    assert.equal(hasAnyDefaultSaleSeries([]), false);
    assert.equal(hasAnyDefaultSaleSeries([series("NOTA_CREDITO")]), false, "una nota no habilita el formulario");
    assert.equal(hasAnyDefaultSaleSeries([series("BOLETA")]), true);
  });
});

describe("missingDefaultSaleSeriesLabels", () => {
  it("devuelve las etiquetas de los tipos de venta sin serie por defecto, en orden del catalogo", () => {
    assert.deepEqual(missingDefaultSaleSeriesLabels([]), ["Factura", "Boleta", "Nota de venta"]);
    assert.deepEqual(missingDefaultSaleSeriesLabels([series("FACTURA")]), ["Boleta", "Nota de venta"]);
    // Una serie NO por defecto no cubre el tipo.
    assert.deepEqual(
      missingDefaultSaleSeriesLabels([series("FACTURA", { isDefault: false })]),
      ["Factura", "Boleta", "Nota de venta"]
    );
    assert.deepEqual(
      missingDefaultSaleSeriesLabels([series("FACTURA"), series("BOLETA"), series("NOTA_VENTA")]),
      []
    );
  });
});

describe("joinLabels", () => {
  it("une con comas y una 'y' antes del ultimo", () => {
    assert.equal(joinLabels([]), "");
    assert.equal(joinLabels(["Factura"]), "Factura");
    assert.equal(joinLabels(["Factura", "Boleta"]), "Factura y Boleta");
    assert.equal(joinLabels(["Factura", "Boleta", "Nota de venta"]), "Factura, Boleta y Nota de venta");
  });
});

describe("mensajes de series (S5)", () => {
  it("arma el mensaje que nombra las series que faltan", () => {
    assert.equal(
      missingSeriesMessage(["Boleta", "Nota de venta"]),
      "Configura una serie por defecto para Boleta y Nota de venta en Configuración → Series."
    );
    assert.equal(
      missingSeriesMessage(["Factura", "Boleta", "Nota de venta"]),
      "Configura una serie por defecto para Factura, Boleta y Nota de venta en Configuración → Series."
    );
  });

  it("no arma mensaje cuando no falta ninguna serie", () => {
    assert.equal(missingSeriesMessage([]), "");
  });

  it("conserva los textos del origen y el destino del enlace", () => {
    assert.equal(NO_SALE_SERIES_MESSAGE, "Aún no tienes series de venta configuradas.");
    assert.equal(
      NO_SALE_SERIES_HINT,
      "Sin una serie por defecto no podrás elegir el tipo de comprobante ni registrar la venta."
    );
    assert.equal(CONFIGURE_SERIES_LABEL, "Configurar series");
    // T4/T5 del slice 2: la pantalla ya existe, asi que el enlace deja de apuntar a `/configuracion`
    // (que ahora redirige) y va directo a la ruta de S8.
    assert.equal(SERIES_CONFIG_PATH, "/configuracion/series");
  });
});

describe("isSaleSeriesBlocked", () => {
  it("bloquea el alta de ventas sin ninguna serie por defecto (S11)", () => {
    assert.equal(
      isSaleSeriesBlocked({ voucherKind: "VENTA", isEditing: false, series: [] }),
      true
    );
    // Una serie que no es por defecto no habilita el alta: la base no tiene de donde numerar.
    assert.equal(
      isSaleSeriesBlocked({
        voucherKind: "VENTA",
        isEditing: false,
        series: [series("FACTURA", { isDefault: false })],
      }),
      true
    );
    assert.equal(
      isSaleSeriesBlocked({
        voucherKind: "VENTA",
        isEditing: false,
        series: [series("BOLETA")],
      }),
      false
    );
  });

  it("no bloquea la edicion ni el vertical de compras", () => {
    // Un comprobante ya emitido tiene su numero: editar no necesita serie (y el numero no cambia).
    assert.equal(
      isSaleSeriesBlocked({ voucherKind: "VENTA", isEditing: true, series: [] }),
      false
    );
    assert.equal(
      isSaleSeriesBlocked({ voucherKind: "COMPRA", isEditing: false, series: [] }),
      false
    );
  });
});

describe("isVoucherTypeDisabled", () => {
  const defaults = (...types: VoucherSeries["voucherType"][]) =>
    defaultSeriesByType(types.map((type) => series(type)));

  it("en ventas deshabilita el tipo sin serie por defecto", () => {
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "VENTA",
        voucherType: "BOLETA",
        defaultByType: defaults("FACTURA"),
        canIssueFactura: true,
      }),
      true
    );
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "VENTA",
        voucherType: "BOLETA",
        defaultByType: defaults("BOLETA"),
        canIssueFactura: true,
      }),
      false
    );
  });

  it("deshabilita FACTURA cuando el cliente no tiene RUC, aunque tenga serie", () => {
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "VENTA",
        voucherType: "FACTURA",
        defaultByType: defaults("FACTURA"),
        canIssueFactura: false,
      }),
      true
    );
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "VENTA",
        voucherType: "FACTURA",
        defaultByType: defaults("FACTURA"),
        canIssueFactura: true,
      }),
      false
    );
  });

  it("en compras no aplica ninguna de las dos reglas", () => {
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "COMPRA",
        voucherType: "FACTURA",
        defaultByType: new Map(),
        canIssueFactura: false,
      }),
      false
    );
  });

  it("sin fuente de series (`null`) no afirma que falte una: solo aplica la regla del RUC", () => {
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "VENTA",
        voucherType: "BOLETA",
        defaultByType: null,
        canIssueFactura: false,
      }),
      false
    );
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "VENTA",
        voucherType: "FACTURA",
        defaultByType: null,
        canIssueFactura: false,
      }),
      true
    );
    assert.equal(
      isVoucherTypeDisabled({
        voucherKind: "VENTA",
        voucherType: "FACTURA",
        defaultByType: null,
        canIssueFactura: true,
      }),
      false
    );
  });
});
