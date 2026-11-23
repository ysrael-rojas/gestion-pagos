// Contrato de salida de las cuentas del vertical de cajas-bancos (C2).
//
// La forma es el `CashAccount` de `lib/cuentas/entidades.ts:8-32` del origen: la fila completa de
// `cash_account`, no el `CashAccountCatalogItem` reducido que consume el formulario de pagos. El
// formulario de cuentas la necesita entera porque su `useCashAccountForm` resetea DIECISEIS
// campos con ella (`components/cajas-bancos/cash-account-form.tsx:124-140`): tipo, nombre, moneda,
// datos bancarios, periodicidad, saldo de apertura y fecha, notas, activa, caja chica con fondo,
// limite por vale y custodio. El catalogo de pagos (`GET /cash-accounts`) NO cambia: sigue
// devolviendo `CashAccountCatalogItem` y esta pinneado por `apps/api/test/catalogs.e2e.test.ts`.
//
// `type` y `currency` salen del enum y del schema de la base, no de copias a mano.
import type { cashAccountTypeEnum } from "../db/schema/enums.ts";

/** Los dos valores del enum `cash_account_type`, derivados del schema (una sola fuente). */
type CashAccountType = (typeof cashAccountTypeEnum.enumValues)[number];

/** Los tres valores de `public.closing_periodicity` (`20261006063301...sql:49`). */
export type ClosingPeriodicity = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Cuenta de caja o banco tal como la devuelven las escrituras y `GET /cash-accounts/:id`.
 *
 * Nombres y tipos son los del origen: `numeric(12,2)` ya convertido a number (la columna viaja
 * como string desde node-postgres), `date` como "YYYY-MM-DD" sin conversion de zona horaria y
 * `timestamptz` como ISO string.
 *
 * `createdAt`/`updatedAt`/`deletedAt` no los lee el formulario, pero estan declarados en el
 * `CashAccount` del origen y una pantalla de cuentas los muestra (la columnas de "actualizada"
 * del arbol de cajas-bancos). `deletedAt` viaja siempre en `null` hoy: las tres rutas de lectura
 * excluyen las filas borradas. Se conserva para que el map de la web sea 1:1 con el del origen.
 */
export interface CashAccountRecord {
	id: string;
	type: CashAccountType;
	name: string;
	currency: string;
	bankName: string | null;
	accountNumber: string | null;
	cci: string | null;
	closingPeriodicity: ClosingPeriodicity | null;
	openingBalance: number;
	openingBalanceDate: string;
	notes: string | null;
	isActive: boolean;
	isPettyCash: boolean;
	changeFund: number;
	pettyExpenseLimit: number | null;
	custodianName: string | null;
	createdAt: string;
	updatedAt: string;
	deletedAt: string | null;
}

/**
 * Fila de `cash_account` tal como la devuelve node-postgres: `numeric` como string exacto y
 * `timestamptz` como `Date`. Es la entrada de `toCashAccountRecord` (en el servicio), mismo
 * reparto que `PaymentRow` en `payments.mapper.ts`.
 */
export interface CashAccountRow {
	id: string;
	type: CashAccountType;
	name: string;
	currency: string;
	bankName: string | null;
	accountNumber: string | null;
	cci: string | null;
	closingPeriodicity: ClosingPeriodicity | null;
	openingBalance: string;
	openingBalanceDate: string;
	notes: string | null;
	isActive: boolean;
	isPettyCash: boolean;
	changeFund: string;
	pettyExpenseLimit: string | null;
	custodianName: string | null;
	createdAt: Date;
	updatedAt: Date;
	deletedAt: Date | null;
}
