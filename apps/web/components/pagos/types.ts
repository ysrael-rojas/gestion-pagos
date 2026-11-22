// Tipos del vertical de pagos que consumen los componentes.
//
// Port de `components/pagos/types.ts` del origen (130 lineas) con dos cambios, los dos de forma:
//
// 1. Las entidades del dominio (Payment, PaymentListItem, PaymentDetail, PaymentHistoryEntry,
//    VoucherBalance, PaymentAllocation, PaymentDirection, PaymentStatus, AssignState) ya no se
//    declaran aca: se reexportan del contrato de `apps/api` (`lib/api/client.ts`), que es la
//    fuente de verdad desde que la UI no habla con la base. Declararlas dos veces fue lo que
//    dejo el cliente anterior con `amount: string` y un `entityName` que el API ya no manda.
// 2. Los catalogos (metodo, categoria, cuenta) se reexportan con los nombres del origen
//    (`PaymentMethodRef`, `CashReceiptCategory`, `CashAccount`) para no reescribir cada import
//    de los componentes portados.
//
// Lo que NO entra, porque nada del vertical lo usa: `ClosingPeriodicity` y `CashClose`.
// Pertenecen a cajas-bancos y llegan con T5c.
import type {
  CashAccountCatalogItem,
  CashReceiptCategoryCatalogItem,
  PaymentMethodCatalogItem,
} from "@/lib/api/client";

export type {
  AllocationInput,
  AssignState,
  CarteraBucket,
  CarteraResumen,
  CashAccountType,
  Payment,
  PaymentAllocation,
  PaymentAssignState,
  PaymentDetail,
  PaymentDirection,
  PaymentHistoryEntry,
  PaymentListItem,
  PaymentStatus,
  PaymentType,
  VoucherBalance,
  VoucherKind,
  VoucherType,
} from "@/lib/api/client";

export type PaymentMethodRef = PaymentMethodCatalogItem;
export type CashReceiptCategory = CashReceiptCategoryCatalogItem;
export type { CashAccountCatalogItem };
