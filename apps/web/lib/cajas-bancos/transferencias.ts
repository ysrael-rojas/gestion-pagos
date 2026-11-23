// Transferencias entre cuentas del lado de la UI (C6 del vertical de cajas-bancos).
//
// Port de `lib/caja/transferencias.ts` del origen (85 lineas). Se conservan el NOMBRE y la FIRMA
// de las tres funciones y la forma del tipo (`CashTransfer`), para que el modal de transferencia y
// la tabla de movimientos se porten sin traducir nada:
//
//   createCashTransfer(values)                  POST /cash-transfers   (RPC `create_cash_transfer`)
//   getCashTransfer(id)                         GET  /cash-transfers/:id
//   listAccountTransfers(accountId, from, to)   GET  /cash-transfers?accountId&from&to
//
// LO QUE DESAPARECE ES EL TRANSPORTE, NO EL CONTRATO: el origen hablaba PostgREST con la sesion de
// Supabase (`.from("cash_transfer").select("*")` y `.or(...)` para "la cuenta es origen o
// destino"); aca la consulta la resuelve el API en SQL y el `or` viaja como un `accountId`.
//
// EL `mapError` DEL ORIGEN NO SE PORTA: traducia SQLSTATE (`P0001`, `23514`, `23503`, `42501`) a
// textos genericos. Ahora el mensaje lo redacta el dominio en el API
// (`apps/api/src/cash/cash.errors.ts` + la RPC) y el `ApiError` viaja con ese texto, que es el que
// el usuario tiene que leer.
//
// `amount` LLEGA COMO NUMBER desde el borde JSON del API (node-postgres entrega `numeric` como
// string exacto y el servicio lo convierte una sola vez). Aca no se parsea ni se formatea: el
// formateo es de la capa de render (`formatCurrency`). `transferDate` es "YYYY-MM-DD" sin `Date` de
// por medio, para que el dia no se corra de zona.
import type { CashTransferFormValues } from "@gestion/shared/lib/schemas/cash-transfer.ts";
import { requestJson } from "./transporte.ts";

/** Una transferencia entre dos cuentas del dueno (`cash_transfer` en el origen). */
export interface CashTransfer {
  id: string;
  sourceAccountId: string;
  targetAccountId: string;
  /** Importe ya convertido a number por el API; la base es la que hizo la aritmetica (S2). */
  amount: number;
  /** "YYYY-MM-DD" (fecha del movimiento, sin hora ni zona). */
  transferDate: string;
  notes: string | null;
  /** ISO timestamp del alta. */
  createdAt: string;
}

/**
 * Mueve fondos de una cuenta a otra (`createCashTransfer` del origen).
 *
 * Toda la validacion de negocio la aplica la RPC: cuentas existentes y del dueno, distintas, en
 * PEN, monto positivo y periodo abierto en las dos. El body es el schema del modal y el `ApiError`
 * trae el mensaje del SQL tal cual, que el modal muestra sin reemplazar.
 */
export function createCashTransfer(values: CashTransferFormValues): Promise<CashTransfer> {
  return requestJson<CashTransfer>("/cash-transfers", { method: "POST", body: values });
}

/** Una transferencia por id. Un id de otro dueno o inexistente responde 404. */
export function getCashTransfer(id: string): Promise<CashTransfer> {
  return requestJson<CashTransfer>(`/cash-transfers/${encodeURIComponent(id)}`);
}

/**
 * Transferencias del periodo en las que la cuenta participa (como origen o como destino),
 * ordenadas por fecha ascendente y con los dos bordes INCLUSIVE, igual que el origen.
 *
 * Es la otra mitad del extracto: `getCashAccountStatement` trae los recibos y esta trae los
 * movimientos entre cuentas, que no son recibos.
 */
export function listAccountTransfers(
  accountId: string,
  from: string,
  to: string,
): Promise<CashTransfer[]> {
  return requestJson<CashTransfer[]>("/cash-transfers", { query: { accountId, from, to } });
}
