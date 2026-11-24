// Test del contrato compartido de series (T2 del slice 2, S10 de
// `odd/tasks/port-vertical-series.md`): el formulario de alta/edicion, el contrato de fila y la
// lista de tipos que la pantalla puede ofrecer.
//
// Vive aca porque `@gestion/shared` no tiene runner propio: el runner de Node corre los
// `*.test.ts` de `apps/web` e importa los archivos del paquete por subpath CON la extension `.ts`
// (misma razon que `lib/ventas/montos.test.ts`).
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ISSUED_SERIES_VOUCHER_TYPES,
  SERIES_VOUCHER_TYPES,
} from "@gestion/shared/lib/data/series-options.ts";
import {
  serieFormSchema,
  voucherSeriesSchema,
} from "@gestion/shared/lib/schemas/serie.ts";

const serieBase = { code: "F001", isDefault: true };

test("la pantalla solo ofrece los tipos que la app emite (S4)", () => {
  assert.deepEqual(
    ISSUED_SERIES_VOUCHER_TYPES.map((option) => option.value),
    ["FACTURA", "BOLETA", "NOTA_VENTA"]
  );
  // El catalogo completo sigue existiendo: las notas y la retencion llegan con su flujo.
  assert.equal(SERIES_VOUCHER_TYPES.length, 6);
});

test("todo tipo ofrecido lo acepta el formulario, y ningun otro", () => {
  for (const option of ISSUED_SERIES_VOUCHER_TYPES) {
    const parsed = serieFormSchema.safeParse({
      ...serieBase,
      voucherType: option.value,
    });

    assert.equal(parsed.success, true, `${option.value} deberia ser valido`);
  }

  // Los tres que no se emiten se rechazan con el mensaje del contrato (S7).
  for (const voucherType of [
    "NOTA_CREDITO",
    "NOTA_DEBITO",
    "COMPROBANTE_RETENCION",
  ]) {
    const parsed = serieFormSchema.safeParse({ ...serieBase, voucherType });

    assert.equal(parsed.success, false, `${voucherType} no deberia ofrecerse`);
    assert.deepEqual(
      parsed.error?.issues.map((issue) => issue.message),
      ["Selecciona el tipo de comprobante"]
    );
  }
});

test("el codigo de serie usa los mensajes del origen (S7)", () => {
  const mensaje = (code: string): string[] =>
    serieFormSchema.safeParse({ ...serieBase, voucherType: "FACTURA", code })
      .error?.issues.map((issue) => issue.message) ?? [];

  assert.deepEqual(mensaje(""), [
    "El código de serie es requerido",
    "Usa 1 a 4 caracteres alfanuméricos, por ejemplo F001",
  ]);
  assert.deepEqual(mensaje("F00012"), [
    "Usa 1 a 4 caracteres alfanuméricos, por ejemplo F001",
  ]);
  // El trim es del contrato: la base guarda el codigo sin espacios.
  assert.equal(
    serieFormSchema.parse({ ...serieBase, voucherType: "FACTURA", code: " F01 " })
      .code,
    "F01"
  );
});

test("el contrato de fila lleva el correlativo y la marca de default", () => {
  const row = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    voucherType: "FACTURA",
    code: "F001",
    lastNumber: 12,
    isDefault: true,
  };

  assert.deepEqual(voucherSeriesSchema.parse(row), row);
  // `last_number` nace en 0: el primer comprobante es el 1.
  assert.equal(
    voucherSeriesSchema.parse({ ...row, lastNumber: 0 }).lastNumber,
    0
  );
  assert.equal(
    voucherSeriesSchema.safeParse({ ...row, lastNumber: -1 }).success,
    false
  );
  assert.equal(
    voucherSeriesSchema.safeParse({ ...row, lastNumber: 1.5 }).success,
    false
  );
  assert.equal(
    voucherSeriesSchema.safeParse({ ...row, code: "F00012" }).success,
    false
  );
});
