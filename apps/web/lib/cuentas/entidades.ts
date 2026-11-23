// Cuentas de caja y banco del lado de la UI.
//
// Port de `lib/cuentas/entidades.ts` del origen (170 lineas) completo: la lectura del catalogo y
// las tres escrituras (`createCashAccount`, `updateCashAccount`, `softDeleteCashAccount`). Lo que
// cambia es el transporte -- el origen hablaba PostgREST con la sesion de Supabase y aca
// `apps/web` consume `apps/api` (S8 del doc padre) -- no el contrato.
//
// DOS NOMBRES PARA DOS COSAS, y el origen tenia uno solo:
//
//   `CashAccount`        cinco columnas: lo que devuelve `GET /cash-accounts` y lo que consume el
//                        selector del formulario de pagos (`components/cajas-bancos/...`
//                        `cajas-bancos-provider.tsx` y `components/pagos/*`). No cambio.
//   `CashAccountRecord`  la fila completa (`GET /cash-accounts/:id` y las escrituras), que es el
//                        `CashAccount` del origen y lo que necesita el formulario de cuentas.
//
// Se conserva `CashAccount` con la forma reducida porque su consumidor (el provider de pagos) ya
// existe y no es parte de este slice; renombrarlo es una decision de C5, cuando las pantallas se
// porten y el selector pueda leer la fila completa.
//
// DESVIO DELIBERADO: el origen mapeaba a mano (`mapRow` / `mapMutation`) y traducia los codigos de
// PostgreSQL a mensajes (`mapError`, lineas 96-111: "Ya existe una cuenta con esos datos.",
// "Los datos no cumplen las reglas de validación..."). El API ya devuelve camelCase y ya traduce
// los errores con el diccionario del vertical (`apps/api/src/cash/cash.errors.ts`), asi que aca no
// hay mapper ni segundo diccionario: el `ApiError` del cliente viaja con el mensaje del servidor,
// que es el que el usuario tiene que leer.
import {
  type CashAccountCatalogItem,
  type CashAccountRecord,
  type CashAccountWrite,
  createCashAccount as createCashAccountRequest,
  getCashAccount as getCashAccountRequest,
  listCashAccounts as listCashAccountsRequest,
  softDeleteCashAccount as softDeleteCashAccountRequest,
  updateCashAccount as updateCashAccountRequest,
} from "@/lib/api/client";

/**
 * Cuenta de caja o banco, reducida a lo que consume el formulario de pagos.
 *
 * `type` separa caja de banco (el metodo EFECTIVO exige caja), `isActive` filtra las dadas de
 * baja y `currency` se muestra al lado del nombre. El resto de la fila del origen (apertura,
 * periodicidad de cierre, caja chica, custodio) no la usa esta pantalla; eso es
 * `CashAccountRecord`.
 */
export interface CashAccount {
  id: string;
  type: CashAccountCatalogItem["type"];
  name: string;
  currency: string;
  isActive: boolean;
}

/**
 * La fila completa del vertical de cajas-bancos (`CashAccount` en el origen).
 *
 * Es el contrato de `apps/api/src/cash/cash-accounts.types.ts`, reexportado con el nombre que
 * usa la UI.
 */
export type { CashAccountRecord };

/**
 * Los campos que el formulario de cuentas manda al guardar.
 *
 * Nombre del origen (`CashAccountFormMutation`, `lib/cuentas/entidades.ts:34-50`); la forma es la
 * del body del API, que a su vez es el `cashAccountSchema` compartido mas `type`.
 */
export type CashAccountFormMutation = CashAccountWrite;

/** Cuentas no borradas del dueno, por tipo y nombre (el orden del origen). */
export async function listCashAccounts(): Promise<CashAccount[]> {
  const accounts = await listCashAccountsRequest();

  return accounts.map((account) => ({
    id: account.id,
    type: account.type,
    name: account.name,
    currency: account.currency,
    isActive: account.isActive,
  }));
}

/**
 * Fila completa de una cuenta viva (`getCashAccount` del origen, que leia la tabla entera).
 *
 * Es lo que el formulario de cuentas `reset`ea al abrir el modal de edicion. Una cuenta borrada
 * o de otro dueno responde 404 y el `ApiError` llega con el mensaje del servidor.
 */
export function getCashAccount(id: string): Promise<CashAccountRecord> {
  return getCashAccountRequest(id);
}

/** Alta de cuenta (`createCashAccount`). Devuelve la fila completa creada. */
export function createCashAccount(values: CashAccountFormMutation): Promise<CashAccountRecord> {
  return createCashAccountRequest(values);
}

/**
 * Modificacion (`updateCashAccount`). REEMPLAZA las columnas editables: el formulario manda la
 * fila completa, igual que el `mapMutation` del origen; no es un merge parcial.
 */
export function updateCashAccount(
  id: string,
  values: CashAccountFormMutation,
): Promise<CashAccountRecord> {
  return updateCashAccountRequest(id, values);
}

/**
 * Baja logica (`softDeleteCashAccount`): marca `deleted_at`, la fila persiste.
 *
 * El origen sellaba la fecha en el cliente (`new Date().toISOString()`); aca la pone la base.
 */
export async function softDeleteCashAccount(id: string): Promise<void> {
  await softDeleteCashAccountRequest(id);
}
