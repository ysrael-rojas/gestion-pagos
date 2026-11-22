// Categorias de recibo de caja. DDL real (psql '\\d cash_receipt_category'):
//   id uuid pk default gen_random_uuid()
//   owner_id uuid not null default auth.uid()
//   direction payment_direction not null
//   name text not null
//   code text not null
//   is_active boolean not null default true
//   created_at timestamptz not null default now()
//   unique (owner_id, code); unique (owner_id, direction, name)
//
// Es el nombre que la UI muestra como "categoria" del pago (`cash_receipt_category.name`); el
// pago guarda solo `category_id`.
import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { paymentDirectionEnum } from "./enums";

export const cashReceiptCategory = pgTable(
	"cash_receipt_category",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id, { onDelete: "cascade" }),
		direction: paymentDirectionEnum("direction").notNull(),
		name: text("name").notNull(),
		code: text("code").notNull(),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique("cash_receipt_category_owner_id_code_key").on(table.ownerId, table.code),
		unique("cash_receipt_category_owner_id_direction_name_key").on(
			table.ownerId,
			table.direction,
			table.name,
		),
	],
);
