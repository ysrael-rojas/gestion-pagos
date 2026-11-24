// Formulario de alta de una nota: lo que no es JSX (T4 del slice 3, S2/S3/S4/S5/S9 y S11 de
// `odd/tasks/port-vertical-notas.md`).
//
// QUE FIJA ESTE MODULO, y por que no esta en el JSX:
//
//   * Los valores iniciales del alta: el "hoy" del negocio (`getTodayLocalDate()`, S9 del slice 1) y
//     el comprobante referenciado fijo, porque la nota se registra DESDE el detalle del comprobante
//     (L3.f). El motivo arranca vacio y el total tambien: son las dos decisiones del usuario.
//   * El catalogo de motivos del TIPO de la nota (S9). Se reusa `NOTE_MOTIVES` de
//     `@gestion/shared`, que es el mismo que valida el contrato: una segunda lista se desincroniza.
//   * Los montos (`notaAmounts`): `saleAmounts` de `@gestion/shared`, la unica formula del 18 % con
//     redondeo a 2 decimales (S4). El API usa la MISMA funcion para mandarlos a la RPC, asi que el
//     preview y lo escrito no pueden discrepar.
//   * El TOPE disponible (S5): lo que queda del total del referenciado despues de las notas de
//     credito ya aplicadas. La invariante la impone la base con el referenciado bloqueado; esto es
//     solo el numero que el usuario necesita para no chocar con ella. Una ND no lo consume (S2).
//   * El preview del numero desde la serie por defecto del tipo de la nota (S3): es de SOLO LECTURA,
//     porque el numero real lo asigna `public.crear_nota` en la transaccion del alta, y el body no
//     lo lleva (`toNotaRequestBody`, igual que `toVoucherRequestBody` del slice 2).
import {
  NOTE_MOTIVES,
  type NoteVoucherType,
} from "@gestion/shared/lib/data/nota-options.ts";
import type { SelectOption } from "@gestion/shared/lib/data/sale-options.ts";
import type {
  NotaFormInput,
  NotaFormValues,
  NotaWriteValues,
  VoucherAdjustmentRow,
} from "@gestion/shared/lib/schemas/nota.ts";
import { saleAmounts } from "@gestion/shared/lib/ventas/montos.ts";
import { getTodayLocalDate } from "@gestion/shared/lib/utils.ts";

import { defaultSeriesByType, suggestVoucherNumber } from "../ventas/series.ts";
import type { VoucherSeries } from "../ventas/types.ts";
import { NOTAS_COPY } from "./textos.ts";

/** Lo que el formulario necesita del comprobante referenciado para arrancar. */
export interface NotaReference {
  /** `id` del comprobante que la nota corrige: viaja en el body. */
  referencedComprobanteId: string;
  voucherType: NoteVoucherType;
}

/**
 * Valores iniciales del alta.
 *
 * `voucherNumber` arranca vacio porque el preview lo escribe la vista cuando ya tiene las series
 * (igual que el preview del comprobante del slice 2): sin serie por defecto del tipo no hay numero
 * que mostrar, y el campo es de solo lectura.
 */
export function createEmptyNotaFormValues(reference: NotaReference): NotaFormInput {
  return {
    issueDate: getTodayLocalDate(),
    voucherType: reference.voucherType,
    voucherNumber: "",
    total: "",
    motiveCode: "",
    referencedComprobanteId: reference.referencedComprobanteId,
  };
}

/** Motivos del catalogo SUNAT que corresponden al tipo de la nota (S9). */
export function notaMotiveOptions(
  voucherType: NoteVoucherType
): SelectOption<string>[] {
  return NOTE_MOTIVES[voucherType];
}

/**
 * Etiqueta del motivo de una fila de la tabla, con el catalogo de SU tipo de nota.
 *
 * El codigo `01` es "Anulación de la operación" en una NC e "Intereses por mora" en una ND: el mismo
 * codigo significa otra cosa, y por eso el catalogo se elige por tipo. Un motivo `null` (lo admite el
 * contrato de fila) o uno que no este en el catalogo no inventan una etiqueta: muestran `—`.
 */
export function notaMotiveLabel(
  voucherType: NoteVoucherType,
  motiveCode: string | null
): string {
  if (!motiveCode) {
    return NOTAS_COPY.noValueMark;
  }

  const options = notaMotiveOptions(voucherType);

  return (
    options.find((option) => option.value === motiveCode)?.label ??
    NOTAS_COPY.noValueMark
  );
}

/**
 * Subtotal e IGV del preview de montos.
 *
 * El total que tipea el usuario YA incluye IGV y `saleAmounts` es la unica formula (S4). El guarda de
 * `Number.isFinite` es lo que evita un "S/ NaN" mientras el campo tiene `""` o un texto cualquiera.
 */
export function notaAmounts(total: number | string): {
  subtotal: number;
  igv: number;
} {
  const numeric = Number(total);

  return saleAmounts(Number.isFinite(numeric) ? numeric : 0);
}

/** Suma de las notas de CREDITO del referenciado: son las que consumen el tope (S5). */
export function creditNotesTotal(notes: VoucherAdjustmentRow[]): number {
  return notes
    .filter((note) => note.voucherType === "NOTA_CREDITO")
    .reduce((sum, note) => sum + note.total, 0);
}

/** Suma de las notas de DEBITO del referenciado: no consumen el tope, aumentan el saldo (S2). */
export function debitNotesTotal(notes: VoucherAdjustmentRow[]): number {
  return notes
    .filter((note) => note.voucherType === "NOTA_DEBITO")
    .reduce((sum, note) => sum + note.total, 0);
}

/**
 * `Tope disponible para este documento:` (S5).
 *
 * Es el total del comprobante referenciado menos las notas de credito (y retenciones, cuando exista su
 * slice) ya aplicadas. Nunca negativo: un tope agotado se muestra como 0, y el negativo solo podria
 * venir de datos historicos, porque la invariante la impone la base con el referenciado bloqueado.
 */
export function availableCredit(
  voucherTotal: number,
  notes: VoucherAdjustmentRow[]
): number {
  return Math.max(0, voucherTotal - creditNotesTotal(notes));
}

/**
 * Preview del numero de la nota (S3/S11).
 *
 * `code-(last+1)` de la serie POR DEFECTO del tipo de la nota, con el mismo `suggestVoucherNumber`
 * del alta de comprobantes (una sola formula del preview). Sin serie por defecto del tipo devuelve
 * `""`: no se inventa un numero ni se muestra el de otro tipo. Ese caso es el bloqueo de S3, que la
 * pantalla anticipa con su mensaje y el boton deshabilitado.
 */
export function previewNotaNumber(
  voucherType: NoteVoucherType,
  series: VoucherSeries[]
): string {
  const defaultSeries = defaultSeriesByType(series).get(voucherType);

  return defaultSeries ? suggestVoucherNumber(defaultSeries) : "";
}

/**
 * Body de `POST /notes`.
 *
 * TRAMPA DEL PORT, la misma del formulario de comprobantes: el OUTPUT del formulario
 * (`NotaFormValues`) exige `voucherNumber` porque es un campo del formulario, pero el body NO lo
 * lleva. El numero lo asigna la base desde la serie por defecto del tipo de la nota dentro de la
 * transaccion del alta (S3) y `notaWriteSchema` lo acepta como opcional e ignorado; mandarlo seria
 * ofrecer un valor que el servidor descarta.
 *
 * Los otros cuatro datos que el origen mandaba tampoco viajan: `entity_id`, `voucher_kind`,
 * `payment_type` y `credit_days` se HEREDAN del referenciado en la RPC (S4), y el `status` lo escribe
 * ella (`PAGADO`, una nota no es cobrable ni pagable).
 */
export function toNotaRequestBody(values: NotaFormValues): NotaWriteValues {
  return {
    issueDate: values.issueDate,
    voucherType: values.voucherType,
    total: values.total,
    motiveCode: values.motiveCode,
    referencedComprobanteId: values.referencedComprobanteId,
  };
}
