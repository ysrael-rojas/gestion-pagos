"use client";

// Tabla de arqueos sorpresivos de una cuenta (C5 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/cash-counts-table.tsx` del origen (103 lineas) sin cambios de
// comportamiento: siete columnas, "Cargando arqueos…" mientras llega la lectura y un mensaje cuando
// no hay ninguno.
//
// Desvio minimo de tipos: el `CashCount` del origen vivia en `lib/caja/arqueos.ts`; aca es el
// `CashCountRecord` del contrato de `apps/api` (`lib/api/client.ts`), campo por campo igual. El
// `expectedBalance` y la `difference` ya vienen calculados por `register_cash_count` (S2), asi que
// esta tabla no resta nada: solo compara `difference` con cero para pintar el resultado.
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn, formatCurrency, formatDate } from "@gestion/shared";
import type { CashCountRecord } from "@/lib/api/client";

interface CashCountsTableProps {
  counts: CashCountRecord[];
  currency: "PEN" | "USD";
  isLoading: boolean;
}

export function CashCountsTable({
  counts,
  currency,
  isLoading,
}: CashCountsTableProps) {
  return (
    <div className="overflow-hidden rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Fecha</TableHead>
            <TableHead>Contado por</TableHead>
            <TableHead className="text-right">Esperado</TableHead>
            <TableHead className="text-right">Contado</TableHead>
            <TableHead className="text-right">Diferencia</TableHead>
            <TableHead>Resultado</TableHead>
            <TableHead>Notas</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-sm">
                Cargando arqueos…
              </TableCell>
            </TableRow>
          ) : counts.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="text-center text-sm text-muted-foreground"
              >
                Aún no hay arqueos sorpresivos para esta cuenta.
              </TableCell>
            </TableRow>
          ) : (
            counts.map((count) => (
              <TableRow key={count.id}>
                <TableCell>{formatDate(count.countDate)}</TableCell>
                <TableCell>{count.countedBy || "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(count.expectedBalance, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(count.countedBalance, currency)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-medium tabular-nums",
                    count.difference === 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400",
                  )}
                >
                  {formatCurrency(count.difference, currency)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      count.difference === 0
                        ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                        : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                    }
                  >
                    {count.difference === 0
                      ? "Cuadrado"
                      : count.difference < 0
                        ? "Faltante"
                        : "Sobrante"}
                  </Badge>
                </TableCell>
                <TableCell className="max-w-56 truncate text-sm text-muted-foreground">
                  {count.notes || "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
