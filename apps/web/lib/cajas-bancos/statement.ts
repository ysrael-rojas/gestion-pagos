// Filas del extracto y de la tabla de movimientos (C6 del vertical de cajas-bancos).
//
// Port de la parte pura de `components/cajas-bancos/statement-table.tsx` del origen (408 lineas):
// `StatementRow` y `buildStatementRows`. Viven en `lib/` y no en el `.tsx` por una razon concreta:
// el runner de los helpers web es `node --test` sobre `lib/**/*.test.ts` y no compila JSX, asi que
// una funcion pura metida en un componente no se puede probar. El componente `statement-table.tsx`
// se queda con lo que si es UI (columnas, seleccion multiple, paginacion) e importa de aca.
//
// El extracto de una cuenta son DOS fuentes que no se pueden mezclar en SQL sin inventar backend
// (L15 del doc de la feature): los recibos (`GET /cartera/statement/:accountId`) y las
// transferencias (`GET /cash-transfers?accountId&from&to`). Esta funcion las une en una sola lista
// ordenada por fecha, que es lo que el usuario lee como "movimientos".
//
// LA DIRECCION DE UNA TRANSFERENCIA ES CONTEXTUAL, y es la unica decision de este archivo: una
// transferencia no tiene direccion contable propia, entra como INGRESO en la cuenta destino y sale
// como EGRESO de la origen. Se resuelve comparando `targetAccountId` con la cuenta que se mira.
// Nada de esto suma plata: solo etiqueta filas que ya traen su importe.
import type { Payment, PaymentStatus } from "../api/client.ts";
import type { CashTransfer } from "./transferencias.ts";

/** Una fila de "Movimientos": un recibo o una transferencia, con lo que la tabla necesita. */
export interface StatementRow {
  id: string;
  kind: "PAYMENT" | "TRANSFER";
  date: string;
  ref: string;
  direction: "INGRESO" | "EGRESO";
  category: string;
  method: string;
  amount: number;
  /** Estado del recibo; `null` en transferencias (no son recibos). */
  status: PaymentStatus | null;
}

/**
 * Une recibos y transferencias en las filas que pinta la tabla, ordenadas por fecha ascendente.
 *
 * Los recibos sin categoria o sin metodo muestran los textos del origen ("Sin categoria", "—") y no
 * una cadena vacia: la columna existe para explicar el movimiento, y un hueco no lo explica. La
 * fecha se compara como texto `YYYY-MM-DD`, que ordena lexicograficamente igual que el calendario.
 */
export function buildStatementRows(
  statement: Payment[],
  transfers: CashTransfer[],
  accountId: string,
): StatementRow[] {
  const paymentRows: StatementRow[] = statement.map((payment) => ({
    id: payment.id,
    kind: "PAYMENT",
    date: payment.paymentDate,
    ref: payment.receiptNumber,
    direction: payment.direction,
    category: payment.categoryName || "Sin categoría",
    method: payment.methodName || "—",
    amount: payment.amount,
    status: payment.status,
  }));

  const transferRows: StatementRow[] = transfers.map((transfer) => {
    const incoming = transfer.targetAccountId === accountId;

    return {
      id: transfer.id,
      kind: "TRANSFER",
      date: transfer.transferDate,
      ref: "Transferencia",
      direction: incoming ? "INGRESO" : "EGRESO",
      category: "Transferencia entre cuentas",
      method: "—",
      amount: transfer.amount,
      status: null,
    };
  });

  return [...paymentRows, ...transferRows].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Ids de las filas que se pueden marcar como verificadas (`EN_REVISION` -> `PROCESADO`).
 *
 * La accion de la tabla de movimientos es de C7 (conciliacion), pero la CONDICION es de la
 * composicion de filas y por eso vive aca, con su test: solo un recibo en revision se puede
 * marcar. Una transferencia no es un recibo (`kind: "TRANSFER"` y `status: null`) y un recibo ya
 * procesado o anulado no se vuelve a procesar, asi que la barra de acciones y la casilla de cada
 * fila solo se dibujan para estos ids. Marcar de mas seria un boton que miente sobre lo que hace.
 */
export function markableReceiptIds(rows: StatementRow[]): string[] {
  return rows
    .filter((row) => row.kind === "PAYMENT" && row.status === "EN_REVISION")
    .map((row) => row.id);
}
