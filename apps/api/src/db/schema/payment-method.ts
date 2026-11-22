// Catalogo de metodos de pago. DDL real (psql '\d payment_method'):
//   id uuid pk default gen_random_uuid()
//   owner_id uuid not null default auth.uid()
//   code text not null
//   name text not null
//   is_active boolean not null default true
//   created_at timestamptz not null default now()
//   unique (owner_id, code)
import { sql } from "drizzle-orm";
import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const paymentMethod = pgTable(
	"payment_method",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id, { onDelete: "cascade" }),
		code: text("code").notNull(),
		name: text("name").notNull(),
		isActive: boolean("is_active").notNull().default(true),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [unique("payment_method_owner_id_code_key").on(table.ownerId, table.code)],
);
