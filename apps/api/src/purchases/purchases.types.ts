// Contrato de salida del vertical de compras (T3): lo que la UI de T4/T5 va a tipar.
//
// El detalle NO reescribe el comprobante: reusa `Voucher` de `@gestion/shared`, que es el tipo que
// comparten ventas y compras (S1) e incluye `paidAmount` y `balance`, o sea el saldo que muestra el
// origen. Lo unico que el API agrega es el nombre de la entidad (`entityName`), porque el listado lo
// necesita en la misma fila y el origen lo resolvia con un join.
//
// La forma es DELIBERADAMENTE la misma que la de ventas (`vouchers.types.ts`): el formulario y las
// tablas de la pantalla son los mismos, asi que una compra y una venta se leen con el mismo tipo en
// el cliente. Lo que cambia es el SIGNIFICADO de `entityName` (proveedor, no cliente) y el de
// `balance` (saldo por pagar, no por cobrar).
import type {
	PaymentType,
	Voucher,
	VoucherStatus,
	VoucherType,
} from "@gestion/shared/components/comprobantes/types.ts";

/**
 * Detalle de una compra: el comprobante completo con su saldo y el nombre del proveedor.
 *
 * Es la respuesta de `GET /purchases/:id`, `POST /purchases` y `PATCH /purchases/:id` (las tres
 * devuelven el mismo contrato, para que la pantalla no tenga dos formas de leer una compra).
 */
export type PurchaseDetail = Voucher & { entityName: string };

/**
 * Fila del listado (`GET /purchases`).
 *
 * Son las columnas de S10 (`F. emisión`, `T. comprobante`, `Nro comprobante`, `Proveedor`, `Total`,
 * `Estado pago`) mas el `id` para las acciones Ver/Editar/Registrar pago. No lleva montos de saldo: la
 * pantalla no los muestra y el listado no paga el costo de la segunda lectura.
 */
export interface PurchaseListItem {
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
