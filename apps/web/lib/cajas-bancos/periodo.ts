// Helpers puros de fecha del cuadre de caja (C5 del vertical de cajas-bancos).
//
// Port de `lib/caja/periodo.ts` del origen (72 lineas) mas `getMonthRange` (que en el origen vivia
// en `lib/caja/dashboard.ts` y que comparten el extracto de C6 y el flujo de C7). Son cinco
// funciones sin red, sin reloj y sin base: la fecha "hoy" siempre entra por parametro, y por eso se
// pueden probar solas (ver `periodo.test.ts`). Viven aca, en la web, porque son aritmetica de
// calendario y no de dinero: S2 prohibe que la app calcule saldos, no que sepa que dia termina un
// periodo.
//
// QUE NO SE PORTA Y POR QUE: `computeCashDifference` del origen (`:45-54`). Ningun componente lo
// usaba —el saldo, los totales y la diferencia los escribe la RPC `close_cash_account`— y dejarlo
// aca seria una segunda formula de la diferencia, que es justo lo que S2 prohibe. Quien necesite
// la diferencia del cierre la lee de `CashCloseRecord.difference`.
import type { ClosingPeriodicity } from "@/lib/api/client";

/**
 * "YYYY-MM-DD" -> Date en UTC.
 *
 * Se arma con `Date.UTC` a proposito: `new Date("2026-10-06")` ya se interpreta UTC, pero
 * `new Date(2026, 9, 6)` seria local, y el navegador de un usuario en Lima queda un dia atras
 * respecto del de uno en Madrid. Todo el vertical compara fechas como texto `YYYY-MM-DD`, que es
 * lo que devuelve y acepta la base (`date` sin zona).
 */
function parseIsoDate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Suma (o resta, con dias negativos) dias a una fecha `YYYY-MM-DD`. */
export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);

  return toIsoDate(date);
}

/**
 * Primer y ultimo dia del mes de una fecha `YYYY-MM-DD`.
 *
 * Origen: `getMonthRange` de `lib/caja/dashboard.ts`. Vive aca, junto a las otras reglas de
 * calendario, y no en `lib/cajas-bancos/dashboard.ts`, por dos razones: es aritmetica de fecha (no
 * de dinero) y tiene dos consumidores —el flujo del mes del dashboard (C7) y el rango inicial del
 * extracto (C6)—, asi que tenerla en `periodo.ts` evita que el port escriba una segunda version
 * cuando llegue C7. Se arma con `Date.UTC` por lo mismo que `addDays`: el ultimo dia del mes no
 * puede depender de la zona del navegador.
 */
export function getMonthRange(value: string): { start: string; end: string } {
  const [year, month] = value.split("-").map(Number);
  // Dia 0 del mes siguiente = ultimo dia de este mes (y respeta febrero bisiesto).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return {
    start: `${value.slice(0, 7)}-01`,
    end: `${value.slice(0, 7)}-${String(lastDay).padStart(2, "0")}`,
  };
}

/**
 * Fin de periodo sugerido segun la periodicidad, usando la fecha de hoy.
 *
 *   DAILY   -> ayer
 *   WEEKLY  -> el domingo anterior (si hoy es domingo, una semana atras)
 *   MONTHLY -> el ultimo dia del mes anterior
 *
 * Es una SUGERENCIA de la UI, no una regla: el periodo real lo decide el usuario en el modal y lo
 * valida la base (S4). Ayer/el domingo anterior porque el dia en curso todavia puede recibir
 * movimientos, y cerrarlo antes de que termine el dia bloquearia un recibo legitimo.
 */
export function suggestedPeriodEnd(periodicity: ClosingPeriodicity, today: string): string {
  const date = parseIsoDate(today);

  if (periodicity === "DAILY") {
    date.setUTCDate(date.getUTCDate() - 1);
  } else if (periodicity === "WEEKLY") {
    const day = date.getUTCDay(); // 0 = domingo
    const back = day === 0 ? 7 : day;
    date.setUTCDate(date.getUTCDate() - back);
  } else {
    // MONTHLY: dia 0 del mes actual = ultimo dia del mes anterior.
    date.setUTCDate(0);
  }

  return toIsoDate(date);
}

/**
 * Primer dia abierto para registrar movimientos de una cuenta.
 *
 * Es el dia siguiente al ultimo cierre, o hoy si la cuenta nunca se cerro. El cierre bloquea
 * hasta su `period_end` INCLUSIVE, asi que el periodo abierto arranca al dia siguiente.
 */
export function firstOpenDate(lastCloseEnd: string | null, today: string): string {
  return lastCloseEnd ? addDays(lastCloseEnd, 1) : today;
}

/**
 * ¿La fecha cae dentro de un periodo ya cerrado?
 *
 * El cierre es irreversible (S4) y bloquea hasta su `period_end` inclusive: comparar como texto
 * `YYYY-MM-DD` alcanza porque el formato es lexicograficamente ordenable. La base vuelve a
 * rechazar el movimiento de todas formas; esto es el aviso temprano de la pantalla.
 */
export function isDateClosed(date: string, lastCloseEnd: string | null): boolean {
  return lastCloseEnd !== null && date <= lastCloseEnd;
}
