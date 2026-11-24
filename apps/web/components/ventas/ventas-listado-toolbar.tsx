"use client";

// Filtros del listado de ventas (S10): `Desde`, `Hasta`, `Estado pago` y `Limpiar filtros`.
//
// Es el mismo patron que `components/pagos/payments-listings-toolbar.tsx`: los filtros viven en la
// URL (`?desde=&hasta=&estado=`) y el listado los lee con `parseListadoFilters`. Asi el estado
// sobrevive al refresh y se puede linkear, y la pantalla no inventa un segundo formato de filtros.
//
// El componente NO parsea la URL: recibe los filtros ya resueltos y solo escribe. La fuente unica
// del parseo es `apps/web/lib/filters/listado-filters.ts`, que ademas descarta una fecha mal
// formada entera en vez de recortarla.
import type { ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListadoFilters } from "@/lib/filters/listado-filters";
import {
  VENTA_STATUS_FILTER_OPTIONS,
  hasActiveVentaFilters,
} from "@/lib/ventas/tabla";

interface VentasListadoToolbarProps {
  filters: ListadoFilters<string>;
  /** Accion principal de la pantalla (`Registrar venta`). */
  children: ReactNode;
}

export function VentasListadoToolbar({
  filters,
  children,
}: VentasListadoToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();

  function replace(params: URLSearchParams) {
    const query = params.toString();

    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function updateFilter(name: "desde" | "hasta" | "estado", value: string) {
    const nextParams = new URLSearchParams();

    if (filters.desde) nextParams.set("desde", filters.desde);
    if (filters.hasta) nextParams.set("hasta", filters.hasta);
    if (filters.estado !== "TODOS") nextParams.set("estado", filters.estado);

    if (!value || (name === "estado" && value === "TODOS")) {
      nextParams.delete(name);
    } else {
      nextParams.set(name, value);
    }

    replace(nextParams);
  }

  function clearFilters() {
    // "Limpiar filtros" vuelve TODOS los filtros a su estado inicial, incluido el estado de pago.
    replace(new URLSearchParams());
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Label>Desde:</Label>
          <Input
            type="date"
            aria-label="Desde"
            className="w-auto"
            value={filters.desde ?? ""}
            onChange={(event) => updateFilter("desde", event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label>Hasta:</Label>
          <Input
            type="date"
            aria-label="Hasta"
            className="w-auto"
            value={filters.hasta ?? ""}
            onChange={(event) => updateFilter("hasta", event.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label>Estado pago:</Label>
          <Select
            value={filters.estado}
            items={VENTA_STATUS_FILTER_OPTIONS}
            onValueChange={(value) => updateFilter("estado", value ?? "TODOS")}
          >
            <SelectTrigger aria-label="Estado pago">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {VENTA_STATUS_FILTER_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {hasActiveVentaFilters(filters) ? (
          <Button variant="ghost" onClick={clearFilters}>
            <X />
            Limpiar filtros
          </Button>
        ) : null}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
