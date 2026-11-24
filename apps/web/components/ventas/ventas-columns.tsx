"use client";

// Columnas del listado de ventas (port de `components/ventas/sales-columns.tsx` del origen, 231
// lineas). Es una fabrica de columnas, no un componente: la tabla le pasa los handlers de fila y
// memoiza el resultado, igual que `clients-columns.tsx` y `payments-columns.tsx`.
//
// S10 fija las seis columnas y las acciones:
//   F. emisión · T. comprobante · Nro comprobante · Cliente · Total · Estado pago
//   Ver, Editar, y `Registrar pago` SOLO cuando el comprobante esta pendiente.
//
// Diferencias con el origen:
//   * Los textos de las celdas ya vienen resueltos en `VentaTableRow` (`lib/ventas/tabla.ts`), asi
//     que la columna no repite `formatDate`/`getOptionLabel` ni el cruce con la lista de clientes.
//   * `Registrar pago` es un ENLACE al vertical de pagos (`paymentEntryHref`), no el drawer de
//     cobro del origen: ese drawer no se porta en este slice.
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
import { ArrowUpDown, Eye, Pencil, Wallet } from "lucide-react";
import Link from "next/link";

import { VoucherStatusBadge } from "@/components/ventas/voucher-status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  canRegisterPayment,
  paymentEntryHref,
  type VentaTableRow,
} from "@/lib/ventas/tabla";
import { cn } from "@gestion/shared";

export const ventasTableFeatures = tableFeatures({
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

export type VentasTableFeatures = typeof ventasTableFeatures;

const columnHelper = createColumnHelper<VentasTableFeatures, VentaTableRow>();

interface VentasColumnsActions {
  onView: (row: VentaTableRow) => void;
  onEdit: (row: VentaTableRow) => void;
}

/** Encabezado ordenable, con la alineacion de la columna. */
function SortableHeader({
  label,
  align,
  onClick,
}: {
  label: string;
  align: "start" | "center" | "end";
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        "flex w-full",
        align === "center" && "justify-center",
        align === "end" && "justify-end"
      )}
    >
      <Button variant="ghost" onClick={onClick}>
        {label}
        <ArrowUpDown />
      </Button>
    </div>
  );
}

export function getVentasColumns({ onView, onEdit }: VentasColumnsActions) {
  return columnHelper.columns([
    columnHelper.accessor("issueDate", {
      header: ({ column }) => (
        <SortableHeader
          label="F. emisión"
          align="center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <div className="text-center">{row.original.issueDateLabel}</div>
      ),
    }),
    columnHelper.accessor("voucherTypeLabel", {
      id: "voucherType",
      header: ({ column }) => (
        <SortableHeader
          label="T. comprobante"
          align="center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ getValue }) => <div className="text-center">{getValue()}</div>,
    }),
    columnHelper.accessor("voucherNumber", {
      header: ({ column }) => (
        <SortableHeader
          label="Nro comprobante"
          align="center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ getValue }) => <div className="text-center">{getValue()}</div>,
    }),
    columnHelper.accessor("entityName", {
      id: "entity",
      header: ({ column }) => (
        <SortableHeader
          label="Cliente"
          align="start"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ getValue }) => <div className="text-left">{getValue()}</div>,
    }),
    columnHelper.accessor("total", {
      header: ({ column }) => (
        <SortableHeader
          label="Total"
          align="end"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <div className="text-right tabular-nums">
          {row.original.totalLabel}
        </div>
      ),
    }),
    columnHelper.accessor("statusLabel", {
      id: "status",
      header: ({ column }) => (
        <SortableHeader
          label="Estado pago"
          align="center"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        />
      ),
      cell: ({ row }) => (
        <div className="flex justify-center">
          <VoucherStatusBadge status={row.original.status} />
        </div>
      ),
    }),
    columnHelper.display({
      id: "actions",
      header: () => <span className="sr-only">Acciones</span>,
      cell: ({ row }) => {
        const venta = row.original;

        return (
          <TooltipProvider>
            <div className="flex items-center justify-end gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onView(venta)}
                    />
                  }
                >
                  <Eye />
                  <span className="sr-only">Ver</span>
                </TooltipTrigger>
                <TooltipContent>Ver</TooltipContent>
              </Tooltip>
              {canRegisterPayment(venta.status) ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={paymentEntryHref(venta)}
                        className={buttonVariants({
                          variant: "ghost",
                          size: "icon-sm",
                        })}
                      />
                    }
                  >
                    <Wallet />
                    <span className="sr-only">Registrar pago</span>
                  </TooltipTrigger>
                  <TooltipContent>Registrar pago</TooltipContent>
                </Tooltip>
              ) : null}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onEdit(venta)}
                    />
                  }
                >
                  <Pencil />
                  <span className="sr-only">Editar</span>
                </TooltipTrigger>
                <TooltipContent>Editar</TooltipContent>
              </Tooltip>
            </div>
          </TooltipProvider>
        );
      },
    }),
  ]);
}
