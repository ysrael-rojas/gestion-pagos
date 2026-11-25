// Fila y filtros del listado de compras (T4, S10 de `odd/tasks/port-vertical-compras.md`).
//
// Lo que se prueba es el contrato que ve el usuario en la tabla de compras: los textos ya resueltos
// de la fila (`F. emisión` en `dd/mm/yyyy`, la etiqueta del tipo, el total en `S/`), los filtros de
// cliente, el vacio propio del vertical, la paginacion de 10 y el enlace de `Registrar pago`
// apuntando al alta de EGRESOS (S10: la compra se paga con un egreso, no con un ingreso).
//
// La fila NO se arma en el closure de cada columna justamente para poder probarla sin montar
// TanStack, igual que en ventas (`lib/ventas/tabla.test.ts`).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VoucherListItem } from "../ventas/types.ts";
import {
  COMPRAS_EMPTY_MESSAGE,
  COMPRAS_PAGE_SIZE,
  COMPRA_STATUS_FILTER_OPTIONS,
  EMPTY_COMPRA_FILTERS,
  canRegisterCompraPayment,
  compraListCopy,
  filterCompraRows,
  hasActiveCompraFilters,
  registrarPagoHref,
  toCompraTableRow,
  toCompraTableRows,
} from "./tabla.ts";

/** Una fila de `GET /purchases` (S10 del doc del slice 4). */
const item = (overrides: Partial<VoucherListItem> = {}): VoucherListItem => ({
  id: "550e8400-e29b-41d4-a716-446655440000",
  entityId: "550e8400-e29b-41d4-a716-446655440001",
  entityName: "Distribuidora Andina",
  issueDate: "2026-03-15",
  voucherType: "FACTURA",
  voucherNumber: "F001-000123",
  total: 1180,
  paymentType: "CONTADO",
  dueDate: null,
  status: "PENDIENTE",
  ...overrides,
});

describe("toCompraTableRow", () => {
  it("resuelve los textos de la fila y conserva los valores crudos de orden y filtro", () => {
    const row = toCompraTableRow(item());

    assert.deepEqual(row, {
      id: "550e8400-e29b-41d4-a716-446655440000",
      entityId: "550e8400-e29b-41d4-a716-446655440001",
      entityName: "Distribuidora Andina",
      issueDate: "2026-03-15",
      issueDateLabel: "15/03/2026",
      voucherType: "FACTURA",
      voucherTypeLabel: "Factura",
      voucherNumber: "F001-000123",
      total: 1180,
      // `formatCurrency` de `es-PE` separa el simbolo con un espacio duro (U+00A0).
      totalLabel: "S/\u00a01,180.00",
      status: "PENDIENTE",
      statusLabel: "Pendiente",
    });
  });

  it("muestra el proveedor que manda el API, aunque ya no exista en la lista", () => {
    // El nombre viaja en la fila (igual que `entityName` en ventas): una compra de un proveedor
    // dado de baja sigue mostrando de quien fue.
    assert.equal(
      toCompraTableRow({ ...item(), entityId: "otro", entityName: "Ferretería Luis" }).entityName,
      "Ferretería Luis"
    );
  });

  it("conserva el orden del API (emision mas reciente primero)", () => {
    const rows = toCompraTableRows([
      item({ id: "a", voucherNumber: "F001-000002" }),
      item({ id: "b", voucherNumber: "F001-000001" }),
    ]);

    assert.deepEqual(
      rows.map((row) => row.voucherNumber),
      ["F001-000002", "F001-000001"]
    );
  });
});

describe("filterCompraRows", () => {
  const rows = toCompraTableRows([
    item({ id: "vieja", issueDate: "2026-01-10", status: "PENDIENTE", entityName: "Proveedor viejo" }),
    item({ id: "nueva", issueDate: "2026-03-15", status: "PAGADO", entityName: "Proveedor nuevo" }),
  ]);

  const ids = (filters: Parameters<typeof filterCompraRows>[1]): string[] =>
    filterCompraRows(rows, filters).map((row) => row.id);

  it("aplica el rango de fechas inclusivo en los dos extremos", () => {
    assert.deepEqual(ids({ desde: "2026-01-10", hasta: "2026-03-15", estado: "TODOS" }), [
      "vieja",
      "nueva",
    ]);
    assert.deepEqual(ids({ desde: "2026-01-11", hasta: null, estado: "TODOS" }), ["nueva"]);
    assert.deepEqual(ids({ desde: null, hasta: "2026-01-10", estado: "TODOS" }), ["vieja"]);
  });

  it("filtra por estado de pago con las opciones de la pantalla", () => {
    assert.deepEqual(ids({ ...EMPTY_COMPRA_FILTERS, estado: "PENDIENTE" }), ["vieja"]);
    assert.deepEqual(ids({ ...EMPTY_COMPRA_FILTERS, estado: "PAGADO" }), ["nueva"]);
    assert.equal(ids(EMPTY_COMPRA_FILTERS).length, 2);
  });
});

describe("hasActiveCompraFilters", () => {
  it("solo hay algo que limpiar con una fecha o un estado aplicado", () => {
    assert.equal(hasActiveCompraFilters(EMPTY_COMPRA_FILTERS), false);
    assert.equal(hasActiveCompraFilters({ desde: "2026-01-01", hasta: null, estado: "TODOS" }), true);
    assert.equal(hasActiveCompraFilters({ desde: null, hasta: "2026-01-01", estado: "TODOS" }), true);
    assert.equal(hasActiveCompraFilters({ desde: null, hasta: null, estado: "PENDIENTE" }), true);
  });
});

describe("constantes del listado de compras (S10)", () => {
  it("pagina de a 10 y vacio propio del vertical", () => {
    assert.equal(COMPRAS_PAGE_SIZE, 10);
    assert.equal(COMPRAS_EMPTY_MESSAGE, "No hay compras registradas");
  });

  it("el filtro de estado es el mismo de ventas", () => {
    assert.deepEqual(COMPRA_STATUS_FILTER_OPTIONS, [
      { value: "TODOS", label: "Todos" },
      { value: "PAGADO", label: "Pagado" },
      { value: "PENDIENTE", label: "Pendiente" },
    ]);
  });
});

describe("Registrar pago de una compra (S10)", () => {
  it("solo aparece con la compra pendiente", () => {
    assert.equal(canRegisterCompraPayment("PENDIENTE"), true);
    assert.equal(canRegisterCompraPayment("PAGADO"), false);
  });

  it("apunta al alta de EGRESOS con la entidad y el comprobante precargados", () => {
    assert.equal(
      registrarPagoHref({ id: "compra-1", entityId: "proveedor-1" }),
      "/pagos/egresos/nuevo?entityId=proveedor-1&comprobanteId=compra-1"
    );
  });
});

describe("compraListCopy", () => {
  it("fija los textos de S10 y reusa los del formulario compartido", () => {
    assert.deepEqual(compraListCopy, {
      title: "Compras",
      subtitle: "Registra y administra tus compras",
      createLabel: "Registrar compra",
      entityColumn: "Proveedor",
      searchPlaceholder: "Buscar compras...",
      emptyMessage: "No hay compras registradas",
      basePath: "/compras",
    });
  });
});
