// Contrato de salida del vertical de ventas (T3): lo que la UI de T4/T5 va a tipar.
//
// El detalle NO reescribe el comprobante: reusa `Voucher` de `@gestion/shared`, que es el tipo que
// comparten ventas y compras (S1) e incluye `paidAmount` y `balance`, o sea el saldo que muestra
// el origen. Lo unico que el API agrega es el nombre de la entidad (`entityName`), porque el
// listado lo necesita en la misma fila y el origen lo resolvia con un join.
import type {
	PaymentType,
	Voucher,
	VoucherStatus,
	VoucherType,
} from "@gestion/shared/components/comprobantes/types.ts";

/**
 * Detalle de una venta: el comprobante completo con su saldo y el nombre del cliente.
 *
 * Es la respuesta de `GET /vouchers/:id`, `POST /vouchers` y `PATCH /vouchers/:id` (las tres
 * devuelven el mismo contrato, para que la pantalla no tenga dos formas de leer un comprobante).
 */
export type VoucherDetail = Voucher & { entityName: string };

/**
 * Fila del listado (`GET /vouchers`).
 *
 * Son las columnas de S10 (`F. emisión`, `T. comprobante`, `Nro comprobante`, `Cliente`, `Total`,
 * `Estado pago`) mas el `id` para las acciones Ver/Editar. No lleva montos de saldo: la pantalla no
 * los muestra y el listado no paga el costo de la segunda lectura.
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
