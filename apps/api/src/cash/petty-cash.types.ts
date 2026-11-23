// Contrato de salida de los vales de caja chica (C6 del vertical de cajas-bancos, S5/S8).
//
// Fuente: `lib/caja/caja-chica.ts` del proyecto de origen (`PettyCashVale`, `mapRow`, `listVales`,
// `getVale`, `createVale`, `anularVale`, `replenishPettyCash`). La forma es la MISMA que consumen
// el panel de caja chica y la tabla de vales: cambiar un campo alla es cambiar este archivo, y el
// listado de claves esta pinneado por el e2e.
//
// NADA SE CALCULA ACA (S2/S5): `serial` es el correlativo que asigno la RPC con la cuenta
// bloqueada, `status` solo lo mueven las RPC y `paymentId` es el recibo de egreso que creo la RPC
// (SPEC 49). El API no numera vales, no decide transiciones y no suma el total de los pendientes:
// si una pantalla necesita ese total, lo devuelve una funcion SQL.
//
// `numeric` viaja como number (la conversion ocurre una sola vez, en `petty-cash.service.ts`, que
// es el borde JSON), `valeDate` como "YYYY-MM-DD" (sin `Date`, para no mover el dia por zona) y
// `createdAt` como ISO string.
import type { ValeStatus } from "./petty-cash.query.ts";

/** Una fila de `GET /petty-cash/vales` (y del alta): el `PettyCashVale` del origen, campo por campo. */
export interface PettyCashValeRecord {
	id: string;
	accountId: string;
	serial: number;
	valeDate: string;
	paidTo: string;
	concept: string;
	amount: number;
	hasReceipt: boolean;
	status: ValeStatus;
	paymentId: string | null;
	createdAt: string;
}

/**
 * Fila cruda de `petty_cash_vale` tal como la devuelve Drizzle sobre node-postgres.
 *
 * `numeric` -> string exacto, `timestamptz` -> `Date` y `date` -> "YYYY-MM-DD"; la conversion al
 * contrato ocurre UNA vez, en `petty-cash.service.ts`.
 */
export interface PettyCashValeRow {
	id: string;
	accountId: string;
	serial: number;
	valeDate: string;
	paidTo: string;
	concept: string;
	amount: string;
	hasReceipt: boolean;
	status: ValeStatus;
	paymentId: string | null;
	createdAt: Date;
}

/**
 * Respuesta de `POST /petty-cash/replenish`: el id de la transferencia que creo la RPC
 * (`replenish_petty_cash` devuelve el `cash_transfer.id`, no el del vale) y los vales repuestos,
 * releidos DESPUES del RPC para que el `status` que viaja sea el de la base.
 */
export interface PettyCashReplenishResult {
	transferId: string;
	vales: PettyCashValeRecord[];
}

/**
 * Respuesta de `POST /petty-cash/vales/:id/void`: `id` y `status` releidos de la tabla, no
 * asumidos por el API (la base es la que decide si el vale quedo ANULADO).
 */
export interface PettyCashValeVoidResult {
	id: string;
	status: ValeStatus;
}
