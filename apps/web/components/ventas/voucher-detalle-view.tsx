"use client";

// Detalle de un comprobante (port de `components/comprobantes/voucher-detalle-view.tsx` del origen,
// 445 lineas). Es la vista que monta `/ventas/[id]` y, cuando se porte compras, `/compras/[id]`:
// todo lo que cambia por vertical sale de `voucherKind` (S1).
//
// QUE NO SE PORTA, y por que:
//
//   * Las solapas de notas de credito/debito y retenciones: son otro modulo, y `apps/api` no tiene
//     esas rutas todavia (S1: el slice 1 son comprobantes base).
//   * El historial de pagos y el `PaymentDrawer`: el pago es el vertical de pagos, y el slice 1
//     prohibe portar el drawer. `Registrar pago` es un ENLACE al alta de recibos que ya existe
//     (`paymentEntryHref`), con la entidad y el comprobante precargados.
//
// Lo que si se conserva: la banda de montos (total, abonado y saldo, que vienen calculados de la
// base), el badge de estado, el boton de cobro solo cuando queda saldo PENDIENTE (S10) y la ficha
// de datos con `dd/mm/yyyy`.
import Link from "next/link";
import { Wallet } from "lucide-react";

import { BackLink } from "@/components/shared/back-link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { VoucherAmountsBand } from "@/components/ventas/voucher-amounts-band";
import { VoucherStatusBadge } from "@/components/ventas/voucher-status-badge";
import { useVoucher } from "@/components/ventas/use-voucher";
import { voucherCopy } from "@/lib/ventas/formulario";
import { canRegisterPayment, paymentEntryHref } from "@/lib/ventas/tabla";
import type { VoucherKind } from "@/lib/ventas/types";
import {
  PAYMENT_TYPES,
  SALE_STATUSES,
  VOUCHER_TYPES,
  getOptionLabel,
} from "@gestion/shared/lib/data/sale-options.ts";
import { formatDate } from "@gestion/shared";

interface VoucherDetalleViewProps {
  voucherKind: VoucherKind;
  voucherId: string;
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value || "—"}</span>
    </div>
  );
}

export function VoucherDetalleView({
  voucherKind,
  voucherId,
}: VoucherDetalleViewProps) {
  const copy = voucherCopy(voucherKind);
  const { voucher, isLoading, error } = useVoucher(voucherId, voucherKind);

  if (isLoading) {
    return (
      <main className="container mx-auto flex flex-col gap-6 p-6">
        <BackLink href={copy.basePath} />
        <p className="text-sm text-muted-foreground">Cargando comprobante…</p>
      </main>
    );
  }

  if (error || !voucher) {
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

  const entityName = voucher.entityName || copy.entityNameFallback;

  return (
    <main className="container mx-auto flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-3">
        <BackLink href={copy.basePath} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-2xl font-semibold">
              {getOptionLabel(VOUCHER_TYPES, voucher.voucherType)}{" "}
              {voucher.voucherNumber}
            </h1>
            <p className="text-sm text-muted-foreground">
              {copy.entityLabel}: {entityName}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <VoucherStatusBadge status={voucher.status} />
            {canRegisterPayment(voucher.status) ? (
              <Link
                href={paymentEntryHref(voucher, voucherKind)}
                className={buttonVariants()}
              >
                <Wallet />
                Registrar pago
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      <VoucherAmountsBand
        total={voucher.total}
        paidAmount={voucher.paidAmount}
        balance={voucher.balance}
      />

      <Card className="bg-muted/30 ring-0">
        <CardHeader>
          <CardTitle>Datos del comprobante</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <DetailField
              label="Fecha de emisión"
              value={formatDate(voucher.issueDate)}
            />
            <DetailField
              label="Fecha de registro"
              value={formatDate(voucher.registrationDate)}
            />
            <DetailField
              label="Tipo de comprobante"
              value={getOptionLabel(VOUCHER_TYPES, voucher.voucherType)}
            />
            <DetailField label="Nro comprobante" value={voucher.voucherNumber} />
            <div className="sm:col-span-2">
              <DetailField label={copy.entityLabel} value={entityName} />
            </div>
            <DetailField
              label="Condición"
              value={getOptionLabel(PAYMENT_TYPES, voucher.paymentType)}
            />
            <DetailField
              label="Días de crédito"
              value={voucher.creditDays != null ? String(voucher.creditDays) : ""}
            />
            <DetailField
              label="Fecha de vencimiento"
              value={voucher.dueDate ? formatDate(voucher.dueDate) : ""}
            />
            <DetailField
              label="Estado"
              value={getOptionLabel(SALE_STATUSES, voucher.status)}
            />
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
