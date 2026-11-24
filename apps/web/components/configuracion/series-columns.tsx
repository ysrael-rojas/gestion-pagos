"use client";

// Columnas de la tabla de series (T4 del slice 2: S8 de
// `odd/tasks/port-vertical-series.md`).
//
// Port de `components/configuracion/series-columns.tsx` del origen. Dos desvios, los dos por el
// stack de este repo:
//
// 1. El origen usaba `DataTableColumnHeader`, que aca no existe: cada columna ordenable inlina el
//    mismo boton ghost con `ArrowUpDown` que ya usan clientes, pagos y cuentas, para no tener dos
//    cabeceras distintas en la app.
// 2. La fila es `SerieTableRow`, el modelo que arma `lib/configuracion/series.ts`: la etiqueta del
//    tipo, el correlativo a 6 digitos y la marca de predeterminada ya vienen resueltos y probados
//    sin montar TanStack.
//
// Los `aria-label` de las acciones salen de `SERIES_COPY` (`Editar serie {code}` /
// `Eliminar serie {code}`): el texto con el codigo intercalado es contrato de S8, no un literal
// suelto en el JSX.
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";
import { ArrowUpDown, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SERIES_COPY, type SerieTableRow } from "@/lib/configuracion/series";

export const seriesTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export type SeriesTableFeatures = typeof seriesTableFeatures;

const columnHelper = createColumnHelper<SeriesTableFeatures, SerieTableRow>();

interface SeriesColumnsActions {
  onEdit: (row: SerieTableRow) => void;
  onDelete: (row: SerieTableRow) => void;
}

export function getSeriesColumns({ onEdit, onDelete }: SeriesColumnsActions) {
  return columnHelper.columns([
    columnHelper.accessor("typeLabel", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {SERIES_COPY.columnType}
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("code", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {SERIES_COPY.columnCode}
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("lastNumber", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          {SERIES_COPY.columnLastNumber}
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue, row }) => (
        <div className="text-center tabular-nums" title={String(getValue())}>
          {row.original.correlativeLabel}
        </div>
      ),
    }),
    columnHelper.accessor("isDefault", {
      // No ordena: en el origen tampoco, y el orden natural del API (tipo y codigo) ya es el util.
      header: () => <div className="text-center">{SERIES_COPY.columnDefault}</div>,
      cell: ({ getValue, row }) =>
        getValue() ? (
          <div className="text-center">
            <Badge variant="outline">{SERIES_COPY.defaultBadge}</Badge>
          </div>
        ) : (
          <div className="text-center text-muted-foreground">
            {row.original.defaultLabel}
          </div>
        ),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <div className="text-right">Acciones</div>,
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={SERIES_COPY.editActionLabel(row.original.code)}
            onClick={() => onEdit(row.original)}
          >
            <Pencil />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={SERIES_COPY.deleteActionLabel(row.original.code)}
            onClick={() => onDelete(row.original)}
          >
            <Trash2 />
          </Button>
        </div>
      ),
    }),
  ]);
}
