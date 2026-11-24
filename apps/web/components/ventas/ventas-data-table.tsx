"use client";

// Tabla del listado de ventas (port de `components/ventas/sales-data-table.tsx` del origen, 141
// lineas). Skeletons mientras carga (5 filas, S10), mensaje de vacio, busqueda global y el
// paginador compartido con paginacion inicial de 10.
//
// Filtros: se aplican ACA sobre las filas ya cargadas (S10: "en cliente sobre `issue_date` y
// `status`"), con `filterVentaRows` — que es `applyListadoFilters`, el mismo de los pagos. La
// busqueda global (`Buscar ventas...`) es la de TanStack, igual que en clientes y pagos: no hay un
// segundo motor de busqueda.
import { useMemo, useState } from "react";
import { useTable, type SortingState } from "@tanstack/react-table";

import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import {
  getVentasColumns,
  ventasTableFeatures,
} from "@/components/ventas/ventas-columns";
import {
  VENTAS_EMPTY_MESSAGE,
  VENTAS_PAGE_SIZE,
  filterVentaRows,
  type VentaTableRow,
} from "@/lib/ventas/tabla";
import type { ListadoFilters } from "@/lib/filters/listado-filters";

interface VentasDataTableProps {
  rows: VentaTableRow[];
  filters: ListadoFilters<string>;
  isLoading?: boolean;
  onView: (row: VentaTableRow) => void;
  onEdit: (row: VentaTableRow) => void;
}

const SKELETON_ROWS = 5;

export function VentasDataTable({
  rows,
  filters,
  isLoading = false,
  onView,
  onEdit,
}: VentasDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const data = useMemo(() => filterVentaRows(rows, filters), [rows, filters]);

  const columns = useMemo(
    () => getVentasColumns({ onView, onEdit }),
    [onView, onEdit]
  );

  const table = useTable({
    features: ventasTableFeatures,
    data,
    columns,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      sorting,
      globalFilter,
    },
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: VENTAS_PAGE_SIZE,
      },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Buscar ventas..."
        value={globalFilter}
        onChange={(event) => setGlobalFilter(event.target.value)}
        className="max-w-sm"
      />

      <div className="overflow-hidden rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : (
                      <table.FlexRender header={header} />
                    )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: SKELETON_ROWS }).map((_, rowIndex) => (
                <TableRow key={`skeleton-${rowIndex}`}>
                  {Array.from({ length: columns.length }).map(
                    (_, cellIndex) => (
                      <TableCell key={`skeleton-${rowIndex}-${cellIndex}`}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    )
                  )}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {VENTAS_EMPTY_MESSAGE}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} />
    </div>
  );
}
