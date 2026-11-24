// Formulario del comprobante (T4 del port del vertical ventas, S3, S5 y S9).
//
// Lo que se prueba:
//
//   1. El default de la fecha de emision sale de `getTodayLocalDate()` (S9: el "hoy" del NEGOCIO,
//      `America/Lima`), nunca de `toISOString()` ni del reloj del proceso.
//   2. Dias de credito (S3): al elegir Credito arranca en 30 y al volver a Contado se limpia.
//   3. El body del POST/PATCH. Aca estaba una TRAMPA del port, ya cerrada: el OUTPUT de
//      `voucherFormSchema` (`creditDays: null` en CONTADO) no era un INPUT valido del mismo schema,
//      porque `z.coerce.number(null)` da 0 y falla `min(1)`. El schema ahora trata `null` como
//      ausente (L13), asi que su output vuelve a entrar; `toVoucherRequestBody` igual omite el campo
//      cuando es null, y eso se prueba aca.
//   4. El preview del numero de comprobante (S11): el alta muestra `code-(last+1)` de la serie por
//      defecto y el numero deja de viajar en el body; la edicion muestra el numero ya emitido.
//   5. Los textos de S5 que dictan la pantalla: la regla "FACTURA exige cliente con RUC" (que el
//      API NO valida a proposito), el aviso de comprobante con pagos, y "Sin dirección registrada".
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CREDIT_DAYS } from "@gestion/shared/lib/data/sale-options.ts";
import {
  voucherFormSchema,
  voucherWriteSchema,
  type VoucherFormValues,
} from "@gestion/shared/lib/schemas/voucher.ts";
import { getTodayLocalDate } from "@gestion/shared/lib/utils.ts";

import type { VoucherDetail } from "./types.ts";
import {
  FACTURA_REQUIRES_RUC,
  FACTURA_RUC_HINT,
  NO_ADDRESS_PLACEHOLDER,
  canIssueFactura,
  createEmptyVoucherFormValues,
  creditDaysForPaymentType,
  isPaidLocked,
  paidLockMessage,
  previewVoucherNumber,
  toVoucherFormValues,
  toVoucherRequestBody,
  voucherCopy,
} from "./formulario.ts";

const detail = (overrides: Partial<VoucherDetail> = {}): VoucherDetail => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  issueDate: "2026-03-15",
  registrationDate: "2026-03-15",
  voucherType: "FACTURA",
  voucherNumber: "F001-000001",
  entityId: "550e8400-e29b-41d4-a716-446655440001",
  subtotal: 84.75,
  igv: 15.25,
  total: 100,
  paymentType: "CONTADO",
  creditDays: null,
  dueDate: null,
  status: "PENDIENTE",
  paidAmount: 0,
  balance: 100,
  entityName: "Bodega Ana",
  ...overrides,
});

/** El OUTPUT del schema compartido: lo que `onSubmit` entrega al hacer clic en Guardar. */
const formValues = (overrides: Partial<VoucherFormValues> = {}): VoucherFormValues => ({
  issueDate: "2026-03-15",
  voucherType: "BOLETA",
  voucherNumber: "B001-000001",
  entityId: "550e8400-e29b-41d4-a716-446655440001",
  total: 100,
  paymentType: "CONTADO",
  creditDays: null,
  status: "PENDIENTE",
  ...overrides,
});

describe("createEmptyVoucherFormValues", () => {
  it("arranca con el hoy del negocio y el estado pendiente del catalogo", () => {
    assert.deepEqual(createEmptyVoucherFormValues(), {
      issueDate: getTodayLocalDate(),
      voucherType: "",
      voucherNumber: "",
      entityId: "",
      total: "",
      paymentType: "",
      creditDays: "",
      status: "PENDIENTE",
    });
  });

  it("usa una fecha del formato de la base (YYYY-MM-DD), no un ISO con hora", () => {
    assert.match(createEmptyVoucherFormValues().issueDate, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("toVoucherFormValues", () => {
  it("carga un comprobante de CONTADO con los dias de credito vacios", () => {
    assert.deepEqual(toVoucherFormValues(detail()), {
      issueDate: "2026-03-15",
      voucherType: "FACTURA",
      voucherNumber: "F001-000001",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
      total: 100,
      paymentType: "CONTADO",
      creditDays: "",
      status: "PENDIENTE",
    });
  });

  it("conserva los dias de credito de un comprobante CREDITO", () => {
    const values = toVoucherFormValues(
      detail({ paymentType: "CREDITO", creditDays: 15, dueDate: "2026-03-30" })
    );

    assert.equal(values.creditDays, 15);
    assert.equal(values.paymentType, "CREDITO");
  });
});

describe("creditDaysForPaymentType", () => {
  it("arranca en 30 al elegir Credito y limpia al volver a Contado", () => {
    assert.equal(DEFAULT_CREDIT_DAYS, 30);
    assert.equal(creditDaysForPaymentType("CREDITO"), 30);
    assert.equal(creditDaysForPaymentType("CONTADO"), "");
  });
});

describe("toVoucherRequestBody", () => {
  it("manda un body que el contrato de escritura acepta, tambien en CONTADO", () => {
    const values = formValues();

    // El output del schema tiene que poder volver a entrar como body (L13): si no, postear el
    // resultado del propio formulario daria 400 en cada venta de contado.
    assert.deepEqual(voucherFormSchema.parse(values), values);

    const body = toVoucherRequestBody(values);

    assert.deepEqual(body, {
      issueDate: "2026-03-15",
      voucherType: "BOLETA",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
      total: 100,
      paymentType: "CONTADO",
      status: "PENDIENTE",
    });
    assert.equal("creditDays" in body, false);

    // El body no es para el schema del FORMULARIO (ese exige el preview del numero): su contrato es
    // el de escritura, que ademas normaliza `creditDays` a `null` en CONTADO.
    const parsed = voucherWriteSchema.safeParse(body);
    assert.equal(parsed.success, true);
    assert.equal(parsed.success && parsed.data.creditDays, null);
  });

  it("no manda el numero: lo asigna la base desde la serie por defecto (S2/S11)", () => {
    const body = toVoucherRequestBody(formValues());

    // El preview es de la pantalla; el numero real lo escribe `crear_venta`.
    assert.equal("voucherNumber" in body, false);
    // El contrato de ESCRITURA ya no lo exige, asi que el body sin numero es valido para el API.
    assert.equal(voucherWriteSchema.safeParse(body).success, true);
  });

  it("conserva los dias de credito en CREDITO", () => {
    const body = toVoucherRequestBody(
      formValues({ paymentType: "CREDITO", creditDays: 15 })
    );

    assert.equal(body.creditDays, 15);
    assert.equal(voucherWriteSchema.safeParse(body).success, true);
  });
});

describe("preview del numero de comprobante (S11)", () => {
  it("en el alta muestra el proximo correlativo de la serie por defecto", () => {
    assert.equal(
      previewVoucherNumber(null, { code: "F001", lastNumber: 0 }),
      "F001-000001"
    );
    assert.equal(
      previewVoucherNumber(null, { code: "b001", lastNumber: 125 }),
      "B001-000126"
    );
  });

  it("sin serie por defecto no inventa un numero: el real lo pone la base", () => {
    assert.equal(previewVoucherNumber(null, null), "");
    assert.equal(previewVoucherNumber(null, undefined), "");
  });

  it("en la edicion muestra el numero ya emitido, no el proximo de la serie", () => {
    // El numero de un comprobante emitido es inmutable (S13.3): la serie puede haber avanzado y el
    // preview no puede mostrar un numero que no es el del comprobante que se esta editando.
    assert.equal(
      previewVoucherNumber(detail({ voucherNumber: "F001-000007" }), {
        code: "F001",
        lastNumber: 125,
      }),
      "F001-000007"
    );
  });
});

describe("la regla de pantalla FACTURA exige RUC (S5)", () => {
  it("solo la aplica a ventas con un cliente de RUC", () => {
    assert.equal(canIssueFactura("VENTA", null), false);
    assert.equal(canIssueFactura("VENTA", { documentType: "DNI" }), false);
    assert.equal(canIssueFactura("VENTA", { documentType: "SIN_DOCUMENTO" }), false);
    assert.equal(canIssueFactura("VENTA", { documentType: "RUC" }), true);
    // En compras el tipo queda libre (el origen no aplicaba la regla).
    assert.equal(canIssueFactura("COMPRA", null), true);
  });

  it("conserva los textos del origen", () => {
    assert.equal(FACTURA_REQUIRES_RUC, "No se puede emitir factura a un cliente sin RUC");
    assert.equal(FACTURA_RUC_HINT, "Para emitir factura, el cliente debe tener RUC.");
    assert.equal(NO_ADDRESS_PLACEHOLDER, "Sin dirección registrada");
  });
});

describe("aviso de comprobante con pagos", () => {
  it("se muestra solo cuando hay algo pagado", () => {
    assert.equal(isPaidLocked(detail()), false);
    assert.equal(isPaidLocked(detail({ paidAmount: 0, balance: 100 })), false);
    assert.equal(isPaidLocked(detail({ paidAmount: 0.01 })), true);
    assert.equal(isPaidLocked(null), false);
  });

  it("nombra la entidad del vertical en el texto de S5", () => {
    assert.equal(
      paidLockMessage("VENTA"),
      "Este comprobante tiene pagos registrados: importe, número, cliente y fecha quedan bloqueados. " +
        "Anula los pagos si necesitas corregirlo."
    );
    assert.equal(
      paidLockMessage("COMPRA"),
      "Este comprobante tiene pagos registrados: importe, número, proveedor y fecha quedan bloqueados. " +
        "Anula los pagos si necesitas corregirlo."
    );
  });
});

describe("voucherCopy", () => {
  it("no endurece ventas en el formulario compartido con compras (S1)", () => {
    assert.deepEqual(voucherCopy("VENTA"), {
      entityLabel: "Cliente",
      entityPlaceholder: "Buscar cliente...",
      entityNameFallback: "Cliente no encontrado",
      basePath: "/ventas",
      entityNoun: "venta",
      createTitle: "Registrar venta",
      editTitle: "Editar venta",
      createSubtitle: "Completa los datos para registrar una nueva venta",
      editSubtitle: "Modifica los datos del comprobante",
    });

    const compra = voucherCopy("COMPRA");

    assert.equal(compra.entityLabel, "Proveedor");
    assert.equal(compra.basePath, "/compras");
    assert.equal(compra.createTitle, "Registrar compra");
    assert.equal(compra.createSubtitle, "Completa los datos para registrar una nueva compra");
  });
});
