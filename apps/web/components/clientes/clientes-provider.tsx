"use client";

// Provider de clientes (port de la parte de lectura de `components/clientes/clientes-provider.tsx`
// del origen, 133 lineas).
//
// Que conserva: `clients`, `isLoading`, `error` y `refresh`, que es lo que usan el autocomplete de
// entidades, `useEntityOptions` y el resolvedor de nombres de la tabla de pagos.
//
// Que NO trae: `addClient`, `updateClient` y `removeClient`. En el origen escribian en
// `entidad` desde el navegador; esas rutas no existen en `apps/api` (son del vertical de clientes,
// T5c) y ninguno de los archivos de pagos las llama. Portarlas seria cablear contra endpoints
// inexistentes.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Client } from "@/components/clientes/types";
import { listClients } from "@/lib/clientes/entidades";

interface ClientesContextValue {
  clients: Client[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

const ClientesContext = createContext<ClientesContextValue | null>(null);

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export function ClientesProvider({ children }: { children: React.ReactNode }) {
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await listClients();

      if (!isMounted.current) {
        return;
      }

      setClients(data);
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
    () => ({ clients, isLoading, error, refresh }),
    [clients, isLoading, error, refresh]
  );

  return (
    <ClientesContext.Provider value={value}>{children}</ClientesContext.Provider>
  );
}

export function useClientes() {
  const context = useContext(ClientesContext);

  if (!context) {
    throw new Error("useClientes debe usarse dentro de un ClientesProvider");
  }

  return context;
}
