// Resumenes del acta de arqueo y del extracto (C5 del vertical de cajas-bancos).
//
// Port de `lib/caja/reportes.ts` del origen (112 lineas) completo. Nada depende de la base ni del
// reloj: entran filas (recibos o movimientos) y salen totales, que es lo que imprimen el acta
// (`cuadre-acta.tsx`) y el reporte (`cuadre-report.tsx`).
//
// `summarizeStatement` no tiene consumidor en este slice —la tabla de movimientos del reporte
// lista los recibos del periodo y las transferencias son C6— pero se porta igual porque es pura y
// es exactamente lo que la pantalla de extractos (C6) usa: probar la regla ahora es mas barato
// que reescribirla despues con un segundo criterio de que suma y que no.
import { round2 } from "@gestion/shared/lib/utils.ts";

export interface ReceiptRange {
  prefix: string;
  first: string;
  last: string;
  count: number;
}

export interface ReceiptSequenceSummary {
  ranges: ReceiptRange[];
  annulled: number;
}

/**
 * Secuencia de recibos de un periodo para el acta/arqueo (SPEC 49): primer y ultimo numero por
 * prefijo (RI/RE) y cantidad de anulados.
 *
 * Los pagos sin numero (datos historicos) se ignoran para los rangos pero SI cuentan como
 * anulados si lo estan: el formato de arqueo pide "recibos anulados del periodo", no "anulados con
 * numero". Se ordena por prefijo y no por orden de llegada para que el acta salga igual dos veces
 * con los mismos datos.
 */
export function summarizeReceiptSequence(
  payments: Array<{ receiptNumber: string; status: string }>,
): ReceiptSequenceSummary {
  const numbersByPrefix = new Map<string, string[]>();

  for (const payment of payments) {
    const receiptNumber = payment.receiptNumber?.trim();

    if (!receiptNumber) {
      continue;
    }

    const prefix = `${receiptNumber.split("-")[0]}-`;
    const numbers = numbersByPrefix.get(prefix) ?? [];
    numbers.push(receiptNumber);
    numbersByPrefix.set(prefix, numbers);
  }

  const ranges = [...numbersByPrefix.entries()]
    .map(([prefix, numbers]) => {
      const sorted = [...numbers].sort();

      return {
        prefix,
        first: sorted[0],
        last: sorted[sorted.length - 1],
        count: sorted.length,
      };
    })
    .sort((a, b) => a.prefix.localeCompare(b.prefix));

  return {
    ranges,
    annulled: payments.filter((payment) => payment.status === "ANULADO").length,
  };
}

/** "RI-000012 → RI-000031 · RE-000004 → RE-000006" o "—" si no hay recibos. */
export function formatReceiptRanges(summary: ReceiptSequenceSummary): string {
  if (summary.ranges.length === 0) {
    return "—";
  }

  return summary.ranges
    .map((range) =>
      range.first === range.last ? range.first : `${range.first} → ${range.last}`,
    )
    .join(" · ");
}

export interface StatementSummary {
  income: number;
  expense: number;
  movements: number;
  transfers: number;
}

/**
 * Totales del extracto (SPEC 51): los anulados se listan pero no suman.
 *
 * Las transferencias no tienen direccion contable propia en el resumen (una entrada y una salida
 * del mismo importe se anulan entre si), asi que solo se cuentan: el detalle de a que cuenta
 * entraron lo da la tabla de movimientos.
 */
export function summarizeStatement(
  statement: Array<{ direction: string; amount: number; status: string }>,
  transfers: unknown[],
): StatementSummary {
  let income = 0;
  let expense = 0;
  let movements = 0;

  for (const row of statement) {
    if (row.status === "ANULADO") {
      continue;
    }

    movements += 1;

    if (row.direction === "INGRESO") {
      income += row.amount;
    } else {
      expense += row.amount;
    }
  }

  return {
    income: round2(income),
    expense: round2(expense),
    movements,
    transfers: transfers.length,
  };
}
