// Arqueos sorpresivos (`cash_count`) y su detalle (`cash_count_denomination`). C4 del vertical de
// cajas-bancos.
//
// DDL real (psql '\d public.cash_count' / '\d public.cash_count_denomination' contra
// `gestion_pagos_dev`, PostgreSQL 18.7, y la migracion
// `20261027203718_spec49_cash_surprise_count.sql:2-70`):
//
//   cash_count
//     id uuid pk default gen_random_uuid()
//     owner_id uuid not null default auth.uid()   -> fk auth.users(id)
//     cash_account_id uuid not null               -> fk cash_account(id)
//     count_date date not null default current_date
//     counted_balance numeric(12,2) not null
//     expected_balance numeric(12,2) not null
//     difference numeric(12,2) not null
//     change_fund numeric(12,2) null
//     counted_by varchar(100) null
//     is_surprise boolean not null default true
//     notes text null
//     created_at timestamptz not null default now()
//     check cash_count_counted_check   counted_balance >= 0
//     indices: (cash_account_id, count_date desc) y (owner_id)
//
//   cash_count_denomination
//     id uuid pk default gen_random_uuid()
//     cash_count_id uuid not null   -> fk cash_count(id) on delete cascade
//     denomination numeric(5,2) not null
//     quantity integer not null
//     check ..._value_check / ..._quantity_check (mismo conjunto PEN que el cierre)
//     unique (cash_count_id, denomination)
//
// APPEND-ONLY: igual que `cash_close`, la unica via de escritura es
// `public.register_cash_count(...)` (`security definer`, S3). `authenticated` conserva el
// privilegio INSERT pero `cash_count` solo tiene politica de SELECT, asi que un INSERT directo
// falla con `42501` por RLS. `expected_balance` y `difference` los calcula la RPC con
// `private.cash_expected_balance` (S2): la app nunca los manda ni los recalcula.
//
// `is_surprise` es `true` siempre hoy (todos los arqueos de la RPC son sorpresivos); se declara
// la columna porque la fila viaja entera al cliente, igual que hacia el origen.
import { sql } from "drizzle-orm";
import {
	boolean,
	date,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashAccount } from "./cash-account";

export const cashCount = pgTable("cash_count", {
	id: uuid("id").primaryKey().defaultRandom(),
	ownerId: uuid("owner_id")
		.notNull()
		.default(sql`auth.uid()`)
		.references(() => users.id),
	cashAccountId: uuid("cash_account_id")
		.notNull()
		.references(() => cashAccount.id),
	countDate: date("count_date").notNull().defaultNow(),
	countedBalance: numeric("counted_balance", { precision: 12, scale: 2 }).notNull(),
	expectedBalance: numeric("expected_balance", { precision: 12, scale: 2 }).notNull(),
	difference: numeric("difference", { precision: 12, scale: 2 }).notNull(),
	changeFund: numeric("change_fund", { precision: 12, scale: 2 }),
	countedBy: varchar("counted_by", { length: 100 }),
	isSurprise: boolean("is_surprise").notNull().default(true),
	notes: text("notes"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Detalle del conteo por denominacion de un arqueo. Sin `owner_id`: la pertenencia se hereda del
 * arqueo padre y la fila es inmutable.
 */
export const cashCountDenomination = pgTable(
	"cash_count_denomination",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		cashCountId: uuid("cash_count_id")
			.notNull()
			.references(() => cashCount.id, { onDelete: "cascade" }),
		denomination: numeric("denomination", { precision: 5, scale: 2 }).notNull(),
		quantity: integer("quantity").notNull(),
	},
	(table) => [
		unique("cash_count_denomination_unique").on(table.cashCountId, table.denomination),
	],
);
