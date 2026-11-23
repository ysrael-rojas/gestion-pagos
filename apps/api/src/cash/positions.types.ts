// Contrato de salida de las posiciones de caja y banco (C3 del vertical de cajas-bancos, S2/S6).
//
// El SALDO no se calcula aca: lo devuelve la base (`public.get_cash_positions` /
// `public.get_cash_position`, cuya unica formula es `private.cash_expected_balance`). Este archivo
// solo declara la forma en que ese numero viaja al cliente, junto con las cuatro columnas de
// `cash_account` que la UI necesita para pintar la fila. Recalcular `opening + ingresos - egresos
// +- transferencias` en TypeScript esta prohibido por S2, y ademas divergiria: la base filtra por
// fecha, excluye los recibos `ANULADO` y suma transferencias por cuenta.
//
// QUE CAMPOS Y POR QUE (no se devuelve el resultado crudo de la RPC):
//
//   La RPC `get_cash_positions` devuelve `account_id, name, type, currency, balance`. El listado
//   de cuentas (`components/cajas-bancos/cuentas-view.tsx:255-276` del origen) y el dashboard
//   (`dashboard-view.tsx:167-175`) leen ademas `bankName`, `closingPeriodicity` e `isPettyCash`
//   de la fila de la cuenta, porque el origen mergeaba la RPC con `listCashAccounts()` en el
//   cliente (`listCashPositionsConsolidated`, `lib/caja/caja.ts:453-476`). Ese merge era un N+1
//   de dos llamadas; aca la consulta une la RPC con su propia fila de `cash_account` y devuelve
//   las ocho columnas de una vez. El saldo sigue siendo el de la funcion: las columnas extra son
//   texto/booleanos de la MISMA fila, no dinero.
//
//   Lo que NO viaja: `openingBalance`, `openingBalanceDate`, `changeFund`, `custodianName`, los
//   datos bancarios completos, las notas y los timestamps. No los lee ninguna de las dos
//   pantallas que consumen posiciones; el formulario de cuentas ya los obtiene enteros por
//   `GET /cash-accounts/:id` (C2).
//
// Tipos: `type` sale del enum de la base y `balance` es `numeric(12,2)` convertido a number SOLO
// en el borde JSON (node-postgres entrega `numeric` como string para no perder precision). El
// `date` de `last_date` viaja como "YYYY-MM-DD" sin conversion de zona horaria.
import type { cashAccountTypeEnum } from "../db/schema/enums.ts";

/** Los dos valores del enum `cash_account_type`, derivados del schema (una sola fuente). */
type CashAccountType = (typeof cashAccountTypeEnum.enumValues)[number];

/** Los tres valores de `public.closing_periodicity` (`20261006063301...sql:49`). */
export type ClosingPeriodicity = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Una fila de `GET /cash-positions`: una cuenta VIVA Y ACTIVA del dueno con su saldo a la fecha.
 *
 * `accountId` es el id de `cash_account` y es la clave con la que la UI cruza
 * `GET /last-movement-dates`; se llama asi (y no `id`) para que no se confunda con el id de un
 * movimiento ni con el de un recibo.
 */
export interface CashAccountPosition {
	accountId: string;
	name: string;
	type: CashAccountType;
	currency: string;
	balance: number;
	bankName: string | null;
	closingPeriodicity: ClosingPeriodicity | null;
	isPettyCash: boolean;
}

/**
 * Fila cruda de la union RPC + `cash_account`, tal como la devuelve node-postgres.
 *
 * `balance` es `string` porque `numeric` no tiene representacion exacta en un double: el driver
 * lo entrega como texto y `positions.service.ts` lo convierte en el borde.
 */
export type CashAccountPositionRow = {
	account_id: string;
	name: string;
	type: CashAccountType;
	currency: string;
	balance: string;
	bank_name: string | null;
	closing_periodicity: ClosingPeriodicity | null;
	is_petty_cash: boolean;
};

/**
 * Fila cruda de `list_last_movement_dates()`.
 *
 * La funcion devuelve `(cash_account_id uuid, last_date date)`; la fecha se pide casteada a texto
 * (`::text`) para que node-postgres no la convierta a `Date` y el dia no se mueva de zona.
 */
export type LastMovementDateRow = {
	cash_account_id: string;
	last_date: string;
};

/**
 * `GET /last-movement-dates`: `accountId -> "YYYY-MM-DD"` del ultimo recibo NO anulado.
 *
 * Es el mapa que el origen usaba para decidir la primera fecha abierta
 * (`listLastMovementDates`, `lib/caja/caja.ts:478-500`): una cuenta AUSENTE del mapa no tiene
 * ningun movimiento, y la UI la muestra como "sin movimientos" en vez de inventar una fecha.
 */
export type LastMovementDates = Record<string, string>;
