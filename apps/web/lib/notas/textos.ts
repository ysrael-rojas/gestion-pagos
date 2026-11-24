// Textos de la seccion de notas y de su formulario de alta (T4 del slice 3: S11 y S3 de
// `odd/tasks/port-vertical-notas.md`).
//
// POR QUE UN MODULO DE TEXTOS Y NO LITERALES EN EL JSX: S11 fija cada texto verbatim, y el origen
// los tenia partidos en varias lineas con `{" "}` de por medio (`Registrar una nota de crédito`,
// `Completa los datos para registrar …`), asi que el texto exacto solo estaba garantizado a ojo. Aca
// cada cadena vive en un solo lugar, el test la compara completa y la pantalla solo la dibuja.
// Mismo criterio que `SERIES_COPY` (`lib/configuracion/series.ts`) y las constantes de
// `lib/ventas/series.ts`.
//
// LOS DOS TEXTOS QUE NO SON DE S11:
//
//   * `noSeriesMessage` es el de S3, verbatim de la RPC `public.crear_nota`
//     (`20261127090000_notas_rpcs.sql`). Se duplica a proposito: la pantalla bloquea el alta ANTES de
//     mandar la peticion cuando el tipo de la nota no tiene serie por defecto, y para eso necesita el
//     texto sin esperar un 400. Si la RPC cambia su redaccion, cambia aca tambien (el e2e de
//     `12-notas.spec.ts` compara el texto de la pantalla y el del API).
//   * `voucherTotalLabel` y `balanceLabel` son los de la ficha del referenciado del origen
//     (`components/notas/nota-form.tsx`): el prefijo con dos puntos, y el valor al lado.
export const NOTAS_COPY = {
  // --- La seccion del detalle (S11) ---
  sectionTitle: "Notas de crédito/débito",
  emptyMessage: "Este comprobante no tiene notas de crédito ni de débito aplicadas.",
  columnType: "Tipo",
  columnNumber: "Número",
  columnIssueDate: "Emisión",
  columnMotive: "Motivo",
  columnTotal: "Total",
  creditTotalLabel: "Notas de crédito",
  debitTotalLabel: "Notas de débito",
  /** Marca de una fila sin motivo: el contrato de fila admite `null` (S11). */
  noValueMark: "—",
  /** Punto de entrada al alta desde el detalle (L3.f: el alta vive aca, no en un listado aparte). */
  createCreditAction: "Agregar nota de crédito",
  createDebitAction: "Agregar nota de débito",
  loadError: "No se pudieron cargar las notas del comprobante.",

  // --- El formulario de alta (S11) ---
  modalDescription: "Completa los datos para registrar la nota.",
  fieldIssueDate: "Fecha de emisión",
  fieldVoucherNumber: "Nro comprobante",
  fieldMotive: "Motivo",
  motivePlaceholder: "Selecciona el motivo",
  fieldTotal: "Total",
  subtotalLabel: "Subtotal (solo lectura)",
  igvLabel: "IGV 18 % (solo lectura)",
  availableCreditLabel: "Tope disponible para este documento:",
  debitRaisesBalance: "Una nota de débito aumenta el saldo del comprobante.",
  cancel: "Cancelar",
  register: "Registrar",
  saving: "Registrando…",
  savedToast: "Documento registrado",
  unexpectedError: "Ocurrió un error inesperado. Intenta nuevamente.",

  // --- La ficha del comprobante referenciado (port de `nota-form.tsx`) ---
  voucherTotalLabel: "Total del comprobante:",
  balanceLabel: "Saldo:",

  // --- El bloqueo por falta de serie del tipo de la nota (S3) ---
  noSeriesMessage:
    "No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.",
  configureSeries: "Configurar series",
} as const;

/**
 * Titulo del modal, por tipo de nota (S11): `Registrar una nota de crédito` / `… de débito`.
 *
 * No es una interpolacion (`Registrar una ${label}`) porque S11 fija las dos frases completas.
 */
export const NOTA_FORM_TITLES: Record<"NOTA_CREDITO" | "NOTA_DEBITO", string> = {
  NOTA_CREDITO: "Registrar una nota de crédito",
  NOTA_DEBITO: "Registrar una nota de débito",
};
