import { z } from "zod";

import type { VoucherType } from "../../components/comprobantes/types";
import {
  ISSUED_SERIES_VOUCHER_TYPES,
  SERIES_VOUCHER_TYPES,
} from "../data/series-options.ts";

/** Serie SUNAT: 1 a 4 caracteres alfanuméricos, por ejemplo `F001`. */
export const SERIES_CODE_PATTERN = /^[A-Za-z0-9]{1,4}$/;

const issuedVoucherTypeValues = ISSUED_SERIES_VOUCHER_TYPES.map(
  (option) => option.value
) as [VoucherType, ...VoucherType[]];

/**
 * Solo los tipos que la app emite hoy: una serie de nota de crédito no tiene sentido hasta que
 * exista el flujo que la emite (`odd/tasks/port-vertical-series.md`, S4).
 */
const seriesVoucherTypeEnum = z.enum(issuedVoucherTypeValues, {
  error: "Selecciona el tipo de comprobante",
});

/**
 * Alta y edición de una serie de comprobante. El correlativo no se edita aquí: lo asigna la base
 * al registrar comprobantes, desde la serie por defecto de cada tipo (S2).
 */
export const serieFormSchema = z.object({
  voucherType: seriesVoucherTypeEnum,
  code: z
    .string()
    .trim()
    .min(1, "El código de serie es requerido")
    .regex(
      SERIES_CODE_PATTERN,
      "Usa 1 a 4 caracteres alfanuméricos, por ejemplo F001"
    ),
  isDefault: z.boolean(),
});

export type SerieFormValues = z.output<typeof serieFormSchema>;
export type SerieFormInput = z.input<typeof serieFormSchema>;

/**
 * Contrato de fila/respuesta de una serie: lo que devuelve el API y lo que pinta la tabla de
 * Configuración → Series.
 *
 * Es distinto del formulario a propósito: `lastNumber` es de solo lectura (lo mueve la base al
 * emitir) y `id` lo pone la base. SPEC 44 pedía `lastNumber` y el schema del formulario no lo
 * tenía; la respuesta a eso es este contrato, no un campo editable de más
 * (`odd/tasks/port-vertical-series.md`, S10).
 */
export const voucherSeriesSchema = z.object({
  id: z.string().uuid(),
  voucherType: seriesVoucherTypeEnum,
  code: z.string().regex(SERIES_CODE_PATTERN),
  lastNumber: z.number().int().min(0),
  isDefault: z.boolean(),
});

export type VoucherSeriesRow = z.output<typeof voucherSeriesSchema>;

/** Re-exportado para que quien pinte el selector de tipos no importe dos módulos. */
export { ISSUED_SERIES_VOUCHER_TYPES, SERIES_VOUCHER_TYPES };
