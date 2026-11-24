"use client";

// Carga de las notas de un comprobante para su detalle (T4 del slice 3: S1 y S11 de
// `odd/tasks/port-vertical-notas.md`).
//
// Es el `loadAdjustments` del origen (`components/comprobantes/voucher-detalle-view.tsx:124-142`)
// reducido a las notas: la retencion tiene su propio slice y su propio listado. La lectura va por
// `listNotas()` de `lib/notas/notas.ts`, que pega en `GET /notes?voucherId=` del API por el puente
// `/api/backend/notes`, el mismo camino que `useVoucher` y `useVoucherSeries` (Server Component no
// resuelve datos en este vertical, y el transporte del frontend no reenvia la cookie desde el
// servidor de Next).
//
// El error NO se funde con "este comprobante no tiene notas": una carga fallida no puede mostrar el
// vacio de S11, que seria una afirmacion falsa sobre el comprobante. La seccion muestra el mensaje y
// deja la tabla como desconocida, igual que el origen.
//
// `reload` es lo que hace que la lista (y los totales) cambien despues de un alta: la seccion lo
// llama junto con la recarga del comprobante (el saldo tambien cambio, S2).
import { useCallback, useEffect, useRef, useState } from "react";

import type { VoucherAdjustmentRow } from "@gestion/shared/lib/schemas/nota.ts";

import { listNotas } from "@/lib/notas/notas";
import { NOTAS_COPY } from "@/lib/notas/textos";

export interface UseNotasResult {
  notas: VoucherAdjustmentRow[];
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useNotas(voucherId: string): UseNotasResult {
  const [notas, setNotas] = useState<VoucherAdjustmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const load = useCallback(async () => {
    setIsLoading(true);

    try {
      const data = await listNotas(voucherId);

      if (!isMounted.current) {
        return;
      }

      setNotas(data);
      setError(null);
    } catch (loadError) {
      if (!isMounted.current) {
        return;
      }

      setNotas([]);
      setError(
        loadError instanceof Error && loadError.message
          ? loadError.message
          : NOTAS_COPY.loadError
      );
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [voucherId]);

  useEffect(() => {
    isMounted.current = true;

    void load();

    return () => {
      isMounted.current = false;
    };
  }, [load]);

  return { notas, isLoading, error, reload: load };
}
