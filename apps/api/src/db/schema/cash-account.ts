// Cuentas de caja y banco. DDL real (psql '\d cash_account' contra gestion_pagos_dev y
// `packages/db/scripts/schema-snapshot.sql:122-140`):
//   id uuid pk default gen_random_uuid()
//   type cash_account_type not null
//   name text not null
//   currency text not null default 'PEN'
//   bank_name text null
//   account_number text null
//   cci text null
//   opening_balance numeric(12,2) not null default 0
//   opening_balance_date date not null default CURRENT_DATE
//   notes text null
//   is_active boolean not null default true
//   is_petty_cash boolean not null default false
//   change_fund numeric(12,2) not null default 0
//   petty_expense_limit numeric(12,2) null
//   custodian_name varchar(100) null
//   closing_periodicity closing_periodicity null
//   created_at / updated_at timestamptz not null default now()
//   deleted_at timestamptz null
//   owner_id uuid not null default auth.uid()
//
// El esquema se declara COMPLETO porque el vertical de cajas-bancos edita la fila entera
// (`apps/api/src/cash/cash-accounts.*`); el catalogo de pagos sigue leyendo solo cinco columnas.
// La base sigue siendo la fuente de verdad (S7): apps/api no emite DDL y las restricciones de
// abajo viven en las migraciones, no en este archivo:
//
//   cash_account_name_nonempty                 char_length(name) >= 1
//   cash_account_opening_balance_nonnegative   opening_balance >= 0
//   cash_account_bank_requires_name            banco <=> bank_name no vacio; caja <=> sin datos bancarios
//   cash_account_change_fund_check             change_fund >= 0
//   cash_account_petty_expense_limit_check     petty_expense_limit is null or > 0
//   cash_account_petty_cash_type_check         not is_petty_cash or type = 'CASH_BOX'
//
// `numeric(12,2)` se declara como string (igual que `payment.amount`): es la unica representacion
// que no pierde centavos. El contrato de salida las convierte a number en
// `cash-accounts.service.ts`, que es lo que consume el formulario.
import { sql } from "drizzle-orm";
import {
	boolean,
	date,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashAccountTypeEnum } from "./enums";

/**
 * `public.closing_periodicity`: DAILY (1), WEEKLY (2), MONTHLY (3)
 * (`20261006063301_create_cash_close_module.sql:49`).
 *
 * Se declara aca -- y no en `enums.ts`, donde viven los otros cinco del slice de pagos -- porque
 * la unica columna que lo usa es `cash_account.closing_periodicity`. Moverlo a `enums.ts` es una
 * linea de seguimiento, mismo criterio que L8 del doc de la feature.
 */
const closingPeriodicityEnum = pgEnum("closing_periodicity", ["DAILY", "WEEKLY", "MONTHLY"]);

export const cashAccount = pgTable("cash_account", {
	id: uuid("id").primaryKey().defaultRandom(),
	type: cashAccountTypeEnum("type").notNull(),
	name: text("name").notNull(),
	currency: text("currency").notNull().default("PEN"),
	bankName: text("bank_name"),
	accountNumber: text("account_number"),
	cci: text("cci"),
	openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull().default("0"),
	openingBalanceDate: date("opening_balance_date").notNull().defaultNow(),
	notes: text("notes"),
	isActive: boolean("is_active").notNull().default(true),
	// Caja chica y fondo de cambio (solo cajas: `cash_account_petty_cash_type_check`).
	isPettyCash: boolean("is_petty_cash").notNull().default(false),
	changeFund: numeric("change_fund", { precision: 12, scale: 2 }).notNull().default("0"),
	pettyExpenseLimit: numeric("petty_expense_limit", { precision: 12, scale: 2 }),
	custodianName: varchar("custodian_name", { length: 100 }),
	// NULL = "usa la periodicidad global de `app_setting`" (lo lee `close_cash_account`).
	closingPeriodicity: closingPeriodicityEnum("closing_periodicity"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	// Lo mueve el trigger `cash_account_set_updated_at`; la app nunca lo escribe.
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	ownerId: uuid("owner_id")
		.notNull()
		.default(sql`auth.uid()`)
		.references(() => users.id, { onDelete: "cascade" }),
});
