/**
 * Montos de un comprobante de venta derivados del total que tipea el usuario.
 *
 * El total tipeado **ya incluye IGV** (es lo que se cobra), así que el IGV no es
 * el 18 % del total: sale de la diferencia contra el subtotal para que
 * `subtotal + igv === total` al centavo. La fórmula vivía solo en el proyecto de
 * origen (`components/comprobantes/voucher-form.tsx`); `packages/shared` no
 * conocía el `1.18` hasta este port. Ver `odd/tasks/port-vertical-ventas.md` (S2).
 */

/** Tasa con la que se despeja la base desde un total con IGV incluido. */
export const IGV_FACTOR = 1.18;

/**
 * Redondeo a `decimals` decimales con el `+ Number.EPSILON` del origen.
 *
 * El EPSILON no es decorativo: sin él, `round(1.555, 2)` da `1.55` porque el
 * binario queda un ULP por debajo (`1.555 * 100 = 155.49999999999997`). Hay un
 * test que fija esa diferencia sobre el caso real `saleAmounts(10.165)`.
 */
export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export interface SaleAmounts {
  /** Base imponible, 2 decimales. */
  subtotal: number;
  /** IGV, 2 decimales: `total - subtotal`, no el 18 % del total. */
  igv: number;
}

/**
 * Despeja subtotal e IGV del total con IGV incluido.
 *
 * El IGV se calcula como diferencia contra el subtotal **ya redondeado**: al
 * revés (`round(total * 0.18, 2)`) la suma deja de cerrar contra el total que el
 * usuario ve y se declara a SUNAT.
 */
export function saleAmounts(total: number): SaleAmounts {
  const subtotal = round(total / IGV_FACTOR, 2);
  return { subtotal, igv: round(total - subtotal, 2) };
}
