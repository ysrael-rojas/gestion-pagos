"use client";

// Modal de alta/edicion de serie (T4 del slice 2: S8).
//
// Port de `components/configuracion/serie-modal.tsx` del origen. La diferencia con el origen es
// quien guarda: alli el modal llamaba al transporte y la vista solo recargaba (`onSaved`); aca el
// modal solo entrega los valores (`onSave`) y la vista es la que escribe y muestra el `toast`,
// igual que `ClientModal` en el vertical de clientes. Asi el manejo de errores de S6
// (`Ya existe una serie con ese código para ese tipo.`) vive en un solo lugar.
//
// El `Dialog` de Base UI desmonta el contenido al cerrarse, asi que el formulario arranca limpio en
// cada apertura sin necesidad de resetear a mano.
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

import { SERIE_FORM_ID, SerieForm } from "@/components/configuracion/serie-form";
import { SERIES_COPY } from "@/lib/configuracion/series";
import type {
  SerieFormValues,
  VoucherSeriesRow,
} from "@gestion/shared/lib/schemas/serie.ts";

interface SerieModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** La serie que se edita, o `null` en un alta. */
  serie: VoucherSeriesRow | null;
  onSave: (values: SerieFormValues) => void;
  isSaving?: boolean;
}

export function SerieModal({
  open,
  onOpenChange,
  serie,
  onSave,
  isSaving = false,
}: SerieModalProps) {
  const isEditing = serie !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? SERIES_COPY.editTitle : SERIES_COPY.createTitle}
          </DialogTitle>
          <DialogDescription>{SERIES_COPY.modalSubtitle}</DialogDescription>
        </DialogHeader>

        <SerieForm serie={serie} onSubmit={onSave} />

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            {SERIES_COPY.cancel}
          </DialogClose>
          <Button type="submit" form={SERIE_FORM_ID} disabled={isSaving}>
            {isSaving
              ? SERIES_COPY.saving
              : isEditing
                ? SERIES_COPY.save
                : SERIES_COPY.create}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
