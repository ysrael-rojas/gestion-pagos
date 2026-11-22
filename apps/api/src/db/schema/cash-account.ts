// Cuentas de caja y banco. DDL real (psql '\\d cash_account' contra gestion_pagos_dev):
//   id uuid pk default gen_random_uuid()
//   type cash_account_type not null
//   name text not null
//   currency text not null default 'PEN'
//   opening_balance numeric(12,2) not null default 0
//   opening_balance_date date not null default CURRENT_DATE
//   is_active boolean not null default true
//   created_at / updated_at timestamptz not null default now()
//   deleted_at timestamptz null
//   owner_id uuid not null default auth.uid()
//   (+ bank_name, account_number, cci, notes, closing_periodicity, is_petty_cash, change_fund,
//      petty_expense_limit, custodian_name)
//
// Se declaran solo las columnas que usan los endpoints de pagos (nombre y moneda para el join de
// lectura; tipo y fechas para nada mas). La base sigue siendo la fuente de verdad (S7): apps/api
// no emite DDL.
import { sql } from "drizzle-orm";
import { boolean, date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashAccountTypeEnum } from "./enums";

export const cashAccount = pgTable("cash_account", {
	id: uuid("id").primaryKey().defaultRandom(),
	type: cashAccountTypeEnum("type").notNull(),
	name: text("name").notNull(),
	currency: text("currency").notNull().default("PEN"),
	openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("0"),
	openingBalanceDate: date("opening_balance_date").notNull().defaultNow(),
	isActive: boolean("is_active").notNull().default(true),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	ownerId: uuid("owner_id")
		.notNull()
		.default(sql`auth.uid()`)
		.references(() => users.id, { onDelete: "cascade" }),
});
