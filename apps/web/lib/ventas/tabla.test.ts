// Tabla del listado de ventas (T4 del port del vertical ventas, S10).
//
// La fila de la tabla se arma en un modulo puro (no en el closure de la columna) para dos cosas:
//
//   1. Que los textos que ve el usuario —`F. emisión` en `dd/mm/yyyy`, la etiqueta del tipo, el
//      total en `S/`— se prueben sin montar TanStack.
//   2. Que `Registrar pago` aparezca SOLO cuando `status === 'PENDIENTE'` (S10) tenga un lugar
//      donde se pueda afirmar, en vez de vivir en un ternario del JSX.
//
// Los filtros NO son server-side (S10: "se aplican en cliente sobre `issue_date` y `status`"), y
// reusan `applyListadoFilters` de `lib/filters/listado-filters.ts`, el mismo que ya usan los pagos:
// cambiar aca que significa "Desde/Hasta/Estado pago" es cambiar esa funcion, no una copia.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VoucherListItem } from "./types.ts";
import {
  PAYMENT_ENTRY_PATHS,
  VENTAS_EMPTY_MESSAGE,
  VENTAS_PAGE_SIZE,
  VENTA_STATUS_FILTER_OPTIONS,
  canRegisterPayment,
  filterVentaRows,
  hasActiveVentaFilters,
  paymentEntryHref,
  toVentaTableRow,
  toVentaTableRows,
} from "./tabla.ts";

const item = (overrides: Partial<VoucherListItem> = {}): VoucherListItem => ({
  id: "venta-1",
  entityId: "cliente-1",
  entityName: "Bodega Ana",
  issueDate: "2026-03-15",
  voucherType: "BOLETA",
  voucherNumber: "B001-000001",
  total: 118.5,
  paymentType: "CONTADO",
  dueDate: null,
  status: "PENDIENTE",
  ...overrides,
});

describe("toVentaTableRow", () => {
  it("resuelve las etiquetas de S10 sin tocar los valores crudos", () => {
    const row = toVentaTableRow(item());

    assert.equal(row.issueDate, "2026-03-15", "la fecha cruda queda para ordenar y filtrar");
    assert.equal(row.issueDateLabel, "15/03/2026");
    assert.equal(row.voucherTypeLabel, "Boleta");
    assert.equal(row.statusLabel, "Pendiente");
    assert.equal(row.total, 118.5);
    // `formatCurrency` de `es-PE` usa un espacio duro (U+00A0) despues del simbolo.
    assert.equal(row.totalLabel.replace(/\u00a0/g, " "), "S/ 118.50");
    assert.equal(row.entityName, "Bodega Ana");
    assert.equal(row.voucherNumber, "B001-000001");
  });

  it("usa el nombre de la entidad que ya viene en la fila del API", () => {
    // El origen resolvia el nombre cruzando la lista de clientes; el API lo manda en la misma fila
    // (`GET /vouchers`), asi que la tabla no puede quedar con "Cliente no encontrado" mientras
    // cargan los clientes.
    assert.equal(toVentaTableRow(item({ entityName: "Ferretería Luis" })).entityName, "Ferretería Luis");
  });

  it("mapea la lista completa conservando el orden del API", () => {
    const rows = toVentaTableRows([
      item({ id: "a", issueDate: "2026-03-15", voucherType: "FACTURA", status: "PAGADO" }),
      item({ id: "b", issueDate: "2026-03-10", voucherType: "NOTA_VENTA" }),
    ]);

    assert.deepEqual(
      rows.map((row) => [row.id, row.issueDate, row.voucherTypeLabel, row.statusLabel]),
      [
        ["a", "2026-03-15", "Factura", "Pagado"],
        ["b", "2026-03-10", "Nota de venta", "Pendiente"],
      ]
    );
  });
});

describe("filterVentaRows", () => {
  const rows = toVentaTableRows([
    item({ id: "a", issueDate: "2026-01-10", status: "PENDIENTE" }),
    item({ id: "b", issueDate: "2026-01-20", status: "PAGADO" }),
    item({ id: "c", issueDate: "2026-02-05", status: "PENDIENTE" }),
  ]);

  const ids = (filters: { desde: string | null; hasta: string | null; estado: string }) =>
    filterVentaRows(rows, filters).map((row) => row.id);

  it("filtra por Desde y Hasta sobre la fecha de emision, inclusive en los dos extremos", () => {
    assert.deepEqual(ids({ desde: null, hasta: null, estado: "TODOS" }), ["a", "b", "c"]);
    assert.deepEqual(ids({ desde: "2026-01-15", hasta: null, estado: "TODOS" }), ["b", "c"]);
    assert.deepEqual(ids({ desde: null, hasta: "2026-01-20", estado: "TODOS" }), ["a", "b"]);
    assert.deepEqual(ids({ desde: "2026-01-10", hasta: "2026-01-20", estado: "TODOS" }), ["a", "b"]);
    assert.deepEqual(ids({ desde: "2026-03-01", hasta: null, estado: "TODOS" }), []);
  });

  it("filtra por Estado pago", () => {
    assert.deepEqual(ids({ desde: null, hasta: null, estado: "PENDIENTE" }), ["a", "c"]);
    assert.deepEqual(ids({ desde: null, hasta: null, estado: "PAGADO" }), ["b"]);
  });

  it("combina los tres filtros", () => {
    assert.deepEqual(ids({ desde: "2026-01-15", hasta: "2026-02-06", estado: "PENDIENTE" }), ["c"]);
  });
});

describe("hasActiveVentaFilters", () => {
  it("distingue el estado inicial para mostrar 'Limpiar filtros'", () => {
    assert.equal(hasActiveVentaFilters({ desde: null, hasta: null, estado: "TODOS" }), false);
    assert.equal(hasActiveVentaFilters({ desde: "2026-01-01", hasta: null, estado: "TODOS" }), true);
    assert.equal(hasActiveVentaFilters({ desde: null, hasta: "2026-01-01", estado: "TODOS" }), true);
    assert.equal(hasActiveVentaFilters({ desde: null, hasta: null, estado: "PENDIENTE" }), true);
  });
});

describe("canRegisterPayment", () => {
  it("ofrece 'Registrar pago' solo para un comprobante pendiente", () => {
    assert.equal(canRegisterPayment("PENDIENTE"), true);
    assert.equal(canRegisterPayment("PAGADO"), false);
  });
});

describe("paymentEntryHref", () => {
  it("apunta al alta de recibos del vertical de pagos con el comprobante precargado", () => {
    // No hay drawer de pagos en este slice: la accion lleva al alta que ya existe, y las dos
    // claves son las que esa pagina lee de la URL.
    assert.deepEqual(PAYMENT_ENTRY_PATHS, {
      VENTA: "/pagos/ingresos/nuevo",
      COMPRA: "/pagos/egresos/nuevo",
    });
    assert.equal(
      paymentEntryHref({ id: "venta-1", entityId: "cliente-1" }),
      "/pagos/ingresos/nuevo?entityId=cliente-1&comprobanteId=venta-1"
    );
    assert.equal(
      paymentEntryHref({ id: "compra-1", entityId: "proveedor-1" }, "COMPRA"),
      "/pagos/egresos/nuevo?entityId=proveedor-1&comprobanteId=compra-1"
    );
  });
});

describe("constantes del listado", () => {
  it("pagina de a 10 y usa los textos de S10", () => {
    assert.equal(VENTAS_PAGE_SIZE, 10);
    assert.equal(VENTAS_EMPTY_MESSAGE, "No hay ventas registradas");
    assert.deepEqual(VENTA_STATUS_FILTER_OPTIONS, [
      { value: "TODOS", label: "Todos" },
      { value: "PAGADO", label: "Pagado" },
      { value: "PENDIENTE", label: "Pendiente" },
    ]);
  });
});
