// Contrato de salida de las transferencias entre cuentas (C6 del vertical de cajas-bancos, S8).
//
// Fuente: `lib/caja/transferencias.ts` del proyecto de origen (`CashTransfer`, `mapRow`,
// `createCashTransfer`, `getCashTransfer`, `listAccountTransfers`). La forma es la MISMA que
// consumen el modal de transferencia y la vista de movimientos de una cuenta: cambiar un campo
// alla es cambiar este archivo, y el listado de claves esta pinneado por el e2e.
//
// NINGUN importe se calcula aca (S2): `amount` es la columna que escribio la RPC, y la unica
// aritmetica permitida es `Number(...)` en el borde JSON (node-postgres entrega `numeric` como
// string exacto para no perder centavos). `transferDate` viaja "YYYY-MM-DD" (sin `Date`, para que
// el dia no se corra de zona al serializar) y `createdAt` como ISO string.
//
// No hay un total de transferencias ni un saldo en este contrato: si una pantalla los necesita,
// los devuelve una funcion SQL, no el API.

/** Una fila de `GET /cash-transfers` (y del alta): el `CashTransfer` del origen, campo por campo. */
export interface CashTransferRecord {
	id: string;
	sourceAccountId: string;
	targetAccountId: string;
	amount: number;
	transferDate: string;
	notes: string | null;
	createdAt: string;
}

/**
 * Fila cruda de `cash_transfer` tal como la devuelve Drizzle sobre node-postgres.
 *
 * `numeric` -> string exacto, `timestamptz` -> `Date` y `date` -> "YYYY-MM-DD"; la conversion al
 * contrato ocurre UNA vez, en `cash-transfers.service.ts`, que es el borde JSON.
 */
export interface CashTransferRow {
	id: string;
	sourceAccountId: string;
	targetAccountId: string;
	amount: string;
	transferDate: string;
	notes: string | null;
	createdAt: Date;
}
