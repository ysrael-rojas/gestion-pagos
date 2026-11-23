"use client";

// Reporte del cuadre de un cierre: resumen, arqueo por denominacion, resumen por categoria y los
// movimientos del periodo (C5 del vertical de cajas-bancos, SPEC 49 y SPEC 51).
//
// Port de `components/cajas-bancos/cuadre-report.tsx` del origen (573 lineas). Se conservan el
// resumen con sus etiquetas, la tabla del arqueo con A/B/A−B, el resumen por categoria (sin
// anulados, que si aparecen en Movimientos), la exportacion a CSV y los dos botones "Exportar CSV"
// e "Imprimir acta"; el acta es `cuadre-acta.tsx`, que llama `window.print()`.
//
// QUE SE PORTA EN C6 Y QUE NO:
//
//   - SI: las TRANSFERENCIAS del periodo. La tabla de movimientos pasa a ser el `StatementTable`
//     portado (`statement-table.tsx`) alimentado por `buildStatementRows(statement, transfers,
//     accountId)`: los recibos del periodo MAS las transferencias en las que la cuenta participo,
//     con la direccion resuelta segun sea origen o destino. Los totales `transferInTotal` /
//     `transferOutTotal` del acta siguen viniendo del cierre, que los sumo la RPC al cerrar.
//   - NO: las acciones sobre los recibos del periodo ("Marcar verificado" en bloque y "Registrar
//     cargo bancario"). La primera es el paso de conciliacion (C7) y la segunda depende de
//     `bank-charge-modal.tsx`, que no existe en este repo. El `StatementTable` las acepta como
//     props opcionales y esta pantalla no las pasa: sin ellas la barra de acciones no se dibuja y
//     la columna de acciones queda vacia, igual que el origen cuando el consumidor no las ofrecia.
//
// DESVIO DELIBERADO: la cuenta de la tabla de movimientos sale de `close.cashAccountId` y no de una
// prop `accountId` como en el origen. Es el mismo dato —el cierre pertenece a esa cuenta— y evita
// una prop que el consumidor tendria que pasar copiando lo que ya esta en `close`.
//
// S2 — Nada de este archivo calcula plata del cierre: `openingBalance`, `incomeTotal`,
// `expenseTotal`, `expectedBalance`, `difference`, `changeFund` y la tolerancia vienen del cierre.
// Solo se suman las denominaciones (denominacion x cantidad) y los totales por categoria de los
// recibos, que es presentacion de lo que ya esta en cada fila.
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
import { ArrowUpDown, Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DataTablePagination } from "@/components/shared/data-table-pagination";
import { CuadreActa } from "@/components/cajas-bancos/cuadre-acta";
import { StatementTable } from "@/components/cajas-bancos/statement-table";
import { buildStatementRows } from "@/lib/cajas-bancos/statement";
import type { CashTransfer } from "@/lib/cajas-bancos/transferencias";
import { downloadCsv, toCsv } from "@/lib/cajas-bancos/csv";
import {
  formatReceiptRanges,
  summarizeReceiptSequence,
} from "@/lib/cajas-bancos/reportes";
import { formatCurrency, formatDate } from "@gestion/shared";
import { PAYMENT_STATUSES } from "@gestion/shared/lib/data/payment-options.ts";
import { getOptionLabel } from "@gestion/shared/lib/data/sale-options.ts";
import {
  denominationKind,
  formatDenomination,
  netCash,
  sumDenominationCounts,
} from "@gestion/shared/lib/caja/denominaciones.ts";
import type { CashAccountType } from "@gestion/shared";
import type {
  CashCloseRecord,
  CloseDenomination,
  Payment,
} from "@/lib/api/client";

interface CuadreReportProps {
  close: CashCloseRecord;
  /** Recibos del periodo del cierre (`listAccountStatement`). */
  statement: Payment[];
  /** Transferencias del periodo en las que la cuenta participo (`listAccountTransfers`). */
  transfers: CashTransfer[];
  accountName: string;
  currency: string;
  /** Tipo de cuenta: define la etiqueta del conteo (caja vs. banco). */
  accountType: CashAccountType;
  /** Detalle del conteo por denominación (vacío en bancos y cierres previos). */
  denominations: CloseDenomination[];
  /** Fondo de cambio de la cuenta al momento de ver el reporte. */
  changeFund: number;
}

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

interface CategoryTotal {
  direction: "INGRESO" | "EGRESO";
  category: string;
  total: number;
}

function groupByCategory(statement: Payment[]): CategoryTotal[] {
  const map = new Map<string, CategoryTotal>();

  for (const payment of statement) {
    // Los recibos anulados no suman en el resumen: así cuadra con los totales
    // de Ingresos y Egresos. Su rastro sigue en Movimientos con su estado.
    if (payment.status === "ANULADO") {
      continue;
    }
    const key = `${payment.direction}|${payment.categoryName}`;
    const current = map.get(key);
    if (current) {
      current.total += payment.amount;
    } else {
      map.set(key, {
        direction: payment.direction,
        category: payment.categoryName || "Sin categoría",
        total: payment.amount,
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.direction !== b.direction) {
      return a.direction === "INGRESO" ? -1 : 1;
    }
    return b.total - a.total;
  });
}

const reportTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

const DEFAULT_PAGE_SIZE = 10;

const categoryColumnHelper = createColumnHelper<
  typeof reportTableFeatures,
  CategoryTotal
>();

interface CategoryTotalsTableProps {
  categories: CategoryTotal[];
  currency: string;
}

function CategoryTotalsTable({
  categories,
  currency,
}: CategoryTotalsTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const columns = useMemo(
    () =>
      categoryColumnHelper.columns([
        categoryColumnHelper.accessor("direction", {
          header: () => <span>Dirección</span>,
          cell: ({ getValue }) =>
            getValue() === "INGRESO" ? "Ingreso" : "Egreso",
        }),
        categoryColumnHelper.accessor("category", {
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Categoría
              <ArrowUpDown />
            </Button>
          ),
          cell: ({ getValue }) => getValue(),
        }),
        categoryColumnHelper.accessor("total", {
          header: ({ column }) => (
            <div className="text-right">
              <Button
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Total
                <ArrowUpDown />
              </Button>
            </div>
          ),
          cell: ({ getValue }) => (
            <div className="text-right">
              {formatAmount(getValue(), currency)}
            </div>
          ),
        }),
      ]),
    [currency],
  );

  const table = useTable({
    features: reportTableFeatures,
    data: categories,
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

function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? "font-medium" : "text-muted-foreground"}>
        {label}
      </span>
      <span className={strong ? "font-semibold" : ""}>{value}</span>
    </div>
  );
}

interface DenominationTotals {
  counted: number;
  changeFund: number;
  net: number;
}

/** Tabla del arqueo: conteo por denominación y cierre del acta (A, B, A−B). */
function DenominationTable({
  denominations,
  totals,
  currency,
}: {
  denominations: CloseDenomination[];
  totals: DenominationTotals;
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-md border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Denominación</TableHead>
              <TableHead className="text-right">Cantidad</TableHead>
              <TableHead className="text-right">Subtotal</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {denominations.map((row) => (
              <TableRow key={row.denomination}>
                <TableCell>
                  <span className="text-muted-foreground">
                    {denominationKind(row.denomination)}
                  </span>{" "}
                  {formatDenomination(row.denomination)}
                </TableCell>
                <TableCell className="text-right">{row.quantity}</TableCell>
                <TableCell className="text-right">
                  {formatAmount(row.denomination * row.quantity, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-1 rounded-md border bg-background p-4">
        <SummaryRow
          label="Total valores en caja (A)"
          value={formatAmount(totals.counted, currency)}
          strong
        />
        <SummaryRow
          label="Menos fondo de cambio (B)"
          value={formatAmount(totals.changeFund, currency)}
        />
        <SummaryRow
          label="Efectivo neto (A − B)"
          value={formatAmount(totals.net, currency)}
          strong
        />
      </div>
    </div>
  );
}

export function CuadreReport({
  close,
  statement,
  transfers,
  accountName,
  currency,
  accountType,
  denominations,
  changeFund,
}: CuadreReportProps) {
  const [printOpen, setPrintOpen] = useState(false);
  const isBank = accountType === "BANK_ACCOUNT";
  const countedLabel = isBank ? "Saldo según extracto" : "Conteo físico";
  // El cierre congela el fondo de cambio; los cierres históricos sin snapshot
  // caen al valor actual de la cuenta.
  const effectiveChangeFund = close.changeFund ?? changeFund;
  const categories = groupByCategory(statement);
  // Los recibos y las transferencias del periodo en una sola lista ordenada por fecha. La cuenta
  // sale del cierre: es la cuenta cuyos movimientos se estan reportando.
  const statementRows = buildStatementRows(statement, transfers, close.cashAccountId);
  // El detalle manda cuando existe: A = suma del conteo. Si el cierre es previo
  // al arqueo por denominación, se usa el conteo total guardado.
  const countedTotal =
    denominations.length > 0
      ? sumDenominationCounts(denominations)
      : (close.countedBalance ?? 0);
  const totals: DenominationTotals = {
    counted: countedTotal,
    changeFund: effectiveChangeFund,
    net: netCash(countedTotal, effectiveChangeFund),
  };
  const hasArqueo = denominations.length > 0 || effectiveChangeFund > 0;
  const differenceResult =
    close.difference === null
      ? null
      : close.difference === 0
        ? "Cuadrado"
        : close.difference < 0
          ? "Faltante"
          : "Sobrante";
  // Secuencia de recibos del período (SPEC 49): primer/último por prefijo y
  // anulados, como pide el formato de arqueo.
  const receiptSequence = summarizeReceiptSequence(statement);
  const receiptRangesLabel = formatReceiptRanges(receiptSequence);

  function handleExport() {
    const rows: (string | number | null)[][] = [
      ["Cuadre de caja"],
      ["Cuenta", accountName],
      ["Periodo", `${close.periodStart} a ${close.periodEnd}`],
      ["Periodicidad", close.periodicity],
      [],
      ["Saldo inicial", close.openingBalance],
      ["Ingresos", close.incomeTotal],
      ["Egresos", close.expenseTotal],
      ["Recibos del período", receiptRangesLabel],
      ["Recibos anulados", receiptSequence.annulled],
      ["Saldo esperado", close.expectedBalance],
      [countedLabel, close.countedBalance ?? ""],
      ["Diferencia", close.difference ?? ""],
      ["Resultado del arqueo", differenceResult ?? ""],
      ["Tolerancia permitida", close.differenceTolerance ?? ""],
      ["Motivo de la diferencia", close.differenceReason ?? ""],
      [],
      ...(hasArqueo
        ? ([
            ["Arqueo por denominación"],
            ["Denominación", "Cantidad", "Subtotal"],
            ...denominations.map((row) => [
              formatDenomination(row.denomination),
              row.quantity,
              row.denomination * row.quantity,
            ]),
            ["Total valores en caja (A)", "", totals.counted],
            ["Menos fondo de cambio (B)", "", totals.changeFund],
            ["Efectivo neto (A − B)", "", totals.net],
            [],
          ] as (string | number | null)[][])
        : []),
      ["Resumen por categoría"],
      ["Dirección", "Categoría", "Total"],
      ...categories.map((item) => [item.direction, item.category, item.total]),
      [],
      ["Movimientos"],
      [
        "Fecha",
        "Tipo",
        "Recibo",
        "Dirección",
        "Categoría",
        "Método",
        "Importe",
        "Estado",
      ],
      ...statementRows.map((row) => [
        row.date,
        row.kind === "TRANSFER" ? "Transferencia" : "Recibo",
        row.ref,
        row.direction,
        row.category,
        row.method,
        row.amount,
        // Las transferencias no son recibos: no tienen estado de conciliación.
        row.status ? getOptionLabel(PAYMENT_STATUSES, row.status) : "—",
      ]),
    ];

    downloadCsv(`cuadre-${accountName}-${close.periodEnd}.csv`, toCsv(rows));
  }

  return (
    <Card className="bg-muted/30 ring-0">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>
          Cuadre {formatDate(close.periodStart)} — {formatDate(close.periodEnd)}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download />
            Exportar CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPrintOpen(true)}
          >
            <Printer />
            Imprimir acta
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="flex flex-col gap-1 rounded-md border bg-background p-4">
          <SummaryRow
            label="Saldo inicial"
            value={formatAmount(close.openingBalance, currency)}
          />
          <SummaryRow
            label="Ingresos"
            value={formatAmount(close.incomeTotal, currency)}
          />
          <SummaryRow
            label="Egresos"
            value={formatAmount(close.expenseTotal, currency)}
          />
          <SummaryRow
            label="Recibos del período"
            value={receiptRangesLabel}
          />
          <SummaryRow
            label="Recibos anulados"
            value={String(receiptSequence.annulled)}
          />
          <SummaryRow
            label="Saldo esperado"
            value={formatAmount(close.expectedBalance, currency)}
            strong
          />
          {close.countedBalance !== null ? (
            <>
              <SummaryRow
                label={countedLabel}
                value={formatAmount(close.countedBalance, currency)}
              />
              <SummaryRow
                label="Diferencia (sobrante/faltante)"
                value={formatAmount(close.difference ?? 0, currency)}
                strong
              />
              {differenceResult ? (
                <SummaryRow
                  label="Resultado del arqueo"
                  value={differenceResult}
                />
              ) : null}
              {close.differenceTolerance !== null ? (
                <SummaryRow
                  label="Tolerancia permitida"
                  value={formatAmount(close.differenceTolerance, currency)}
                />
              ) : null}
              {close.differenceReason ? (
                <SummaryRow
                  label="Motivo de la diferencia"
                  value={close.differenceReason}
                />
              ) : null}
            </>
          ) : null}
          <SummaryRow label="Contado por" value={close.countedBy || "—"} />
          <SummaryRow label="Revisado por" value={close.verifiedBy || "—"} />
          {close.penUsdRate !== null ? (
            <SummaryRow
              label="Tipo de cambio usado"
              value={String(close.penUsdRate)}
            />
          ) : null}
          {close.notes ? <SummaryRow label="Notas" value={close.notes} /> : null}
        </div>

        {hasArqueo ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Arqueo por denominación</h3>
            <DenominationTable
              denominations={denominations}
              totals={totals}
              currency={currency}
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Resumen por categoría</h3>
          <CategoryTotalsTable categories={categories} currency={currency} />
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Movimientos</h3>
          {/* Sin `onMarkVerified` ni `onRegisterBankCharge`: son acciones de C7/conciliacion. */}
          <StatementTable rows={statementRows} currency={currency} />
        </div>
      </CardContent>

      <CuadreActa
        close={close}
        accountName={accountName}
        accountType={accountType}
        currency={currency === "USD" ? "USD" : "PEN"}
        denominations={denominations}
        statement={statement}
        open={printOpen}
        onClose={() => setPrintOpen(false)}
      />
    </Card>
  );
}
