// Contrato del body de compras (T2 del slice 4, S2 y S9 de `odd/tasks/port-vertical-compras.md`).
//
// La unica diferencia con la venta es el numero: en una compra lo puso el proveedor, asi que el
// cliente lo manda y el API lo exige. Todo lo demas sale de la misma fabrica del contrato
// compartido, para que las reglas de IGV, dias de credito y estado no se dupliquen.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  purchaseWriteSchema,
  voucherWriteSchema,
} from "@gestion/shared/lib/schemas/voucher.ts";

const compraBase = {
  issueDate: "2026-11-24",
  voucherType: "FACTURA",
  voucherNumber: "F001-000123",
  entityId: "550e8400-e29b-41d4-a716-446655440000",
  total: 118,
  paymentType: "CONTADO",
  status: "PENDIENTE",
};

test("en una compra el numero es obligatorio y en una venta no (S2)", () => {
  assert.equal(purchaseWriteSchema.safeParse(compraBase).success, true);
  // La venta ignora el numero porque lo asigna la base; la compra no tiene serie nuestra.
  assert.equal(
    voucherWriteSchema.safeParse({ ...compraBase, voucherNumber: undefined }).success,
    true
  );
  assert.equal(
    purchaseWriteSchema.safeParse({ ...compraBase, voucherNumber: undefined })
      .success,
    false
  );
});

test("el numero de compra usa el mensaje del contrato compartido", () => {
  const mensaje = (voucherNumber: string): string[] =>
    purchaseWriteSchema.safeParse({ ...compraBase, voucherNumber }).error?.issues.map(
      (issue) => issue.message
    ) ?? [];

  assert.deepEqual(mensaje(""), [
    "El número de comprobante es requerido",
    "Usa el formato serie-correlativo, por ejemplo F001-000001",
  ]);
  assert.deepEqual(mensaje("F001"), [
    "Usa el formato serie-correlativo, por ejemplo F001-000001",
  ]);
  // El numero del proveedor puede tener su propia serie: el patron es el mismo.
  assert.deepEqual(mensaje("FC01-000001"), []);
  assert.deepEqual(mensaje("F001-99999999"), []);
});

test("el resto del contrato es el de la venta: credito y CONTADO (S9)", () => {
  // CONTADO limpia los dias, igual que en la venta (misma fabrica).
  assert.equal(
    purchaseWriteSchema.parse({ ...compraBase, paymentType: "CONTADO", creditDays: 30 })
      .creditDays,
    null
  );
  // CREDITO los exige con el mensaje del contrato.
  assert.deepEqual(
    purchaseWriteSchema
      .safeParse({ ...compraBase, paymentType: "CREDITO" })
      .error?.issues.map((issue) => issue.message),
    ["Ingresa los días de crédito"]
  );
  // `supplierId` NO es una clave del contrato compartido: la vista lo mapea a `entityId`.
  assert.equal(
    purchaseWriteSchema.safeParse({ ...compraBase, supplierId: "x" }).success,
    true
  );
});
