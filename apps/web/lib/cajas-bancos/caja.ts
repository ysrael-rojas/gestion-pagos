// Caja y bancos del lado de la UI — MITAD DE LECTURA (C3 del vertical de cajas-bancos).
//
// Fuente: `lib/caja/caja.ts` del origen (500 lineas: catalogos, ajustes, posiciones, extractos,
// transferencias, caja chica). Este archivo porta SOLO las tres lecturas de posiciones de este
// slice:
//
//   getCashPosition(accountId, asOf)        -> saldo de una cuenta (origen: lineas 433-447)
//   listCashPositionsConsolidated(asOf)     -> saldos de todas las cuentas (origen: 453-476)
//   listLastMovementDates()                 -> ultimo recibo no anulado por cuenta (origen: 478-500)
//
// La mitad de ESCRITURA (`createCashTransfer`, `createPayment` como movimiento de caja, vales de
// caja chica) NO vive aca todavia: son C6 y C8. Cuando lleguen, siguen el mismo contrato: el
// origen hablaba PostgREST con la sesion de Supabase y aca se consume `apps/api` (S8 del doc
// padre), sin cambiar la forma de los datos.
//
// QUE SE CONSERVA Y QUE NO:
//
//   - El NOMBRE y la FIRMA de las tres funciones son los del origen, para que C5 (pantallas) y C7
//     (dashboard y proyeccion) se porten llamando a los mismos simbolos.
//   - El SALDO sigue viniendo del servidor y no se toca aca (S2): estas tres funciones son
//     transporte, no aritmetica. Ni `round2` ni ninguna suma viven en este archivo.
//   - DESVIO DELIBERADO: `listCashPositionsConsolidated` del origen hacia DOS llamadas en
//     paralelo (`listCashAccounts()` + RPC de posiciones) y las cruzaba en el cliente con
//     `balance: map.get(id) ?? 0`. Aca hay UNA llamada: el API devuelve la fila de la cuenta y el
//     saldo juntos (una sola consulta SQL), y una cuenta que el servidor excluye no aparece en
//     lugar de aparecer con saldo 0 inventado.
//   - DESVIO DELIBERADO: el `CashAccountPosition` del origen era `{ account, balance }` (la fila
//     completa de la cuenta anidada). El API devuelve la fila PLANA con las ocho columnas que la
//     UI lee, asi que el tipo se reexporta tal cual y no hay mapper que pueda desincronizarse.
//
// Los errores no se traducen aca: el API ya devuelve los mensajes del vertical
// (`apps/api/src/cash/cash.errors.ts`) y el `ApiError` del cliente viaja con ese texto. El
// `mapError` del origen (que traducia codigos de PostgreSQL) no tiene equivalente: el navegador
// ya no habla con Postgres.
import {
  type CashAccountPosition,
  type LastMovementDates,
  getCashPosition as getCashPositionRequest,
  listCashPositions as listCashPositionsRequest,
  listLastMovementDates as listLastMovementDatesRequest,
} from "@/lib/api/client";

/**
 * Una cuenta con su saldo a una fecha: `GET /cash-positions` (`CashAccountPosition` del API).
 *
 * `balance` es el saldo que calculo la base (`opening_balance + ingresos − egresos ±
 * transferencias`, sin anulados) a la fecha del corte, ya convertido a number en el borde JSON.
 */
export type { CashAccountPosition };

/**
 * Mapa `accountId -> "YYYY-MM-DD"` del ultimo recibo NO anulado (`GET /last-movement-dates`).
 *
 * Es lo que el listado de cuentas usa para decidir la primera fecha abierta: una cuenta ausente
 * del mapa no tiene movimientos. Origen: `listLastMovementDates` (`lib/caja/caja.ts:478-500`).
 */
export type { LastMovementDates };

/**
 * Saldo de una cuenta a una fecha (`getCashPosition` del origen).
 *
 * `asOf` es "YYYY-MM-DD" y lo manda la pantalla (el origen siempre lo pasaba: el dia local del
 * navegador). Devuelve el numero que calculo `public.get_cash_position`; un id inexistente, de
 * otro dueno o de una cuenta dada de baja responde 404 y el `ApiError` trae el mensaje del API.
 */
export function getCashPosition(accountId: string, asOf: string): Promise<number> {
  return getCashPositionRequest(accountId, asOf);
}

/**
 * Saldos de todas las cuentas vivas y activas del dueno (`listCashPositionsConsolidated`).
 *
 * Una sola llamada, en el orden por nombre que devuelve la base. El consumidor del origen lo usaba
 * tal cual: el dashboard para `summarizePositions` (que suma por tipo) y el listado de cuentas
 * para la tabla.
 */
export function listCashPositionsConsolidated(asOf: string): Promise<CashAccountPosition[]> {
  return listCashPositionsRequest(asOf);
}

/**
 * Ultimo movimiento (recibo no anulado) por cuenta (`listLastMovementDates`).
 *
 * El consumidor es un lookup por cuenta: `lastMovements[account.id] ?? null`. La logica de "si
 * falla, la tabla de cuentas se muestra igual" (SPEC 55) vive en la pantalla, no aca: esta funcion
 * propaga el error en vez de devolver un mapa vacio que se veria igual que "sin movimientos".
 */
export function listLastMovementDates(): Promise<LastMovementDates> {
  return listLastMovementDatesRequest();
}
