// Ajustes generales de cajas-bancos del lado de la UI.
//
// DESVIO DELIBERADO respecto del origen (`lib/caja/caja.ts`, lineas 337-427): alli la tarjeta
// "Configuracion general" disparaba `ensureDefaultSettings()` dentro de un `useEffect` de carga,
// es decir un GET que escribia tres filas. Un GET que muta no es comportamiento a preservar (S7,
// deuda L67). Aca la siembra es una llamada explicita (`ensureSettings()` de `lib/api/client`) y
// la web la hace una sola vez cuando `needsDefaultSettings` dice que faltan filas: el efecto para
// el usuario es el mismo (abre la configuracion y encuentra los valores), el mecanismo es honesto.
//
// Las tres claves y sus defaults viven en `apps/api/src/cash/settings.types.ts`, copiados del
// origen, porque es el servidor el que escribe. Aca solo esta la DECISION de sembrar y los
// lectores con fallback (`getDefaultPeriodicity` / `getCashDifferenceTolerance` /
// `getPenUsdRate` del origen), que son funciones puras del mapa y no tocan la red.
import type { AppSettings, ClosingPeriodicity } from "@/lib/api/client";

/**
 * Las tres claves de `app_setting` que el vertical escribe y lee, en el orden del origen.
 *
 * Son las unicas que expone la tarjeta de configuracion y las unicas que el SQL de cierre lee
 * (`close_cash_account`: periodicidad por defecto, tolerancia de diferencia y tasa PEN/USD).
 */
export const SETTING_KEYS = [
  "default_closing_periodicity",
  "pen_usd_rate",
  "cash_difference_tolerance",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];

/**
 * Semillas del origen, con el valor textual que guarda la columna.
 *
 * `DAILY` es `DEFAULT_PERIODICITY` (`lib/caja/caja.ts:51`), `"3.75"` es `DEFAULT_PEN_USD_RATE`
 * (`:54`) y `"0.50"` es `DEFAULT_DIFFERENCE_TOLERANCE` (`:56`, que el origen escribe `"0.5"` y la
 * migracion `20261027202707_spec49...sql:35` escribio `'0.50'`; el SQL castea
 * `value::numeric(12,2)`, asi que el numero es 0.5 en los dos casos). Tienen que coincidir con
 * `apps/api/src/cash/settings.types.ts` o la UI pediria sembrar de nuevo lo que ya esta.
 */
export const DEFAULT_SETTINGS: Record<SettingKey, string> = {
  default_closing_periodicity: "DAILY",
  pen_usd_rate: "3.75",
  cash_difference_tolerance: "0.50",
};

/**
 * Hay que sembrar si falta (o esta vacia) alguna de las tres claves.
 *
 * Mismo criterio que `ensureDefaultSettings()` del origen (`if (!settings[KEY])`, lineas 368-378)
 * y mismo papel que `needsCatalogSeed` en `lib/pagos/catalogs.ts`: con `true` la tarjeta llama
 * `ensureSettings()` una vez y vuelve a leer; con `false` no escribe nada (la ruta es idempotente,
 * pero una pantalla no deberia tener efectos).
 */
export function needsDefaultSettings(settings: AppSettings): boolean {
  return SETTING_KEYS.some((key) => !settings[key]);
}

/**
 * Periodicidad de cierre por defecto (`getDefaultPeriodicity` del origen, lineas 391-400).
 *
 * Un valor que no sea uno de los tres del enum cae a `DAILY`, igual que en el origen: la columna
 * `value` es `text` y la base puede tener cualquier cosa escrita por una version anterior.
 */
export function closingPeriodicityFrom(settings: AppSettings): ClosingPeriodicity {
  const value = settings.default_closing_periodicity;

  return value === "DAILY" || value === "WEEKLY" || value === "MONTHLY"
    ? value
    : (DEFAULT_SETTINGS.default_closing_periodicity as ClosingPeriodicity);
}

/**
 * Tolerancia de diferencia permitida al cerrar (`getCashDifferenceTolerance`, lineas 403-415).
 *
 * Un valor no numerico o negativo cae al default: la base lo castea a `numeric(12,2)` en
 * `close_cash_account` y la funcion ya usa 0.50 cuando la fila no existe.
 */
export function cashDifferenceToleranceFrom(settings: AppSettings): number {
  const raw = settings.cash_difference_tolerance;

  if (!raw) {
    return Number(DEFAULT_SETTINGS.cash_difference_tolerance);
  }

  const value = Number(raw);

  return Number.isFinite(value) && value >= 0
    ? value
    : Number(DEFAULT_SETTINGS.cash_difference_tolerance);
}

/**
 * Tasa PEN/USD para consolidar cuentas en otra moneda (`getPenUsdRate`, lineas 417-427).
 *
 * `null` cuando no hay fila o el valor no es un numero, que es lo que el origen devolvia y lo que
 * el reporte muestra como "sin tipo de cambio".
 */
export function penUsdRateFrom(settings: AppSettings): number | null {
  const raw = settings.pen_usd_rate;

  if (!raw) {
    return null;
  }

  const value = Number(raw);

  return Number.isFinite(value) ? value : null;
}
