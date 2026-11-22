// Vista `payment_balance`: cuanto de cada pago quedo asignado y cuanto falta. Definicion real
// (pg_get_viewdef, PostgreSQL 18.7):
//
//   select p.id as payment_id, p.entity_id, p.direction, p.status, p.amount,
//          coalesce(sum(a.amount), 0)::numeric(12,2) as assigned_amount,
//          (p.amount - coalesce(sum(a.amount), 0))::numeric(12,2) as unassigned_amount
//     from payment p left join payment_allocation a on a.payment_id = p.id
//    group by p.id
//
// `security_invoker=true`, y la definicion NO filtra por dueno: el aislamiento sale de la RLS de
// `payment` y `payment_allocation` al evaluarse con el rol `authenticated` y el GUC `app.user_id`
// de `withOwner`. Esa es exactamente la propiedad que fija `test/payments.e2e.test.ts`: con una
// fila de otro dueno presente, la vista devuelve cero.
import { numeric, pgView, uuid } from "drizzle-orm/pg-core";
import { paymentDirectionEnum, paymentStatusEnum } from "./enums";

export const paymentBalance = pgView("payment_balance", {
	paymentId: uuid("payment_id"),
	entityId: uuid("entity_id"),
	direction: paymentDirectionEnum("direction"),
	status: paymentStatusEnum("status"),
	amount: numeric("amount", { precision: 12, scale: 2 }),
	assignedAmount: numeric("assigned_amount", { precision: 12, scale: 2 }),
	unassignedAmount: numeric("unassigned_amount", { precision: 12, scale: 2 }),
}).existing();
