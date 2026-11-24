// Contrato de datos del vertical de ventas en la web (T4 del port).
//
// Espeja `apps/api/src/vouchers/vouchers.types.ts`, que a su vez reusa `Voucher` de
// `@gestion/shared`: el comprobante es el MISMO tipo para ventas y compras (S1). Los tipos se
// declaran aca —y no importados de `apps/api`— por la misma razon que en `lib/api/client.ts`:
// `apps/web` no depende del paquete del backend, asi que cambiar un campo alla es cambiar este
// archivo (y `lib/api/client.ts` cuando la ruta es compartida, como `/vouchers/open`).
//
// `VoucherWriteBody` NO es `VoucherFormValues`: es el body que efectivamente viaja al API. La
// diferencia (una sola, pero critica) esta documentada en `toVoucherRequestBody`.
import type {
  PaymentType,
  Voucher,
  VoucherKind,
  VoucherStatus,
  VoucherType,
} from "@gestion/shared/components/comprobantes/types.ts";

export type { PaymentType, Voucher, VoucherKind, VoucherStatus, VoucherType };

/** `GET /vouchers/:id`, `POST /vouchers` y `PATCH /vouchers/:id`: el comprobante con su saldo. */
export interface VoucherDetail extends Voucher {
  entityName: string;
}

/**
 * Fila de `GET /vouchers`: las columnas de S10 mas el `id` de las acciones.
 *
 * Trae `entityName` en la misma fila porque el origen lo resolvia cruzando la lista de clientes y
 * asi la tabla no muestra "Cliente no encontrado" mientras esa lista carga.
 */
export interface VoucherListItem {
  id: string;
  entityId: string;
  entityName: string;
  issueDate: string;
  voucherType: VoucherType;
  voucherNumber: string;
  total: number;
  paymentType: PaymentType;
  dueDate: string | null;
  status: VoucherStatus;
}

/**
 * Body de `POST /vouchers` y `PATCH /vouchers/:id`.
 *
 * `creditDays` es OPCIONAL porque en CONTADO no viaja (el campo se omite, no se manda `null`: ver
 * `toVoucherRequestBody`). `dueDate` y `registrationDate` no estan: son columnas de la base
 * (`due_date` es generada) y `status` lo recalcula la tabla cuando se asignan o anulan pagos.
 */
export interface VoucherWriteBody {
  issueDate: string;
  voucherType: VoucherType;
  voucherNumber: string;
  entityId: string;
  total: number;
  paymentType: PaymentType;
  creditDays?: number;
  status: VoucherStatus;
}

/**
 * Una serie de comprobante (`voucher_series`).
 *
 * Se declara aca aunque el slice 1 no tenga UI de series (`/configuracion` queda fuera, S1): el
 * formulario necesita la FORMA para sugerir el correlativo y para decidir si un tipo esta
 * disponible. `apps/api` todavia no expone el recurso, asi que hoy nadie la carga (ver
 * `components/ventas/voucher-form.tsx`).
 */
export interface VoucherSeries {
  id: string;
  voucherType: VoucherType;
  code: string;
  lastNumber: number;
  isDefault: boolean;
  deletedAt: string | null;
}
