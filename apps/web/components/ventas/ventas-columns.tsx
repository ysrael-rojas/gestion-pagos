"use client";

// Columnas del listado de comprobantes (port de `components/ventas/sales-columns.tsx` del origen,
// 231 lineas). Es una fabrica de columnas, no un componente: la tabla le pasa los handlers de fila y
// memoiza el resultado, igual que `clients-columns.tsx` y `payments-columns.tsx`.
//
// S10 fija las seis columnas y las acciones, para ventas Y para compras:
//   F. emisión · T. comprobante · Nro comprobante · Cliente/Proveedor · Total · Estado pago
//   Ver, Editar, y `Registrar pago` SOLO cuando el comprobante esta pendiente.
// El vertical entra por `voucherKind` (S10 del doc de compras): lo unico que cambia es el encabezado
// de la entidad (`Cliente` / `Proveedor`) y a que alta de recibos lleva `Registrar pago` (ingresos /
// egresos). El resto son las mismas columnas sobre la misma fila.
//
// Diferencias con el origen:
//   * Los textos de las celdas ya vienen resueltos en `VoucherTableRow` (`lib/ventas/tabla.ts`), asi
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
import type { VoucherKind } from "@/lib/ventas/types";
import {
  canRegisterPayment,
  paymentEntryHref,
  voucherListCopy,
  type VoucherTableRow,
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

const columnHelper = createColumnHelper<VentasTableFeatures, VoucherTableRow>();

interface VentasColumnsActions {
  /** Vertical de la tabla: decide el encabezado de la entidad y el destino de `Registrar pago`. */
  voucherKind: VoucherKind;
  onView: (row: VoucherTableRow) => void;
  onEdit: (row: VoucherTableRow) => void;
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

export function getVentasColumns({
  voucherKind,
  onView,
  onEdit,
}: VentasColumnsActions) {
  const copy = voucherListCopy(voucherKind);

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
          label={copy.entityColumn}
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
        const voucher = row.original;

        return (
          <TooltipProvider>
            <div className="flex items-center justify-end gap-1">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onView(voucher)}
                    />
                  }
                >
                  <Eye />
                  <span className="sr-only">Ver</span>
                </TooltipTrigger>
                <TooltipContent>Ver</TooltipContent>
              </Tooltip>
              {canRegisterPayment(voucher.status) ? (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Link
                        href={paymentEntryHref(voucher, voucherKind)}
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
                      onClick={() => onEdit(voucher)}
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
