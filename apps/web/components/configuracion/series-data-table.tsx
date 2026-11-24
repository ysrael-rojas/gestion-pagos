"use client";

// Tabla de series (T4 del slice 2: S8).
//
// Port de la tabla que el origen tenia dentro de `series-view.tsx`: skeletons mientras carga, el
// mensaje de vacio de S8 cuando no hay filas y el paginador compartido de `components/shared`.
//
// No hay buscador: S8 no lo tiene y el vertical de series es corto (una serie por tipo y codigo). Lo
// que si se conserva del origen es el orden por columna y la paginacion.
import { useMemo, useState } from "react";
import { useTable, type SortingState } from "@tanstack/react-table";

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
import { SERIES_COPY, type SerieTableRow } from "@/lib/configuracion/series";
import {
  getSeriesColumns,
  seriesTableFeatures,
} from "@/components/configuracion/series-columns";

interface SeriesDataTableProps {
  rows: SerieTableRow[];
  isLoading?: boolean;
  onEdit: (row: SerieTableRow) => void;
  onDelete: (row: SerieTableRow) => void;
}

const SKELETON_ROWS = 4;
const PAGE_SIZE = 10;

export function SeriesDataTable({
  rows,
  isLoading = false,
  onEdit,
  onDelete,
}: SeriesDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () => getSeriesColumns({ onEdit, onDelete }),
    [onEdit, onDelete]
  );

  const table = useTable({
    features: seriesTableFeatures,
    data: rows,
    columns,
    onSortingChange: setSorting,
    state: { sorting },
    initialState: { pagination: { pageIndex: 0, pageSize: PAGE_SIZE } },
  });

  return (
    <div className="flex flex-col gap-4">
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
                  {Array.from({ length: columns.length }).map((_, cellIndex) => (
                    <TableCell key={`skeleton-${rowIndex}-${cellIndex}`}>
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  ))}
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
                  className="h-24 text-center text-sm text-muted-foreground"
                >
                  {SERIES_COPY.emptyMessage}
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
