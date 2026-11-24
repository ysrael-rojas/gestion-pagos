// Badge del estado de pago de un comprobante (S10: columna `Estado pago`).
//
// El origen tiene este badge en `components/shared/payment-status-badge.tsx` y lo comparten ventas
// y compras. En el monorepo no existe todavia (`components/pagos/receipt-status-badge.tsx` es el
// estado del RECIBO, con otros tres valores), asi que vive aca dentro del vertical y lo usa el
// detalle cuando se porte compras.
import { Badge } from "@/components/ui/badge";
import { SALE_STATUSES, getOptionLabel } from "@gestion/shared/lib/data/sale-options.ts";
import type { VoucherStatus } from "@/lib/ventas/types";

const STATUS_STYLES: Record<VoucherStatus, string> = {
  PAGADO:
    "bg-pastel-mint text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  PENDIENTE:
    "bg-pastel-cream text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
};

export function VoucherStatusBadge({ status }: { status: VoucherStatus }) {
  return (
    <Badge variant="outline" className={STATUS_STYLES[status]}>
      {getOptionLabel(SALE_STATUSES, status)}
    </Badge>
  );
}
