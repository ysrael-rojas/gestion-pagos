"use client";

// Detalle de cuentas con su saldo a hoy (C5 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/cuentas-view.tsx` del origen (615 lineas). Es el "listado con
// saldos" del vertical: cuatro tarjetas de totales (consolidado, cuentas registradas, cajas,
// bancos) y la tabla de cada cuenta con su saldo, su porcentaje del total, su equivalente en soles
// y la fecha de su ultimo movimiento.
//
// S2 — LOS SALDOS VIENEN DE LA BASE. `listCashPositionsConsolidated` es transporte de
// `GET /cash-positions`: la base devuelve `balance` ya calculado
// (`opening_balance + ingresos − egresos ± transferencias`, sin anulados). Este archivo solo suma
// esos saldos para mostrarlos juntos, y convierte a soles con el TC configurado (SPEC 52).
//
// QUE NO SE PORTA (C6): la columna de acciones con "Movimiento" y "Vales", y el boton "Transferir".
// En el origen abrian `CashMovementModal`, `CashTransferModal` y `PettyCashPanel`, tres pantallas de
// transferencias y caja chica cuya API (`POST /cash-transfers`, vales de caja chica) todavia no
// esta expuesta. Ofrecer los botones sin esas escrituras daria un 404 disfrazado de accion.
//
// DESVIO DELIBERADO (lo impone el API): el origen recibia `CashAccountPosition` con la fila de la
// cuenta ANIDADA (`position.account.name`) y leia de ahi la periodicidad, el banco y la moneda.
// `GET /cash-positions` devuelve la fila PLANA (`name`, `type`, `bankName`, `closingPeriodicity`),
// asi que la lectura cambia de forma pero no de datos: la base ya resolvio el join.
import { useEffect, useMemo, useState } from "react";
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
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { formatCurrency, formatDate, getTodayLocalDate } from "@gestion/shared";
import { getPeriodicityLabel } from "@gestion/shared/lib/data/cash-options.ts";
import { useCajasBancos } from "@/components/cajas-bancos/cajas-bancos-provider";
import {
  listCashPositionsConsolidated,
  listLastMovementDates,
  type CashAccountPosition,
} from "@/lib/cajas-bancos/caja";
import { toPen } from "@/lib/cajas-bancos/dashboard";

const SKELETON_ROWS = 4;
const DEFAULT_PAGE_SIZE = 10;

const cuentasTableFeatures = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
});

interface AccountPositionRow {
  id: string;
  isBank: boolean;
  isPettyCash: boolean;
  name: string;
  bankName: string;
  currency: string;
  closing: string;
  balance: number;
  sharePercent: number;
  equivalentPen: number;
  lastMovementDate: string | null;
  balanceLabel: string;
}

type AccountFilterValue = "ALL" | "CASH_BOX" | "BANK_ACCOUNT";

const ACCOUNT_FILTER_ITEMS: { value: AccountFilterValue; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "CASH_BOX", label: "Caja" },
  { value: "BANK_ACCOUNT", label: "Banco" },
];

const cuentasColumnHelper = createColumnHelper<
  typeof cuentasTableFeatures,
  AccountPositionRow
>();

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

export function CuentasView() {
  // El tipo de cambio sale de los ajustes, que el provider ya leyo (`GET /settings`).
  const { penUsdRate } = useCajasBancos();
  const today = getTodayLocalDate();
  const [positions, setPositions] = useState<CashAccountPosition[]>([]);
  const [lastMovements, setLastMovements] = useState<
    Record<string, string | null>
  >({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [movementsError, setMovementsError] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState<AccountFilterValue>("ALL");

  useEffect(() => {
    let isMounted = true;

    void (async () => {
      setIsLoading(true);

      // Los saldos son obligatorios; el último movimiento es opcional: si falla,
      // la tabla de cuentas se muestra igual (SPEC 55). El TC ya no se pide acá:
      // lo trae el provider junto con el resto de los ajustes.
      const [positionsResult, movementsResult] = await Promise.allSettled([
        listCashPositionsConsolidated(today),
        listLastMovementDates(),
      ]);

      if (!isMounted) {
        return;
      }

      if (positionsResult.status === "rejected") {
        const reason = positionsResult.reason;

        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudieron cargar las cuentas.",
        );
        setMovementsError(false);
        setIsLoading(false);
        return;
      }

      setPositions(positionsResult.value);
      setLastMovements(
        movementsResult.status === "fulfilled" ? movementsResult.value : {},
      );
      setMovementsError(movementsResult.status === "rejected");
      setError(null);
      setIsLoading(false);
    })();

    return () => {
      isMounted = false;
    };
  }, [today]);

  const hasForeignCurrency = positions.some(
    (position) => position.currency !== "PEN",
  );

  const consolidated = positions.reduce(
    (total, position) => total + toPen(position.balance, position.currency, penUsdRate),
    0,
  );

  const cashTotal = positions.reduce(
    (total, position) =>
      position.type === "CASH_BOX"
        ? total + toPen(position.balance, position.currency, penUsdRate)
        : total,
    0,
  );

  const bankTotal = positions.reduce(
    (total, position) =>
      position.type === "BANK_ACCOUNT"
        ? total + toPen(position.balance, position.currency, penUsdRate)
        : total,
    0,
  );

  const rows = useMemo<AccountPositionRow[]>(
    () =>
      positions.map((position) => {
        const equivalentPen = toPen(
          position.balance,
          position.currency,
          penUsdRate,
        );
        return {
          id: position.accountId,
          isBank: position.type === "BANK_ACCOUNT",
          isPettyCash: position.isPettyCash,
          name: position.name,
          bankName: position.bankName ?? "—",
          currency: position.currency,
          closing: position.closingPeriodicity
            ? getPeriodicityLabel(position.closingPeriodicity)
            : "Predeterminado",
          balance: position.balance,
          sharePercent:
            consolidated > 0 ? (equivalentPen / consolidated) * 100 : 0,
          equivalentPen,
          lastMovementDate: lastMovements[position.accountId] ?? null,
          balanceLabel: formatAmount(position.balance, position.currency),
        };
      }),
    [positions, penUsdRate, consolidated, lastMovements],
  );

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesType =
        filterType === "ALL" ||
        (filterType === "CASH_BOX" && !row.isBank) ||
        (filterType === "BANK_ACCOUNT" && row.isBank);

      if (!matchesType) {
        return false;
      }
      if (!term) {
        return true;
      }

      return (
        row.name.toLowerCase().includes(term) ||
        row.bankName.toLowerCase().includes(term)
      );
    });
  }, [rows, search, filterType]);

  const columns = useMemo(
    () =>
      cuentasColumnHelper.columns([
        cuentasColumnHelper.accessor("isBank", {
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Tipo
              <ArrowUpDown />
            </Button>
          ),
          cell: ({ getValue }) =>
            getValue() ? (
              <Badge variant="default">Banco</Badge>
            ) : (
              <Badge variant="secondary">Caja</Badge>
            ),
        }),
        cuentasColumnHelper.accessor("name", {
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Nombre
              <ArrowUpDown />
            </Button>
          ),
          cell: ({ getValue }) => (
            <span className="font-medium">{getValue()}</span>
          ),
        }),
        cuentasColumnHelper.accessor("bankName", {
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Banco
              <ArrowUpDown />
            </Button>
          ),
          cell: ({ getValue }) => getValue(),
        }),
        cuentasColumnHelper.accessor("currency", {
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
        cuentasColumnHelper.accessor("closing", {
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Cierre
              <ArrowUpDown />
            </Button>
          ),
          cell: ({ getValue }) => getValue(),
        }),
        cuentasColumnHelper.accessor("balance", {
          id: "balance",
          header: ({ column }) => (
            <div className="text-right">
              <Button
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Saldo a hoy
                <ArrowUpDown />
              </Button>
            </div>
          ),
          cell: ({ row }) => (
            <div className="text-right font-medium">
              {row.original.balanceLabel}
            </div>
          ),
        }),
        cuentasColumnHelper.accessor("sharePercent", {
          header: ({ column }) => (
            <div className="text-right">
              <Button
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                % del total
                <ArrowUpDown />
              </Button>
            </div>
          ),
          cell: ({ getValue }) => (
            <div className="text-right">{getValue().toFixed(1)}%</div>
          ),
        }),
        cuentasColumnHelper.accessor("equivalentPen", {
          header: ({ column }) => (
            <div className="text-right">
              <Button
                variant="ghost"
                onClick={() =>
                  column.toggleSorting(column.getIsSorted() === "asc")
                }
              >
                Equivalente PEN
                <ArrowUpDown />
              </Button>
            </div>
          ),
          cell: ({ getValue }) => (
            <div className="text-right">{formatCurrency(getValue())}</div>
          ),
        }),
        cuentasColumnHelper.accessor("lastMovementDate", {
          header: ({ column }) => (
            <Button
              variant="ghost"
              onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            >
              Último movimiento
              <ArrowUpDown />
            </Button>
          ),
          cell: ({ getValue }) => {
            const value = getValue();
            return value ? formatDate(value) : "—";
          },
        }),
      ]),
    [],
  );

  const table = useTable({
    features: cuentasTableFeatures,
    data: filteredRows,
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

  const hasFilters = search.trim() !== "" || filterType !== "ALL";

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-muted/30 ring-0">
          <CardHeader>
            <CardTitle className="text-sm">Total consolidado (PEN)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatCurrency(consolidated)}
            {hasForeignCurrency && penUsdRate === null ? (
              <p className="mt-1 text-xs font-normal text-destructive">
                Falta el tipo de cambio PEN/USD en Configuración: las cuentas
                en otra moneda no se suman al total.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-muted/30 ring-0">
          <CardHeader>
            <CardTitle className="text-sm">Cuentas registradas</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {positions.length}
          </CardContent>
        </Card>

        <Card className="bg-muted/30 ring-0">
          <CardHeader>
            <CardTitle className="text-sm">Saldo en cajas (PEN)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatCurrency(cashTotal)}
          </CardContent>
        </Card>

        <Card className="bg-muted/30 ring-0">
          <CardHeader>
            <CardTitle className="text-sm">Saldo en bancos (PEN)</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {formatCurrency(bankTotal)}
          </CardContent>
        </Card>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {movementsError ? (
        <p role="status" className="text-sm text-muted-foreground">
          No se pudo cargar el último movimiento. Los saldos y las cuentas
          siguen disponibles.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {/* Línea de controles: búsqueda + filtro de tipo, fuera del datatable. */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Buscar por nombre o banco…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="max-w-sm"
            aria-label="Buscar cuentas"
          />
          <Select
            value={filterType}
            items={ACCOUNT_FILTER_ITEMS}
            onValueChange={(value) => {
              if (value === null) return;
              setFilterType(value);
            }}
          >
            <SelectTrigger aria-label="Filtrar por tipo" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCOUNT_FILTER_ITEMS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

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
                Array.from({ length: SKELETON_ROWS }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    {Array.from({ length: columns.length }).map((_, cell) => (
                      <TableCell key={`skeleton-${index}-${cell}`}>
                        <Skeleton className="h-5 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="text-center text-sm text-muted-foreground"
                  >
                    {hasFilters
                      ? "No se encontraron cuentas con los filtros aplicados."
                      : "No hay cajas ni bancos registrados."}
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
    </main>
  );
}
