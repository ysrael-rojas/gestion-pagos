// Resumen de posiciones y flujo del mes del dashboard de tesoreria (C5 y C7 del vertical de
// cajas-bancos).
//
// Port COMPLETO de `lib/caja/dashboard.ts` del origen (100 lineas): `summarizePositions` y `toPen`
// (las dos funciones que el listado de cuentas consume para mostrar el total consolidado, el saldo
// en cajas, el saldo en bancos y el "% del total" de cada fila) mas `FlowLike`, `CashFlowTotals` y
// `summarizeCashFlow` (el resultado del mes del dashboard). C5 porto la mitad de posiciones y dejo
// estas tres anotadas como "C7"; el dashboard llego con C7 y las trae con su pantalla.
//
// `getMonthRange` NO esta aca y no se duplica: vive en `lib/cajas-bancos/periodo.ts` desde C5,
// porque es aritmetica de calendario (no de dinero) y tiene dos consumidores (el rango del extracto
// de C6 y el del flujo del mes de C7). El origen la tenia en este archivo.
//
// S2 — El SALDO no se calcula aca: entra ya calculado por la base en `balance`
// (`GET /cash-positions`). Lo unico que hace este archivo es sumar esos saldos para mostrarlos
// juntos, que es una decision de presentacion, no de dominio.
//
// S2 — EL FLUJO DEL MES TAMPOCO SE SUMA ACA EN PRODUCCION: el dashboard usa
// `getMonthlyCashFlow` (`GET /cash-flow/monthly`), donde los tres numeros los agrega PostgreSQL con
// el filtro `status <> 'ANULADO'`. `summarizeCashFlow` es el helper de DISPLAY del origen (suma
// filas que YA vienen sin anulados y redondea a dos decimales) y se conserva por contrato del
// slice, no porque la pantalla lo llame: reintroducir la suma en el cliente seria una segunda
// definicion de "flujo del mes" al lado del SQL, que es justo lo que S2 prohibe.
import { round2 } from "@gestion/shared/lib/utils.ts";

/** Fila minima de un movimiento de caja para agregar el resultado del mes. */
export interface FlowLike {
  direction: "INGRESO" | "EGRESO";
  amount: number;
}

/** Fila minima de una posicion para agregar el disponible total. */
export interface PositionLike {
  type: "CASH_BOX" | "BANK_ACCOUNT";
  balance: number;
}

/** Los tres numeros del resultado del mes. */
export interface CashFlowTotals {
  income: number;
  expense: number;
  /** Ingresos − egresos. Puede ser negativo. */
  net: number;
}

export interface PositionsSummary {
  total: number;
  cashTotal: number;
  bankTotal: number;
  count: number;
}

/**
 * Suma ingresos y egresos del periodo; el neto es ingresos − egresos.
 *
 * Una direccion que no sea INGRESO ni EGRESO no suma a ningun lado (y no es un error: se ignora,
 * como en el origen). El filtro de recibos ANULADOS NO esta aca: lo aplica el SQL de
 * `GET /cash-flow/monthly`, antes de que cualquier fila llegue al cliente (S2).
 */
export function summarizeCashFlow(rows: FlowLike[]): CashFlowTotals {
  let income = 0;
  let expense = 0;

  for (const row of rows) {
    if (row.direction === "INGRESO") {
      income += row.amount;
    } else if (row.direction === "EGRESO") {
      expense += row.amount;
    }
  }

  income = round2(income);
  expense = round2(expense);

  return { income, expense, net: round2(income - expense) };
}

/**
 * Total disponible y su desglose por tipo de cuenta (caja vs. banco).
 *
 * Redondea a dos decimales: la suma de saldos con centavos arrastra ruido de punto flotante
 * (0.1 + 0.2 !== 0.3) y el total que ve el usuario tiene que cerrar al centavo.
 */
export function summarizePositions(positions: PositionLike[]): PositionsSummary {
  let total = 0;
  let cashTotal = 0;
  let bankTotal = 0;

  for (const position of positions) {
    total += position.balance;

    if (position.type === "CASH_BOX") {
      cashTotal += position.balance;
    } else {
      bankTotal += position.balance;
    }
  }

  return {
    total: round2(total),
    cashTotal: round2(cashTotal),
    bankTotal: round2(bankTotal),
    count: positions.length,
  };
}

/**
 * Convierte un saldo a soles con el tipo de cambio configurado (SPEC 52).
 *
 * Sin TC configurado una cuenta en otra moneda cuenta como 0 y la pantalla avisa que falta el
 * tipo de cambio en Configuracion: sumarla a 1:1 inventaria un saldo, y bloquear la tabla por una
 * fila sin TC escondedria las cuentas en soles, que si tienen saldo real.
 */
export function toPen(balance: number, currency: string, penUsdRate: number | null): number {
  if (currency === "PEN") {
    return balance;
  }

  return penUsdRate ? balance * penUsdRate : 0;
}
