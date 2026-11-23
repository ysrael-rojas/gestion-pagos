"use client";

// Columnas de la tabla de cuentas (C5 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/cash-accounts-columns.tsx` del origen (193 lineas). Es una
// fabrica de columnas, no un componente: la tabla le pasa los tres handlers de fila y memoiza el
// resultado, igual que `clients-columns.tsx` y `payments-columns.tsx`.
//
// DESVIO DELIBERADO: el origen usaba `DataTableColumnHeader`
// (`components/shared/data-table-column-header.tsx`), que no existe en este repo. Cada columna
// ordenable inlina el mismo boton que ya usan clientes y pagos (un `Button` ghost con
// `ArrowUpDown` que alterna el orden), para que no haya dos cabeceras distintas en la app. Se
// conservan las siete columnas ordenables del origen y la de acciones, que no ordena.
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";
import { ArrowUpDown, Eye, Pencil, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCurrency } from "@gestion/shared";
import type { CashAccountRecord } from "@/lib/cuentas/entidades";

function formatAmount(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es-PE", {
      style: "currency",
      currency: currency || "PEN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return formatCurrency(value);
  }
}

export const cashAccountsTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  rowSortingFeature,
  rowPaginationFeature,
  filteredRowModel: createFilteredRowModel(),
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

export type CashAccountsTableFeatures = typeof cashAccountsTableFeatures;

const columnHelper = createColumnHelper<
  CashAccountsTableFeatures,
  CashAccountRecord
>();

interface CashAccountsColumnsActions {
  onView: (account: CashAccountRecord) => void;
  onEdit: (account: CashAccountRecord) => void;
  onDelete: (account: CashAccountRecord) => void;
}

export function getCashAccountsColumns({
  onView,
  onEdit,
  onDelete,
}: CashAccountsColumnsActions) {
  return columnHelper.columns([
    columnHelper.accessor("type", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Tipo
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) => {
        const value = getValue();
        return value === "CASH_BOX" ? (
          <Badge variant="secondary">Caja</Badge>
        ) : (
          <Badge variant="default">Banco</Badge>
        );
      },
    }),
    columnHelper.accessor("name", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Nombre
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("bankName", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Banco
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) => getValue() ?? "—",
    }),
    columnHelper.accessor("accountNumber", {
      id: "accountNumber",
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Nro de cuenta
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) => getValue() ?? "—",
    }),
    columnHelper.accessor("currency", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Moneda
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("openingBalance", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Saldo inicial
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue, row }) => (
        <div className="text-right">
          {formatAmount(getValue(), row.original.currency)}
        </div>
      ),
    }),
    columnHelper.accessor("isActive", {
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Estado
          <ArrowUpDown />
        </Button>
      ),
      cell: ({ getValue }) =>
        getValue() ? (
          <Badge variant="outline">Activa</Badge>
        ) : (
          <Badge variant="destructive">Inactiva</Badge>
        ),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <div className="text-right">Acciones</div>,
      cell: ({ row }) => {
        const account = row.original;
        return (
          <TooltipProvider>
            <div className="flex items-center justify-end gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onView(account)}
                      aria-label="Ver detalle"
                    />
                  }
                >
                  <Eye />
                </TooltipTrigger>
                <TooltipContent>Ver detalle</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onEdit(account)}
                      aria-label="Editar"
                    />
                  }
                >
                  <Pencil />
                </TooltipTrigger>
                <TooltipContent>Editar</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onDelete(account)}
                      aria-label="Eliminar"
                    />
                  }
                >
                  <Trash2 />
                </TooltipTrigger>
                <TooltipContent>Eliminar</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        );
      },
    }),
  ]);
}
