// Resumen de posiciones del listado de cuentas (C5 del vertical de cajas-bancos).
//
// Port de la MITAD de `lib/caja/dashboard.ts` del origen (100 lineas): `summarizePositions` y
// `toPen`, que son las dos funciones que el listado de cuentas consume para mostrar el total
// consolidado, el saldo en cajas, el saldo en bancos y el "% del total" de cada fila.
//
// QUE NO SE PORTA Y POR QUE: `getMonthRange`, `summarizeCashFlow` y `FlowLike` son el flujo del
// mes del dashboard (`/cajas-bancos`, C7) y `summarizeCashFlow` suma importes de pagos, cosa que
// hoy solo necesita esa pantalla. Portarlos sin consumidor agregaria una segunda aritmetica de
// dinero a la web antes de tiempo; C7 los trae con su pantalla.
//
// S2 — El SALDO no se calcula aca: entra ya calculado por la base en `balance`
// (`GET /cash-positions`). Lo unico que hace este archivo es sumar esos saldos para mostrarlos
// juntos, que es una decision de presentacion, no de dominio.
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
