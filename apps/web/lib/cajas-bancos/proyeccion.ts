// Proyeccion de flujo de caja a cuatro semanas (C7 del vertical de cajas-bancos, SPEC 52).
//
// Port de `lib/caja/proyeccion.ts` del origen (111 lineas) COMPLETO: `PROJECTION_WEEKS`,
// `startOfWeek` y `buildCashFlowProjection`, las tres funciones puras. No toca red, no toca reloj
// (la fecha de hoy entra por parametro) y no toca el DOM, asi que se prueban solas en
// `proyeccion.test.ts`.
//
// POR QUE ESTA ARITMETICA SI SE PORTA Y NO VIOLA S2: S2 prohibe que la app calcule un SALDO para
// persistirlo; esto no es un saldo, es una proyeccion de tesoreria sobre comprobantes que ya
// existen y una columna `closingBalance` que no se guarda en ningun lado. El disponible de partida
// (`currentBalance`) NO se calcula aca: entra ya consolidado en soles por el llamador, con los
// saldos que devolvio la base y el tipo de cambio de los ajustes.
//
// El reparto de las cuatro semanas (origen: comentario de `buildCashFlowProjection`):
//
//   - Vencidos (vencimiento anterior al lunes en curso, incluido el contado con saldo) suman en la
//     semana 1 como "atrasado", separados de lo que vence dentro de la semana.
//   - Credito sin fecha de vencimiento no tiene semana: va a `unassigned` y NO suma.
//   - Lo que vence despues de la semana 4 queda fuera del horizonte.
//
// `round2` se aplica a los cuatro acumulados de cada semana y al saldo en cascada: sin eso, sumar
// cientos de importes con centavos deja un `closingBalance` con ruido de punto flotante y la
// columna "Queda" no cuadra al centavo con lo que el usuario suma a mano.
import type { VoucherBalance } from "../api/client.ts";
import { round2 } from "@gestion/shared/lib/utils.ts";
import { addDays } from "./periodo.ts";

/** Cantidad de semanas que se proyectan (SPEC 52). */
export const PROJECTION_WEEKS = 4;

/** Lunes de la semana de `today` (semanas de lunes a domingo). */
export function startOfWeek(today: string): string {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = domingo

  return addDays(today, day === 0 ? -6 : 1 - day);
}

/** Una semana del horizonte con lo que entra, lo que sale y el saldo con el que termina. */
export interface ProjectionWeek {
  index: number;
  start: string;
  end: string;
  overdueCollections: number;
  overduePayments: number;
  collections: number;
  payments: number;
  closingBalance: number;
}

/** Las cuatro semanas y los dos totales que se muestran aparte. */
export interface CashFlowProjection {
  currentBalance: number;
  weeks: ProjectionWeek[];
  /** Credito sin fecha de vencimiento: se muestra aparte y no suma. */
  unassigned: { collections: number; payments: number };
  hasNegativeWeek: boolean;
  firstNegativeWeekIndex: number | null;
}

/** Lo que la pantalla le pasa: hoy, el disponible consolidado y los dos lados de la cartera. */
export interface ProjectionInput {
  today: string;
  /** Disponible hoy, ya consolidado en soles. */
  currentBalance: number;
  receivables: VoucherBalance[];
  payables: VoucherBalance[];
}

function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000,
  );
}

/**
 * Reparte los comprobantes pendientes en 4 semanas (lunes-domingo) desde la semana en curso y
 * calcula el saldo final en cascada (SPEC 52).
 *
 * Ver el encabezado del archivo para las tres reglas de reparto. Un comprobante con `balance <= 0`
 * no se proyecta: ya esta pagado o cobrado, y sumarlo inflaria la semana.
 */
export function buildCashFlowProjection(input: ProjectionInput): CashFlowProjection {
  const firstMonday = startOfWeek(input.today);
  const weeks: ProjectionWeek[] = Array.from({ length: PROJECTION_WEEKS }, (_, index) => {
    const start = addDays(firstMonday, index * 7);

    return {
      index,
      start,
      end: addDays(start, 6),
      overdueCollections: 0,
      overduePayments: 0,
      collections: 0,
      payments: 0,
      closingBalance: 0,
    };
  });
  const unassigned = { collections: 0, payments: 0 };

  function addRows(rows: VoucherBalance[], kind: "collection" | "payment") {
    for (const row of rows) {
      if (row.balance <= 0) {
        continue;
      }

      if (!row.effectiveDueDate) {
        if (kind === "collection") {
          unassigned.collections += row.balance;
        } else {
          unassigned.payments += row.balance;
        }
        continue;
      }

      if (row.effectiveDueDate < firstMonday) {
        if (kind === "collection") {
          weeks[0]!.overdueCollections += row.balance;
        } else {
          weeks[0]!.overduePayments += row.balance;
        }
        continue;
      }

      const offset = Math.floor(daysBetween(firstMonday, row.effectiveDueDate) / 7);

      // Mas alla del horizonte: no se proyecta (la vista cubre 4 semanas).
      if (offset < 0 || offset >= PROJECTION_WEEKS) {
        continue;
      }

      if (kind === "collection") {
        weeks[offset]!.collections += row.balance;
      } else {
        weeks[offset]!.payments += row.balance;
      }
    }
  }

  addRows(input.receivables, "collection");
  addRows(input.payables, "payment");

  let balance = round2(input.currentBalance);

  for (const week of weeks) {
    week.overdueCollections = round2(week.overdueCollections);
    week.overduePayments = round2(week.overduePayments);
    week.collections = round2(week.collections);
    week.payments = round2(week.payments);
    week.closingBalance = round2(
      balance +
        week.overdueCollections -
        week.overduePayments +
        week.collections -
        week.payments,
    );
    balance = week.closingBalance;
  }

  const firstNegative = weeks.find((week) => week.closingBalance < 0);

  return {
    currentBalance: round2(input.currentBalance),
    weeks,
    unassigned: {
      collections: round2(unassigned.collections),
      payments: round2(unassigned.payments),
    },
    hasNegativeWeek: Boolean(firstNegative),
    firstNegativeWeekIndex: firstNegative?.index ?? null,
  };
}
