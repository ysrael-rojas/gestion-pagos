// Tests de T1 del port del vertical ventas (`odd/tasks/port-vertical-ventas.md`): los montos
// derivados del total (S2) y la limpieza de `creditDays` en el schema compartido (S3/S4).
//
// `@gestion/shared` no tiene runner propio, asi que los tests viven aca y importan los archivos
// del paquete por subpath CON la extension `.ts`, igual que `lib/cajas-bancos/catalogos.test.ts`.
import assert from "node:assert/strict";
import { test } from "node:test";

import { voucherFormSchema } from "@gestion/shared/lib/schemas/voucher.ts";
import { round, saleAmounts } from "@gestion/shared/lib/ventas/montos.ts";

// Payload minimo valido de `voucherFormSchema`; cada test cambia solo lo que mira.
const voucherBase = {
  issueDate: "2026-03-15",
  voucherType: "BOLETA" as const,
  voucherNumber: "B001-000001",
  entityId: "cliente-1",
  total: 100,
  status: "PENDIENTE" as const,
};

// --- S2: montos derivados del total -----------------------------------------

test("saleAmounts deriva subtotal e IGV del total con IGV incluido", () => {
  assert.deepEqual(saleAmounts(100), { subtotal: 84.75, igv: 15.25 });
  assert.deepEqual(saleAmounts(1200.55), { subtotal: 1017.42, igv: 183.13 });
});

test("el IGV es la diferencia contra el subtotal, no el 18 % del total", () => {
  // El total que tipea el usuario YA incluye IGV: el 18 % del total (18) no es el IGV (15.25).
  // Una implementacion "naive" que calcule `total * 0.18` rompe subtotal + IGV = total.
  const { subtotal, igv } = saleAmounts(100);
  assert.notEqual(igv, 18);
  assert.equal(round(subtotal + igv, 2), 100);
});

test("saleAmounts redondea a 2 decimales los totales con mas decimales", () => {
  assert.deepEqual(saleAmounts(10.999), { subtotal: 9.32, igv: 1.68 });
  assert.deepEqual(saleAmounts(0.01), { subtotal: 0.01, igv: 0 });
  // 10.999 no es un total en centavos: la suma cuadra contra el total redondeado (11.00).
  const { subtotal, igv } = saleAmounts(10.999);
  assert.equal(round(subtotal + igv, 2), round(10.999, 2));
});

test("saleAmounts conserva el redondeo del origen (`+ Number.EPSILON`)", () => {
  // Unico caso medido en que la variante SIN EPSILON (`round2` de `lib/utils.ts`) da otro IGV:
  // 1.55 en vez de 1.56. Se fija el comportamiento del origen, que es el que ya se emitio.
  assert.deepEqual(saleAmounts(10.165), { subtotal: 8.61, igv: 1.56 });
});

test("subtotal + IGV = total al centavo en todos los totales de 0.01 a 200.00", () => {
  // El invariante se compara a centavos porque la suma en punto flotante arrastra ruido de ULP
  // (0.05 + 0.01 = 0.060000000000000005) y la base guarda `numeric(12,2)`.
  for (let cents = 1; cents <= 20_000; cents += 1) {
    const total = cents / 100;
    const { subtotal, igv } = saleAmounts(total);

    assert.equal(round(subtotal + igv, 2), total, `total ${total}`);
    // Los dos montos quedan en centavos exactos: es lo que se declara a SUNAT.
    assert.equal(round(subtotal, 2), subtotal, `subtotal de ${total}`);
    assert.equal(round(igv, 2), igv, `igv de ${total}`);
  }
});

// --- S3/S4: `creditDays` solo existe en CREDITO ------------------------------

test("CONTADO descarta los dias de credito y devuelve el resto del payload intacto", () => {
  // El schema no calcula montos ni vencimiento: el esperado es el payload de entrada, con
  // `creditDays` en null.
  const esperado = {
    issueDate: "2026-03-15",
    voucherType: "BOLETA",
    voucherNumber: "B001-000001",
    entityId: "cliente-1",
    total: 100,
    paymentType: "CONTADO",
    status: "PENDIENTE",
    creditDays: null,
  };

  assert.deepEqual(
    voucherFormSchema.parse({ ...voucherBase, paymentType: "CONTADO", creditDays: 30 }),
    esperado
  );
  // El formulario limpia el campo a "" al volver a Contado: tambien tiene que quedar en null.
  assert.deepEqual(
    voucherFormSchema.parse({ ...voucherBase, paymentType: "CONTADO", creditDays: "" }),
    esperado
  );
});

test("CREDITO exige los dias de credito con el mensaje del contrato", () => {
  const result = voucherFormSchema.safeParse({ ...voucherBase, paymentType: "CREDITO" });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error?.issues.map((issue) => issue.message),
    ["Ingresa los días de crédito"]
  );
});

test("CREDITO rechaza 0 con el mensaje del contrato", () => {
  const result = voucherFormSchema.safeParse({
    ...voucherBase,
    paymentType: "CREDITO",
    creditDays: 0,
  });

  assert.equal(result.success, false);
  assert.deepEqual(
    result.error?.issues.map((issue) => issue.message),
    ["Los días de crédito deben ser al menos 1"]
  );
});

test("CREDITO con un entero valido conserva los dias", () => {
  const parsed = voucherFormSchema.parse({
    ...voucherBase,
    paymentType: "CREDITO",
    creditDays: 30,
  });

  assert.equal(parsed.creditDays, 30);
  assert.equal(parsed.paymentType, "CREDITO");
  // Los dias viajan como string desde el input del formulario.
  assert.equal(
    voucherFormSchema.parse({ ...voucherBase, paymentType: "CREDITO", creditDays: "45" })
      .creditDays,
    45
  );
});

// --- PRESERVE: los mensajes que ya existian siguen igual ----------------------

test("el resto de los mensajes de `voucherFormSchema` no cambia", () => {
  const mensaje = (payload: Record<string, unknown>): string[] =>
    voucherFormSchema.safeParse(payload).error?.issues.map((issue) => issue.message) ?? [];

  const contado = { ...voucherBase, paymentType: "CONTADO" };

  assert.deepEqual(mensaje({ ...contado, voucherNumber: "" }), [
    "El número de comprobante es requerido",
    // El `regex` corre igual después del `min` fallido: un número vacío devuelve los
    // dos mensajes. Es el comportamiento del schema encadenado del origen (mismo
    // `voucherNumberSchema`) y el formulario muestra el primero; se fija acá para que
    // el port no cambie el contrato de S4 sin decirlo.
    "Usa el formato serie-correlativo, por ejemplo F001-000001",
  ]);
  assert.deepEqual(mensaje({ ...contado, voucherNumber: "F001" }), [
    "Usa el formato serie-correlativo, por ejemplo F001-000001",
  ]);
  assert.deepEqual(mensaje({ ...contado, entityId: "" }), [
    "Selecciona el cliente o proveedor",
  ]);
  assert.deepEqual(mensaje({ ...contado, total: 0 }), ["El total debe ser mayor a 0"]);
  // `total: ""` se coacciona a 0 antes de validar, así que sale el mensaje del mínimo;
  // "Ingresa un total válido" queda para los textos no numéricos. Igual que el origen.
  assert.deepEqual(mensaje({ ...contado, total: "" }), ["El total debe ser mayor a 0"]);
  assert.deepEqual(mensaje({ ...contado, total: "abc" }), ["Ingresa un total válido"]);
  assert.deepEqual(mensaje({ ...contado, paymentType: "OTRO" }), [
    "Selecciona el tipo de pago",
  ]);
  assert.deepEqual(mensaje({ ...contado, status: "ANULADO" }), ["Selecciona el estado"]);
  // `creditDays` de CREDITO sigue validando entero y numero antes que el minimo.
  assert.deepEqual(
    mensaje({ ...voucherBase, paymentType: "CREDITO", creditDays: 2.5 }),
    ["Los días de crédito deben ser un número entero"]
  );
  assert.deepEqual(
    mensaje({ ...voucherBase, paymentType: "CREDITO", creditDays: "abc" }),
    ["Ingresa un número válido de días"]
  );
});
