// Contrato de salida de la conciliacion bancaria (C7 del vertical de cajas-bancos).
//
// Fuente: `lib/caja/conciliacion.ts` del proyecto de origen (`BankReconciliation`, `mapRow`,
// `mapItemRow`, `getReconciliation`, `saveReconciliation`). La forma es la MISMA que consume
// `components/cajas-bancos/conciliacion-view.tsx`: cambiar un campo alla es cambiar este archivo.
//
// NINGUN importe se calcula aca (S2). `statementBalance` y `booksBalance` son los dos numeros que
// el usuario escribe y que la RPC persiste; `reconciledBalance`, `difference` y `isConciled` NO
// viajan porque la RPC no los guarda y el borde no los inventa: son el helper de DISPLAY
// `computeReconciliation` de la web (tolerancia de un centimo), que se recalcula con las partidas
// vigentes cada vez que se pinta el acta.
//
// Tipos: `date` viaja "YYYY-MM-DD" (sin `Date`, para que el dia no se corra de zona al
// serializar), `timestamptz` como ISO string y `numeric` como number (node-postgres entrega
// `numeric` como string exacto para no perder centavos; la conversion ocurre UNA vez, en el borde).
import type { reconciliationItemKindEnum } from "../db/schema/bank-reconciliation.ts";

/** Las cuatro clases de partida del enum `reconciliation_item_kind`, derivadas del schema. */
export type ReconciliationItemKind = (typeof reconciliationItemKindEnum.enumValues)[number];

/** Una partida del acta: `ReconciliationItem` del origen, con el `id` ya asignado por la base. */
export interface BankReconciliationItem {
	id: string;
	kind: ReconciliationItemKind;
	/** Texto libre; el monto SIEMPRE es positivo y el signo lo aporta `kind`. */
	description: string;
	amount: number;
}

/**
 * `GET /bank-reconciliations` (por triplete), `GET /bank-reconciliations/:id` y la respuesta de
 * `POST /bank-reconciliations`: el `BankReconciliation` del origen, campo por campo.
 *
 * `accountId` es `cash_account_id` (nombre del origen, no `cashAccountId`): es la clave con la que
 * la pantalla cruza la conciliacion con la cuenta elegida.
 */
export interface BankReconciliation {
	id: string;
	accountId: string;
	periodStart: string;
	periodEnd: string;
	statementBalance: number;
	booksBalance: number;
	preparedBy: string | null;
	reviewedBy: string | null;
	notes: string | null;
	updatedAt: string;
	items: BankReconciliationItem[];
}

/**
 * Fila cruda de `bank_reconciliation` tal como la devuelve Drizzle sobre node-postgres.
 *
 * `numeric` -> string exacto y `timestamptz` -> `Date`; la conversion al contrato ocurre UNA vez,
 * en `bank-reconciliations.service.ts`, que es el borde JSON. `date` ya llega como string.
 */
export interface BankReconciliationRow {
	id: string;
	cashAccountId: string;
	periodStart: string;
	periodEnd: string;
	statementBalance: string;
	booksBalance: string;
	preparedBy: string | null;
	reviewedBy: string | null;
	notes: string | null;
	updatedAt: Date;
}

/** Fila cruda de `bank_reconciliation_item`. */
export interface BankReconciliationItemRow {
	id: string;
	kind: ReconciliationItemKind;
	description: string;
	amount: string;
}
