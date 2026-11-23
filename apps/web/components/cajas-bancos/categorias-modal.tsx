"use client";

// Alta de una categoria de recibo (C7 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/categorias-modal.tsx` del origen (168 lineas): nombre, tipo
// (ingreso/egreso) y guardar, validados con el schema COMPARTIDO (`cashReceiptCategorySchema`).
//
// DESVIO DELIBERADO (lo impone el API): el body NO lleva `code`. En el origen el modal lo derivaba
// del nombre con `categoryCodeFromName` antes del `insert`; aca esa derivacion vive en el servicio
// del API (`apps/api/src/payments/catalogs.service.ts`), en UN solo lugar, porque la columna es
// `not null` y unica por dueno. El schema compartido del alta tampoco tiene la clave, asi que es
// imposible mandarla por accidente; el codigo que devuelve el API es el que usara despues el
// formulario de pagos para resolver la categoria (SPEC 37).
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PaymentDirection } from "@/components/pagos/types";
import { createReceiptCategory } from "@/lib/api/client";
import { cashReceiptCategorySchema } from "@gestion/shared/lib/schemas/cash-receipt-category.ts";

interface CategoriasModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}

const DIRECTION_OPTIONS = [
  { value: "select", label: "Seleccionar" },
  { value: "INGRESO", label: "Ingresos" },
  { value: "EGRESO", label: "Egresos" },
] as const;

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

export function CategoriasModal({ open, onOpenChange, onCreated }: CategoriasModalProps) {
  const [name, setName] = useState("");
  const [directionValue, setDirectionValue] = useState<"select" | PaymentDirection>("select");
  const [isSaving, setIsSaving] = useState(false);

  function resetForm() {
    setName("");
    setDirectionValue("select");
  }

  async function handleSave() {
    if (directionValue === "select") {
      return;
    }

    const parsed = cashReceiptCategorySchema.safeParse({
      direction: directionValue,
      name,
      isActive: true,
    });

    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Datos inválidos.");
      return;
    }

    setIsSaving(true);
    try {
      await createReceiptCategory(parsed.data);
      await onCreated();
      toast.success("Categoría agregada.");
      resetForm();
      onOpenChange(false);
    } catch (error) {
      // Un nombre sin letras ni numeros no tiene codigo posible: el mensaje lo redacta el API.
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetForm();
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Agregar categoría</DialogTitle>
          <DialogDescription>
            Define el nombre y el tipo de movimiento de la categoría.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="category-name">Nombre</Label>
            <Input
              id="category-name"
              value={name}
              placeholder="Cobranza de venta"
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="category-direction">Tipo</Label>
            <Select
              value={directionValue}
              items={DIRECTION_OPTIONS}
              onValueChange={(value) => {
                if (value === "INGRESO" || value === "EGRESO" || value === "select") {
                  setDirectionValue(value);
                }
              }}
            >
              <SelectTrigger id="category-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIRECTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              resetForm();
              onOpenChange(false);
            }}
            disabled={isSaving}
          >
            Cancelar
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving || directionValue === "select"}
          >
            {isSaving ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
