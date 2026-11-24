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
import type { VoucherSeriesRow } from "@gestion/shared/lib/schemas/serie.ts";

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
 *
 * `voucherNumber` tampoco esta (T5 del slice 2, S11): el numero lo asigna la base desde la serie
 * por defecto del tipo, dentro de la transaccion del alta (S2). El preview que muestra la pantalla
 * es de solo lectura y no es parte del cuerpo. El contrato de escritura del API todavia lo acepta
 * y lo ignora (`voucherWriteSchema`), pero ningun cliente de este repo lo manda.
 */
export interface VoucherWriteBody {
  issueDate: string;
  voucherType: VoucherType;
  entityId: string;
  total: number;
  paymentType: PaymentType;
  creditDays?: number;
  status: VoucherStatus;
}

/**
 * Una serie de comprobante (`voucher_series`).
 *
 * Es el contrato COMPARTIDO de la fila (`voucherSeriesSchema`), el mismo que devuelve el API y el
 * que pinta `/configuracion/series`: el formulario de ventas solo usa `code`, `lastNumber`,
 * `voucherType` e `isDefault`, y no tiene por que declarar una segunda forma que se desincronice.
 * Las series que devuelve el API estan todas vivas (el listado filtra `deleted_at is null`), asi que
 * `deletedAt` no viaja: el contrato no lo tiene.
 */
export type VoucherSeries = VoucherSeriesRow;
