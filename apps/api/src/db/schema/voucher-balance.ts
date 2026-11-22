// Vista `voucher_balance`: saldo de cada comprobante. Columnas reales (psql '\\d voucher_balance'):
//
//   comprobante_id uuid, entity_id uuid, voucher_kind voucher_kind, voucher_type voucher_type,
//   voucher_number text, issue_date date, payment_type payment_type, effective_due_date date,
//   total numeric(12,2), paid_amount numeric(12,2), balance numeric(12,2),
//   status comprobante_status, credit_amount numeric(12,2), debit_amount numeric(12,2)
//
// `security_invoker=true`: la vista NO tiene dueno propio, se evalua con los privilegios de quien
// consulta. Como todas las queries de dominio pasan por `withOwner` (rol `authenticated` + GUC
// `app.user_id`), la RLS de `comprobante`/`payment_allocation`/`payment` filtra las filas. Esa
// propiedad esta probada en `test/payments.e2e.test.ts` (fixture de otro dueno, cero filas).
//
// `numeric` se declara como string: es la representacion exacta que devuelve node-postgres. La
// conversion a number ocurre en el mapper, que es el borde del contrato HTTP.
import { pgView } from "drizzle-orm/pg-core";
import { date, numeric, text, uuid } from "drizzle-orm/pg-core";
import { comprobanteStatusEnum, paymentTypeEnum, voucherKindEnum, voucherTypeEnum } from "./enums";

export const voucherBalance = pgView("voucher_balance", {
	comprobanteId: uuid("comprobante_id"),
	entityId: uuid("entity_id"),
	voucherKind: voucherKindEnum("voucher_kind"),
	voucherType: voucherTypeEnum("voucher_type"),
	voucherNumber: text("voucher_number"),
	issueDate: date("issue_date"),
	paymentType: paymentTypeEnum("payment_type"),
	effectiveDueDate: date("effective_due_date"),
	total: numeric("total", { precision: 12, scale: 2 }),
	paidAmount: numeric("paid_amount", { precision: 12, scale: 2 }),
	balance: numeric("balance", { precision: 12, scale: 2 }),
	status: comprobanteStatusEnum("status"),
	creditAmount: numeric("credit_amount", { precision: 12, scale: 2 }),
	debitAmount: numeric("debit_amount", { precision: 12, scale: 2 }),
}).existing();
