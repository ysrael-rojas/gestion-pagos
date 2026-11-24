"use client";

// Carga del comprobante para la edicion y el detalle (T4 del port).
//
// Es el `useVoucher` del origen, con dos cambios de stack: la lectura va por `VOUCHER_SOURCES`
// (HTTP al API, no PostgREST) y el error que se muestra es el `message` del `ApiError`, que ya
// viene redactado por el dominio (`El comprobante no existe.`).
//
// El error NO se funde con "comprobante vacio": la vista de detalle y la de edicion muestran los
// dos estados por separado, igual que el origen.
import { useCallback, useEffect, useRef, useState } from "react";

import type { VoucherDetail, VoucherKind } from "@/lib/ventas/types";
import { VOUCHER_SOURCES } from "@/lib/ventas/ventas";

const LOAD_FALLBACK_MESSAGE =
  "No se pudo cargar el comprobante. Intenta nuevamente.";

export interface UseVoucherResult {
  voucher: VoucherDetail | null;
  isLoading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useVoucher(
  voucherId: string | undefined,
  voucherKind: VoucherKind
): UseVoucherResult {
  const [voucher, setVoucher] = useState<VoucherDetail | null>(null);
  const [isLoading, setIsLoading] = useState(voucherId !== undefined);
  const [error, setError] = useState<string | null>(null);
  const isMounted = useRef(true);

  const load = useCallback(async () => {
    if (!voucherId) {
      setVoucher(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    try {
      const data = await VOUCHER_SOURCES[voucherKind].detail(voucherId);

      if (!isMounted.current) {
        return;
      }

      setVoucher(data);
      setError(null);
    } catch (loadError) {
      if (!isMounted.current) {
        return;
      }

      setVoucher(null);
      setError(
        loadError instanceof Error ? loadError.message : LOAD_FALLBACK_MESSAGE
      );
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [voucherId, voucherKind]);

  useEffect(() => {
    isMounted.current = true;

    void load();

    return () => {
      isMounted.current = false;
    };
  }, [load]);

  return { voucher, isLoading, error, reload: load };
}
