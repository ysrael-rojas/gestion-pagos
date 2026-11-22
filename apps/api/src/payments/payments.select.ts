// La proyeccion de lectura de un pago, compartida por los dos servicios del vertical.
//
// Es el `PAYMENT_SELECT` del origen:
//   `*, payment_method(name), cash_account(name, currency), cash_receipt_category(name)`
// expresado con los handles tipados de Drizzle. Todos los joins son LEFT: un pago tiene FK
// obligatoria a los tres catalogos, pero el row se arma igual si Drizzle no encuentra la fila
// (mismo comportamiento que PostgREST en el origen).
import { eq } from "drizzle-orm";
import type { Transaction } from "../db/db.provider";
import { cashAccount, cashReceiptCategory, payment, paymentMethod } from "../db/schema";

export const paymentSelection = {
	id: payment.id,
	entityId: payment.entityId,
	direction: payment.direction,
	paymentDate: payment.paymentDate,
	receiptSerial: payment.receiptSerial,
	receiptNumber: payment.receiptNumber,
	amount: payment.amount,
	methodId: payment.methodId,
	methodName: paymentMethod.name,
	cashAccountId: payment.cashAccountId,
	cashAccountName: cashAccount.name,
	currency: cashAccount.currency,
	categoryId: payment.categoryId,
	categoryName: cashReceiptCategory.name,
	reference: payment.reference,
	status: payment.status,
	voidReason: payment.voidReason,
	voidedAt: payment.voidedAt,
	notes: payment.notes,
	isCashMovement: payment.isCashMovement,
};

/** `select ... from payment` con sus catalogos, dentro de la transaccion del dueno. */
export function selectPaymentRows(tx: Transaction) {
	return tx
		.select(paymentSelection)
		.from(payment)
		.leftJoin(paymentMethod, eq(payment.methodId, paymentMethod.id))
		.leftJoin(cashAccount, eq(payment.cashAccountId, cashAccount.id))
		.leftJoin(cashReceiptCategory, eq(payment.categoryId, cashReceiptCategory.id))
		.$dynamic();
}
