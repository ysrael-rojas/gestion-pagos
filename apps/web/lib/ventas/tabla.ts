// Fila y filtros del listado de comprobantes (T4 del port de ventas, S10; T4 del port de compras).
//
// Una sola implementacion para los dos verticales: una venta y una compra son la MISMA fila de
// `GET /vouchers` / `GET /purchases` (S1 del doc de ventas, y el contrato de T3 de compras es
// deliberadamente igual), asi que lo unico que cambia es el texto de dos columnas y el vacio. Copiar
// el archivo para compras habria dejado dos definiciones del mismo filtro y de la misma regla de
// `Registrar pago`, que es exactamente lo que este slice evita.
//
// La fila se arma ACA y no en el closure de cada columna por dos razones:
//
//   1. Los textos que ve el usuario (`F. emisión` en `dd/mm/yyyy`, la etiqueta del tipo, el total en
//      `S/`) se prueban sin montar TanStack.
//   2. `Registrar pago` aparece SOLO cuando `status === 'PENDIENTE'` (S10) tiene un lugar donde
//      afirmarlo, en vez de un ternario suelto en el JSX.
//
// Los filtros son de CLIENTE (S10: "se aplican en cliente sobre `issue_date` y `status`, igual que
// el resto de los listados portados") y reusan `applyListadoFilters` de `lib/filters/listado-filters.ts`,
// el mismo que usan los pagos: "Desde/Hasta/Estado pago" significa lo mismo en los dos verticales, y
// el rango es inclusivo en los dos extremos. Reimplementarlo aca seria una segunda definicion del
// mismo filtro.
//
// No hay filtro por texto aca: la busqueda global (`Buscar ventas...` / `Buscar compras...`) es la de
// TanStack (`globalFilteringFeature`), igual que en clientes y pagos.
import {
  SALE_STATUSES,
  VOUCHER_TYPES,
  getOptionLabel,
} from "@gestion/shared/lib/data/sale-options.ts";
import { formatCurrency, formatDate } from "@gestion/shared/lib/utils.ts";

import {
  applyListadoFilters,
  type ListadoFilters,
} from "../filters/listado-filters.ts";
import { voucherCopy } from "./formulario.ts";
import type { VoucherKind, VoucherListItem, VoucherStatus, VoucherType } from "./types.ts";

/** Paginacion del listado (S10). El paginador compartido permite cambiarla en pantalla. */
export const VOUCHER_PAGE_SIZE = 10;
/** Alias del vertical de ventas: el nombre lo usan sus componentes desde T4. */
export const VENTAS_PAGE_SIZE = VOUCHER_PAGE_SIZE;

/** Vacio de cada listado (S10: "No hay ventas registradas" / "No hay compras registradas"). */
export const VOUCHER_EMPTY_MESSAGES: Record<VoucherKind, string> = {
  VENTA: "No hay ventas registradas",
  COMPRA: "No hay compras registradas",
};
export const VENTAS_EMPTY_MESSAGE = VOUCHER_EMPTY_MESSAGES.VENTA;

/** Opciones del filtro "Estado pago" (S10), con el mismo shape que el de pagos. */
export const VOUCHER_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "PAGADO", label: "Pagado" },
  { value: "PENDIENTE", label: "Pendiente" },
];
export const VENTA_STATUS_FILTER_OPTIONS = VOUCHER_STATUS_FILTER_OPTIONS;

/** Estado de filtros sin nada aplicado: es lo que decide si se muestra "Limpiar filtros". */
export const EMPTY_VOUCHER_FILTERS: ListadoFilters<string> = {
  desde: null,
  hasta: null,
  estado: "TODOS",
};
export const EMPTY_VENTA_FILTERS = EMPTY_VOUCHER_FILTERS;

/** Textos del listado que cambian por vertical (S10 de compras). */
export interface VoucherListCopy {
  title: string;
  subtitle: string;
  /** Accion principal: `Registrar venta` / `Registrar compra` (sale de `voucherCopy`). */
  createLabel: string;
  /** Encabezado de la columna de la entidad: `Cliente` / `Proveedor`. */
  entityColumn: string;
  searchPlaceholder: string;
  emptyMessage: string;
  basePath: string;
}

/**
 * Textos del listado y del alta segun el vertical.
 *
 * `createLabel`, `entityColumn` y `basePath` NO se escriben de nuevo: son los de `voucherCopy`, la
 * misma fuente que usan el formulario y el detalle (S1). Asi una compra no puede decir "Proveedor"
 * en el formulario y "Cliente" en la tabla.
 */
export function voucherListCopy(voucherKind: VoucherKind): VoucherListCopy {
  const copy = voucherCopy(voucherKind);

  return {
    title: voucherKind === "VENTA" ? "Ventas" : "Compras",
    subtitle:
      voucherKind === "VENTA"
        ? "Registra y administra tus ventas"
        : "Registra y administra tus compras",
    createLabel: copy.createTitle,
    entityColumn: copy.entityLabel,
    searchPlaceholder:
      voucherKind === "VENTA" ? "Buscar ventas..." : "Buscar compras...",
    emptyMessage: VOUCHER_EMPTY_MESSAGES[voucherKind],
    basePath: copy.basePath,
  };
}

/**
 * Fila de la tabla: el `VoucherListItem` del API con los textos ya resueltos.
 *
 * `issueDate` y `total` se conservan crudos porque son los que ordenan y filtran; las etiquetas
 * son solo para pintar. `entityName` viene del API, no de cruzar la lista de clientes o proveedores:
 * si la entidad se borro, el comprobante sigue mostrando de quien fue.
 */
export interface VoucherTableRow {
  id: string;
  entityId: string;
  entityName: string;
  issueDate: string;
  issueDateLabel: string;
  voucherType: VoucherType;
  voucherTypeLabel: string;
  voucherNumber: string;
  total: number;
  totalLabel: string;
  status: VoucherStatus;
  statusLabel: string;
}

/** Alias historico del vertical de ventas (mismos campos: la fila es agnostica del kind). */
export type VentaTableRow = VoucherTableRow;

export function toVoucherTableRow(item: VoucherListItem): VoucherTableRow {
  return {
    id: item.id,
    entityId: item.entityId,
    entityName: item.entityName,
    issueDate: item.issueDate,
    issueDateLabel: formatDate(item.issueDate),
    voucherType: item.voucherType,
    voucherTypeLabel: getOptionLabel(VOUCHER_TYPES, item.voucherType),
    voucherNumber: item.voucherNumber,
    total: item.total,
    totalLabel: formatCurrency(item.total),
    status: item.status,
    statusLabel: getOptionLabel(SALE_STATUSES, item.status),
  };
}

export const toVentaTableRow = toVoucherTableRow;

/** La lista completa, conservando el orden del API (emision mas reciente primero). */
export function toVoucherTableRows(items: VoucherListItem[]): VoucherTableRow[] {
  return items.map(toVoucherTableRow);
}

export const toVentaTableRows = toVoucherTableRows;

/** Aplica Desde/Hasta sobre la fecha de emision y el Estado pago elegido. */
export function filterVoucherRows(
  rows: VoucherTableRow[],
  filters: ListadoFilters<string>
): VoucherTableRow[] {
  return applyListadoFilters(rows, filters);
}

export const filterVentaRows = filterVoucherRows;

/** Si hay algo que limpiar, que es cuando el toolbar muestra "Limpiar filtros". */
export function hasActiveVoucherFilters(
  filters: ListadoFilters<string>
): boolean {
  return (
    filters.desde !== null ||
    filters.hasta !== null ||
    filters.estado !== EMPTY_VOUCHER_FILTERS.estado
  );
}

export const hasActiveVentaFilters = hasActiveVoucherFilters;

/**
 * `Registrar pago` solo existe para un comprobante pendiente (S10).
 *
 * La accion NO abre el drawer de pagos del origen (queda fuera de este slice): navega al alta del
 * recibo que ya existe en el vertical de pagos, con la entidad y el comprobante precargados.
 */
export function canRegisterPayment(status: VoucherStatus): boolean {
  return status === "PENDIENTE";
}

/** Alta de recibos del vertical de pagos: el punto de entrada que ya existe para cobrar o pagar. */
export const PAYMENT_ENTRY_PATHS: Record<VoucherKind, string> = {
  VENTA: "/pagos/ingresos/nuevo",
  COMPRA: "/pagos/egresos/nuevo",
};

/**
 * Enlace de `Registrar pago` para un comprobante.
 *
 * Manda las dos claves que `app/(app)/pagos/{ingresos,egresos}/nuevo/page.tsx` ya lee de la URL
 * (`entityId` y `comprobanteId`): el formulario de pagos abre con la entidad y el comprobante
 * precargados y el usuario solo elige importe y metodo. Es un enlace y no una llamada porque el
 * pago pertenece al otro vertical. Una venta se cobra con un INGRESO y una compra se paga con un
 * EGRESO (S6 del doc de compras): el kind decide la pantalla.
 */
export function paymentEntryHref(
  voucher: { id: string; entityId: string },
  voucherKind: VoucherKind = "VENTA"
): string {
  const query = new URLSearchParams({
    entityId: voucher.entityId,
    comprobanteId: voucher.id,
  });

  return `${PAYMENT_ENTRY_PATHS[voucherKind]}?${query.toString()}`;
}
