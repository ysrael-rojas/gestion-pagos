"use client";

// Listado de comprobantes (port de `components/ventas/ventas-listado-view.tsx` del origen, 102
// lineas). Es la pantalla de S10 para VENTAS y para COMPRAS: titulo, subtitulo, boton del alta,
// filtros, tabla y acciones salen del vertical via `voucherKind`, y los textos de `voucherListCopy`
// (`lib/ventas/tabla.ts`).
//
// Diferencias con el origen, todas por el stack o por el alcance del slice:
//
//   * NO hay `useVentas()` (provider de ventas en el layout): los providers del layout son de
//     clientes, cajas y pagos, y agregar uno nuevo obligaria a tocar `app/(app)/layout.tsx`. El
//     listado pide su fuente al montarse (`VOUCHER_SOURCES[kind].list`, o sea `GET /vouchers` o
//     `GET /purchases`); volver de un alta o una edicion remonta la pagina y vuelve a leer, asi que
//     no queda una fila vieja en pantalla.
//   * NO cruza la lista de clientes ni la de proveedores: el API manda `entityName` en la misma fila.
//     Un comprobante de una entidad borrada sigue mostrando de quien fue.
//   * `Registrar pago` es un enlace al vertical de pagos (`/pagos/ingresos/nuevo` o
//     `/pagos/egresos/nuevo`, con la entidad y el comprobante precargados), no el drawer de cobro del
//     origen: ese drawer pertenece a otro vertical y este slice no lo porta.
//
// Los filtros se leen de la URL (`?desde=&hasta=&estado=`) con `parseListadoFilters`, la misma
// funcion que usan los pagos, y se aplican en cliente sobre `issue_date` y `status` (S10).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { buttonVariants } from "@/components/ui/button";
import { VentasDataTable } from "@/components/ventas/ventas-data-table";
import { VentasListadoToolbar } from "@/components/ventas/ventas-listado-toolbar";
import {
  toVoucherTableRows,
  voucherListCopy,
  type VoucherTableRow,
} from "@/lib/ventas/tabla";
import type { VoucherKind } from "@/lib/ventas/types";
import { VOUCHER_SOURCES } from "@/lib/ventas/ventas";
import { parseListadoFilters } from "@/lib/filters/listado-filters";

const LIST_FALLBACK_MESSAGE =
  "No se pudieron cargar los comprobantes. Intenta nuevamente.";

interface VoucherListadoViewProps {
  voucherKind: VoucherKind;
}

export function VoucherListadoView({ voucherKind }: VoucherListadoViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const copy = voucherListCopy(voucherKind);
  const [rows, setRows] = useState<VoucherTableRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const isMounted = useRef(true);

  const desde = searchParams.get("desde") ?? undefined;
  const hasta = searchParams.get("hasta") ?? undefined;
  const estado = searchParams.get("estado") ?? undefined;

  // `parseListadoFilters` ya devuelve el objeto completo (desde/hasta/estado), con las fechas mal
  // formadas descartadas y un estado fuera del catalogo convertido a TODOS.
  const filters = useMemo(
    () => parseListadoFilters({ desde, hasta, estado }),
    [desde, hasta, estado]
  );

  const load = useCallback(async () => {
    try {
      const data = await VOUCHER_SOURCES[voucherKind].list();

      if (!isMounted.current) {
        return;
      }

      setRows(toVoucherTableRows(data));
    } catch (loadError) {
      if (!isMounted.current) {
        return;
      }

      setRows([]);
      toast.error(
        loadError instanceof Error ? loadError.message : LIST_FALLBACK_MESSAGE
      );
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, [voucherKind]);

  useEffect(() => {
    isMounted.current = true;

    void load();

    return () => {
      isMounted.current = false;
    };
  }, [load]);

  const openView = useCallback(
    (row: VoucherTableRow) => {
      router.push(`${copy.basePath}/${row.id}`);
    },
    [copy.basePath, router]
  );

  const openEdit = useCallback(
    (row: VoucherTableRow) => {
      router.push(`${copy.basePath}/${row.id}/editar`);
    },
    [copy.basePath, router]
  );

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">{copy.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.subtitle}</p>
      </div>

      <VentasListadoToolbar filters={filters}>
        <Link href={`${copy.basePath}/nuevo`} className={buttonVariants()}>
          {copy.createLabel}
        </Link>
      </VentasListadoToolbar>

      <VentasDataTable
        voucherKind={voucherKind}
        rows={rows}
        filters={filters}
        isLoading={isLoading}
        onView={openView}
        onEdit={openEdit}
      />
    </main>
  );
}

/**
 * El listado de ventas.
 *
 * Se conserva el nombre porque `app/(app)/ventas/page.tsx` lo importa (esa pagina no cambia en este
 * slice): es exactamente `VoucherListadoView` con el vertical de ventas.
 */
export function VentasListadoView() {
  return <VoucherListadoView voucherKind="VENTA" />;
}
