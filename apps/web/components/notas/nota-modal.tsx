"use client";

// Modal de alta de una nota (T4 del slice 3: S11 de `odd/tasks/port-vertical-notas.md`).
//
// Port de `components/notas/nota-modal.tsx` del origen, sin la mitad de EDICION: una nota emitida no
// se edita (S7). Su tipo y su referencia son inmutables por trigger, no hay `editar_nota` en el API
// y una correccion se hace con OTRA nota. Por eso el titulo siempre es `Registrar una nota de
// crédito` / `... de débito` (S11) y no existe el intermedio `Editar …` / `Guardar cambios`.
//
// Quien guarda es la SECCION (`onSubmit` + `isSaving`), igual que en `serie-modal`: el modal solo
// entrega los valores, y el `toast` y el mapa de errores del API (S10) quedan en un solo lugar.
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { NOTA_FORM_ID, NotaForm } from "@/components/notas/nota-form";
import { NOTA_FORM_TITLES, NOTAS_COPY } from "@/lib/notas/textos";
import type { VoucherDetail, VoucherSeries } from "@/lib/ventas/types";
import type {
  NotaFormValues,
  VoucherAdjustmentRow,
} from "@gestion/shared/lib/schemas/nota.ts";

interface NotaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voucherType: "NOTA_CREDITO" | "NOTA_DEBITO";
  voucher: VoucherDetail;
  notas: VoucherAdjustmentRow[];
  series: VoucherSeries[];
  isSeriesBlocked: boolean;
  isSaving?: boolean;
  onSubmit: (values: NotaFormValues) => void;
}

export function NotaModal({
  open,
  onOpenChange,
  voucherType,
  voucher,
  notas,
  series,
  isSeriesBlocked,
  isSaving = false,
  onSubmit,
}: NotaModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{NOTA_FORM_TITLES[voucherType]}</DialogTitle>
          <DialogDescription>{NOTAS_COPY.modalDescription}</DialogDescription>
        </DialogHeader>

        <NotaForm
          voucherType={voucherType}
          voucher={voucher}
          notas={notas}
          series={series}
          isSeriesBlocked={isSeriesBlocked}
          onSubmit={onSubmit}
        />

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {NOTAS_COPY.cancel}
          </DialogClose>
          <Button
            type="submit"
            form={NOTA_FORM_ID}
            // Sin serie por defecto del tipo de la nota no hay numero que asignar (S3): la base lo
            // rechazaria con su mensaje, y el boton lo anticipa.
            disabled={isSaving || isSeriesBlocked}
          >
            {isSaving ? NOTAS_COPY.saving : NOTAS_COPY.register}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
