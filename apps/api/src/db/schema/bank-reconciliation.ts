// Conciliacion bancaria (`bank_reconciliation` y su detalle `bank_reconciliation_item`). C7 del
// vertical de cajas-bancos.
//
// DDL real (psql '\d public.bank_reconciliation' / '\d public.bank_reconciliation_item' contra
// `gestion_pagos_dev`, PostgreSQL 18.7, y `packages/db/scripts/schema-snapshot.sql`):
//
//   bank_reconciliation
//     id uuid pk default gen_random_uuid()
//     owner_id uuid not null default auth.uid()   -> fk auth.users(id) on delete cascade
//     cash_account_id uuid not null               -> fk cash_account(id)
//     period_start / period_end date not null
//     statement_balance / books_balance numeric(12,2) not null
//     prepared_by / reviewed_by varchar(100) null
//     notes text null
//     created_at / updated_at timestamptz not null default now()
//     unique (cash_account_id, period_start, period_end)      <- el UPSERT de la RPC
//     check bank_reconciliation_period_check  period_end >= period_start
//
//   bank_reconciliation_item
//     id uuid pk default gen_random_uuid()
//     reconciliation_id uuid not null   -> fk bank_reconciliation(id) on delete cascade
//     kind reconciliation_item_kind not null
//     description text not null
//     amount numeric(12,2) not null
//     created_at timestamptz not null default now()
//     check bank_reconciliation_item_amount_check        amount > 0
//     check bank_reconciliation_item_description_check   char_length(btrim(description)) >= 1
//
// APPEND-ONLY: la fila NO se escribe desde el API, ni con INSERT ni con UPDATE. La unica via es
// `public.save_bank_reconciliation(p_reconciliation jsonb, p_items jsonb)`, `security definer`
// (SPEC 53), que valida el dueno y el tipo de cuenta con `for update`, hace el upsert de la
// cabecera y reemplaza las partidas (delete-then-insert) en la MISMA transaccion. La migracion
// ademas revoca `insert, update, delete` sobre las dos tablas a `authenticated`, asi que un DML
// directo muere con `42501` aunque alguien agregue una politica de escritura.
//
// La LECTURA si es del API: no hay vista ni RPC de lectura, las dos tablas solo tienen politica de
// SELECT y el dueno las lee con Drizzle dentro de `withOwner`. `bank_reconciliation_item` no tiene
// `owner_id`: la pertenencia se hereda del padre y su politica la resuelve con un `exists` sobre
// `bank_reconciliation`.
//
// Las columnas se declaran una por una con su nombre SQL (sin `casing`), como `cash-close.ts` y
// `cash-transfer.ts`. `numeric` viaja como string (unica representacion sin perdida de centavos) y
// `date` como "YYYY-MM-DD"; las dos conversiones al borde JSON las hace
// `bank-reconciliations.service.ts`.
import { sql } from "drizzle-orm";
import { date, numeric, pgEnum, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashAccount } from "./cash-account";

/**
 * `public.reconciliation_item_kind`: las cuatro clases de partida del formato oficial
 * (SPEC 53), en el orden en que las creo `20261028074215_spec53_bank_reconciliation.sql:17-22`.
 *
 * El SIGNO de cada clase no vive en la base: es una convencion de display
 * (`ITEM_SIGN` en `packages/shared/src/lib/caja/conciliacion-tipos.ts`). El enum solo dice la
 * clase; el monto siempre viaja en positivo (`amount > 0`).
 */
export const reconciliationItemKindEnum = pgEnum("reconciliation_item_kind", [
	"DEPOSITO_EN_TRANSITO",
	"PAGO_NO_DEBITADO",
	"CARGO_NO_REGISTRADO",
	"ABONO_NO_REGISTRADO",
]);

export const bankReconciliation = pgTable(
	"bank_reconciliation",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id, { onDelete: "cascade" }),
		cashAccountId: uuid("cash_account_id")
			.notNull()
			.references(() => cashAccount.id),
		periodStart: date("period_start").notNull(),
		periodEnd: date("period_end").notNull(),
		// Los dos saldos del acta: el del extracto bancario y el de los registros propios. Los
		// escribe el usuario (via RPC), no se derivan de ningun movimiento.
		statementBalance: numeric("statement_balance", { precision: 12, scale: 2 }).notNull(),
		booksBalance: numeric("books_balance", { precision: 12, scale: 2 }).notNull(),
		// Doble firma del acta (SPEC 53): quien preparo y quien reviso la conciliacion.
		preparedBy: varchar("prepared_by", { length: 100 }),
		reviewedBy: varchar("reviewed_by", { length: 100 }),
		notes: text("notes"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// El triplete que hace de clave natural: es lo que busca la pantalla (match EXACTO, no
		// rango) y lo que usa el `on conflict ... do update` de la RPC.
		unique("bank_reconciliation_period_unique").on(
			table.cashAccountId,
			table.periodStart,
			table.periodEnd,
		),
	],
);

/**
 * Detalle de la conciliacion: las partidas del formato oficial.
 *
 * Sin `owner_id`: la pertenencia se hereda del padre (misma decision que
 * `cash_close_denomination` y `cash_transfer`). `created_at` es lo que ordena la lectura: la RPC
 * reinserta todas las partidas en cada guardado, asi que el orden es "como se guardaron".
 */
export const bankReconciliationItem = pgTable("bank_reconciliation_item", {
	id: uuid("id").primaryKey().defaultRandom(),
	reconciliationId: uuid("reconciliation_id")
		.notNull()
		.references(() => bankReconciliation.id, { onDelete: "cascade" }),
	kind: reconciliationItemKindEnum("kind").notNull(),
	description: text("description").notNull(),
	amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
