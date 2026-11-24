// Series de comprobante del lado de la UI (T4 del slice 2: S8 de
// `odd/tasks/port-vertical-series.md`).
//
// Port de `components/configuracion/{series-view,series-columns,serie-modal}.tsx` y de
// `lib/comprobantes/series.ts` del origen, solo la parte que NO es JSX: el transporte de las cuatro
// rutas, la fila -> modelo de tabla y los valores del formulario. El texto de la pantalla se
// exporta como constantes por la misma razon que en `lib/ventas/series.ts`: el origen lo tenia
// partido en varias lineas con `{" "}` de por medio, y asi el texto exacto de S8 solo estaba
// garantizado a ojo. El test lo compara completo.
//
// Tres diferencias con el origen, todas del contrato nuevo:
//
// 1. EL CRUD VA POR RPC DEL API, no por PostgREST (`lib/comprobantes/series.ts` del origen hacia
//    UPDATE/INSERT directo y limpiaba el default anterior en una segunda llamada). Aca
//    `POST /series`, `PATCH /series/:id` y `POST /series/:id/delete` llaman a `crear_serie`,
//    `editar_serie` y `eliminar_serie`, que hacen lo mismo dentro de una transaccion y sin DML
//    (S5). El default anterior lo limpia la RPC: no hay `clearDefaultSeries` en el cliente.
// 2. EL BORRADO ES POST. `authenticated` no tiene DELETE sobre `voucher_series` (S5) y el puente
//    del navegador no reenvia ese verbo (S9), asi que la baja logica es `POST /series/:id/delete`.
// 3. EL TIPO NO VIAJA EN LA EDICION. Cambiarlo reescribiria la numeracion ya emitida (S5, L4a),
//    por eso `toSerieEditBody` lo omite y el formulario muestra el tipo como dato fijo.
//
// El `fetch` no se duplica: `request` es el de `lib/api/client.ts`, el unico transporte del
// frontend (resuelve la base segun donde corra, credenciales `same-origin` y `ApiError` con el
// mensaje del API sin tocar). Los errores de S6 (`Ya existe una serie con ese código para ese
// tipo.`, `La serie no existe.`) llegan al `toast` tal cual: traducirlos aca duplicaria el mapa de
// errores de `apps/api/src/series/series.errors.ts`.
//
// El correlativo se formatea con `formatSeriesCorrelative` de `lib/ventas/series.ts`: la tabla de
// series y el preview del formulario de ventas tienen que mostrar el mismo numero con el mismo
// relleno, y dos helpers distintos se desincronizan al primer cambio.
import type { VoucherType } from "@gestion/shared/components/comprobantes/types.ts";
import {
  ISSUED_SERIES_VOUCHER_TYPES,
  getSeriesTypeLabel,
} from "@gestion/shared/lib/data/series-options.ts";
import type {
  SerieFormInput,
  SerieFormValues,
  VoucherSeriesRow,
} from "@gestion/shared/lib/schemas/serie.ts";

import { request } from "../api/client.ts";
import { formatSeriesCorrelative } from "../ventas/series.ts";

/**
 * Textos de `/configuracion/series`, verbatim de S8.
 *
 * Los tres marcados "[cambia]" en el documento son los que decian "se sugiere" en el origen: hoy el
 * sistema **asigna** el correlativo, asi que sugerirlo seria mentir. `editActionLabel`,
 * `deleteActionLabel` y `deleteDialogTitle` son funciones porque llevan el codigo de la serie
 * intercalado (`Editar serie F001`), igual que el `aria-label` del origen.
 */
export const SERIES_COPY = {
  sectionTitle: "Configuración",
  sectionSubtitle: "Administra la numeración de tus comprobantes de venta.",
  pageTitle: "Series de comprobantes",
  pageSubtitle:
    "Registra las series de cada tipo de comprobante y elige cuál se usa por defecto. " +
    "El correlativo lo asigna el sistema al registrar ventas.",
  defaultHint: "Solo una serie por tipo puede quedar como predeterminada.",
  addAction: "Agregar serie",
  emptyMessage:
    "No hay series registradas. Agrega la primera para poder registrar ventas.",
  columnType: "Tipo",
  columnCode: "Serie",
  columnLastNumber: "Último correlativo",
  columnDefault: "Por defecto",
  defaultBadge: "Predeterminada",
  noDefaultMark: "—",
  createTitle: "Agregar serie",
  editTitle: "Editar serie",
  modalSubtitle:
    "Define el código de serie y si es la que se usa por defecto para ese tipo de comprobante.",
  fieldType: "Tipo de comprobante",
  fieldCode: "Serie",
  requiredBadge: "Requerido",
  codePlaceholder: "F001",
  defaultCheckboxLabel: "Usar como serie por defecto para este tipo",
  defaultCheckboxHint: "Solo puede haber una serie por defecto por tipo de comprobante.",
  codeHint:
    "De 1 a 4 caracteres alfanuméricos. El correlativo lo asigna el sistema al registrar ventas.",
  toastCreated: "Serie agregada",
  toastUpdated: "Serie actualizada",
  toastDeleted: "Serie eliminada",
  deleteDescription:
    "Dejará de usarse para nuevas ventas. Los comprobantes ya registrados no cambian.",
  deleteConfirm: "Eliminar",
  cancel: "Cancelar",
  save: "Guardar cambios",
  create: "Agregar serie",
  saving: "Guardando…",
  unexpectedError: "Ocurrió un error inesperado. Intenta nuevamente.",
  editActionLabel: (code: string) => `Editar serie ${code}`,
  deleteActionLabel: (code: string) => `Eliminar serie ${code}`,
  deleteDialogTitle: (code: string) => `Eliminar serie ${code}`,
} as const;

/**
 * Fila de la tabla: la fila del API con los textos ya resueltos.
 *
 * `lastNumber` se conserva crudo porque es lo que ordena; `correlativeLabel` es lo que se pinta. La
 * etiqueta del tipo sale de `SERIES_VOUCHER_TYPES`, que es el catalogo del origen, y no de un
 * `switch` local.
 */
export interface SerieTableRow {
  id: string;
  voucherType: VoucherType;
  typeLabel: string;
  code: string;
  lastNumber: number;
  correlativeLabel: string;
  isDefault: boolean;
  defaultLabel: string;
}

/**
 * Fila del API -> fila de la tabla.
 *
 * El correlativo de la tabla es el ULTIMO usado (`000126`), no el proximo: la columna se llama
 * "Último correlativo" y el proximo numero lo asigna la base al emitir (S2).
 */
export function toSerieTableRow(row: VoucherSeriesRow): SerieTableRow {
  return {
    id: row.id,
    voucherType: row.voucherType,
    typeLabel: getSeriesTypeLabel(row.voucherType),
    code: row.code,
    lastNumber: row.lastNumber,
    correlativeLabel: formatSeriesCorrelative(row.lastNumber),
    isDefault: row.isDefault,
    defaultLabel: row.isDefault
      ? SERIES_COPY.defaultBadge
      : SERIES_COPY.noDefaultMark,
  };
}

export function toSeriesTableRows(rows: VoucherSeriesRow[]): SerieTableRow[] {
  return rows.map(toSerieTableRow);
}

/**
 * Valores iniciales del alta.
 *
 * `voucherType` arranca vacio a proposito: es la decision que el usuario tiene que tomar, y
 * `serieFormSchema` ya la exige con el mensaje de S7. `isDefault` arranca en `false`, igual que en
 * el origen: marcar por defecto es una decision explicita, y la RPC limpia el default anterior del
 * mismo tipo en la misma transaccion cuando se marca.
 */
export function createEmptySerieFormValues(): SerieFormInput {
  return {
    voucherType: "" as VoucherType,
    code: "",
    isDefault: false,
  };
}

/** Valores iniciales de la edicion, a partir de la fila que devuelve el API. */
export function toSerieFormValues(row: VoucherSeriesRow): SerieFormInput {
  return {
    voucherType: row.voucherType,
    code: row.code,
    isDefault: row.isDefault,
  };
}

/** Body de `PATCH /series/:id`: codigo y default, sin el tipo (S5, L4a). */
export interface SerieEditBody {
  code: string;
  isDefault: boolean;
}

export function toSerieEditBody(values: SerieFormValues): SerieEditBody {
  return { code: values.code, isDefault: values.isDefault };
}

/**
 * Codigo de serie mientras se tipea: mayusculas (S8).
 *
 * Solo cambia el caso: no recorta ni valida, porque el `trim` es del contrato compartido
 * (`serieFormSchema`) y la longitud la corta el `maxLength` del input. Recortar mientras el usuario
 * escribe seria pelear con el cursor.
 */
export function normalizeSerieCodeInput(value: string): string {
  return value.toUpperCase();
}

/** Las series vivas del dueno (`GET /series`), en el orden del API (tipo y codigo). */
export function listSeries(): Promise<VoucherSeriesRow[]> {
  return request<VoucherSeriesRow[]>("/series");
}

/** Alta (RPC `crear_serie`). Devuelve la fila creada (201). */
export function createSerie(values: SerieFormValues): Promise<VoucherSeriesRow> {
  return request<VoucherSeriesRow>("/series", { method: "POST", body: values });
}

/** Edicion del codigo y del default (RPC `editar_serie`). Devuelve la fila ya guardada. */
export function updateSerie(
  id: string,
  values: SerieFormValues
): Promise<VoucherSeriesRow> {
  return request<VoucherSeriesRow>(`/series/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: toSerieEditBody(values),
  });
}

/**
 * Baja LOGICA (RPC `eliminar_serie`): `POST /series/:id/delete`, 204 sin cuerpo.
 *
 * No es un DELETE HTTP: el puente del navegador no reenvia ese verbo y la fila no desaparece (queda
 * `deleted_at`). Los comprobantes ya emitidos no cambian (S8).
 */
export async function deleteSerie(id: string): Promise<void> {
  await request<void>(`/series/${encodeURIComponent(id)}/delete`, {
    method: "POST",
  });
}

/** Los tres tipos que la pantalla ofrece (S4), para el select del modal. */
export const SERIES_TYPE_OPTIONS = ISSUED_SERIES_VOUCHER_TYPES;
