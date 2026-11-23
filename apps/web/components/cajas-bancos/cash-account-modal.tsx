"use client";

// Modal de alta y edicion de cuenta (C5 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/cash-account-modal.tsx` del origen (84 lineas) sin cambios de
// comportamiento. El unico cambio es el tipo de la cuenta, que aca es la fila completa
// (`CashAccountRecord`) porque es lo que devuelven las escrituras y `GET /cash-accounts/:id`.
//
// El modal NO guarda: recibe `onSave` y el listado es el que llama al provider. Asi el error del
// API se muestra donde vive el estado de guardado y el formulario no se cierra si la escritura
// fallo.
import { useWatch } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  CASH_ACCOUNT_FORM_ID,
  CashAccountForm,
  useCashAccountForm,
} from "@/components/cajas-bancos/cash-account-form";
import type { CashAccountFormValues } from "@gestion/shared";
import type { CashAccountRecord } from "@/lib/cuentas/entidades";

interface CashAccountModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: CashAccountRecord | null;
  onSave: (values: CashAccountFormValues) => void;
  isSaving?: boolean;
}

export function CashAccountModal({
  open,
  onOpenChange,
  account,
  onSave,
  isSaving = false,
}: CashAccountModalProps) {
  const form = useCashAccountForm({ open, account });
  // Sin tipo elegido ("Seleccionar") no se puede registrar la cuenta.
  const type = useWatch({ control: form.control, name: "type" });
  const isEditing = account !== null;
  const title = isEditing
    ? account?.type === "BANK_ACCOUNT"
      ? "Editar banco"
      : "Editar caja"
    : "Registrar cuenta";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        <Card className="ring-0">
          <CardHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {isEditing
                ? "Modifica los datos de la cuenta"
                : "Completa los datos para registrar una nueva cuenta"}
            </DialogDescription>
          </CardHeader>
          <CardContent>
            <CashAccountForm form={form} onSubmit={onSave} />
          </CardContent>
          <CardFooter className="justify-end gap-2">
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              type="submit"
              form={CASH_ACCOUNT_FORM_ID}
              disabled={isSaving || !type}
            >
              {isEditing ? "Guardar cambios" : "Registrar"}
            </Button>
          </CardFooter>
        </Card>
      </DialogContent>
    </Dialog>
  );
}
