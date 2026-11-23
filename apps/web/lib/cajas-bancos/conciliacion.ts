// Conciliacion bancaria del lado de la UI (C7 del vertical de cajas-bancos).
//
// Port de `lib/caja/conciliacion.ts` del origen (152 lineas). Se conservan el NOMBRE y la FIRMA de
// las dos funciones y la forma del tipo (`BankReconciliation`), para que la pantalla se porte sin
// traducir nada:
//
//   getReconciliation(accountId, periodStart, periodEnd)   GET  /bank-reconciliations?...
//   saveReconciliation(input)                              POST /bank-reconciliations
//
// LAS DOS DIFERENCIAS SON DE TRANSPORTE, NO DE CONTRATO:
//
//   1. El origen leia la cabecera y despues sus partidas con DOS consultas PostgREST. El API
//      devuelve el acta completa en una sola respuesta (la lee en la misma transaccion), asi que
//      hay una llamada y no dos.
//   2. El origen guardaba con la RPC `save_bank_reconciliation` (que devolvia solo el id) y
//      RELEIA el acta con `getReconciliation`. La ruta del API responde 201 con el acta ya releida
//      (cabecera + partidas), asi que la relectura del cliente desaparece: el `BankReconciliation`
//      que devuelve `saveReconciliation` es el que devolvio el servidor.
//
// "NO HAY CONCILIACION TODAVIA" NO ES UN ERROR: `GET /bank-reconciliations` responde 200 con un
// `null` literal cuando el triplete (cuenta, periodo) no tiene acta, y esta funcion devuelve
// `null`. Es el estado normal que abre el formulario en blanco, no un 404 que la pantalla tendria
// que tratar como fallo.
//
// EL `mapError` DEL ORIGEN NO SE PORTA: traducia SQLSTATE (`P0001`, `23505`, `23503`, `23514`,
// `42501`, `PGRST116`) a textos genericos. Ahora la RPC redacta el mensaje de negocio, el API lo
// traduce a HTTP y el `ApiError` del cliente viaja con ese texto, que es el que el usuario tiene
// que leer. Un segundo diccionario aca volveria a esconder el mensaje del servidor.
//
// S2 / la diferencia NO SE CALCULA ACA Y NO VIAJA: `reconciledBalance`, `difference` e
// `isConciled` no estan en el contrato porque la RPC no los guarda. Son el helper de DISPLAY
// `computeReconciliation` de `@gestion/shared`, que la pantalla y el acta recalculan con las
// partidas vigentes cada vez que se pintan. Esta capa no valida ni recalcula la diferencia antes de
// guardar, y nunca manda una diferencia precalculada.
import type { ReconciliationItem } from "@gestion/shared/lib/caja/conciliacion-tipos.ts";
import { requestJson } from "./transporte.ts";

/**
 * Una partida del acta (`ReconciliationItem` de `@gestion/shared`, que es el del origen).
 *
 * Se reexporta el tipo compartido en vez de redeclararlo: la pantalla arma las partidas del
 * formulario SIN `id` (el `id` es opcional en el helper compartido, porque el formulario las crea
 * antes de guardarlas) y el API devuelve las guardadas CON `id`, que es lo que necesita el acta
 * para pintar el detalle. Un tipo local con dos variantes reproduciria esa ambiguedad.
 */
export type { ReconciliationItem };

/**
 * El acta completa: cabecera + partidas (`BankReconciliation` del origen).
 *
 * `accountId` es `cash_account_id` con el nombre del origen, que es la clave con la que la pantalla
 * cruza el acta con la cuenta elegida. `updatedAt` es el ISO del ultimo guardado. Los importes son
 * number y las fechas "YYYY-MM-DD": el borde JSON del API hace la conversion una sola vez.
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
  items: ReconciliationItem[];
}

/** Lo que manda la pantalla al guardar: el `SaveReconciliationInput` del origen. */
export interface SaveReconciliationInput {
  accountId: string;
  periodStart: string;
  periodEnd: string;
  statementBalance: number;
  booksBalance: number;
  preparedBy?: string | null;
  reviewedBy?: string | null;
  notes?: string | null;
  items: ReconciliationItem[];
}

/**
 * El acta de un periodo, o `null` si esa cuenta no tiene conciliacion para ese rango.
 *
 * Los tres parametros son obligatorios y forman el triplete EXACTO del indice unico
 * (`cash_account_id`, `period_start`, `period_end`): la pantalla pide "la conciliacion de esta
 * cuenta en este periodo", y una respuesta parcial no tendria sentido.
 */
export function getReconciliation(
  accountId: string,
  periodStart: string,
  periodEnd: string,
): Promise<BankReconciliation | null> {
  return requestJson<BankReconciliation | null>("/bank-reconciliations", {
    query: { accountId, periodStart, periodEnd },
  });
}

/**
 * Guarda el acta (upsert por cuenta y periodo) y devuelve la fila RELEIDA por el servidor.
 *
 * Las ocho reglas de negocio (cuenta indicada, cuenta visible, solo cuentas bancarias, periodo
 * valido, los dos saldos, clase y monto de cada partida, descripcion no vacia, monto > 0) las aplica
 * la RPC `save_bank_reconciliation`. El cliente no las repite: si lo hiciera, el usuario veria el
 * mensaje generico del formulario en vez del mensaje de la base, y las ramas de la RPC quedarian
 * inalcanzables.
 *
 * Las partidas NO mandan `id`: la RPC borra y reinserta, asi que el id del cliente no significa
 * nada (el contrato del API lo descarta).
 */
export function saveReconciliation(input: SaveReconciliationInput): Promise<BankReconciliation> {
  return requestJson<BankReconciliation>("/bank-reconciliations", {
    method: "POST",
    body: {
      accountId: input.accountId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      statementBalance: input.statementBalance,
      booksBalance: input.booksBalance,
      preparedBy: input.preparedBy ?? null,
      reviewedBy: input.reviewedBy ?? null,
      notes: input.notes ?? null,
      items: input.items.map((item) => ({
        kind: item.kind,
        description: item.description,
        amount: item.amount,
      })),
    },
  });
}
