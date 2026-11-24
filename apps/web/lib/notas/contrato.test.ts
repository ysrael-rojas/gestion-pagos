// Test del contrato de notas (T2 del slice 3, S2/S8/S9 y S10 de `odd/tasks/port-vertical-notas.md`):
// el formulario, el body del API (sin numero, porque lo asigna la base) y el catalogo de motivos.
//
// Vive en `apps/web` por la misma razon que el resto de los contratos de `@gestion/shared`: el
// paquete no tiene runner propio y el de Node corre los `*.test.ts` de la app.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CREDIT_NOTE_MOTIVES,
  DEBIT_NOTE_MOTIVES,
} from "@gestion/shared/lib/data/nota-options.ts";
import {
  notaSchema,
  notaWriteSchema,
  voucherAdjustmentSchema,
} from "@gestion/shared/lib/schemas/nota.ts";

const notaBase = {
  issueDate: "2026-11-24",
  voucherType: "NOTA_CREDITO",
  voucherNumber: "FC01-000001",
  total: 100,
  motiveCode: "07",
  referencedComprobanteId: "550e8400-e29b-41d4-a716-446655440000",
};

test("el catalogo de motivos es el de SUNAT, sin el 08 (S9)", () => {
  assert.deepEqual(
    CREDIT_NOTE_MOTIVES.map((motive) => motive.value),
    ["01", "02", "03", "04", "05", "06", "07", "09", "10"]
  );
  assert.deepEqual(
    DEBIT_NOTE_MOTIVES.map((motive) => motive.value),
    ["01", "02", "03"]
  );
  assert.equal(CREDIT_NOTE_MOTIVES[0]?.label, "Anulación de la operación");
  assert.equal(DEBIT_NOTE_MOTIVES[2]?.label, "Penalidades / otros conceptos");
});

test("el formulario exige el numero, el body del API no (lo asigna la base)", () => {
  assert.equal(notaSchema.safeParse(notaBase).success, true);

  const sinNumero = { ...notaBase, voucherNumber: undefined };

  assert.equal(notaSchema.safeParse(sinNumero).success, false);
  assert.equal(notaWriteSchema.safeParse(sinNumero).success, true);
  // El body acepta el preview y lo deja pasar: la RPC lo ignora.
  assert.equal(notaWriteSchema.safeParse(notaBase).success, true);
});

test("el motivo es obligatorio en NC y en ND, y tiene que ser del catalogo del tipo (S8)", () => {
  const mensaje = (payload: Record<string, unknown>): string[] =>
    notaWriteSchema.safeParse(payload).error?.issues.map((issue) => issue.message) ??
    [];

  assert.deepEqual(mensaje({ ...notaBase, motiveCode: "" }), [
    "Selecciona el motivo de la nota",
  ]);
  // 01 de debito no pertenece al catalogo de credito, y al reves.
  assert.deepEqual(mensaje({ ...notaBase, motiveCode: "01" }), []);
  assert.deepEqual(
    mensaje({ ...notaBase, voucherType: "NOTA_DEBITO", motiveCode: "01" }),
    []
  );
  assert.deepEqual(
    mensaje({ ...notaBase, voucherType: "NOTA_DEBITO", motiveCode: "07" }),
    ["El motivo no pertenece al catálogo de la nota"]
  );
  // La retencion no lleva motivo: si viene, se rechaza, y si falta, pasa.
  assert.deepEqual(
    mensaje({ ...notaBase, voucherType: "COMPROBANTE_RETENCION", motiveCode: "01" }),
    ["El comprobante de retención no lleva motivo"]
  );
  assert.deepEqual(
    mensaje({
      ...notaBase,
      voucherType: "COMPROBANTE_RETENCION",
      motiveCode: undefined,
    }),
    []
  );
});

test("los mensajes de validacion del contrato son los de S8", () => {
  const mensaje = (payload: Record<string, unknown>): string[] =>
    notaWriteSchema.safeParse(payload).error?.issues.map((issue) => issue.message) ??
    [];

  assert.deepEqual(mensaje({ ...notaBase, issueDate: "" }), [
    "La fecha de emisión es requerida",
  ]);
  assert.deepEqual(mensaje({ ...notaBase, total: 0 }), [
    "El total debe ser mayor a 0",
  ]);
  assert.deepEqual(mensaje({ ...notaBase, total: "abc" }), [
    "Ingresa un total válido",
  ]);
  assert.deepEqual(mensaje({ ...notaBase, referencedComprobanteId: "" }), [
    "Selecciona el comprobante referenciado",
  ]);
  assert.deepEqual(mensaje({ ...notaBase, voucherType: "FACTURA" }), [
    "Selecciona el tipo de comprobante",
  ]);
});

test("la fila que lista el detalle lleva motivo y total, y no acepta retencion (S11)", () => {
  const row = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    voucherType: "NOTA_CREDITO",
    voucherNumber: "FC01-000001",
    issueDate: "2026-11-24",
    motiveCode: "07",
    total: 120,
  };

  assert.deepEqual(voucherAdjustmentSchema.parse(row), row);
  // Una retencion se lista en su propia solapa, no en esta.
  assert.equal(
    voucherAdjustmentSchema.safeParse({ ...row, voucherType: "COMPROBANTE_RETENCION" })
      .success,
    false
  );
  assert.equal(
    voucherAdjustmentSchema.safeParse({ ...row, motiveCode: null }).success,
    true
  );
});
