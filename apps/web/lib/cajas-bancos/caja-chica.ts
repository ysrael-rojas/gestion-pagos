// Caja chica del lado de la UI: vales y reposicion del fondo (C6 del vertical de cajas-bancos).
//
// Port de `lib/caja/caja-chica.ts` del origen (140 lineas). Se conservan el NOMBRE y la FIRMA de
// las funciones y la forma del tipo (`PettyCashVale`), para que el panel de caja chica y sus dos
// modales se porten sin traducir nada:
//
//   listVales(accountId, status?)   GET  /petty-cash/vales?accountId&status
//   getVale(id)                     GET  /petty-cash/vales/:id
//   createVale(values)              POST /petty-cash/vales          (RPC `create_petty_cash_vale`)
//   anularVale(valeId)              POST /petty-cash/vales/:id/void (RPC `void_petty_cash_vale`)
//   replenishPettyCash(values)      POST /petty-cash/replenish      (RPC `replenish_petty_cash`)
//   pendingValesTotal(vales)        suma local de lo que ya esta en pantalla
//
// LO QUE NO SE HACE ACA (S5/S8):
//
//   - `serial` (correlativo por cuenta) y `status` los pone la base, no el cliente: `serial` sale de
//     la RPC con la cuenta bloqueada (`for update` + `unique (account_id, serial)`), y el vale
//     nace PENDIENTE. El body no los acepta.
//   - `paymentId` es el recibo de egreso que crea la RPC (SPEC 49). La UI lo muestra, no lo arma:
//     un vale no inserta un `payment` desde el navegador.
//   - El TOTAL DEL FONDO y el arqueo no se calculan aca. `pendingValesTotal` es la excepcion
//     declarada por el origen: suma los vales PENDIENTE que la pantalla ya tiene en memoria para
//     mostrarlos como "en la calle". No es un saldo: el saldo de la cuenta lo devuelve
//     `GET /cash-accounts/:id/position` (S2).
//
// EL `mapError` DEL ORIGEN NO SE PORTA: traducia SQLSTATE a textos genericos ("Ya existe un vale
// con ese numero en la cuenta" para `23505`, etc.). El mensaje lo redacta el dominio en el API y el
// `ApiError` viaja con ese texto.
import { round2 } from "@gestion/shared/lib/utils.ts";
import type {
  PettyCashReplenishFormValues,
  PettyCashValeFormValues,
} from "@gestion/shared/lib/schemas/petty-cash-vale.ts";
import { requestJson } from "./transporte.ts";

/**
 * Estado del vale: los labels de `public.vale_status` en su orden. Solo lo mueven las RPC
 * (`replenish_petty_cash` -> REPUESTO, `void_petty_cash_vale` -> ANULADO).
 */
export type ValeStatus = "PENDIENTE" | "REPUESTO" | "ANULADO";

/** Un vale de caja chica (`petty_cash_vale` en el origen). */
export interface PettyCashVale {
  id: string;
  accountId: string;
  /** Correlativo por cuenta, asignado por la RPC (nunca por el cliente). */
  serial: number;
  /** "YYYY-MM-DD". */
  valeDate: string;
  paidTo: string;
  concept: string;
  /** Importe ya convertido a number por el API. */
  amount: number;
  hasReceipt: boolean;
  status: ValeStatus;
  /** Recibo de egreso generado por la RPC (SPEC 49); null en vales historicos. */
  paymentId: string | null;
  /** ISO timestamp del alta. */
  createdAt: string;
}

/** Respuesta de `POST /petty-cash/replenish`: la transferencia creada y los vales repuestos. */
interface ReplenishResponse {
  transferId: string;
  vales: PettyCashVale[];
}

/** Vales de una caja chica, ordenados por correlativo (`listVales` del origen). */
export function listVales(accountId: string, status?: ValeStatus): Promise<PettyCashVale[]> {
  return requestJson<PettyCashVale[]>("/petty-cash/vales", {
    query: { accountId, status },
  });
}

/** Un vale por id. Un id de otro dueno o inexistente responde 404. */
export function getVale(id: string): Promise<PettyCashVale> {
  return requestJson<PettyCashVale>(`/petty-cash/vales/${encodeURIComponent(id)}`);
}

/**
 * Total de vales pendientes: es la parte del fondo que esta "en la calle" y que, sumada al efectivo
 * fisico, debe cuadrar con el fondo de la caja chica.
 *
 * Suma SOLO los PENDIENTE (un vale repuesto ya volvio al fondo y uno anulado no salio nunca) y
 * redondea a centavos, que es lo que evita el centavo fantasma de punto flotante (0.1 + 0.2).
 */
export function pendingValesTotal(vales: PettyCashVale[]): number {
  return round2(
    vales
      .filter((vale) => vale.status === "PENDIENTE")
      .reduce((total, vale) => total + vale.amount, 0),
  );
}

/**
 * Alta del vale (`createVale` del origen). El `serial` que devuelve es el que asigno la base y es lo
 * que el panel muestra en el aviso de exito.
 */
export function createVale(values: PettyCashValeFormValues): Promise<PettyCashVale> {
  return requestJson<PettyCashVale>("/petty-cash/vales", { method: "POST", body: values });
}

/** Anula un vale pendiente (no se borra: queda el rastro del correlativo). */
export async function anularVale(valeId: string): Promise<void> {
  await requestJson<{ id: string; status: ValeStatus }>(
    `/petty-cash/vales/${encodeURIComponent(valeId)}/void`,
    { method: "POST" },
  );
}

/**
 * Repone el fondo: transfiere el total de los vales elegidos desde otra cuenta y los marca como
 * repuestos en una sola operacion (RPC atomica).
 *
 * Devuelve el id de la TRANSFERENCIA que creo la RPC (`replenish_petty_cash` devuelve el
 * `cash_transfer.id`, no el del vale), que es lo que devolvia el origen. Los vales repuestos que
 * tambien manda el API se descartan aca porque el panel recarga la lista completa despues: mostrar
 * la mitad optimista de una operacion que movio plata es peor que releer.
 */
export async function replenishPettyCash(values: PettyCashReplenishFormValues): Promise<string> {
  const result = await requestJson<ReplenishResponse>("/petty-cash/replenish", {
    method: "POST",
    body: values,
  });

  return result.transferId;
}
