// Contrato de salida del agregado mensual de flujo de caja (C7 del vertical de cajas-bancos).
//
// Fuente: `lib/caja/dashboard.ts:17-21` del proyecto de origen, donde `getMonthlyCashFlow`
// (`lib/caja/caja.ts:501-516`) pide las filas del periodo y `summarizeCashFlow` las suma en el
// cliente:
//
//   export interface CashFlowTotals {
//     income: number;
//     expense: number;
//     /** Ingresos − egresos. Puede ser negativo. */
//     net: number;
//   }
//
// La forma se porta UNO A UNO (tres claves, estos nombres): el dashboard del origen
// (`components/cajas-bancos/dashboard-view.tsx:128,141`) es el consumidor, y cambiar un nombre es
// cambiar esa pantalla. Lo que NO se porta es el calculo en el cliente: los tres numeros los
// devuelve un `sum(...)` de PostgreSQL (S2). `net` es "ingresos menos egresos" y puede ser
// negativo; no es un saldo.
export interface MonthlyCashFlow {
	/** Total de los recibos INGRESO del periodo, sin los ANULADO. */
	income: number;
	/** Total de los recibos EGRESO del periodo, sin los ANULADO. */
	expense: number;
	/** `income - expense`. Puede ser negativo. */
	net: number;
}

/**
 * Fila cruda del agregado.
 *
 * Los tres son `numeric` (string exacto que entrega node-postgres, o el `0` que coalesce el SQL);
 * la conversion a number ocurre UNA vez, en `cash-flow.service.ts`, que es el borde JSON.
 */
export interface MonthlyCashFlowRow {
	income: string;
	expense: string;
	net: string;
}
