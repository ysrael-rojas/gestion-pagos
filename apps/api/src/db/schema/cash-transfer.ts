// Transferencias de fondos entre dos cuentas de caja/banco (`cash_transfer`). C6 del vertical de
// cajas-bancos.
//
// DDL real (psql '\d public.cash_transfer' contra `gestion_pagos_dev` y
// `packages/db/scripts/schema-snapshot.sql:191-198,464-475,624-627`):
//
//   id                uuid pk default gen_random_uuid()
//   owner_id          uuid not null default auth.uid()
//   source_account_id uuid not null   -> fk cash_account(id)
//   target_account_id uuid not null   -> fk cash_account(id)
//   amount            numeric(12,2) not null
//   transfer_date     date not null default CURRENT_DATE
//   notes             text null
//   created_at        timestamptz not null default now()
//
//   check cash_transfer_amount_positive     amount > 0
//   check cash_transfer_distinct_accounts   source_account_id <> target_account_id
//   index cash_transfer_owner_date_idx      (owner_id, transfer_date desc)
//   index cash_transfer_source_idx / cash_transfer_target_idx
//
// APPEND-ONLY: la tabla NO es un destino de escritura del API (S8 del vertical). La unica via es
// `public.create_cash_transfer(...)`, `security definer`, y una transferencia NUNCA inserta un
// `payment`: el movimiento lo leen `private.cash_expected_balance`, `get_cash_position` y
// `close_cash_account` con el signo que corresponda (S2). `authenticated` conserva el privilegio
// INSERT del blanket de `20261029101500:96`, pero la tabla solo tiene politica de SELECT
// (`20261014165429_create_cash_transfer.sql` creo tambien una de INSERT y la version vigente del
// snapshot ya no la lista), asi que un INSERT directo muere con `42501` — lo pina el e2e de este
// slice, igual que el de cierres.
//
// Las columnas se declaran una por una con su nombre SQL (sin `casing`), como `cash-account.ts` y
// `cash-close.ts`. `numeric` viaja como string (unica representacion sin perdida de centavos) y
// `date` como "YYYY-MM-DD"; las dos conversiones al borde JSON las hace `cash-transfers.service.ts`.
import { sql } from "drizzle-orm";
import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashAccount } from "./cash-account";

export const cashTransfer = pgTable("cash_transfer", {
	id: uuid("id").primaryKey().defaultRandom(),
	ownerId: uuid("owner_id")
		.notNull()
		.default(sql`auth.uid()`)
		.references(() => users.id),
	sourceAccountId: uuid("source_account_id")
		.notNull()
		.references(() => cashAccount.id),
	targetAccountId: uuid("target_account_id")
		.notNull()
		.references(() => cashAccount.id),
	amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
	// La fecha del movimiento: es la que recortan los filtros por periodo y la que compara
	// `private.assert_account_open_for` antes de dejar crear la transferencia.
	transferDate: date("transfer_date").notNull().defaultNow(),
	notes: text("notes"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
