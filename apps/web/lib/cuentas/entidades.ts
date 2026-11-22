// Cuentas de caja y banco del lado de la UI.
//
// Port de la parte de lectura de `lib/cuentas/entidades.ts` del origen (170 lineas). El origen
// traia la fila completa de `cash_account` porque el vertical de cajas-bancos la edita; el
// formulario de pagos solo necesita cinco columnas, y son las que expone `GET /cash-accounts`.
//
// Las escrituras (`createCashAccount`, `updateCashAccount`, `softDeleteCashAccount`) no se
// portan: son del vertical de cajas-bancos (T5c) y no tienen ruta en `apps/api`.
import { type CashAccountCatalogItem, listCashAccounts as listCashAccountsRequest } from "@/lib/api/client";

/**
 * Cuenta de caja o banco, reducida a lo que consume el formulario de pagos.
 *
 * `type` separa caja de banco (el metodo EFECTIVO exige caja), `isActive` filtra las dadas de
 * baja y `currency` se muestra al lado del nombre. El resto de la fila del origen (apertura,
 * periodicidad de cierre, caja chica, custodio) no la usa esta pantalla.
 */
export interface CashAccount {
  id: string;
  type: CashAccountCatalogItem["type"];
  name: string;
  currency: string;
  isActive: boolean;
}

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
