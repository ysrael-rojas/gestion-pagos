"use client";

// Formulario de alta de una nota de credito o de debito (T4 del slice 3: S2, S3, S4, S5, S9 y S11
// de `odd/tasks/port-vertical-notas.md`).
//
// Port de `components/notas/nota-form.tsx` del origen con cuatro cambios, todos del contrato nuevo:
//
// 1. EL TIPO NO SE ELIGE ACA. La nota se registra desde el detalle del comprobante (L3.f) y el tipo
//    es el del boton con el que el usuario abrio el modal: el select de tipo del origen desaparece y
//    el `voucherType` viaja como campo oculto, igual que el `referencedComprobanteId`.
// 2. EL NUMERO ES UN PREVIEW DE SOLO LECTURA (S3): el origen lo tipeaba y lo mandaba. Hoy lo asigna
//    la base desde la serie por defecto del tipo de la nota, y el campo muestra
//    `code-(last+1)` sin viajar en el body (`toNotaRequestBody`).
// 3. LA "FECHA DE REGISTRO" SALE: es una columna de la base y S11 no la lista para este formulario.
// 4. LOS MONTOS SALEN DE `notaAmounts` (que delega en `saleAmounts`, S4), no de un
//    `calculateAmounts` local; y el tope disponible se calcula con las notas ya cargadas.
//
// La ficha del referenciado y los dos avisos son los del origen: `Tope disponible para este
// documento:` para una NC (lo que queda antes de chocar con la invariante de S5) y `Una nota de
// débito aumenta el saldo del comprobante.` para una ND. Los textos viven en `lib/notas/textos.ts`
// y el test los compara completos.
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  availableCredit,
  createEmptyNotaFormValues,
  notaAmounts,
  notaMotiveOptions,
  previewNotaNumber,
} from "@/lib/notas/formulario";
import { NOTAS_COPY } from "@/lib/notas/textos";
import type { VoucherDetail, VoucherSeries } from "@/lib/ventas/types";
import { SERIES_CONFIG_PATH } from "@/lib/ventas/series";
import {
  notaSchema,
  type NotaFormInput,
  type NotaFormValues,
  type VoucherAdjustmentRow,
} from "@gestion/shared/lib/schemas/nota.ts";
import { VOUCHER_TYPES, getOptionLabel } from "@gestion/shared/lib/data/sale-options.ts";
import { formatCurrency, formatDate } from "@gestion/shared";

/** Id del `<form>`: lo usa el boton `Registrar`, que vive en el pie del modal. */
export const NOTA_FORM_ID = "nota-form";

interface NotaFormProps {
  /** El tipo de la nota: lo fijo el boton con el que se abrio el modal. */
  voucherType: "NOTA_CREDITO" | "NOTA_DEBITO";
  /** El comprobante que la nota corrige: de aca salen el id, el total y el saldo. */
  voucher: VoucherDetail;
  /** Las notas ya aplicadas al comprobante: de aca sale el tope disponible (S5). */
  notas: VoucherAdjustmentRow[];
  /** Series del dueno, para el preview del numero (S3). */
  series: VoucherSeries[];
  /** Sin serie por defecto del tipo de la nota no hay numero posible (S3). */
  isSeriesBlocked: boolean;
  onSubmit: (values: NotaFormValues) => void;
}

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
        Requerido
      </Badge>
    </div>
  );
}

function FormGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="bg-muted/30 ring-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
      </CardContent>
    </Card>
  );
}

export function NotaForm({
  voucherType,
  voucher,
  notas,
  series,
  isSeriesBlocked,
  onSubmit,
}: NotaFormProps) {
  const form = useForm<NotaFormInput, unknown, NotaFormValues>({
    resolver: zodResolver(notaSchema),
    // El contenido del modal se remonta por apertura (el `Dialog` de Base UI desmonta al cerrar),
    // asi que los valores iniciales se resuelven una sola vez y no hace falta resetear a mano.
    defaultValues: createEmptyNotaFormValues({
      voucherType,
      referencedComprobanteId: voucher.id,
    }),
  });

  const total = useWatch({ control: form.control, name: "total" });
  const { subtotal, igv } = notaAmounts(Number(total));

  const previewNumber = useMemo(
    () => previewNotaNumber(voucherType, series),
    [series, voucherType]
  );

  // S3/S11: el preview de SOLO LECTURA. Se escribe en el formulario porque `notaSchema` lo exige
  // como campo del formulario, pero `toNotaRequestBody` no lo manda: el numero real lo asigna la
  // base dentro de la transaccion del alta y es el que devuelve el API.
  useEffect(() => {
    form.setValue("voucherNumber", previewNumber, { shouldValidate: false });
  }, [form, previewNumber]);

  const motiveOptions = notaMotiveOptions(voucherType);
  const motiveItems = motiveOptions.map((option) => ({
    value: option.value,
    label: option.label,
  }));

  const consumesCredit = voucherType === "NOTA_CREDITO";
  const creditLeft = availableCredit(voucher.total, notas);
  const errors = form.formState.errors;

  return (
    <form
      id={NOTA_FORM_ID}
      // El form entrega los VALORES; quien escribe es la seccion (que arma el body con
      // `toNotaRequestBody`: el output del formulario no es el body, el numero no viaja). Asi el
      // manejo de errores del API vive en un solo lugar, igual que en `serie-modal`.
      onSubmit={form.handleSubmit(onSubmit)}
      className="flex flex-col gap-4"
    >
      {isSeriesBlocked ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
        >
          {/* S3: sin serie por defecto del tipo de la nota no hay numero que asignar. */}
          <p className="font-medium">{NOTAS_COPY.noSeriesMessage}</p>
          <Link
            href={SERIES_CONFIG_PATH}
            className="font-medium text-brand-strong hover:underline"
          >
            {NOTAS_COPY.configureSeries}
          </Link>
        </div>
      ) : null}

      {/* Ficha del comprobante referenciado, como en el origen: identidad, total y saldo. */}
      <div className="flex flex-col gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
        <p className="font-medium">
          {voucher.entityName} —{" "}
          {getOptionLabel(VOUCHER_TYPES, voucher.voucherType)}{" "}
          {voucher.voucherNumber}
        </p>
        <p className="text-muted-foreground">
          {NOTAS_COPY.fieldIssueDate}: {formatDate(voucher.issueDate)}
        </p>
        <p className="text-muted-foreground">
          {NOTAS_COPY.voucherTotalLabel} {formatCurrency(voucher.total)}
        </p>
        <p className="text-muted-foreground">
          {NOTAS_COPY.balanceLabel} {formatCurrency(voucher.balance)}
        </p>
        {consumesCredit ? (
          <p className="text-muted-foreground">
            {NOTAS_COPY.availableCreditLabel} {formatCurrency(creditLeft)}
          </p>
        ) : (
          <p className="text-muted-foreground">{NOTAS_COPY.debitRaisesBalance}</p>
        )}
      </div>

      <FormGroup title="Datos del comprobante">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nota-issueDate">{NOTAS_COPY.fieldIssueDate}</Label>
          <Input
            id="nota-issueDate"
            type="date"
            aria-invalid={!!errors.issueDate}
            {...form.register("issueDate")}
          />
          <FieldError message={errors.issueDate?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nota-voucherNumber">
            {NOTAS_COPY.fieldVoucherNumber}
          </Label>
          <Input
            id="nota-voucherNumber"
            value={previewNumber}
            // El placeholder depende del tipo, como en el origen (FC01/FD01).
            placeholder={
              voucherType === "NOTA_CREDITO" ? "FC01-000001" : "FD01-000001"
            }
            readOnly
            disabled
          />
        </div>

        <input type="hidden" {...form.register("voucherType")} />
        <input type="hidden" {...form.register("referencedComprobanteId")} />

        <Controller
          control={form.control}
          name="motiveCode"
          render={({ field }) => (
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <RequiredLabel htmlFor="nota-motiveCode">
                {NOTAS_COPY.fieldMotive}
              </RequiredLabel>
              <Select
                value={field.value ? field.value : null}
                items={motiveItems}
                onValueChange={(value) => field.onChange(value ?? "")}
              >
                <SelectTrigger
                  id="nota-motiveCode"
                  className="w-full"
                  aria-invalid={!!errors.motiveCode}
                >
                  <SelectValue placeholder={NOTAS_COPY.motivePlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {motiveOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={errors.motiveCode?.message} />
            </div>
          )}
        />
      </FormGroup>

      <FormGroup title="Montos">
        <div className="flex flex-col gap-1.5">
          <RequiredLabel htmlFor="nota-total">
            {NOTAS_COPY.fieldTotal}
          </RequiredLabel>
          <Input
            id="nota-total"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            aria-invalid={!!errors.total}
            {...form.register("total")}
          />
          <FieldError message={errors.total?.message} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nota-subtotal">{NOTAS_COPY.subtotalLabel}</Label>
          <Input
            id="nota-subtotal"
            value={formatCurrency(subtotal)}
            readOnly
            disabled
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="nota-igv">{NOTAS_COPY.igvLabel}</Label>
          <Input id="nota-igv" value={formatCurrency(igv)} readOnly disabled />
        </div>
      </FormGroup>
    </form>
  );
}
