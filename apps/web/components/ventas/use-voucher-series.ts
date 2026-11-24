"use client";

// Carga de las series del dueno para la pantalla de alta/edicion de un comprobante (T5 del slice 2:
// S11 de `odd/tasks/port-vertical-series.md`).
//
// Es el `useVoucherSeries()` del origen, con dos cambios de stack:
//
//   * La lectura va por `listSeries()` de `lib/configuracion/series.ts`, que pega en `GET /series`
//     del API por el puente `/api/backend/series` (el prefijo esta en la lista blanca desde T5). El
//     origen leia la tabla por PostgREST.
//   * `enabled` permite no pedir nada en compras: ese vertical todavia no tiene series y su
//     formulario no las usa (el tipo queda libre). Sin esto, `/compras/nuevo` haria una peticion
//     inutil y ademas mostraria el bloqueo de ventas.
//
// POR QUE SE CARGA EN EL NAVEGADOR Y NO EN LA PAGINA (desvio del plan, con su razon): las paginas de
// ventas son Server Components que no resuelven datos; el unico transporte del frontend
// (`request` de `lib/api/client.ts`) resuelve la base en el servidor pero NO reenvia la cookie de
// sesion, asi que una lectura desde el servidor de Next responde 401 del `SessionGuard`. Cargar aca,
// por el puente, es el mismo camino que ya usa `useVoucher` para el detalle y no duplica transporte.
//
// El error NO se funde con "no hay series": una carga fallida no puede mostrar el bloqueo de S11
// ("Aún no tienes series de venta configuradas"), que seria una afirmacion falsa. El formulario
// muestra el mensaje del error y deja el guardado a cargo del API, que responde con el texto de S6.
import { useCallback, useEffect, useRef, useState } from "react";

import { listSeries } from "@/lib/configuracion/series";
import type { VoucherSeries } from "@/lib/ventas/types";

const LOAD_FALLBACK_MESSAGE = "No se pudieron cargar las series. Intenta nuevamente.";

export interface UseVoucherSeriesResult {
  series: VoucherSeries[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useVoucherSeries(enabled = true): UseVoucherSeriesResult {
  const [series, setSeries] = useState<VoucherSeries[]>([]);
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const load = useCallback(async () => {
    if (!enabled) {
      setSeries([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const data = await listSeries();

      if (!isMounted.current) {
        return;
      }

      setSeries(data);
      setError(null);
    } catch (loadError) {
      if (!isMounted.current) {
        return;
      }

      setSeries([]);
      setError(
        loadError instanceof Error ? loadError.message : LOAD_FALLBACK_MESSAGE
      );
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [enabled]);

  useEffect(() => {
    isMounted.current = true;

    void load();

    return () => {
      isMounted.current = false;
    };
  }, [load]);

  return { series, isLoading, error, reload: load };
}
