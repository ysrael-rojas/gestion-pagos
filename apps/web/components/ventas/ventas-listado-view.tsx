"use client";

// Listado de ventas (port de `components/ventas/ventas-listado-view.tsx` del origen, 102 lineas).
// Es la pantalla de S10: titulo `Ventas`, subtitulo `Registra y administra tus ventas`, boton
// `Registrar venta`, filtros, tabla y acciones.
//
// Diferencias con el origen, todas por el stack o por el alcance del slice:
//
//   * NO hay `useVentas()` (provider de ventas en el layout): los providers del layout son de
//     clientes, cajas y pagos, y agregar uno nuevo obligaria a tocar `app/(app)/layout.tsx`, fuera
//     de T4. El listado pide `GET /vouchers` al montarse; volver de un alta o una edicion remonta la
//     pagina y vuelve a leer, asi que no queda una fila vieja en pantalla.
//   * NO cruza la lista de clientes: el API manda `entityName` en la misma fila. Una venta de un
//     cliente borrado sigue mostrando de quien fue.
//   * `Registrar pago` es un enlace al vertical de pagos (`/pagos/ingresos/nuevo`, con la entidad y
//     el comprobante precargados), no el drawer de cobro del origen: ese drawer pertenece a otro
//     vertical y este slice no lo porta.
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
  toVentaTableRows,
  type VentaTableRow,
} from "@/lib/ventas/tabla";
import { listVentas } from "@/lib/ventas/ventas";
import { parseListadoFilters } from "@/lib/filters/listado-filters";

const LIST_FALLBACK_MESSAGE =
  "No se pudieron cargar las ventas. Intenta nuevamente.";

export function VentasListadoView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [ventas, setVentas] = useState<VentaTableRow[]>([]);
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
      const data = await listVentas();

      if (!isMounted.current) {
        return;
      }

      setVentas(toVentaTableRows(data));
    } catch (loadError) {
      if (!isMounted.current) {
        return;
      }

      setVentas([]);
      toast.error(
        loadError instanceof Error ? loadError.message : LIST_FALLBACK_MESSAGE
      );
    } finally {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    isMounted.current = true;

    void load();

    return () => {
      isMounted.current = false;
    };
  }, [load]);

  const openView = useCallback(
    (row: VentaTableRow) => {
      router.push(`/ventas/${row.id}`);
    },
    [router]
  );

  const openEdit = useCallback(
    (row: VentaTableRow) => {
      router.push(`/ventas/${row.id}/editar`);
    },
    [router]
  );

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Ventas</h1>
        <p className="text-sm text-muted-foreground">
          Registra y administra tus ventas
        </p>
      </div>

      <VentasListadoToolbar filters={filters}>
        <Link href="/ventas/nuevo" className={buttonVariants()}>
          Registrar venta
        </Link>
      </VentasListadoToolbar>

      <VentasDataTable
        rows={ventas}
        filters={filters}
        isLoading={isLoading}
        onView={openView}
        onEdit={openEdit}
      />
    </main>
  );
}
