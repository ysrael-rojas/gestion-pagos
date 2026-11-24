"use client";

// Alta y edicion de un comprobante (port de `components/comprobantes/voucher-form-view.tsx` del
// origen, 189 lineas). Es la vista que monta la pagina: en ventas, `/ventas/nuevo` y
// `/ventas/[id]/editar`.
//
// Diferencias con el origen:
//
//   * La escritura va por `VOUCHER_SOURCES[voucherKind]` (POST/PATCH al API), no por PostgREST, y
//     el body lo arma `toVoucherRequestBody` (que omite `creditDays` en CONTADO: ver el comentario
//     en `lib/ventas/formulario.ts`).
//   * NO hay `advanceSeriesNumber`: el avance del correlativo lo hace la RPC `crear_venta` en la
//     misma transaccion que el alta (S8). En el origen eran dos llamadas y un toast si la segunda
//     fallaba (L5).
//   * NO se refresca un provider de ventas: no hay uno en el layout y el listado recarga al
//     montarse, asi que volver de una edicion siempre lee datos frescos.
//   * Los errores del API se muestran tal cual (`ApiError.message`): `Ya registraste una venta con
//     ese número de comprobante.`, el mensaje del trigger de pagos, etc. No se traducen aca.
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { BackLink } from "@/components/shared/back-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { VOUCHER_FORM_ID, VoucherForm } from "@/components/ventas/voucher-form";
import { useVoucher } from "@/components/ventas/use-voucher";
import { toVoucherRequestBody, voucherCopy } from "@/lib/ventas/formulario";
import type { VoucherKind, VoucherSeries } from "@/lib/ventas/types";
import { VOUCHER_SOURCES } from "@/lib/ventas/ventas";
import type { VoucherFormValues } from "@gestion/shared/lib/schemas/voucher.ts";
import { cn } from "@gestion/shared";

interface VoucherFormViewProps {
  voucherKind: VoucherKind;
  /** Sin id es un alta; con id, la edicion de ese comprobante. */
  voucherId?: string;
  /**
   * Series del dueno. El `apps/api` de este slice no las expone: cuando exista el recurso, la
   * pagina las pasa y el formulario habilita sugerencia de correlativo y la regla de series de S5.
   */
  series?: VoucherSeries[];
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
  series,
}: VoucherFormViewProps) {
  const router = useRouter();
  const copy = voucherCopy(voucherKind);
  const isEditing = voucherId !== undefined;
  const source = VOUCHER_SOURCES[voucherKind];
  const { voucher, isLoading, error } = useVoucher(voucherId, voucherKind);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(values: VoucherFormValues) {
    setIsSaving(true);

    try {
      const body = toVoucherRequestBody(values);
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
        series={series}
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
        <Button type="submit" form={VOUCHER_FORM_ID} disabled={isSaving}>
          {isSaving ? "Guardando…" : isEditing ? "Guardar cambios" : "Registrar"}
        </Button>
      </div>
    </main>
  );
}
