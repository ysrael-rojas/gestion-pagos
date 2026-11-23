"use client";

// Tabla de cuentas de caja y banco (C5 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/cash-accounts-data-table.tsx` del origen (129 lineas). Es la
// misma tabla que usan clientes y pagos: skeletons mientras carga, mensaje de vacio cuando no hay
// filas, filtro global por texto y el paginador compartido de `components/shared`.
//
// El unico cambio es el tipo de fila (`CashAccountRecord`, la fila completa) y el import del
// paginador, que en el monorepo ya existia como pieza compartida.
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
import type { CashAccountRecord } from "@/lib/cuentas/entidades";
import {
  cashAccountsTableFeatures,
  getCashAccountsColumns,
} from "@/components/cajas-bancos/cash-accounts-columns";

interface CashAccountsDataTableProps {
  accounts: CashAccountRecord[];
  isLoading?: boolean;
  onView: (account: CashAccountRecord) => void;
  onEdit: (account: CashAccountRecord) => void;
  onDelete: (account: CashAccountRecord) => void;
}

const SKELETON_ROWS = 5;

export function CashAccountsDataTable({
  accounts,
  isLoading = false,
  onView,
  onEdit,
  onDelete,
}: CashAccountsDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo(
    () => getCashAccountsColumns({ onView, onEdit, onDelete }),
    [onView, onEdit, onDelete],
  );

  const table = useTable({
    features: cashAccountsTableFeatures,
    data: accounts,
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
        pageSize: 10,
      },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <Input
        placeholder="Buscar por nombre o banco…"
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
                    ),
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
                  className="text-center text-sm text-muted-foreground"
                >
                  No hay cajas ni bancos registrados.
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
