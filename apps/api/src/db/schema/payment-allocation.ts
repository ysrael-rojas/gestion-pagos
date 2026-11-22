// Asignacion de un pago a comprobantes. DDL real (psql '\d payment_allocation'):
//   id uuid pk default gen_random_uuid()
//   payment_id uuid not null      -> fk payment(id) on delete restrict
//   comprobante_id uuid not null  -> fk comprobante(id)
//   amount numeric(12,2) not null check (amount > 0)
//   created_at timestamptz not null default now()
//   owner_id uuid not null default auth.uid() -> fk auth.users(id) on delete cascade
//   unique (payment_id, comprobante_id)
//
// `comprobante` no forma parte de este slice: su FK queda documentada, no declarada.
import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { payment } from "./payment";

export const paymentAllocation = pgTable(
	"payment_allocation",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		paymentId: uuid("payment_id")
			.notNull()
			.references(() => payment.id, { onDelete: "restrict" }),
		comprobanteId: uuid("comprobante_id").notNull(),
		amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(table) => [
		unique("payment_allocation_unique").on(table.paymentId, table.comprobanteId),
		index("payment_allocation_payment_idx").on(table.paymentId),
		index("payment_allocation_comprobante_idx").on(table.comprobanteId),
		index("idx_payment_allocation_owner_id").on(table.ownerId),
		check("payment_allocation_amount_check", sql`${table.amount} > 0::numeric`),
	],
);
