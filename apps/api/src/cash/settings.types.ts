// Contrato de salida y semillas de los ajustes generales del vertical de cajas-bancos (C1, S7).
//
// Fuente: `lib/caja/caja.ts` del proyecto de origen — las constantes en las lineas 51-56 y las
// lecturas/siembra en las lineas 337-427. El origen guardaba la tabla clave/valor `app_setting`
// como un `Record<string, string>` y sembraba tres claves dentro del render de la tarjeta
// "Configuracion general" (`ensureDefaultSettings()`), es decir un GET que escribia. Aca la
// siembra es `POST /settings/ensure` (idempotente, explicita) y `GET /settings` solo lee; cierra
// la deuda L67 con el mismo criterio con el que `POST /catalogs/ensure` cerro la suya.
//
// Las tres claves son las UNICAS que la UI expone y las unicas que el SQL de la base lee:
//   default_closing_periodicity  `close_cash_account` (periodicidad cuando la cuenta no fija una)
//   cash_difference_tolerance    `close_cash_account` (diferencia sin motivo; default 0.50)
//   pen_usd_rate                 `close_cash_account` (tasa para consolidar cuentas en USD)
// Sin estas filas el cierre cae a `DAILY`/`0.50` y la tasa queda nula, que es exactamente el
// sintoma que describe L4 del doc de la feature.
//
// La tabla es clave/valor y `value` es `text`, asi que el contrato es un mapa de strings, no un
// objeto de tipos ricos: el origen hacia lo mismo (`getAppSettings`) y la UI decide como
// interpretarlo. Los lectores con defaults viven en la web (`lib/cajas-bancos/settings.ts`), que
// es donde el origen los tenia (`getDefaultPeriodicity` / `getCashDifferenceTolerance` /
// `getPenUsdRate`).

/** Los tres valores del enum `closing_periodicity` (migracion `20261006063301`, linea 49). */
export const CLOSING_PERIODICITIES = ["DAILY", "WEEKLY", "MONTHLY"] as const;

export type ClosingPeriodicity = (typeof CLOSING_PERIODICITIES)[number];

/** Las claves que el vertical escribe y lee. Cualquier otra fila viaja igual en el mapa. */
export type SettingKey =
	| "default_closing_periodicity"
	| "pen_usd_rate"
	| "cash_difference_tolerance";

/** Una semilla: la clave y el `value` textual que se guarda en la columna. */
export interface SettingSeed {
	readonly key: SettingKey;
	readonly value: string;
}

/**
 * Las tres semillas del origen, en el orden en que `ensureDefaultSettings()` las evaluaba.
 *
 * Valores y procedencia:
 *   DAILY  <- `lib/caja/caja.ts:51` (`DEFAULT_PERIODICITY`), empujado en la linea 369.
 *   3.75   <- `lib/caja/caja.ts:54` (`DEFAULT_PEN_USD_RATE`), empujado en la linea 372.
 *   0.50   <- `lib/caja/caja.ts:56` (`DEFAULT_DIFFERENCE_TOLERANCE = 0.5`), empujado con
 *             `String(...)` en la linea 377, o sea `"0.5"`.
 *
 * Sobre la tolerancia: el origen escribe `"0.5"` y la migracion que introdujo la clave para los
 * duenos existentes escribio `"0.50"`
 * (`packages/db/migrations/20261027202707_spec49_cash_close_tolerance_and_reason.sql:35-37`).
 * Aca se siembra `"0.50"` para que un dueno nuevo quede con el MISMO texto que uno migrado: el
 * SQL castea `value::numeric(12,2)`, asi que el numero es identico (0.5) y lo unico distinto
 * seria el texto guardado. Es la unica semilla donde las dos fuentes escriben distinto el mismo
 * valor.
 */
export const DEFAULT_SETTINGS: readonly SettingSeed[] = [
	{ key: "default_closing_periodicity", value: "DAILY" },
	{ key: "pen_usd_rate", value: "3.75" },
	{ key: "cash_difference_tolerance", value: "0.50" },
];

/** Las tres claves, en el orden de `DEFAULT_SETTINGS` (el del origen). */
export const SETTING_KEYS: readonly SettingKey[] = DEFAULT_SETTINGS.map((seed) => seed.key);

/**
 * Ajustes del dueno: `key -> value`, tal como estan en la tabla.
 *
 * Es `Record<string, string>` y no un objeto con las tres claves porque la tabla admite
 * cualquier clave: la migracion tambien inserto `cash_difference_tolerance` por SQL y una
 * version futura puede agregar otra sin tocar este tipo.
 */
export type AppSettings = Record<string, string>;

/**
 * Resultado de `POST /settings/ensure`: cuantas filas falto crear.
 *
 * `{ created: 3 }` la primera vez, `{ created: 0 }` despues. Misma forma y mismo razonamiento
 * que `CatalogSeedResult` (`{ methods, categories }`) de `POST /catalogs/ensure`.
 */
export interface SettingsSeedResult {
	created: number;
}
