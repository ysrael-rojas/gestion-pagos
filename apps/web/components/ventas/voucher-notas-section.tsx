"use client";

// Seccion de notas de credito/debito del detalle de un comprobante (T4 del slice 3: S1, S2, S5 y S11
// de `odd/tasks/port-vertical-notas.md`).
//
// Port de `components/comprobantes/voucher-adjustments-section.tsx` del origen, SOLO el grupo de
// notas: las retenciones tienen su propio slice y no se listan aca, y por eso tampoco hay solapas
// (el detalle de este vertical es una sola pagina con secciones, no el tablero del origen).
//
// Que hace, y por que es la dueña de la escritura:
//
//   * Lista las notas del comprobante (`useNotas`, `GET /notes?voucherId=`) con los textos de S11: la
//     tabla (`Tipo`, `Número`, `Emisión`, `Motivo`, `Total`), los dos totales (`Notas de crédito`,
//     `Notas de débito`) y el vacio (`Este comprobante no tiene notas de crédito ni de débito
//     aplicadas.`).
//   * Abre el alta DESDE aca (L3.f): dos botones, uno por tipo de nota, que fijan el tipo del modal.
//     El origen registraba en `/notas/credito`, un listado aparte.
//   * Escribe y muestra el `toast` (`Documento registrado`). Despues del alta recarga las DOS cosas:
//     la lista de notas (la fila nueva aparece) y el comprobante (`onCreated`), porque el saldo y el
//     estado los recalcula la base con los triggers de ajuste (S2) y la banda de montos tiene que
//     mostrar el saldo nuevo. Sin la segunda recarga la pantalla mentiria.
//
// El bloqueo por falta de serie (S3) se deriva del PREVIEW: si `previewNotaNumber` devuelve `""` para
// el tipo elegido es que no hay serie por defecto de ese tipo, y no hay numero que la base pueda
// asignar. Solo bloquea cuando la carga de series TERMINO bien: un error de red no puede disfrazarse
// de "no hay series" (para eso esta `seriesError`, que muestra el texto y deja responder al API).
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { NotaModal } from "@/components/notas/nota-modal";
import { useNotas } from "@/components/notas/use-notas";
import { useVoucherSeries } from "@/components/ventas/use-voucher-series";
import {
  previewNotaNumber,
  toNotaRequestBody,
} from "@/lib/notas/formulario";
import { createNota } from "@/lib/notas/notas";
import { hasNotas, notaTotals, toNotaTableRows } from "@/lib/notas/tabla";
import { NOTAS_COPY } from "@/lib/notas/textos";
import type { VoucherDetail } from "@/lib/ventas/types";
import type { NotaFormValues } from "@gestion/shared/lib/schemas/nota.ts";

type NoteType = "NOTA_CREDITO" | "NOTA_DEBITO";

const SKELETON_ROWS = 3;

interface VoucherNotasSectionProps {
  voucher: VoucherDetail;
  /** Recarga el comprobante: el alta mueve el saldo (S2) y la banda de montos lo muestra. */
  onCreated: () => Promise<void>;
}

function TotalItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

export function VoucherNotasSection({
  voucher,
  onCreated,
}: VoucherNotasSectionProps) {
  const { notas, isLoading, error, reload } = useNotas(voucher.id);
  const {
    series,
    isLoading: isSeriesLoading,
    error: seriesError,
  } = useVoucherSeries();
  /** El tipo de la nota que se esta registrando, o `null` con el modal cerrado. */
  const [openType, setOpenType] = useState<NoteType | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const rows = toNotaTableRows(notas);
  const totals = notaTotals(notas);

  /**
   * Sin serie por defecto del tipo de la nota no hay numero (S3).
   *
   * Mientras las series cargan no se puede afirmar nada (el preview esta vacio por falta de datos,
   * no por falta de serie), asi que no se bloquea; y si la carga fallo tampoco, porque el mensaje del
   * API es la respuesta honesta.
   */
  const isSeriesBlocked = (type: NoteType): boolean =>
    !isSeriesLoading &&
    !seriesError &&
    previewNotaNumber(type, series) === "";

  async function handleSubmit(values: NotaFormValues) {
    setIsSaving(true);

    try {
      await createNota(toNotaRequestBody(values));
      toast.success(NOTAS_COPY.savedToast);
      setOpenType(null);
      // Las dos recargas: la nota nueva en la lista y el saldo nuevo en la banda de montos.
      await Promise.all([reload(), onCreated()]);
    } catch (saveError) {
      toast.error(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : NOTAS_COPY.unexpectedError
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Card className="bg-muted/30 ring-0">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{NOTAS_COPY.sectionTitle}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenType("NOTA_CREDITO")}
            >
              {NOTAS_COPY.createCreditAction}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenType("NOTA_DEBITO")}
            >
              {NOTAS_COPY.createDebitAction}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: SKELETON_ROWS }).map((_, index) => (
              <Skeleton key={index} className="h-10 w-full" />
            ))}
          </div>
        ) : (
          <>
            {hasNotas(notas) ? (
              <div className="grid grid-cols-2 gap-3 rounded-lg border bg-background p-3 sm:grid-cols-3">
                <TotalItem
                  label={NOTAS_COPY.creditTotalLabel}
                  value={totals.creditLabel}
                />
                <TotalItem
                  label={NOTAS_COPY.debitTotalLabel}
                  value={totals.debitLabel}
                />
              </div>
            ) : null}

            {hasNotas(notas) ? (
              <div className="overflow-x-auto rounded-md border bg-background">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{NOTAS_COPY.columnType}</TableHead>
                      <TableHead>{NOTAS_COPY.columnNumber}</TableHead>
                      <TableHead>{NOTAS_COPY.columnIssueDate}</TableHead>
                      <TableHead>{NOTAS_COPY.columnMotive}</TableHead>
                      <TableHead className="text-right">
                        {NOTAS_COPY.columnTotal}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.voucherTypeLabel}</TableCell>
                        <TableCell>{row.voucherNumber}</TableCell>
                        <TableCell>{row.issueDateLabel}</TableCell>
                        <TableCell>{row.motiveLabel}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.totalLabel}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {NOTAS_COPY.emptyMessage}
              </p>
            )}
          </>
        )}
      </CardContent>

      {openType ? (
        <NotaModal
          open
          onOpenChange={(open) => {
            if (!open) {
              setOpenType(null);
            }
          }}
          voucherType={openType}
          voucher={voucher}
          notas={notas}
          series={series}
          isSeriesBlocked={isSeriesBlocked(openType)}
          isSaving={isSaving}
          onSubmit={handleSubmit}
        />
      ) : null}
    </Card>
  );
}
