"use client";

// Provider de cuentas de caja y banco (port de la parte de lectura de
// `components/cajas-bancos/cajas-bancos-provider.tsx` del origen, 130 lineas).
//
// Lo usa el formulario de pagos: `accounts` alimenta el selector de caja/banco y `isLoading` el
// estado del selector. `refresh` se llama despues de registrar un pago, para que un movimiento
// nuevo no deje el selector con datos viejos.
//
// Que NO trae: `addAccount`, `updateAccount` y `removeAccount` (escrituras del vertical de
// cajas-bancos, T5c, sin ruta en `apps/api`).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { CashAccount } from "@/lib/cuentas/entidades";
import { listCashAccounts } from "@/lib/cuentas/entidades";

interface CajasBancosContextValue {
  accounts: CashAccount[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const CajasBancosContext = createContext<CajasBancosContextValue | null>(null);

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export function CajasBancosProvider({ children }: { children: React.ReactNode }) {
  const [accounts, setAccounts] = useState<CashAccount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await listCashAccounts();

      if (!isMounted.current) {
        return;
      }

      setAccounts(data);
      setError(null);
    } catch (err) {
      if (!isMounted.current) {
        return;
      }

      setError(getErrorMessage(err));
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    void (async () => {
      await refresh();
    })();

    return () => {
      isMounted.current = false;
    };
  }, [refresh]);

  const value = useMemo(
    () => ({ accounts, isLoading, error, refresh }),
    [accounts, isLoading, error, refresh]
  );

  return (
    <CajasBancosContext.Provider value={value}>
      {children}
    </CajasBancosContext.Provider>
  );
}

export function useCajasBancos() {
  const context = useContext(CajasBancosContext);

  if (!context) {
    throw new Error("useCajasBancos debe usarse dentro de un CajasBancosProvider");
  }

  return context;
}
