import type { VoucherType } from "../../components/comprobantes/types.ts";
import type { SelectOption } from "./sale-options";
import { VOUCHER_TYPES } from "./sale-options.ts";

/**
 * Los 6 tipos del enum `voucher_type`, usados para administrar series en
 * Configuración. El formulario de comprobantes solo usa los 3 primeros.
 */
export const SERIES_VOUCHER_TYPES: SelectOption<VoucherType>[] = [
  { value: "FACTURA", label: "Factura" },
  { value: "BOLETA", label: "Boleta" },
  { value: "NOTA_VENTA", label: "Nota de venta" },
  { value: "NOTA_CREDITO", label: "Nota de crédito" },
  { value: "NOTA_DEBITO", label: "Nota de débito" },
  { value: "COMPROBANTE_RETENCION", label: "Comprobante de retención" },
];

export function getSeriesTypeLabel(voucherType: VoucherType): string {
  return (
    SERIES_VOUCHER_TYPES.find((option) => option.value === voucherType)?.label ??
    voucherType
  );
}

/**
 * Los tipos que la app **emite** hoy, y por lo tanto los unicos que pueden tener serie.
 *
 * Es el subconjunto de `SERIES_VOUCHER_TYPES` que tambien es comprobante base de venta: los otros
 * tres (`NOTA_CREDITO`, `NOTA_DEBITO`, `COMPROBANTE_RETENCION`) se ofrecen cuando exista el flujo
 * que los emite, no antes (`odd/tasks/port-vertical-series.md`, S4). Se deriva de `VOUCHER_TYPES`
 * para no tener dos listas que se desincronicen.
 */
export const ISSUED_SERIES_VOUCHER_TYPES: SelectOption<VoucherType>[] =
  SERIES_VOUCHER_TYPES.filter((option) =>
    VOUCHER_TYPES.some((sale) => sale.value === option.value)
  );
