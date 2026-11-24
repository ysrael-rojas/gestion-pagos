"use client";

// Formulario de serie (T4 del slice 2: S8 de `odd/tasks/port-vertical-series.md`).
//
// Port de `components/configuracion/serie-modal.tsx` del origen, la parte de formulario. Tres
// diferencias con el origen, todas del contrato de este slice:
//
// 1. EL SELECT DE TIPO OFRECE SOLO LOS TRES TIPOS QUE SE EMITEN (S4). El origen usaba los seis del
//    enum; `NOTA_CREDITO`, `NOTA_DEBITO` y `COMPROBANTE_RETENCION` llegan cuando exista el flujo que
//    los emite. `SERIES_TYPE_OPTIONS` es el mismo subconjunto que valida `serieFormSchema`.
// 2. EL TIPO SE DESHABILITA AL EDITAR. Cambiarlo reescribiria la numeracion ya emitida a nombre de
//    otro tipo de comprobante (S5, L4a): la RPC `editar_serie` ni lo recibe.
// 3. LA AYUDA DEL CODIGO DICE QUE EL CORRELATIVO LO ASIGNA EL SISTEMA (S8, "[cambia]"): en el
//    origen decia que "se sugiere", y hoy sugerir seria mentir.
//
// El texto del codigo se normaliza a mayusculas al tipear con `normalizeSerieCodeInput`, y el
// `maxLength` de 4 lo fija el propio CHECK de la base (`^[A-Za-z0-9]{1,4}$`).
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SERIES_COPY,
  SERIES_TYPE_OPTIONS,
  createEmptySerieFormValues,
  normalizeSerieCodeInput,
  toSerieFormValues,
} from "@/lib/configuracion/series";
import {
  serieFormSchema,
  type SerieFormInput,
  type SerieFormValues,
  type VoucherSeriesRow,
} from "@gestion/shared/lib/schemas/serie.ts";
import type { VoucherType } from "@/lib/ventas/types";

interface SerieFormProps {
  /** La serie que se edita, o `null` en un alta. */
  serie: VoucherSeriesRow | null;
  onSubmit: (values: SerieFormValues) => void;
}

/** Id del `<form>`: lo usa el boton Guardar, que vive fuera (en el pie del modal). */
export const SERIE_FORM_ID = "serie-form";

/** Limite del codigo de serie (`^[A-Za-z0-9]{1,4}$`). */
export const SERIES_CODE_MAX_LENGTH = 4;

const typeItems = SERIES_TYPE_OPTIONS.map((option) => ({
  value: option.value,
  label: option.label,
}));

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null;
  }

  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function RequiredLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Label htmlFor={htmlFor}>{children}</Label>
      <Badge
        variant="outline"
        className="border-destructive/40 font-normal text-destructive"
      >
        {SERIES_COPY.requiredBadge}
      </Badge>
    </div>
  );
}

export function SerieForm({ serie, onSubmit }: SerieFormProps) {
  const isEditing = serie !== null;

  const form = useForm<SerieFormInput, unknown, SerieFormValues>({
    resolver: zodResolver(serieFormSchema),
    defaultValues: createEmptySerieFormValues(),
  });

  useEffect(() => {
    form.reset(
      serie ? toSerieFormValues(serie) : createEmptySerieFormValues()
    );
  }, [serie, form]);

  const errors = form.formState.errors;

  return (
    <form
      id={SERIE_FORM_ID}
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
    >
      <Controller
        control={form.control}
        name="voucherType"
        render={({ field }) => (
          <div className="flex flex-col gap-1.5">
            <RequiredLabel htmlFor="serie-voucher-type">
              {SERIES_COPY.fieldType}
            </RequiredLabel>
            <Select
              value={field.value ? field.value : null}
              items={typeItems}
              onValueChange={(value) =>
                field.onChange(value ?? ("" as VoucherType))
              }
            >
              <SelectTrigger
                id="serie-voucher-type"
                className="w-full"
                // El tipo de una serie no se edita: cambiarlo renumeraria lo ya emitido (S5).
                disabled={isEditing}
                aria-invalid={!!errors.voucherType}
              >
                <SelectValue placeholder="Selecciona un tipo" />
              </SelectTrigger>
              <SelectContent>
                {SERIES_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={errors.voucherType?.message} />
          </div>
        )}
      />

      <div className="flex flex-col gap-1.5">
        <RequiredLabel htmlFor="serie-code">{SERIES_COPY.fieldCode}</RequiredLabel>
        <Controller
          control={form.control}
          name="code"
          render={({ field }) => (
            <Input
              id="serie-code"
              value={field.value}
              placeholder={SERIES_COPY.codePlaceholder}
              maxLength={SERIES_CODE_MAX_LENGTH}
              autoFocus
              aria-invalid={!!errors.code}
              onChange={(event) =>
                field.onChange(normalizeSerieCodeInput(event.target.value))
              }
            />
          )}
        />
        {errors.code ? (
          <FieldError message={errors.code.message} />
        ) : (
          <p className="text-xs text-muted-foreground">{SERIES_COPY.codeHint}</p>
        )}
      </div>

      <Controller
        control={form.control}
        name="isDefault"
        render={({ field }) => (
          <div className="flex items-start gap-2">
            <Checkbox
              id="serie-is-default"
              checked={field.value}
              onCheckedChange={(checked) => field.onChange(checked)}
            />
            <div className="flex flex-col gap-1">
              <Label htmlFor="serie-is-default">
                {SERIES_COPY.defaultCheckboxLabel}
              </Label>
              <p className="text-xs text-muted-foreground">
                {SERIES_COPY.defaultCheckboxHint}
              </p>
            </div>
          </div>
        )}
      />
    </form>
  );
}
