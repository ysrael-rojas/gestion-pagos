// Helpers puros de fecha del cuadre de caja (C5 del vertical de cajas-bancos).
//
// Port de `lib/caja/periodo.ts` del origen (72 lineas). Son cuatro funciones sin red, sin reloj y
// sin base: la fecha "hoy" siempre entra por parametro, y por eso se pueden probar solas (ver
// `periodo.test.ts`). Viven aca, en la web, porque son aritmetica de calendario y no de dinero:
// S2 prohibe que la app calcule saldos, no que sepa que dia termina un periodo.
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
