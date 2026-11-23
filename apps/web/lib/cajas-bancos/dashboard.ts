// Resumen de posiciones y flujo del mes del dashboard de tesoreria (C5 y C7 del vertical de
// cajas-bancos).
//
// Port de `lib/caja/dashboard.ts` del origen: `summarizePositions` y `toPen`, las dos funciones
// que el listado de cuentas consume para mostrar el total consolidado, el saldo en cajas, el saldo
// en bancos y el "% del total" de cada fila.
//
// `FlowLike`, `CashFlowTotals` y `summarizeCashFlow` NO estan: se portaron con C7 y se borraron en
// la limpieza del vertical porque ningun consumidor de produccion los llamaba. El resultado del mes
// lo agrega PostgreSQL en `GET /cash-flow/monthly`; tener ademas la suma en el cliente era la
// segunda definicion de "flujo del mes" que S2 prohibe.
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
// el filtro `status <> 'ANULADO'`. No hay una segunda suma en el cliente: el helper de display del
// origen se borro por no tener consumidor (ver el encabezado).
import { round2 } from "@gestion/shared/lib/utils.ts";

/** Fila minima de una posicion para agregar el disponible total. */
export interface PositionLike {
  type: "CASH_BOX" | "BANK_ACCOUNT";
  balance: number;
}

export interface PositionsSummary {
  total: number;
  cashTotal: number;
  bankTotal: number;
  count: number;
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
