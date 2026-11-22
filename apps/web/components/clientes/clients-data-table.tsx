"use client";

// Tabla de clientes (port de `components/clientes/clients-data-table.tsx` del origen, 130
// lineas). Es la misma tabla que `payments-view.tsx` usa para pagos: skeletons mientras carga,
// mensaje de vacio cuando no hay filas, y el paginador compartido de `components/shared`.
//
// Lo unico que cambio es el import del paginador, que en el monorepo ya existia como pieza
// compartida (`@/components/shared/data-table-pagination`), asi que no hubo que portarlo.
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
import type { Client } from "@/components/clientes/types";
import {
  clientsTableFeatures,
  getClientsColumns,
} from "@/components/clientes/clients-columns";

interface ClientsDataTableProps {
  clients: Client[];
  isLoading?: boolean;
  onView: (client: Client) => void;
  onEdit: (client: Client) => void;
  onDelete: (client: Client) => void;
}

const SKELETON_ROWS = 5;

export function ClientsDataTable({
  clients,
  isLoading = false,
  onView,
  onEdit,
  onDelete,
}: ClientsDataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo(
    () => getClientsColumns({ onView, onEdit, onDelete }),
    [onView, onEdit, onDelete]
  );

  const table = useTable({
    features: clientsTableFeatures,
    data: clients,
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
        placeholder="Buscar clientes..."
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
                  No hay clientes registrados
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
