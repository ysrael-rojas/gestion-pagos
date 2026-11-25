"use client";

// Alta y edicion de un comprobante (port de `components/comprobantes/voucher-form-view.tsx` del
// origen, 189 lineas). Es la vista que monta la pagina: en ventas, `/ventas/nuevo` y
// `/ventas/[id]/editar`.
//
// Diferencias con el origen:
//
//   * La escritura va por `VOUCHER_SOURCES[voucherKind]` (POST/PATCH al API), no por PostgREST, y
//     el body lo arma `toVoucherRequestBody` (que omite `creditDays` en CONTADO y ya no manda el
//     numero: ver el comentario en `lib/ventas/formulario.ts`).
//   * Las SERIES se cargan aca (`useVoucherSeries`) y bajan al formulario. No se cargan en la pagina
//     porque las paginas de ventas son Server Components que no resuelven datos y el transporte del
//     frontend no reenvia la cookie de sesion desde el servidor de Next (ver el comentario del
//     hook). Con las series en mano, esta vista puede BLOQUEAR el guardado cuando el alta no tiene
//     ninguna serie por defecto de venta (S11): el boton queda deshabilitado, no solo el aviso.
//   * NO hay `advanceSeriesNumber`: el avance del correlativo lo hace la RPC `crear_venta` en la
//     misma transaccion que el alta (S8). En el origen eran dos llamadas y un toast si la segunda
//     fallaba (L5).
//   * NO se refresca un provider de ventas: no hay uno en el layout y el listado recarga al
//     montarse, asi que volver de una edicion siempre lee datos frescos.
//   * Los errores del API se muestran tal cual (`ApiError.message`): el mensaje del trigger de pagos,
//     `No hay una serie por defecto para este tipo de comprobante...` (S6), etc. No se traducen aca.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { BackLink } from "@/components/shared/back-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VOUCHER_FORM_ID, VoucherForm } from "@/components/ventas/voucher-form";
import { useVoucher } from "@/components/ventas/use-voucher";
import { useVoucherSeries } from "@/components/ventas/use-voucher-series";
import { toVoucherRequestBody, voucherCopy } from "@/lib/ventas/formulario";import { isSaleSeriesBlocked } from "@/lib/ventas/series";
import type { VoucherKind } from "@/lib/ventas/types";
import { VOUCHER_SOURCES } from "@/lib/ventas/ventas";
import type { VoucherFormValues } from "@gestion/shared/lib/schemas/voucher.ts";
import { cn } from "@gestion/shared";

interface VoucherFormViewProps {
  voucherKind: VoucherKind;
  /** Sin id es un alta; con id, la edicion de ese comprobante. */
  voucherId?: string;
}

const SAVED_MESSAGES: Record<VoucherKind, { created: string; updated: string }> = {
  VENTA: { created: "Venta registrada", updated: "Venta actualizada" },
  COMPRA: { created: "Compra registrada", updated: "Compra actualizada" },
};

const SAVE_FALLBACK_MESSAGE =
  "No se pudo guardar el comprobante. Intenta nuevamente.";

export function VoucherFormView({
  voucherKind,
  voucherId,
}: VoucherFormViewProps) {
  const router = useRouter();
  const copy = voucherCopy(voucherKind);
  const isEditing = voucherId !== undefined;
  const isSale = voucherKind === "VENTA";
  const source = VOUCHER_SOURCES[voucherKind];
  const { voucher, isLoading, error } = useVoucher(voucherId, voucherKind);
  const {
    series,
    isLoading: isSeriesLoading,
    error: seriesError,
  } = useVoucherSeries(isSale);
  const [isSaving, setIsSaving] = useState(false);

  // S11: sin ninguna serie por defecto de venta no hay alta posible (la base necesita de donde
  // numerar), asi que el guardado se deshabilita. Solo cuenta cuando la carga TERMINO bien: un error
  // de red no puede disfrazarse de "no hay series" (para eso esta `seriesError`, que muestra el
  // texto y deja que el API responda con el suyo).
  const isSeriesBlocked =
    !isSeriesLoading &&
    !seriesError &&
    isSaleSeriesBlocked({ voucherKind, isEditing, series });

  async function handleSubmit(values: VoucherFormValues) {
    setIsSaving(true);

    try {
      const body = toVoucherRequestBody(values, voucherKind);
      const saved =
        isEditing && voucherId
          ? await source.update(voucherId, body)
          : await source.create(body);

      toast.success(
        isEditing
          ? SAVED_MESSAGES[voucherKind].updated
          : SAVED_MESSAGES[voucherKind].created
      );
      router.push(`${copy.basePath}/${saved.id}`);
    } catch (saveError) {
      toast.error(
        saveError instanceof Error ? saveError.message : SAVE_FALLBACK_MESSAGE
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isEditing && isLoading) {
    return (
      <main className="container mx-auto flex flex-col gap-6 p-6">
        <BackLink href={copy.basePath} />
        <p className="text-sm text-muted-foreground">Cargando comprobante…</p>
      </main>
    );
  }

  if (isEditing && (error || !voucher)) {
    return (
      <main className="container mx-auto flex flex-col gap-6 p-6">
        <BackLink href={copy.basePath} />
        <Card>
          <CardContent className="flex flex-col items-start gap-3">
            <h1 className="text-2xl font-semibold">Comprobante no encontrado</h1>
            <p className="text-sm text-muted-foreground">
              {error ??
                "No encontramos ese comprobante. Puede haber sido anulado o el enlace no es válido."}
            </p>
            <Link
              href={copy.basePath}
              className="text-sm font-medium text-brand-strong hover:underline"
            >
              Volver al listado
            </Link>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <BackLink href={copy.basePath} />
        <h1 className="text-2xl font-semibold">
          {isEditing ? copy.editTitle : copy.createTitle}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isEditing ? copy.editSubtitle : copy.createSubtitle}
        </p>
      </div>

      <VoucherForm
        voucherKind={voucherKind}
        voucher={voucher}
        series={isSale ? series : undefined}
        seriesLoading={isSale && isSeriesLoading}
        seriesError={seriesError}
        onSubmit={handleSubmit}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        {/* Un enlace no se renderiza con `Button` (Base UI): se estiliza el <a>. */}
        <Link
          href={copy.basePath}
          className={cn(
            buttonVariants({ variant: "outline" }),
            isSaving && "pointer-events-none opacity-50"
          )}
        >
          Cancelar
        </Link>
        <Button
          type="submit"
          form={VOUCHER_FORM_ID}
          disabled={isSaving || isSeriesBlocked}
        >
          {isSaving ? "Guardando…" : isEditing ? "Guardar cambios" : "Registrar"}
        </Button>
      </div>
    </main>
  );
}
