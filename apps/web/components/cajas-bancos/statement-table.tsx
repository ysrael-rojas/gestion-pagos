"use client";

// Tabla de movimientos del periodo: recibos y transferencias con su estado de conciliacion
// (C6 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/statement-table.tsx` del origen (408 lineas). La composicion de
// las filas —recibos + transferencias, con la direccion de la transferencia resuelta segun la
// cuenta que se mira— vive en `lib/cajas-bancos/statement.ts`, porque es pura y ahi si se puede
// probar con `node --test` (el runner de los helpers web no compila JSX). Este archivo se queda con
// lo que es UI: columnas, seleccion multiple de recibos en revision y paginacion.
//
// QUE NO SE PORTA Y POR QUE (lo decide quien monta el componente, no este archivo): las dos acciones
// del origen son props OPCIONALES que hoy nadie pasa.
//
//   `onMarkVerified`     marca recibos EN_REVISION como verificados (`POST /payments/process`).
//                        Es el paso de conciliacion bancaria, que es C7 y no tiene pantalla aca.
//   `onRegisterBankCharge`  abre el modal de cargo bancario (`bank-charge-modal.tsx`), que tampoco
//                        forma parte de este slice.
//
// Sin esas props el comportamiento es el del origen cuando el consumidor no las pasaba: la barra de
// acciones no se dibuja y la columna de acciones queda vacia. No hay stub ni boton deshabilitado:
// el modal de cargo bancario simplemente no existe en este repo todavia.
//
// DESVIO DELIBERADO: la cabecera ordenable del origen usaba `DataTableColumnHeader`
// (`components/shared/data-table-column-header`), que no esta portado. Aca se usa el mismo boton
// `ghost` + `ArrowUpDown` del resto del port (tabla de cuentas, historial de cierres, reporte de
// cuadre), para que no haya dos cabeceras distintas en la app.
import { useMemo, useState } from "react";
import {
  createColumnHelper,
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { ReceiptStatusBadge } from "@/components/pagos/receipt-status-badge";
import { buildStatementRows, type StatementRow } from "@/lib/cajas-bancos/statement";
import { formatCurrency, formatDate } from "@gestion/shared";

export type { StatementRow };
export { buildStatementRows };

const statementTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

const statementRowColumnHelper = createColumnHelper<
  typeof statementTableFeatures,
  StatementRow
>();

const DEFAULT_PAGE_SIZE = 10;

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

/** Cabecera ordenable con el boton del port (no hay `DataTableColumnHeader` aca). */
function SortableHeader({
  title,
  column,
  align = "left",
}: {
  title: string;
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: (desc?: boolean) => void;
  };
  align?: "left" | "right";
}) {
  const button = (
    <Button
      variant="ghost"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      {title}
      <ArrowUpDown />
    </Button>
  );

  return align === "right" ? <div className="text-right">{button}</div> : button;
}

interface StatementTableProps {
  rows: StatementRow[];
  currency: string;
  /** Marca los recibos indicados como verificados (`EN_REVISION` → `PROCESADO`). */
  onMarkVerified?: (paymentIds: string[]) => Promise<void> | void;
  /** Abre el registro de un cargo bancario (ITF, comisión, detracción). */
  onRegisterBankCharge?: () => void;
}

/**
 * Movimientos del período con su estado de conciliación. Los recibos en
 * revisión se pueden marcar como verificados (uno por uno o en bloque).
 */
export function StatementTable({
  rows,
  currency,
  onMarkVerified,
  onRegisterBankCharge,
}: StatementTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Solo los recibos en revision pueden marcarse como verificados: una transferencia no es un
  // recibo y un pago ya procesado no se vuelve a procesar.
  const markableIds = useMemo(
    () =>
      rows
        .filter((row) => row.kind === "PAYMENT" && row.status === "EN_REVISION")
        .map((row) => row.id),
    [rows],
  );
  const selectedIds = useMemo(
    () => selected.filter((id) => markableIds.includes(id)),
    [selected, markableIds],
  );
  const allSelected =
    markableIds.length > 0 && selectedIds.length === markableIds.length;

  async function mark(ids: string[]) {
    if (!onMarkVerified || ids.length === 0) {
      return;
    }

    setIsSaving(true);
    try {
      await onMarkVerified(ids);
      setSelected([]);
      setIsConfirming(false);
    } finally {
      setIsSaving(false);
    }
  }

  function toggleRow(id: string, checked: boolean) {
    setSelected((current) =>
      checked ? [...current, id] : current.filter((item) => item !== id),
    );
  }

  const columns = useMemo(
    () =>
      statementRowColumnHelper.columns([
        statementRowColumnHelper.display({
          id: "select",
          header: () =>
            onMarkVerified && markableIds.length > 0 ? (
              <Checkbox
                aria-label="Seleccionar todos los recibos en revisión"
                checked={allSelected}
                onCheckedChange={(checked) =>
                  setSelected(checked === true ? markableIds : [])
                }
              />
            ) : null,
          cell: ({ row }) =>
            onMarkVerified &&
            row.original.kind === "PAYMENT" &&
            row.original.status === "EN_REVISION" ? (
              <Checkbox
                aria-label={`Seleccionar recibo ${row.original.ref}`}
                checked={selectedIds.includes(row.original.id)}
                onCheckedChange={(checked) =>
                  toggleRow(row.original.id, checked === true)
                }
              />
            ) : null,
        }),
        statementRowColumnHelper.accessor("kind", {
          header: () => <span className="sr-only">Tipo</span>,
          cell: ({ getValue }) =>
            getValue() === "TRANSFER" ? (
              <Badge variant="outline">Transferencia</Badge>
            ) : (
              <Badge variant="secondary">Recibo</Badge>
            ),
        }),
        statementRowColumnHelper.accessor("date", {
          header: ({ column }) => <SortableHeader title="Fecha" column={column} />,
          cell: ({ getValue }) => formatDate(getValue()),
        }),
        statementRowColumnHelper.accessor("ref", {
          header: ({ column }) => <SortableHeader title="Recibo" column={column} />,
          cell: ({ getValue }) => getValue(),
        }),
        statementRowColumnHelper.accessor("direction", {
          header: ({ column }) => (
            <SortableHeader title="Dirección" column={column} />
          ),
          cell: ({ getValue }) => (getValue() === "INGRESO" ? "Ingreso" : "Egreso"),
        }),
        statementRowColumnHelper.accessor("category", {
          header: ({ column }) => (
            <SortableHeader title="Categoría" column={column} />
          ),
          cell: ({ getValue }) => getValue(),
        }),
        statementRowColumnHelper.accessor("method", {
          header: ({ column }) => <SortableHeader title="Método" column={column} />,
          cell: ({ getValue }) => getValue(),
        }),
        statementRowColumnHelper.accessor("amount", {
          header: ({ column }) => (
            <SortableHeader title="Importe" column={column} align="right" />
          ),
          cell: ({ getValue }) => (
            <div className="text-right">{formatAmount(getValue(), currency)}</div>
          ),
        }),
        statementRowColumnHelper.accessor("status", {
          header: ({ column }) => <SortableHeader title="Estado" column={column} />,
          cell: ({ getValue }) => {
            const status = getValue();
            return status ? (
              <ReceiptStatusBadge status={status} />
            ) : (
              <span className="text-muted-foreground">—</span>
            );
          },
        }),
        statementRowColumnHelper.display({
          id: "actions",
          header: () => <div className="text-right">Acciones</div>,
          cell: ({ row }) =>
            onMarkVerified &&
            row.original.kind === "PAYMENT" &&
            row.original.status === "EN_REVISION" ? (
              <div className="text-right">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => void mark([row.original.id])}
                >
                  Marcar verificado
                </Button>
              </div>
            ) : null,
        }),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currency, onMarkVerified, markableIds, selectedIds, allSelected, isSaving],
  );

  const table = useTable({
    features: statementTableFeatures,
    data: rows,
    columns,
    onSortingChange: setSorting,
    state: { sorting },
    initialState: {
      pagination: {
        pageIndex: 0,
        pageSize: DEFAULT_PAGE_SIZE,
      },
    },
  });

  return (
    <div className="flex flex-col gap-4">
      {onRegisterBankCharge || markableIds.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          {onRegisterBankCharge ? (
            <Button size="sm" variant="outline" onClick={onRegisterBankCharge}>
              Registrar cargo bancario
            </Button>
          ) : null}

          {markableIds.length > 0 ? (
            isConfirming ? (
              <>
                <span className="font-medium">
                  ¿Marcar {selectedIds.length} recibo(s) como verificados? La
                  validación no cambia el saldo.
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isSaving}
                    onClick={() => setIsConfirming(false)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    size="sm"
                    disabled={isSaving}
                    onClick={() => void mark(selectedIds)}
                  >
                    {isSaving ? "Marcando…" : "Confirmar"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={selectedIds.length === 0}
                  onClick={() => setIsConfirming(true)}
                >
                  Marcar verificados ({selectedIds.length})
                </Button>
                <span className="text-muted-foreground">
                  Selecciona los recibos en revisión que ya cuadran con el
                  extracto del banco.
                </span>
              </>
            )
          ) : null}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-md border bg-background">
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
            {table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="text-center text-sm text-muted-foreground"
                >
                  Sin movimientos en el período.
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getAllCells().map((cell) => (
                    <TableCell key={cell.id}>
                      <table.FlexRender cell={cell} />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <DataTablePagination table={table} />
    </div>
  );
}
