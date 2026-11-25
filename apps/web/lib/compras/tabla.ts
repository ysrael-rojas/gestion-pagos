// Listado de compras: fila, filtros y textos (T4, S10 de `odd/tasks/port-vertical-compras.md`).
//
// QUE NO HACE ESTE ARCHIVO: no define una segunda fila, ni un segundo filtro, ni una segunda
// paginacion. Una compra y una venta son la MISMA fila (`VoucherTableRow`), el MISMO filtro de
// cliente (`applyListadoFilters`, via `filterVoucherRows`) y la MISMA regla de `Registrar pago`; la
// unica diferencia de S10 es el encabezado de la entidad (`Proveedor`), el vacio y la busqueda. Por
// eso todo sale de `lib/ventas/tabla.ts` y este modulo solo fija los textos y el nombre del vertical.
// Un `tabla.ts` de compras con su propia copia habria dejado dos definiciones del mismo filtro: el
// dia que una cambie (un rango, un estado nuevo), la otra se queda mintiendo en silencio.
//
// `Registrar pago` de una compra apunta a `/pagos/egresos/nuevo` y no a ingresos: una compra se PAGA
// con un egreso (S6). El enlace lleva `entityId` y `comprobanteId`, que es lo que ya lee la pagina
// del alta de egresos.
import type { ListadoFilters } from "../filters/listado-filters.ts";
import {
  EMPTY_VOUCHER_FILTERS,
  VOUCHER_EMPTY_MESSAGES,
  VOUCHER_PAGE_SIZE,
  VOUCHER_STATUS_FILTER_OPTIONS,
  canRegisterPayment,
  filterVoucherRows,
  hasActiveVoucherFilters,
  paymentEntryHref,
  toVoucherTableRow,
  toVoucherTableRows,
  voucherListCopy,
  type VoucherListCopy,
  type VoucherTableRow,
} from "../ventas/tabla.ts";

/** La fila de la tabla de compras es la misma de ventas (`VoucherListItem` + textos resueltos). */
export type CompraTableRow = VoucherTableRow;

export const toCompraTableRow = toVoucherTableRow;
export const toCompraTableRows = toVoucherTableRows;

/** Paginacion del listado (S10): 10 filas, la misma del resto de los listados portados. */
export const COMPRAS_PAGE_SIZE = VOUCHER_PAGE_SIZE;

/** Vacio del listado (S10, textual): `No hay compras registradas`. */
export const COMPRAS_EMPTY_MESSAGE = VOUCHER_EMPTY_MESSAGES.COMPRA;

/** Opciones del filtro "Estado pago": el mismo catalogo que el de ventas y pagos. */
export const COMPRA_STATUS_FILTER_OPTIONS = VOUCHER_STATUS_FILTER_OPTIONS;

/** Estado de filtros sin nada aplicado: es lo que decide si se muestra "Limpiar filtros". */
export const EMPTY_COMPRA_FILTERS: ListadoFilters<string> = EMPTY_VOUCHER_FILTERS;

/** Textos de la pantalla de compras (S10), resueltos una sola vez desde el vertical. */
export const compraListCopy: VoucherListCopy = voucherListCopy("COMPRA");

/** Aplica Desde/Hasta sobre la fecha de emision y el Estado pago elegido. */
export function filterCompraRows(
  rows: CompraTableRow[],
  filters: ListadoFilters<string>
): CompraTableRow[] {
  return filterVoucherRows(rows, filters);
}

/** Si hay algo que limpiar, que es cuando el toolbar muestra "Limpiar filtros". */
export function hasActiveCompraFilters(filters: ListadoFilters<string>): boolean {
  return hasActiveVoucherFilters(filters);
}

/** `Registrar pago` solo existe con la compra pendiente (S10). */
export function canRegisterCompraPayment(status: CompraTableRow["status"]): boolean {
  return canRegisterPayment(status);
}

/** Alta de EGRESOS con la entidad y el comprobante precargados (S10). */
export function registrarPagoHref(voucher: { id: string; entityId: string }): string {
  return paymentEntryHref(voucher, "COMPRA");
}
