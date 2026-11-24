// Body de escritura de una compra (T4, S2 y S9 de `odd/tasks/port-vertical-compras.md`).
//
// La diferencia con la venta es UNA y es de negocio: en una compra el numero lo emitio el proveedor,
// asi que lo tipea el usuario y viaja en el body (`purchaseWriteSchema` lo exige). En la venta lo
// asigna la base desde la serie por defecto del tipo, y el cliente no lo manda. Las dos variantes
// salen del mismo armador (`toVoucherRequestBody`), no de una copia.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  purchaseWriteSchema,
  voucherWriteSchema,
  type VoucherFormValues,
} from "@gestion/shared/lib/schemas/voucher.ts";

import { toVoucherRequestBody } from "../ventas/formulario.ts";

/** El OUTPUT del schema compartido: lo que `onSubmit` entrega al hacer clic en Guardar. */
const formValues = (overrides: Partial<VoucherFormValues> = {}): VoucherFormValues => ({
  issueDate: "2026-03-15",
  voucherType: "FACTURA",
  voucherNumber: "F001-000123",
  entityId: "550e8400-e29b-41d4-a716-446655440001",
  total: 118,
  paymentType: "CONTADO",
  creditDays: null,
  status: "PENDIENTE",
  ...overrides,
});

describe("toVoucherRequestBody en compras", () => {
  it("manda el numero del proveedor y el contrato de compra lo acepta", () => {
    const body = toVoucherRequestBody(formValues(), "COMPRA");

    assert.deepEqual(body, {
      issueDate: "2026-03-15",
      voucherType: "FACTURA",
      voucherNumber: "F001-000123",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
      total: 118,
      paymentType: "CONTADO",
      status: "PENDIENTE",
    });
    assert.equal(purchaseWriteSchema.safeParse(body).success, true);
    // Y es OBLIGATORIO: el mismo body sin numero es un 400 del contrato de compras (S2).
    const { voucherNumber: _omit, ...sinNumero } = body;

    assert.equal(purchaseWriteSchema.safeParse(sinNumero).success, false);
  });

  it("en CONTADO no viaja `creditDays` (el campo se omite, no se manda null)", () => {
    const body = toVoucherRequestBody(formValues(), "COMPRA");

    assert.equal("creditDays" in body, false);
    assert.equal(purchaseWriteSchema.parse(body).creditDays, null);
  });

  it("en CREDITO conserva los dias, como el contrato compartido", () => {
    const body = toVoucherRequestBody(
      formValues({ paymentType: "CREDITO", creditDays: 15 }),
      "COMPRA"
    );

    assert.equal(body.creditDays, 15);
    assert.equal(purchaseWriteSchema.safeParse(body).success, true);
  });
});

describe("toVoucherRequestBody en ventas (sin cambios)", () => {
  it("sigue sin mandar el numero: lo asigna la base desde la serie (S2/S11 del slice 2)", () => {
    const body = toVoucherRequestBody(formValues());

    assert.equal("voucherNumber" in body, false);
    assert.equal(voucherWriteSchema.safeParse(body).success, true);
  });
});
