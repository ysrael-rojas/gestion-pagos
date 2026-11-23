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
// QUE SE PORTA EN C6: la columna de acciones con "Movimiento" y "Vales", y el boton "Transferir"
// del encabezado. Los tres abren las pantallas de transferencias y caja chica, que ya tienen API
// propia (`POST /cash-transfers`, `POST /petty-cash/*`) y cuyos componentes llegan en este slice.
//
//   Transferir  `CashTransferModal` -> `POST /cash-transfers` (RPC `create_cash_transfer`).
//   Movimiento  `CashMovementModal` -> `POST /payments` con `isCashMovement: true` (S8). Un
//               movimiento de caja NO es una ruta nueva del API.
//   Vales       `PettyCashPanel` (solo cajas chicas) -> vales, reposicion y arqueo por RPC.
//
// DESVIO DELIBERADO: las tres pantallas reciben la fila COMPLETA de la cuenta (`accounts` del
// provider) y no la posicion plana de esta tabla, porque necesitan el fondo de cambio, el custodio,
// el limite por vale y la periodicidad, que `GET /cash-positions` no devuelve. La lista se
// INTERSECTA con las posiciones para no ofrecer una cuenta inactiva: `GET /cash-positions` devuelve
// una fila por cuenta viva Y ACTIVA, y `GET /cash-accounts` no filtra por `is_active`, asi que el
// origen nunca ofrecia una cuenta dada de baja y aca tampoco. Es la misma fila de la misma cuenta:
// el id de la posicion y el de la cuenta coinciden (`accountId`).
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
import {
  formatCurrency,
  formatDate,
  getTodayLocalDate,
  type CashMovementFormValues,
  type CashTransferFormValues,
} from "@gestion/shared";
import { getPeriodicityLabel } from "@gestion/shared/lib/data/cash-options.ts";
import { toast } from "sonner";
import { CashMovementModal } from "@/components/cajas-bancos/cash-movement-modal";
import { CashTransferModal } from "@/components/cajas-bancos/cash-transfer-modal";
import { PettyCashPanel } from "@/components/cajas-bancos/petty-cash-panel";
import { useCajasBancos } from "@/components/cajas-bancos/cajas-bancos-provider";
import { createPayment } from "@/lib/api/client";
import {
  listCashPositionsConsolidated,
  listLastMovementDates,
  type CashAccountPosition,
} from "@/lib/cajas-bancos/caja";
import { toPen } from "@/lib/cajas-bancos/dashboard";
import { cashMovementToPayment } from "@/lib/cajas-bancos/movimientos";
import { createCashTransfer } from "@/lib/cajas-bancos/transferencias";

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
  // El tipo de cambio sale de los ajustes, que el provider ya leyo (`GET /settings`); las filas
  // completas de las cuentas son las que necesitan los modales de transferencia, movimiento y caja
  // chica (fondo, custodio, limite por vale).
  const { penUsdRate, accounts } = useCajasBancos();
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
  // Se incrementa despues de una escritura (transferencia, movimiento, reposicion) para releer los
  // saldos: es la base la que los recalcula (S2), no esta pantalla.
  const [refreshKey, setRefreshKey] = useState(0);
  const [transferOpen, setTransferOpen] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);
  const [movementAccountId, setMovementAccountId] = useState<string | null>(null);
  const [isSavingMovement, setIsSavingMovement] = useState(false);
  const [pettyCashAccountId, setPettyCashAccountId] = useState<string | null>(null);

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
  }, [today, refreshKey]);

  /**
   * Registra la transferencia y relee los saldos.
   *
   * Las reglas (cuentas distintas, en PEN, monto positivo, periodo abierto en las dos) las aplica
   * `create_cash_transfer`; el mensaje del `ApiError` se muestra tal cual, sin traducir (S5).
   */
  async function handleTransfer(values: CashTransferFormValues) {
    setIsTransferring(true);
    try {
      await createCashTransfer(values);
      setTransferOpen(false);
      toast.success("Transferencia registrada");
      setRefreshKey((key) => key + 1);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo registrar la transferencia.",
      );
    } finally {
      setIsTransferring(false);
    }
  }

  /**
   * Registra el movimiento de caja y relee los saldos.
   *
   * Es `POST /payments` con `isCashMovement: true` (S8): el recibo lo crea la misma RPC que un pago
   * normal, con su numero correlativo, y queda fuera del circuito de asignacion.
   */
  async function handleCreateMovement(values: CashMovementFormValues) {
    setIsSavingMovement(true);
    try {
      await createPayment(cashMovementToPayment(values));
      toast.success("Movimiento registrado");
      setMovementAccountId(null);
      setRefreshKey((key) => key + 1);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "No se pudo registrar el movimiento.",
      );
    } finally {
      setIsSavingMovement(false);
    }
  }

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
        // Las dos acciones de C6. "Vales" solo existe en cajas chicas (`is_petty_cash`): en una
        // cuenta normal el panel de vales no tendria fondo que reponer.
        cuentasColumnHelper.display({
          id: "actions",
          header: () => <div className="text-right">Acciones</div>,
          cell: ({ row }) => (
            <div className="flex justify-end gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMovementAccountId(row.original.id)}
              >
                Movimiento
              </Button>
              {row.original.isPettyCash ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPettyCashAccountId(row.original.id)}
                >
                  Vales
                </Button>
              ) : null}
            </div>
          ),
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

  // Cuentas que ofrecen los modales: las posiciones (vivas y activas) con su fila completa.
  const selectableAccounts = useMemo(() => {
    const activeIds = new Set(positions.map((position) => position.accountId));

    return accounts.filter((account) => activeIds.has(account.id));
  }, [accounts, positions]);

  const pettyCashAccount =
    selectableAccounts.find((item) => item.id === pettyCashAccountId) ?? null;
  const movementAccount =
    selectableAccounts.find((item) => item.id === movementAccountId) ?? null;

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
          <Button onClick={() => setTransferOpen(true)}>Transferir</Button>
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

      <CashTransferModal
        open={transferOpen}
        onOpenChange={setTransferOpen}
        accounts={selectableAccounts}
        onDone={(values) => void handleTransfer(values)}
        isSaving={isTransferring}
      />

      <CashMovementModal
        open={movementAccountId !== null}
        onOpenChange={(next) => {
          if (!next) setMovementAccountId(null);
        }}
        account={movementAccount}
        onDone={(values) => void handleCreateMovement(values)}
        isSaving={isSavingMovement}
      />

      {pettyCashAccount ? (
        <PettyCashPanel
          open
          onOpenChange={(next) => {
            if (!next) setPettyCashAccountId(null);
          }}
          account={pettyCashAccount}
          accounts={selectableAccounts}
          onChanged={() => {
            // La reposicion mueve saldos entre dos cuentas: se relee la tabla de saldos.
            setRefreshKey((key) => key + 1);
          }}
        />
      ) : null}
    </main>
  );
}
