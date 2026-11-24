// Fila y filtros del listado de ventas (T4 del port, S10).
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
// No hay filtro por texto aca: la busqueda global (`Buscar ventas...`) es la de TanStack
// (`globalFilteringFeature`), igual que en clientes y pagos.
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
import type { VoucherKind, VoucherListItem, VoucherStatus, VoucherType } from "./types.ts";

/** Paginacion del listado (S10). El paginador compartido permite cambiarla en pantalla. */
export const VENTAS_PAGE_SIZE = 10;

/** Vacio del listado (S10). */
export const VENTAS_EMPTY_MESSAGE = "No hay ventas registradas";

/** Opciones del filtro "Estado pago" (S10), con el mismo shape que el de pagos. */
export const VENTA_STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "TODOS", label: "Todos" },
  { value: "PAGADO", label: "Pagado" },
  { value: "PENDIENTE", label: "Pendiente" },
];

/** Estado de filtros sin nada aplicado: es lo que decide si se muestra "Limpiar filtros". */
export const EMPTY_VENTA_FILTERS: ListadoFilters<string> = {
  desde: null,
  hasta: null,
  estado: "TODOS",
};

/**
 * Fila de la tabla: el `VoucherListItem` del API con los textos ya resueltos.
 *
 * `issueDate` y `total` se conservan crudos porque son los que ordenan y filtran; las etiquetas
 * son solo para pintar. `entityName` viene del API, no de cruzar la lista de clientes: si el
 * cliente se borro, la venta sigue mostrando de quien fue.
 */
export interface VentaTableRow {
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

export function toVentaTableRow(item: VoucherListItem): VentaTableRow {
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

/** La lista completa, conservando el orden del API (emision mas reciente primero). */
export function toVentaTableRows(items: VoucherListItem[]): VentaTableRow[] {
  return items.map(toVentaTableRow);
}

/** Aplica Desde/Hasta sobre la fecha de emision y el Estado pago elegido. */
export function filterVentaRows(
  rows: VentaTableRow[],
  filters: ListadoFilters<string>
): VentaTableRow[] {
  return applyListadoFilters(rows, filters);
}

/** Si hay algo que limpiar, que es cuando el toolbar muestra "Limpiar filtros". */
export function hasActiveVentaFilters(filters: ListadoFilters<string>): boolean {
  return (
    filters.desde !== null ||
    filters.hasta !== null ||
    filters.estado !== EMPTY_VENTA_FILTERS.estado
  );
}

/**
 * `Registrar pago` solo existe para un comprobante pendiente (S10).
 *
 * La accion NO abre el drawer de pagos del origen (queda fuera de este slice): navega al alta de
 * ingresos que ya existe en el vertical de pagos (`/pagos/ingresos/nuevo`), con la entidad y el
 * comprobante precargados.
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
 * pago pertenece al otro vertical.
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
