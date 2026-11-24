// Series y correlativo del comprobante (slice 1 T4 y slice 2 T4/T5: S5, S7, S8 y S11).
//
// Port de `lib/comprobantes/series.ts` del origen, solo la parte PURA: el preview del numero y las
// reglas de pantalla que dependen de las series. El CRUD de series vive en
// `lib/configuracion/series.ts` (la pantalla `/configuracion/series` del slice 2) y el avance del
// correlativo lo hace la RPC `crear_venta` dentro de la misma transaccion que el alta (S2), no la
// app: en el origen era una segunda llamada sin transaccion (L5).
//
// Consecuencia del slice 2: la serie dejo de ser una AYUDA. El numero lo asigna la base desde la
// serie por defecto del tipo (S2), asi que sin serie por defecto no se registra
// (`isSaleSeriesBlocked`, S11) y el preview del numero se calcula con `suggestVoucherNumber`. La RPC
// ya no acepta un alta sin serie.
//
// Los textos de S5 se exportan como constantes en vez de escribirse dentro del JSX: el origen los
// tenia partidos en varias lineas con `{" "}` de por medio, y asi el texto exacto solo estaba
// garantizado a ojo. El test los compara completos.
import {
  VOUCHER_TYPES,
  type SelectOption,
} from "@gestion/shared/lib/data/sale-options.ts";

import type { VoucherKind, VoucherSeries, VoucherType } from "./types.ts";

/** Mismo formato que `VOUCHER_NUMBER_PATTERN` del schema compartido (S7). */
export const VOUCHER_NUMBER_PARTS = /^([A-Za-z0-9]{1,4})-(\d{1,8})$/;

/** Relleno del correlativo sugerido (`F001-000126`). */
export const CORRELATIVE_PAD = 6;

/** Pantalla de series (`/configuracion/series`, S8/S9 del slice 2). */
export const SERIES_CONFIG_PATH = "/configuracion/series";

export const NO_SALE_SERIES_MESSAGE = "Aún no tienes series de venta configuradas.";
export const NO_SALE_SERIES_HINT =
  "Sin una serie por defecto no podrás elegir el tipo de comprobante ni registrar la venta.";
export const CONFIGURE_SERIES_LABEL = "Configurar series";

/** Los tres tipos base de venta, que son los que el formulario ofrece (S10/S1). */
const SALE_VOUCHER_TYPES: SelectOption<VoucherType>[] = VOUCHER_TYPES;

function normalizeSeriesCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Preview del proximo numero: `F001-000126` a partir del ultimo correlativo usado.
 *
 * Es una AYUDA visual de solo lectura (S11): el numero real lo asigna `crear_venta` y puede no ser
 * este si otra venta consumio el correlativo entre el render y el guardado.
 */
export function suggestVoucherNumber(
  series: Pick<VoucherSeries, "code" | "lastNumber">
): string {
  return `${normalizeSeriesCode(series.code)}-${formatSeriesCorrelative(
    series.lastNumber + 1
  )}`;
}

/** Correlativo de 6 digitos para mostrar en la tabla de series. */
export function formatSeriesCorrelative(lastNumber: number): string {
  return String(lastNumber).padStart(CORRELATIVE_PAD, "0");
}

/**
 * Serie por defecto de cada tipo.
 *
 * La ultima gana, igual que el `Map.set` del origen: el indice unico parcial
 * `voucher_series_default_per_type_idx` garantiza una sola por tipo, y si hubiera dos filas
 * (datos viejos) la UI tiene que ser determinista en vez de depender del orden del API.
 */
export function defaultSeriesByType(
  series: VoucherSeries[]
): Map<VoucherType, VoucherSeries> {
  const byType = new Map<VoucherType, VoucherSeries>();

  for (const item of series) {
    if (item.isDefault) {
      byType.set(item.voucherType, item);
    }
  }

  return byType;
}

/** Si al menos uno de los tres tipos de venta tiene serie por defecto. */
export function hasAnyDefaultSaleSeries(series: VoucherSeries[]): boolean {
  const byType = defaultSeriesByType(series);

  return SALE_VOUCHER_TYPES.some((option) => byType.has(option.value));
}

/** Etiquetas de los tipos de venta sin serie por defecto, en el orden del catalogo. */
export function missingDefaultSaleSeriesLabels(series: VoucherSeries[]): string[] {
  const byType = defaultSeriesByType(series);

  return SALE_VOUCHER_TYPES.filter((option) => !byType.has(option.value)).map(
    (option) => option.label
  );
}

/** `"Factura, Boleta y Nota de venta"`: como se nombra una lista de tipos en el mensaje de S5. */
export function joinLabels(labels: string[]): string {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

/** `Configura una serie por defecto para {tipos} en Configuración → Series.` (`""` si no falta ninguna). */
export function missingSeriesMessage(labels: string[]): string {
  if (labels.length === 0) {
    return "";
  }

  return `Configura una serie por defecto para ${joinLabels(
    labels
  )} en Configuración → Series.`;
}

/**
 * Si un tipo de comprobante se puede elegir.
 *
 * Dos reglas del origen, en este orden: en ventas un tipo sin serie por defecto no se ofrece, y
 * FACTURA exige ademas un cliente con RUC. En compras no aplica ninguna (el tipo queda libre).
 *
 * `defaultByType: null` significa "este vertical no tiene fuente de series" (hoy compras). Sin
 * datos no se puede afirmar que un tipo no tenga serie, asi que esa mitad de la regla no se aplica
 * y queda solo la de FACTURA con RUC. Ventas siempre trae el mapa: las series las carga
 * `useVoucherSeries` en la vista del formulario.
 */
export function isVoucherTypeDisabled({
  voucherKind,
  voucherType,
  defaultByType,
  canIssueFactura,
}: {
  voucherKind: VoucherKind;
  voucherType: VoucherType;
  defaultByType: ReadonlyMap<VoucherType, VoucherSeries> | null;
  canIssueFactura: boolean;
}): boolean {
  if (voucherKind !== "VENTA") {
    return false;
  }

  if (defaultByType !== null && !defaultByType.has(voucherType)) {
    return true;
  }

  return voucherType === "FACTURA" && !canIssueFactura;
}

/**
 * Si la pantalla de alta de ventas queda bloqueada por falta de series (S11).
 *
 * Hasta el slice 1 la sugerencia de serie era una AYUDA: la RPC registraba igual sin serie. Desde el
 * slice 2 el numero lo asigna la base desde la serie por defecto del tipo (S2), asi que sin
 * ninguna serie por defecto no hay alta posible (`No hay una serie por defecto para este tipo de
 * comprobante...`, S6). Por eso, sin series, el alta se BLOQUEA: el aviso de S5 se muestra y el
 * boton de guardar se deshabilita, en vez de dejar que el usuario llene el formulario para recibir
 * un 400 al final.
 *
 * Solo ventas y solo el alta: la edicion de un comprobante ya emitido no necesita serie (su numero
 * es inmutable) y compras no tiene series todavia (el tipo queda libre).
 */
export function isSaleSeriesBlocked({
  voucherKind,
  isEditing,
  series,
}: {
  voucherKind: VoucherKind;
  isEditing: boolean;
  series: VoucherSeries[];
}): boolean {
  if (voucherKind !== "VENTA" || isEditing) {
    return false;
  }

  return !hasAnyDefaultSaleSeries(series);
}
