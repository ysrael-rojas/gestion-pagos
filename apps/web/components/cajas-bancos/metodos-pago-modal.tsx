"use client";

// Alta de un metodo de pago (C7 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/metodos-pago-modal.tsx` del origen (115 lineas). Dos campos,
// codigo y nombre, validados con el schema COMPARTIDO del formulario (`paymentMethodSchema`), que
// es el mismo que usa el API: el codigo se normaliza una sola vez (trim, mayusculas, espacios a
// guion bajo) y el mensaje de "El código no puede superar 40 caracteres." es el que ya ve el
// usuario.
//
// DESVIO DELIBERADO (transporte): el origen insertaba con PostgREST; aca es `POST
// /payment-methods`. Lo unico que el usuario nuevo ve distinto es que un codigo repetido responde
// 409 con un mensaje que NOMBRA el codigo ("Ya existe un método de pago con el código ..."), en vez
// del texto generico de un `23505`: ese mensaje llega al `toast` sin tocar.
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createPaymentMethod } from "@/lib/api/client";
import { paymentMethodSchema } from "@gestion/shared/lib/schemas/payment-method.ts";

interface MetodosPagoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export function MetodosPagoModal({ open, onOpenChange, onCreated }: MetodosPagoModalProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = paymentMethodSchema.safeParse({ code, name, isActive: true });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Datos inválidos.");
      return;
    }

    setIsSaving(true);
    try {
      await createPaymentMethod({ ...parsed.data, isActive: true });
      setCode("");
      setName("");
      onOpenChange(false);
      toast.success("Método agregado");
      await onCreated();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar método de pago</DialogTitle>
          <DialogDescription>
            Completa el código y nombre del nuevo método. El código no se puede cambiar después.
          </DialogDescription>
        </DialogHeader>
        <form id="payment-method-form" onSubmit={handleSubmit}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="payment-method-code">Código</Label>
              <Input
                id="payment-method-code"
                value={code}
                placeholder="EFECTIVO"
                maxLength={40}
                autoFocus
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="payment-method-name">Nombre</Label>
              <Input
                id="payment-method-name"
                value={name}
                placeholder="Efectivo"
                maxLength={60}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button type="submit" form="payment-method-form" disabled={isSaving}>
            Agregar método
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
