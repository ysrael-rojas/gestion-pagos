"use client";

// Cargo bancario: ITF, comision o detraccion que el banco descuenta de la cuenta (C7, SPEC 33/50).
//
// Port de `components/cajas-bancos/bank-charge-modal.tsx` del origen (306 lineas). C6 lo dejo
// fuera a proposito (ver `statement-table.tsx` y `cuadres-view.tsx`): es la segunda accion de la
// conciliacion, junto con "Marcar verificado", y las dos llegan con este slice.
//
// UN CARGO BANCARIO ES UN RECIBO DE EGRESO (S8): el modal no inserta nada, devuelve el formulario y
// el llamador lo manda a `POST /payments` con `isCashMovement: true` (`bankChargeToPayment` de
// `lib/cajas-bancos/cargos.ts`). Sin entidad y sin asignaciones: no paga una factura.
//
// LAS DOS FECHAS DE LA VENTANA las decide la base y aca se avisan temprano:
//
//   minimo  `firstOpenDate(ultimoCierre.periodEnd, hoy)` — el cierre bloquea hasta su `period_end`
//           inclusive (S4), asi que el primer dia abierto es el siguiente.
//   maximo  el propio `min`: un cargo no puede ser futuro, y menos caer en un periodo ya cerrado.
//           `isDateClosed` es el aviso temprano; la base lo vuelve a rechazar.
//
// DESVIO DELIBERADO (dos, los mismos criterios que el resto del vertical):
//
//   1. El ultimo cierre se lee de `GET /cash-closes?accountId` (historial del mas reciente al mas
//      antiguo) y no de un `getLastClose` propio: es el mismo dato con una ruta que ya existe.
//   2. En el origen abrir el modal disparaba `ensureCatalogsSeeded()` siempre (un GET que
//      escribia 3 metodos y 13 categorias). Aca la siembra es `POST /catalogs/ensure`, idempotente,
//      y solo ocurre si alguna de las dos listas vuelve vacia: mismo criterio que el formulario de
//      pagos y el modal de movimiento de caja.
//
// Las categorias que ofrece son las tres de cargo (`BANK_CHARGE_CATEGORY_CODES`), resueltas por
// `code`: el dueño puede renombrarlas sin romper el combo (SPEC 37/49).
import { useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import {
  ensureCatalogs,
  listCashCloses,
  listPaymentMethods,
  listReceiptCategories,
} from "@/lib/api/client";
import { BANK_CHARGE_CATEGORY_CODES } from "@/lib/cajas-bancos/cargos";
import { firstOpenDate, isDateClosed } from "@/lib/cajas-bancos/periodo";
import { needsCatalogSeed } from "@/lib/pagos/catalogs";
import type { CashReceiptCategory, PaymentMethodRef } from "@/components/pagos/types";
import type { CashAccountRecord } from "@/lib/cuentas/entidades";
import {
  bankChargeSchema,
  formatDate,
  getTodayLocalDate,
  type BankChargeFormInput,
  type BankChargeFormValues,
} from "@gestion/shared";

export const BANK_CHARGE_FORM_ID = "bank-charge-form";

interface BankChargeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: CashAccountRecord;
  onDone: (values: BankChargeFormValues) => void;
  isSaving?: boolean;
}

function createEmptyValues(accountId: string): BankChargeFormInput {
  return {
    cashAccountId: accountId,
    categoryId: "",
    methodId: "",
    amount: undefined as unknown as number,
    chargeDate: getTodayLocalDate(),
    reference: "",
    notes: "",
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Ocurrió un error inesperado. Intenta nuevamente.";
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function BankChargeModal({
  open,
  onOpenChange,
  account,
  onDone,
  isSaving = false,
}: BankChargeModalProps) {
  const [methods, setMethods] = useState<PaymentMethodRef[]>([]);
  const [categories, setCategories] = useState<CashReceiptCategory[]>([]);
  // Primer dia abierto de la cuenta (posterior al ultimo cierre) y fin del ultimo periodo cerrado,
  // para proponer la fecha y bloquear una cerrada.
  const [openFrom, setOpenFrom] = useState<string>(() => getTodayLocalDate());
  const [lastClosedEnd, setLastClosedEnd] = useState<string | null>(null);

  const form = useForm<BankChargeFormInput, unknown, BankChargeFormValues>({
    resolver: zodResolver(bankChargeSchema),
    defaultValues: createEmptyValues(account.id),
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    let isMounted = true;

    void (async () => {
      let lastCloseEnd: string | null = null;

      try {
        // El historial viene del mas reciente al mas antiguo: el primero es el ultimo cierre.
        const closes = await listCashCloses(account.id);
        lastCloseEnd = closes[0]?.periodEnd ?? null;

        if (isMounted) {
          setLastClosedEnd(lastCloseEnd);
        }
      } catch (error) {
        if (isMounted) {
          toast.error(getErrorMessage(error));
        }
      }

      const nextOpenFrom = firstOpenDate(lastCloseEnd, getTodayLocalDate());

      if (isMounted) {
        setOpenFrom(nextOpenFrom);
      }
      form.reset({ ...createEmptyValues(account.id), chargeDate: nextOpenFrom });

      try {
        let [methodData, categoryData] = await Promise.all([
          listPaymentMethods(),
          listReceiptCategories("EGRESO"),
        ]);

        // Las categorias de cargo son semillas: si el dueño todavia no abrio un formulario de pago,
        // hay que sembrarlas antes de listarlas.
        if (needsCatalogSeed(methodData, categoryData)) {
          await ensureCatalogs();
          const refetched = await Promise.all([
            listPaymentMethods(),
            listReceiptCategories("EGRESO"),
          ]);

          methodData = refetched[0];
          categoryData = refetched[1];
        }

        if (!isMounted) {
          return;
        }

        setMethods(methodData);
        setCategories(
          categoryData.filter((category) =>
            (BANK_CHARGE_CATEGORY_CODES as readonly string[]).includes(category.code),
          ),
        );
      } catch (error) {
        if (isMounted) {
          toast.error(getErrorMessage(error));
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [open, account.id, form]);

  function handleSubmit(values: BankChargeFormValues) {
    if (lastClosedEnd && isDateClosed(values.chargeDate, lastClosedEnd)) {
      const message = `La fecha cae en un período cerrado (hasta ${formatDate(
        lastClosedEnd,
      )}). Usa una fecha posterior al cierre.`;
      form.setError("chargeDate", { message });
      toast.error(message);
      return;
    }

    onDone(values);
  }

  const errors = form.formState.errors;
  const methodItems = useMemo(
    () => methods.map((method) => ({ value: method.id, label: method.name })),
    [methods],
  );
  const categoryItems = useMemo(
    () => categories.map((category) => ({ value: category.id, label: category.name })),
    [categories],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {/* noValidate: el `min` nativo bloquea el submit y dejaria inalcanzable el mensaje propio de
        periodo cerrado; el schema y handleSubmit validan. */}
        <form
          id={BANK_CHARGE_FORM_ID}
          noValidate
          onSubmit={form.handleSubmit(handleSubmit)}
          className="flex flex-col gap-5 p-6"
        >
          <div className="flex flex-col gap-1">
            <DialogTitle>Registrar cargo bancario</DialogTitle>
            <DialogDescription>
              {account.name} · se registra como un recibo de egreso con la categoría del cargo (ITF,
              comisión o detracción).
            </DialogDescription>
          </div>

          <Controller
            control={form.control}
            name="categoryId"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="categoryId">Tipo de cargo</Label>
                <Select
                  value={field.value || null}
                  items={categoryItems}
                  onValueChange={(value) => field.onChange(value ?? "")}
                >
                  <SelectTrigger id="categoryId" className="w-full">
                    <SelectValue placeholder="Selecciona el cargo" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoryItems.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.categoryId?.message} />
                {categories.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Las categorías de cargo bancario se siembran al abrir el módulo de caja; si no
                    aparecen, revisa Configuración.
                  </p>
                ) : null}
              </div>
            )}
          />

          <Controller
            control={form.control}
            name="methodId"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="methodId">Método</Label>
                <Select
                  value={field.value || null}
                  items={methodItems}
                  onValueChange={(value) => field.onChange(value ?? "")}
                >
                  <SelectTrigger id="methodId" className="w-full">
                    <SelectValue placeholder="Selecciona el método" />
                  </SelectTrigger>
                  <SelectContent>
                    {methodItems.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.methodId?.message} />
              </div>
            )}
          />

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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chargeDate">Fecha</Label>
            <Input
              id="chargeDate"
              type="date"
              min={openFrom}
              aria-invalid={!!errors.chargeDate}
              {...form.register("chargeDate")}
            />
            <FieldError message={errors.chargeDate?.message} />
            <p className="text-xs text-muted-foreground">
              Solo fechas abiertas: el último cierre bloquea los días anteriores.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="reference">Referencia (opcional)</Label>
            <Input
              id="reference"
              placeholder="Ej. operación 0012345"
              aria-invalid={!!errors.reference}
              {...form.register("reference")}
            />
            <FieldError message={errors.reference?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="bankChargeNotes">Notas (opcional)</Label>
            <Textarea
              id="bankChargeNotes"
              placeholder="Observaciones del cargo"
              aria-invalid={!!errors.notes}
              {...form.register("notes")}
            />
            <FieldError message={errors.notes?.message} />
          </div>

          <div className="flex items-center justify-end gap-2">
            <DialogClose render={<Button variant="outline" />}>Cancelar</DialogClose>
            <Button type="submit" form={BANK_CHARGE_FORM_ID} disabled={isSaving}>
              {isSaving ? "Registrando…" : "Registrar cargo"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
