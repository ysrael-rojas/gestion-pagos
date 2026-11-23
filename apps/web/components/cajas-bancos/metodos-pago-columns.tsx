"use client";

// Columnas de la tabla de metodos de pago (C7 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/metodos-pago-columns.tsx` del origen (156 lineas). Es una
// fabrica de columnas, no un componente: la tarjeta le pasa el estado de edicion en linea (que
// metodo se esta renombrando y con que texto) y memoiza el resultado.
//
// DESVIO DELIBERADO: el origen usaba `DataTableColumnHeader`
// (`components/shared/data-table-column-header.tsx`), que no esta portado. Cada columna ordenable
// inlina el mismo boton `ghost` + `ArrowUpDown` que ya usan las tablas de cuentas, cierres y
// movimientos, para que no haya dos cabeceras distintas en la app.
//
// El `code` no es editable a proposito: es el identificador estable con el que el formulario de
// pagos resuelve "es efectivo" y la categoria (SPEC 37), asi que el alta lo fija y el `PATCH` ni
// siquiera lo acepta en el API.
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
import { ArrowUpDown, Check, Pencil, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PaymentMethodRef } from "@/components/pagos/types";

export const paymentMethodsTableFeatures = tableFeatures({
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

export type PaymentMethodsTableFeatures = typeof paymentMethodsTableFeatures;

const columnHelper = createColumnHelper<PaymentMethodsTableFeatures, PaymentMethodRef>();

/** Cabecera ordenable con el boton del port (no hay `DataTableColumnHeader` aca). */
function SortableHeader({
  title,
  column,
}: {
  title: string;
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
}) {
  return (
    <Button variant="ghost" onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}>
      {title}
      <ArrowUpDown />
    </Button>
  );
}

interface PaymentMethodsColumnsActions {
  editingId: string | null;
  editingName: string;
  onEditingNameChange: (name: string) => void;
  onStartRename: (method: PaymentMethodRef) => void;
  onRename: (method: PaymentMethodRef) => void;
  onCancelRename: () => void;
  onToggle: (method: PaymentMethodRef) => void;
}

export function getPaymentMethodsColumns({
  editingId,
  editingName,
  onEditingNameChange,
  onStartRename,
  onRename,
  onCancelRename,
  onToggle,
}: PaymentMethodsColumnsActions) {
  return columnHelper.columns([
    columnHelper.accessor("isActive", {
      header: ({ column }) => <SortableHeader title="Estado" column={column} />,
      cell: ({ getValue }) =>
        getValue() ? (
          <Badge variant="outline">Activo</Badge>
        ) : (
          <Badge variant="destructive">Inactivo</Badge>
        ),
    }),
    columnHelper.accessor("code", {
      header: ({ column }) => <SortableHeader title="Código" column={column} />,
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.accessor("name", {
      header: ({ column }) => <SortableHeader title="Nombre" column={column} />,
      cell: ({ row }) =>
        editingId === row.original.id ? (
          <Input
            value={editingName}
            aria-label={`Nombre del método ${row.original.code}`}
            className="h-8 min-w-36"
            onChange={(event) => onEditingNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onRename(row.original);
              }
              if (event.key === "Escape") {
                onCancelRename();
              }
            }}
          />
        ) : (
          row.original.name
        ),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <div className="text-right">Acciones</div>,
      cell: ({ row }) => {
        const method = row.original;
        const isEditing = editingId === method.id;

        return (
          <div className="flex items-center justify-end gap-1">
            {isEditing ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Guardar nombre"
                  onClick={() => onRename(method)}
                >
                  <Check />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Cancelar edición"
                  onClick={onCancelRename}
                >
                  <X />
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Renombrar ${method.name}`}
                onClick={() => onStartRename(method)}
              >
                <Pencil />
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onToggle(method)}>
              {method.isActive ? "Desactivar" : "Activar"}
            </Button>
          </div>
        );
      },
    }),
  ]);
}
