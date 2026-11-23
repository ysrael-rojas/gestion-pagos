"use client";

// Columnas de la tabla de categorias de recibo (C7 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/categorias-columns.tsx` del origen (173 lineas). La edicion del
// nombre vive en el componente de acciones de cada fila (estado local: que fila se esta editando y
// con que texto), a diferencia de los metodos de pago, donde el estado sube a la tarjeta.
//
// DESVIO DELIBERADO: el origen usaba `DataTableColumnHeader`
// (`components/shared/data-table-column-header.tsx`), que no esta portado. Cada columna ordenable
// inlina el mismo boton `ghost` + `ArrowUpDown` del resto de las tablas del port.
//
// La `direction` se muestra como chip y no se edita: un cambio de direccion cambiaria el sentido
// contable de todos los recibos que ya usan la categoria, y el `PATCH` del API no la acepta.
import { useState } from "react";
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
import type { CashReceiptCategory } from "@/components/pagos/types";

export const categoriasTableFeatures = tableFeatures({
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

export type CategoriasTableFeatures = typeof categoriasTableFeatures;

const columnHelper = createColumnHelper<CategoriasTableFeatures, CashReceiptCategory>();

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

interface CategoriasColumnsActions {
  onRename: (category: CashReceiptCategory, name: string) => void;
  onToggle: (category: CashReceiptCategory) => void;
}

function CategoryActions({
  category,
  onRename,
  onToggle,
}: {
  category: CashReceiptCategory;
  onRename: CategoriasColumnsActions["onRename"];
  onToggle: CategoriasColumnsActions["onToggle"];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(category.name);

  function cancelEditing() {
    setName(category.name);
    setIsEditing(false);
  }

  function saveName() {
    onRename(category, name);
    setIsEditing(false);
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {isEditing ? (
        <>
          <Input
            aria-label={`Nuevo nombre para ${category.name}`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                saveName();
              } else if (event.key === "Escape") {
                cancelEditing();
              }
            }}
            className="h-8 w-48"
            autoFocus
          />
          <Button variant="ghost" size="icon-sm" aria-label="Guardar nombre" onClick={saveName}>
            <Check />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Cancelar edición"
            onClick={cancelEditing}
          >
            <X />
          </Button>
        </>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Renombrar ${category.name}`}
          onClick={() => setIsEditing(true)}
        >
          <Pencil />
        </Button>
      )}
      <Button variant="outline" size="sm" onClick={() => onToggle(category)}>
        {category.isActive ? "Desactivar" : "Activar"}
      </Button>
    </div>
  );
}

export function getCategoriasColumns({ onRename, onToggle }: CategoriasColumnsActions) {
  return columnHelper.columns([
    columnHelper.accessor("direction", {
      header: ({ column }) => <SortableHeader title="Tipo" column={column} />,
      cell: ({ getValue }) =>
        getValue() === "INGRESO" ? (
          <Badge variant="secondary">Ingreso</Badge>
        ) : (
          <Badge variant="outline">Egreso</Badge>
        ),
    }),
    columnHelper.accessor("isActive", {
      header: ({ column }) => <SortableHeader title="Estado" column={column} />,
      cell: ({ getValue }) =>
        getValue() ? (
          <Badge variant="outline">Activa</Badge>
        ) : (
          <Badge variant="destructive">Inactiva</Badge>
        ),
    }),
    columnHelper.accessor("name", {
      header: ({ column }) => <SortableHeader title="Nombre" column={column} />,
      cell: ({ getValue }) => getValue(),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <div className="text-right">Acciones</div>,
      cell: ({ row }) => (
        <CategoryActions category={row.original} onRename={onRename} onToggle={onToggle} />
      ),
    }),
  ]);
}
