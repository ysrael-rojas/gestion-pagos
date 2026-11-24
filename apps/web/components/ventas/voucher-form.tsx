"use client";

// Formulario de comprobante (port de `components/comprobantes/voucher-form.tsx` del origen, 700
// lineas). Es COMPARTIDO con compras via `voucherKind` (S1): la etiqueta de la entidad, la ruta
// base y los titulos salen de `voucherCopy`, y las dos reglas de ventas (serie por defecto y
// FACTURA con RUC) viven en `lib/ventas/series.ts` y `lib/ventas/formulario.ts`.
//
// Diferencias con el origen, todas por el stack o por decisiones ya tomadas en el slice:
//
//   * No hay `useVoucherSeries()`: `apps/api` **no** expone las series (la UI de series es
//     `/configuracion`, fuera del slice 1). El componente recibe `series?: VoucherSeries[]`; con
//     `undefined` (hoy) no promete nada de series: no sugiere correlativo ni deshabilita tipos.
//     Ver el comentario de `seriesGatesTypes`.
//   * Los montos salen de `saleAmounts` de `@gestion/shared` (S2), no de un `calculateAmounts` local.
//   * `dueDate` se previsualiza con `calculateDueDate` de `lib/ventas/fechas.ts`, que trabaja en UTC:
//     el origen usaba la hora local del navegador (S9).
//   * Los mensajes de S5 son constantes de `lib/ventas`, no texto partido en el JSX: asi el test los
//     compara completos.
//   * Las entidades NO se cargan desde `lib/clientes`: clientes vienen del `ClientesProvider` del
//     layout (ya hidratados) y proveedores de `listSuppliers()`, igual que el origen.
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useClientes } from "@/components/clientes/clientes-provider";
import type { Client } from "@/components/clientes/types";
import {
  EntityAutocomplete,
  toEntityAutocompleteItems,
} from "@/components/shared/entity-autocomplete";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { listSuppliers } from "@/lib/clientes/entidades";
import { calculateDueDate } from "@/lib/ventas/fechas";
import {
  FACTURA_REQUIRES_RUC,
  FACTURA_RUC_HINT,
  NO_ADDRESS_PLACEHOLDER,
  canIssueFactura,
  createEmptyVoucherFormValues,
  creditDaysForPaymentType,
  isPaidLocked,
  paidLockMessage,
  toVoucherFormValues,
  voucherCopy,
} from "@/lib/ventas/formulario";
import {
  CONFIGURE_SERIES_LABEL,
  NO_SALE_SERIES_HINT,
  NO_SALE_SERIES_MESSAGE,
  SERIES_CONFIG_PATH,
  defaultSeriesByType,
  hasAnyDefaultSaleSeries,
  isVoucherTypeDisabled,
  missingDefaultSaleSeriesLabels,
  missingSeriesMessage,
  suggestVoucherNumber,
} from "@/lib/ventas/series";
import type {
  PaymentType,
  VoucherDetail,
  VoucherKind,
  VoucherSeries,
  VoucherType,
} from "@/lib/ventas/types";
import {
  PAYMENT_TYPES,
  SALE_STATUSES,
  VOUCHER_TYPES,
} from "@gestion/shared/lib/data/sale-options.ts";
import {
  voucherFormSchema,
  type VoucherFormInput,
  type VoucherFormValues,
} from "@gestion/shared/lib/schemas/voucher.ts";
import { saleAmounts } from "@gestion/shared/lib/ventas/montos.ts";
import { cn, formatCurrency, getTodayLocalDate } from "@gestion/shared";

interface VoucherFormProps {
  voucherKind: VoucherKind;
  voucher?: VoucherDetail | null;
  /**
   * Series del dueno, cuando exista de donde leerlas. `undefined` = no hay fuente todavia (el
   * API no expone series), y en ese caso el formulario no sugiere correlativo ni deshabilita tipos.
   */
  series?: VoucherSeries[];
  onSubmit: (values: VoucherFormValues) => void;
}

/** Id del `<form>`: lo usa el boton Guardar, que vive fuera (en el pie de la vista). */
export const VOUCHER_FORM_ID = "voucher-form";

const voucherTypeItems = VOUCHER_TYPES.map((option) => ({
  value: option.value,
  label: option.label,
}));

const paymentTypeItems = PAYMENT_TYPES.map((option) => ({
  value: option.value,
  label: option.label,
}));

const statusItems = SALE_STATUSES.map((option) => ({
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
        Requerido
      </Badge>
    </div>
  );
}

function FormGroup({
  title,
  children,
  className,
  contentClassName,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={cn("bg-muted/30 ring-0", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            "grid grid-cols-1 gap-4 sm:grid-cols-2",
            contentClassName
          )}
        >
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

export function VoucherForm({
  voucherKind,
  voucher,
  series,
  onSubmit,
}: VoucherFormProps) {
  const isSale = voucherKind === "VENTA";
  const copy = voucherCopy(voucherKind);

  const { clients, isLoading: isClientsLoading } = useClientes();
  const [suppliers, setSuppliers] = useState<Client[]>([]);
  const [isSuppliersLoading, setIsSuppliersLoading] = useState(true);

  useEffect(() => {
    if (isSale) {
      return;
    }

    let isMounted = true;

    void (async () => {
      try {
        const data = await listSuppliers();

        if (isMounted) {
          setSuppliers(data);
        }
      } catch {
        if (isMounted) {
          setSuppliers([]);
        }
      } finally {
        if (isMounted) {
          setIsSuppliersLoading(false);
        }
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [isSale]);

  const form = useForm<VoucherFormInput, unknown, VoucherFormValues>({
    resolver: zodResolver(voucherFormSchema),
    defaultValues: createEmptyVoucherFormValues(),
  });

  useEffect(() => {
    form.reset(
      voucher ? toVoucherFormValues(voucher) : createEmptyVoucherFormValues()
    );
  }, [voucher, form]);

  const total = useWatch({ control: form.control, name: "total" });
  const numericTotal = Number(total);
  const { subtotal, igv } = saleAmounts(
    Number.isFinite(numericTotal) ? numericTotal : 0
  );

  const paymentType = useWatch({ control: form.control, name: "paymentType" });
  const issueDate = useWatch({ control: form.control, name: "issueDate" });
  const creditDays = useWatch({ control: form.control, name: "creditDays" });
  const voucherType = useWatch({ control: form.control, name: "voucherType" });
  const entityId = useWatch({ control: form.control, name: "entityId" });

  const isCredit = paymentType === "CREDITO";
  const dueDate = isCredit
    ? calculateDueDate(issueDate, Number(creditDays))
    : "";

  const registrationDate = voucher?.registrationDate ?? getTodayLocalDate();
  const entities = isSale ? clients : suppliers;
  const entityItems = toEntityAutocompleteItems(entities);
  const isEntityLoading = isSale ? isClientsLoading : isSuppliersLoading;

  const selectedEntity =
    entities.find((entity) => entity.id === entityId) ?? null;
  const canIssueFacturaForEntity = canIssueFactura(voucherKind, selectedEntity);
  const isLocked = isPaidLocked(voucher);

  const errors = form.formState.errors;

  // Series: `undefined` significa "no hay fuente todavia" (S1: el API no expone series y la UI de
  // `/configuracion` es de un slice posterior). Sin fuente, el formulario NO deshabilita tipos: la
  // sugerencia es una ayuda y la RPC registra igual sin serie configurada (S7). Cuando T5 o el
  // slice de series pase el arreglo, la regla del origen se activa sola.
  const seriesGatesTypes = isSale && series !== undefined;
  const ownerSeries = useMemo(() => series ?? [], [series]);

  const defaultByType = useMemo(
    () => defaultSeriesByType(ownerSeries),
    [ownerSeries]
  );

  const missingSeriesLabels = useMemo(
    () => (seriesGatesTypes ? missingDefaultSaleSeriesLabels(ownerSeries) : []),
    [ownerSeries, seriesGatesTypes]
  );

  const hasAnySeries = useMemo(
    () => (seriesGatesTypes ? hasAnyDefaultSaleSeries(ownerSeries) : true),
    [ownerSeries, seriesGatesTypes]
  );

  const defaultSeries = voucherType ? defaultByType.get(voucherType) ?? null : null;

  const previousTypeRef = useRef<VoucherType | "">("");
  const suggestionRef = useRef("");

  // Sugerencia de numeracion (solo ventas nuevas y solo con series cargadas). Si cambia el tipo se
  // recalcula; si el usuario edito el numero a mano, se respeta.
  useEffect(() => {
    if (!seriesGatesTypes || voucher || !series) {
      previousTypeRef.current = "";
      suggestionRef.current = "";
      return;
    }

    const typeChanged = previousTypeRef.current !== voucherType;
    previousTypeRef.current = voucherType;

    if (!defaultSeries) {
      suggestionRef.current = "";
      return;
    }

    const nextSuggestion = suggestVoucherNumber(defaultSeries);
    const currentNumber = form.getValues("voucherNumber");

    if (
      typeChanged ||
      !currentNumber ||
      currentNumber === suggestionRef.current
    ) {
      form.setValue("voucherNumber", nextSuggestion, { shouldValidate: false });
    }

    suggestionRef.current = nextSuggestion;
  }, [defaultSeries, form, seriesGatesTypes, series, voucher, voucherType]);

  function isTypeDisabled(value: VoucherType): boolean {
    return isVoucherTypeDisabled({
      voucherKind,
      voucherType: value,
      // `null` cuando no hay fuente de series: ver `seriesGatesTypes`.
      defaultByType: seriesGatesTypes ? defaultByType : null,
      canIssueFactura: canIssueFacturaForEntity,
    });
  }

  function handleSubmit(values: VoucherFormValues) {
    // En ventas una factura exige RUC; en compras el tipo queda libre (S5). La regla es de
    // PANTALLA: el API no la valida a proposito, porque bloquearia la edicion de comprobantes
    // historicos (decision de T3, L11).
    if (
      voucherKind === "VENTA" &&
      values.voucherType === "FACTURA" &&
      !canIssueFacturaForEntity
    ) {
      form.setError("voucherType", { message: FACTURA_REQUIRES_RUC });
      return;
    }

    onSubmit(values);
  }

  return (
    <form
      id={VOUCHER_FORM_ID}
      onSubmit={form.handleSubmit(handleSubmit)}
      className="flex flex-col gap-4"
    >
      {isLocked ? (
        <p
          role="status"
          className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          {paidLockMessage(voucherKind)}
        </p>
      ) : null}

      {seriesGatesTypes && !voucher && !hasAnySeries ? (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm"
        >
          <p className="font-medium">{NO_SALE_SERIES_MESSAGE}</p>
          <p className="text-muted-foreground">{NO_SALE_SERIES_HINT}</p>
          <Link
            href={SERIES_CONFIG_PATH}
            className="font-medium text-brand-strong hover:underline"
          >
            {CONFIGURE_SERIES_LABEL}
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <FormGroup title="Datos del comprobante" className="lg:col-span-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="issueDate">Fecha de emisión</Label>
            <Input
              id="issueDate"
              type="date"
              disabled={isLocked}
              aria-invalid={!!errors.issueDate}
              {...form.register("issueDate")}
            />
            <FieldError message={errors.issueDate?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="registrationDate">Fecha de registro</Label>
            <Input
              id="registrationDate"
              type="date"
              value={registrationDate}
              readOnly
              disabled
            />
          </div>

          <Controller
            control={form.control}
            name="voucherType"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <RequiredLabel htmlFor="voucherType">
                  Tipo de comprobante
                </RequiredLabel>
                <Select
                  value={field.value ? field.value : null}
                  items={voucherTypeItems}
                  onValueChange={(value) =>
                    field.onChange(value ?? ("" as VoucherType))
                  }
                >
                  <SelectTrigger
                    id="voucherType"
                    className="w-full"
                    aria-invalid={!!errors.voucherType}
                  >
                    <SelectValue placeholder="Selecciona un tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {VOUCHER_TYPES.map((option) => (
                      <SelectItem
                        key={option.value}
                        value={option.value}
                        disabled={isTypeDisabled(option.value)}
                      >
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isSale && !canIssueFacturaForEntity ? (
                  <p className="text-xs text-muted-foreground">
                    {FACTURA_RUC_HINT}
                  </p>
                ) : null}
                {missingSeriesLabels.length ? (
                  <p className="text-xs text-muted-foreground">
                    {missingSeriesMessage(missingSeriesLabels)}
                  </p>
                ) : null}
                <FieldError message={errors.voucherType?.message} />
              </div>
            )}
          />

          <div className="flex flex-col gap-1.5">
            <RequiredLabel htmlFor="voucherNumber">
              Nro comprobante
            </RequiredLabel>
            <Input
              id="voucherNumber"
              placeholder="F001-000001"
              disabled={isLocked}
              aria-invalid={!!errors.voucherNumber}
              {...form.register("voucherNumber")}
            />
            <FieldError message={errors.voucherNumber?.message} />
          </div>

          <Controller
            control={form.control}
            name="entityId"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <RequiredLabel htmlFor="entityId">
                  {copy.entityLabel}
                </RequiredLabel>
                <EntityAutocomplete
                  id="entityId"
                  items={entityItems}
                  value={field.value ? field.value : null}
                  onValueChange={(value) => {
                    field.onChange(value);

                    const entity =
                      entities.find((item) => item.id === value) ?? null;
                    const suggestedType: VoucherType =
                      entity?.documentType === "RUC" ? "FACTURA" : "BOLETA";

                    // En ventas solo se autoselecciona si el tipo tiene serie por defecto
                    // configurada; sin fuente de series no hay nada que consultar.
                    if (!seriesGatesTypes || defaultByType.has(suggestedType)) {
                      form.setValue("voucherType", suggestedType);
                    }
                  }}
                  placeholder={copy.entityPlaceholder}
                  isLoading={isEntityLoading}
                  isDisabled={isLocked}
                  aria-invalid={!!errors.entityId}
                />
                {selectedEntity ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="entityAddress">Dirección</Label>
                    <Input
                      id="entityAddress"
                      value={
                        selectedEntity.address.trim() || NO_ADDRESS_PLACEHOLDER
                      }
                      readOnly
                    />
                  </div>
                ) : null}
                <FieldError message={errors.entityId?.message} />
              </div>
            )}
          />
        </FormGroup>

        <FormGroup
          title="Condición de pago"
          className="lg:col-span-1"
          contentClassName="sm:grid-cols-1"
        >
          <Controller
            control={form.control}
            name="paymentType"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <RequiredLabel htmlFor="paymentType">Condición</RequiredLabel>
                <Select
                  value={field.value ? field.value : null}
                  items={paymentTypeItems}
                  onValueChange={(value) => {
                    const next = (value ?? "") as PaymentType | "";
                    field.onChange(next);
                    // S3: arranca en 30 al elegir Crédito y se limpia al volver a Contado.
                    form.setValue("creditDays", creditDaysForPaymentType(next));
                  }}
                >
                  <SelectTrigger
                    id="paymentType"
                    className="w-full"
                    aria-invalid={!!errors.paymentType}
                  >
                    <SelectValue placeholder="Selecciona un tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_TYPES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.paymentType?.message} />
              </div>
            )}
          />

          {isCredit ? (
            <>
              <div className="flex flex-col gap-1.5">
                <RequiredLabel htmlFor="creditDays">
                  Días de crédito
                </RequiredLabel>
                <Input
                  id="creditDays"
                  type="number"
                  step="1"
                  min="1"
                  placeholder="30"
                  aria-invalid={!!errors.creditDays}
                  {...form.register("creditDays")}
                />
                <FieldError message={errors.creditDays?.message} />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dueDate">Fecha de vencimiento</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  readOnly
                  disabled
                />
              </div>
            </>
          ) : null}

          <Controller
            control={form.control}
            name="status"
            render={({ field }) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="status">Estado</Label>
                <Select
                  value={field.value ? field.value : null}
                  items={statusItems}
                  onValueChange={(value) => field.onChange(value ?? "")}
                >
                  <SelectTrigger id="status" className="w-full">
                    <SelectValue placeholder="Selecciona un estado" />
                  </SelectTrigger>
                  <SelectContent>
                    {SALE_STATUSES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError message={errors.status?.message} />
              </div>
            )}
          />
        </FormGroup>

        <FormGroup
          title="Montos"
          className="lg:col-span-4"
          contentClassName="sm:grid-cols-3"
        >
          <div className="flex flex-col gap-1.5">
            <RequiredLabel htmlFor="total">Total</RequiredLabel>
            <Input
              id="total"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              disabled={isLocked}
              aria-invalid={!!errors.total}
              {...form.register("total")}
            />
            <FieldError message={errors.total?.message} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subtotal">Subtotal (solo lectura)</Label>
            <Input
              id="subtotal"
              value={formatCurrency(subtotal)}
              readOnly
              disabled
            />
          </div>

          <div className="flex flex-col gap-1.5">
            {/* Texto de S5, verbatim: el IGV no se edita, se deriva del total. */}
            <Label htmlFor="igv">IGV 18 % (solo lectura)</Label>
            <Input id="igv" value={formatCurrency(igv)} readOnly disabled />
          </div>
        </FormGroup>
      </div>
    </form>
  );
}
