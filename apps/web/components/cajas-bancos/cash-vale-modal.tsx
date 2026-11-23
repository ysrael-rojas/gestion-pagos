"use client";

// Modal de alta de un vale de caja chica (C6 del vertical de cajas-bancos).
//
// Port de `components/cajas-bancos/cash-vale-modal.tsx` del origen (253 lineas). El comportamiento
// es el del origen: fecha (hoy por defecto), categoria del gasto, pagado a, concepto, importe,
// "tiene comprobante" y el aviso del limite por gasto de la caja.
//
// EL CORRELATIVO NO SE ELIGE ACA (S5): el numero de vale lo asigna la RPC con la cuenta bloqueada
// (`for update` + `unique (account_id, serial)`), y el modal lo dice en la descripcion. El vale nace
// PENDIENTE y la RPC crea ademas su recibo de egreso (SPEC 49); nada de eso viaja en el body, que
// es `pettyCashValeSchema` sin la regla del limite.
//
// EL LIMITE POR GASTO se valida DOS VECES y no es duplicacion: `createPettyCashValeSchema(limit)` lo
// adelanta en el cliente para que el usuario no mande un vale que va a rebotar, y
// `create_petty_cash_vale` lo revalida contra la columna ya leida de la cuenta. El que manda es el
// SQL; el del cliente es el aviso temprano.
//
// DESVIO DELIBERADO: en el origen abrir el modal disparaba `ensureCatalogsSeeded()`, que sembraba
// los catalogos dentro de un GET. Aca la lectura es explicita y la siembra (`POST /catalogs/ensure`,
// idempotente) solo ocurre si la lista de categorias de egreso vuelve vacia; mismo criterio que el
// formulario de pagos (`components/pagos/payment-form.tsx`).
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import type { CashReceiptCategory } from "@/components/pagos/types";
import { ensureCatalogs, listReceiptCategories } from "@/lib/api/client";
import {
  createPettyCashValeSchema,
  formatCurrency,
  getTodayLocalDate,
  type PettyCashValeFormInput,
  type PettyCashValeFormValues,
} from "@gestion/shared";
import type { CashAccountRecord } from "@/lib/cuentas/entidades";

export const PETTY_CASH_VALE_FORM_ID = "petty-cash-vale-form";

interface CashValeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: CashAccountRecord;
  onDone: (values: PettyCashValeFormValues) => void;
  isSaving?: boolean;
}

function createEmptyValues(accountId: string): PettyCashValeFormInput {
  return {
    accountId,
    categoryId: "",
    valeDate: getTodayLocalDate(),
    paidTo: "",
    concept: "",
    amount: undefined as unknown as number,
    hasReceipt: false,
  };
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function CashValeModal({
  open,
  onOpenChange,
  account,
  onDone,
  isSaving = false,
}: CashValeModalProps) {
  const limit = account.pettyExpenseLimit;
  const [categories, setCategories] = useState<CashReceiptCategory[]>([]);

  const form = useForm<PettyCashValeFormInput, unknown, PettyCashValeFormValues>({
    resolver: zodResolver(createPettyCashValeSchema(limit)),
    defaultValues: createEmptyValues(account.id),
  });

  useEffect(() => {
    if (open) {
      form.reset(createEmptyValues(account.id));
    }
  }, [open, account.id, form]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let isMounted = true;

    void (async () => {
      try {
        // Categorias de egreso: es la unica direccion con la que se puede emitir un vale.
        let nextCategories = await listReceiptCategories("EGRESO");

        if (nextCategories.length === 0) {
          await ensureCatalogs();
          nextCategories = await listReceiptCategories("EGRESO");
        }

        if (isMounted) {
          setCategories(nextCategories);
        }
      } catch {
        // Un fallo de catalogo deja el selector vacio en vez de tumbar el modal: el error real
        // aparece al guardar, con el mensaje del API.
        if (isMounted) {
          setCategories([]);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [open]);

  const errors = form.formState.errors;
  const categoryItems = categories.map((category) => ({
    value: category.id,
    label: category.name,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        <form
          id={PETTY_CASH_VALE_FORM_ID}
          onSubmit={form.handleSubmit(onDone)}
          className="flex flex-col gap-5 p-6"
        >
          <div className="flex flex-col gap-1">
            <DialogTitle>Nuevo vale de caja chica</DialogTitle>
            <DialogDescription>
              {account.name} · el número de vale lo asigna el sistema.
            </DialogDescription>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="valeDate">Fecha</Label>
            <Input
              id="valeDate"
              type="date"
              aria-invalid={!!errors.valeDate}
              {...form.register("valeDate")}
            />
            <FieldError message={errors.valeDate?.message} />
          </div>

          <Controller
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="categoryId">Categoría del gasto</Label>
                <Select
                  value={field.value || null}
                  items={categoryItems}
                  onValueChange={(value) => field.onChange(value ?? "")}
                >
                  <SelectTrigger id="categoryId" className="w-full">
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={null}>Seleccionar</SelectItem>
                    {categoryItems.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.categoryId?.message} />
                <p className="text-xs text-muted-foreground">
                  El vale se registra como egreso de la caja chica con esta
                  categoría.
                </p>
              </div>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="paidTo">Pagado a</Label>
            <Input
              id="paidTo"
              placeholder="Ej. Juan Pérez"
              aria-invalid={!!errors.paidTo}
              {...form.register("paidTo")}
            />
            <FieldError message={errors.paidTo?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="concept">Concepto</Label>
            <Textarea
              id="concept"
              placeholder="Ej. Pasajes y movilidad"
              aria-invalid={!!errors.concept}
              {...form.register("concept")}
            />
            <FieldError message={errors.concept?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="amount">Importe (S/)</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              aria-invalid={!!errors.amount}
              {...form.register("amount", { valueAsNumber: true })}
            />
            <FieldError message={errors.amount?.message} />
            {limit !== null ? (
              <p className="text-xs text-muted-foreground">
                Límite por gasto: {formatCurrency(limit)}.
              </p>
            ) : null}
          </div>

          <Controller
            control={form.control}
            name="hasReceipt"
            render={({ field }) => (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="hasReceipt"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
                <Label htmlFor="hasReceipt">Tiene comprobante adjunto</Label>
              </div>
            )}
          />

          <div className="flex items-center justify-end gap-2">
            <DialogClose render={<Button variant="outline" />}>
              Cancelar
            </DialogClose>
            <Button
              type="submit"
              form={PETTY_CASH_VALE_FORM_ID}
              disabled={isSaving}
            >
              {isSaving ? "Registrando…" : "Registrar vale"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
