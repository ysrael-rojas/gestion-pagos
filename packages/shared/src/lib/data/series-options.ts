import type { VoucherType } from "../../components/comprobantes/types.ts";
import type { SelectOption } from "./sale-options";

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
 * Hoy son los tres comprobantes base de venta mas las dos notas (slice 3): la retencion queda afuera
 * hasta que exista su flujo, y el catalogo completo (`SERIES_VOUCHER_TYPES`) se conserva para
 * etiquetas y para los slices que faltan (`odd/tasks/port-vertical-notas.md`, S11).
 */
export const ISSUED_SERIES_VOUCHER_TYPES: SelectOption<VoucherType>[] =
  SERIES_VOUCHER_TYPES.filter((option) => option.value !== "COMPROBANTE_RETENCION");
