// Fila, totales y estado vacio de la seccion de notas del detalle de un comprobante (T4 del slice 3:
// S1, S2, S9 y S11 de `odd/tasks/port-vertical-notas.md`).
//
// Port de la parte no-JSX de `components/comprobantes/voucher-adjustments-section.tsx` del origen,
// reducida a las NOTAS: la retencion tiene su propio slice y no se lista aca (S1). La fila se arma en
// este modulo y no en el closure de cada columna por la misma razon que en `lib/ventas/tabla.ts`:
// los textos que ve el usuario (`Tipo`, `Emisión` en `dd/mm/yyyy`, el motivo traducido, el total en
// `S/`) se prueban sin montar TanStack.
//
// Los dos totales se suman ACA y no en el JSX porque son la lectura economica de la seccion: la NC
// DISMINUYE el importe del referenciado y la ND lo AUMENTA (S2), asi que mezclarlos daria un numero
// que no significa nada. Los dos se muestran por separado, como en el origen.
import {
  ADJUSTMENT_VOUCHER_TYPES,
  type NoteVoucherType,
} from "@gestion/shared/lib/data/nota-options.ts";
import { getOptionLabel } from "@gestion/shared/lib/data/sale-options.ts";
import type { VoucherAdjustmentRow } from "@gestion/shared/lib/schemas/nota.ts";
import { formatCurrency, formatDate } from "@gestion/shared/lib/utils.ts";

import { notaMotiveLabel } from "./formulario.ts";

/** Fila de la tabla de notas: la fila del API con los textos ya resueltos. */
export interface NotaTableRow {
  id: string;
  voucherType: NoteVoucherType;
  /** `Nota de crédito` / `Nota de débito`. */
  voucherTypeLabel: string;
  voucherNumber: string;
  issueDate: string;
  /** `dd/mm/yyyy`. */
  issueDateLabel: string;
  motiveCode: string | null;
  /** Motivo del catalogo SUNAT de SU tipo, o `—`. */
  motiveLabel: string;
  total: number;
  totalLabel: string;
}

export function toNotaTableRow(row: VoucherAdjustmentRow): NotaTableRow {
  return {
    id: row.id,
    voucherType: row.voucherType,
    voucherTypeLabel: getOptionLabel(ADJUSTMENT_VOUCHER_TYPES, row.voucherType),
    voucherNumber: row.voucherNumber,
    issueDate: row.issueDate,
    issueDateLabel: formatDate(row.issueDate),
    motiveCode: row.motiveCode,
    motiveLabel: notaMotiveLabel(row.voucherType, row.motiveCode),
    total: row.total,
    totalLabel: formatCurrency(row.total),
  };
}

/** La lista completa, conservando el orden del API (emision mas reciente primero). */
export function toNotaTableRows(rows: VoucherAdjustmentRow[]): NotaTableRow[] {
  return rows.map(toNotaTableRow);
}

/** Los dos totales de la seccion, con el importe ya formateado. */
export interface NotaTotals {
  credit: number;
  debit: number;
  creditLabel: string;
  debitLabel: string;
}

/**
 * `Notas de crédito` y `Notas de débito` (S11), cada uno con SU suma.
 *
 * Sin notas los dos son 0: la seccion muestra entonces el vacio de S11, no una grilla de totales en
 * cero (como en el origen).
 */
export function notaTotals(rows: VoucherAdjustmentRow[]): NotaTotals {
  const credit = rows
    .filter((row) => row.voucherType === "NOTA_CREDITO")
    .reduce((sum, row) => sum + row.total, 0);
  const debit = rows
    .filter((row) => row.voucherType === "NOTA_DEBITO")
    .reduce((sum, row) => sum + row.total, 0);

  return {
    credit,
    debit,
    creditLabel: formatCurrency(credit),
    debitLabel: formatCurrency(debit),
  };
}

/** Si hay al menos una nota: es lo que decide entre la tabla y el vacio de S11. */
export function hasNotas(rows: VoucherAdjustmentRow[]): boolean {
  return rows.length > 0;
}
