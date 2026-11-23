// Contrato de salida de cierres y arqueos (C4 del vertical de cajas-bancos, S2/S3/S4/S5).
//
// Fuente: `lib/caja/caja.ts` (`mapCashCloseRow`, `getCashClose`, `listCashCloses`,
// `listCloseDenominations`) y `lib/caja/arqueos.ts` (`CashCount`, `mapRow`, `listCashCounts`,
// `getCashCount`) del proyecto de origen. La forma es la MISMA que consumen `cuadres-view.tsx`,
// `cuadre-acta.tsx`, `cuadre-report.tsx` y `cash-counts-table.tsx`: cambiar un campo alla es
// cambiar este archivo, y el listado de claves esta pinneado por el e2e.
//
// NINGUN importe se calcula aca (S2). `openingBalance`, `incomeTotal`, `expenseTotal`,
// `expectedBalance`, los dos totales de transferencia, `difference`, `changeFund`,
// `differenceTolerance` y `penUsdRate` son columnas que escribio la RPC con
// `private.cash_expected_balance`; este archivo solo declara como viajan al cliente. La unica
// aritmetica permitida es `Number(...)` en el borde JSON (node-postgres entrega `numeric` como
// string exacto para no perder centavos).
//
// Tipos: `date` viaja "YYYY-MM-DD" (sin `Date`, para que el dia no se corra de zona al
// serializar), `timestamptz` como ISO string, `numeric` como number (o `null` donde la columna es
// nullable) y los enums con los valores de la base.
import type { ClosingPeriodicity } from "./settings.types.ts";

/** Una fila de `cash_close_denomination`: el conteo fisico de un cierre (vacio en bancos). */
export interface CloseDenomination {
	denomination: number;
	quantity: number;
}

/**
 * Una fila de `GET /cash-closes` (y del alta): el `CashClose` del origen, campo por campo.
 *
 * `differenceTolerance` es el snapshot de la tolerancia vigente al cerrar (SPEC 49) y
 * `countedBy`/`verifiedBy` la doble firma del acta (SPEC 51); los tres son `null` en los cierres
 * historicos anteriores a esas migraciones.
 */
export interface CashCloseRecord {
	id: string;
	cashAccountId: string;
	periodicity: ClosingPeriodicity;
	periodStart: string;
	periodEnd: string;
	openingBalance: number;
	incomeTotal: number;
	expenseTotal: number;
	expectedBalance: number;
	transferInTotal: number;
	transferOutTotal: number;
	countedBalance: number | null;
	changeFund: number | null;
	difference: number | null;
	differenceReason: string | null;
	differenceTolerance: number | null;
	countedBy: string | null;
	verifiedBy: string | null;
	penUsdRate: number | null;
	notes: string | null;
	createdAt: string;
}

/**
 * `GET /cash-closes/:id` y la respuesta de `POST /cash-closes`: el cierre con su arqueo.
 *
 * El origen pedia las dos cosas en paralelo (`getCashClose` + `listCloseDenominations`,
 * `cuadres-view.tsx:411-414`); aca es una sola respuesta porque el detalle se lee en la misma
 * transaccion y el acta no puede mostrar un cierre con denominaciones de otro momento.
 */
export interface CashCloseDetail extends CashCloseRecord {
	denominations: CloseDenomination[];
}

/**
 * Una fila de `GET /cash-counts`: el `CashCount` del origen (`lib/caja/arqueos.ts:8-21`).
 *
 * `expectedBalance` y `difference` los calculo la RPC (S2); la app no los deriva. No viaja el
 * detalle por denominacion: la tabla de arqueos no lo muestra y el origen tampoco lo pedia.
 */
export interface CashCountRecord {
	id: string;
	accountId: string;
	countDate: string;
	countedBalance: number;
	expectedBalance: number;
	difference: number;
	changeFund: number | null;
	countedBy: string | null;
	isSurprise: boolean;
	notes: string | null;
	createdAt: string;
}

/**
 * Fila cruda de `cash_close` tal como la devuelve Drizzle sobre node-postgres.
 *
 * `numeric` -> string exacto y `timestamptz` -> `Date`; la conversion al contrato ocurre UNA vez,
 * en `closes.service.ts`, que es el borde JSON. `date` ya llega como string.
 */
export interface CashCloseRow {
	id: string;
	cashAccountId: string;
	periodicity: ClosingPeriodicity;
	periodStart: string;
	periodEnd: string;
	openingBalance: string;
	incomeTotal: string;
	expenseTotal: string;
	expectedBalance: string;
	transferInTotal: string;
	transferOutTotal: string;
	countedBalance: string | null;
	changeFund: string | null;
	difference: string | null;
	differenceReason: string | null;
	differenceTolerance: string | null;
	countedBy: string | null;
	verifiedBy: string | null;
	penUsdRate: string | null;
	notes: string | null;
	createdAt: Date;
}

/** Fila cruda de `cash_close_denomination`. */
export interface CloseDenominationRow {
	denomination: string;
	quantity: number;
}

/** Fila cruda de `cash_count`. */
export interface CashCountRow {
	id: string;
	cashAccountId: string;
	countDate: string;
	countedBalance: string;
	expectedBalance: string;
	difference: string;
	changeFund: string | null;
	countedBy: string | null;
	isSurprise: boolean;
	notes: string | null;
	createdAt: Date;
}
