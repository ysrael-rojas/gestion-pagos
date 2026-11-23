// Cierres de caja (`cash_close`) y su detalle de arqueo (`cash_close_denomination`). C4 del
// vertical de cajas-bancos.
//
// DDL real (psql '\d public.cash_close' / '\d public.cash_close_denomination' contra
// `gestion_pagos_dev`, PostgreSQL 18.7, y `packages/db/scripts/schema-snapshot.sql:46-49,142-167`):
//
//   cash_close
//     id uuid pk default gen_random_uuid()
//     owner_id uuid not null default auth.uid()
//     cash_account_id uuid not null   -> fk cash_account(id)
//     periodicity closing_periodicity not null
//     period_start / period_end date not null
//     opening_balance numeric(12,2) not null
//     income_total / expense_total numeric(12,2) not null default 0
//     expected_balance numeric(12,2) not null
//     transfer_in_total / transfer_out_total numeric(12,2) not null default 0
//     counted_balance numeric(12,2) null
//     difference numeric(12,2) null
//     difference_reason text null
//     difference_tolerance numeric(12,2) null
//     pen_usd_rate numeric(10,4) null
//     notes text null
//     change_fund numeric(12,2) null
//     counted_by / verified_by varchar(100) null
//     created_at timestamptz not null default now()
//     unique (cash_account_id, period_end)          <- S5: la carrera del cierre la corta el indice
//     check cash_close_period_check                 period_start <= period_end
//     check cash_close_counted_check                (counted is null) = (difference is null)
//
//   cash_close_denomination
//     id uuid pk default gen_random_uuid()
//     cash_close_id uuid not null   -> fk cash_close(id) on delete cascade
//     denomination numeric(5,2) not null
//     quantity integer not null
//     check ..._value_check      denomination in (200,100,50,20,10,5,2,1,0.50,0.20,0.10)
//     check ..._quantity_check   quantity >= 0
//     unique (cash_close_id, denomination)
//
// APPEND-ONLY: estas dos tablas NO son un destino de escritura del API (S3). La unica via es
// `public.close_cash_account(...)`, `security definer`, que ademas congela los totales que
// calcula la base (`private.cash_expected_balance`, S2). El contrato se sostiene sobre la RLS y
// no solo sobre los grants: `authenticated` conserva el privilegio INSERT (el `grant ... on all
// tables` de `20261029101500_better_auth_tables_and_role_grants.sql:96` lo re-otorgo despues del
// `revoke` de `20261006063301`), pero `cash_close` solo tiene politica de SELECT, asi que un
// INSERT directo muere con `42501` ("new row violates row-level security policy"). Lo que el
// comentario viejo de S3 ("INSERT revocado para authenticated") ya no describe con precision es
// el PRIVILEGIO; el efecto observable —no se puede escribir sin la RPC— es el mismo y lo pina
// `apps/api/test/cash-closes.e2e.test.ts`.
//
// Las columnas se declaran una por una con su nombre SQL (no se usa `casing`) para que este
// archivo siga el mismo estilo que `cash-account.ts` y se pueda comparar contra el `\d` a ojo.
// `numeric` viaja como string (unica representacion sin perdida de centavos) y `date` como
// "YYYY-MM-DD"; las dos conversiones al borde JSON las hace `closes.service.ts`.
import { sql } from "drizzle-orm";
import {
	date,
	integer,
	numeric,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { cashAccount } from "./cash-account";

/**
 * `public.closing_periodicity`: DAILY (1), WEEKLY (2), MONTHLY (3)
 * (`20261006063301_create_cash_close_module.sql:49`).
 *
 * `cash-account.ts` ya declara este enum, pero lo mantiene PRIVADO (no lo exporta) porque hasta
 * C3 la unica columna que lo usaba era `cash_account.closing_periodicity`. Este slice no puede
 * editar `cash-account.ts`, asi que se vuelve a declarar con el mismo nombre y los mismos labels:
 * Drizzle identifica los enums por nombre, los valores son identicos y `drizzle-kit` no genera
 * DDL en este monorepo, asi que no hay drift posible. Exportarlo alla y reusarlo es una linea de
 * seguimiento (mismo criterio que L8 del doc de la feature).
 */
const closingPeriodicityEnum = pgEnum("closing_periodicity", ["DAILY", "WEEKLY", "MONTHLY"]);

export const cashClose = pgTable(
	"cash_close",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id),
		cashAccountId: uuid("cash_account_id")
			.notNull()
			.references(() => cashAccount.id),
		periodicity: closingPeriodicityEnum("periodicity").notNull(),
		periodStart: date("period_start").notNull(),
		periodEnd: date("period_end").notNull(),
		openingBalance: numeric("opening_balance", { precision: 12, scale: 2 }).notNull(),
		// Los tres totales del periodo; los escribe la RPC, nunca la app.
		incomeTotal: numeric("income_total", { precision: 12, scale: 2 }).notNull().default("0"),
		expenseTotal: numeric("expense_total", { precision: 12, scale: 2 }).notNull().default("0"),
		expectedBalance: numeric("expected_balance", { precision: 12, scale: 2 }).notNull(),
		transferInTotal: numeric("transfer_in_total", { precision: 12, scale: 2 })
			.notNull()
			.default("0"),
		transferOutTotal: numeric("transfer_out_total", { precision: 12, scale: 2 })
			.notNull()
			.default("0"),
		// NULL = cierre de banco sin comparacion contra el extracto (la RPC lo permite).
		countedBalance: numeric("counted_balance", { precision: 12, scale: 2 }),
		difference: numeric("difference", { precision: 12, scale: 2 }),
		// SPEC 49: motivo y tolerancia vigente congelados al cerrar.
		differenceReason: text("difference_reason"),
		differenceTolerance: numeric("difference_tolerance", { precision: 12, scale: 2 }),
		// Tasa PEN/USD congelada para una cuenta que no es PEN; NULL en las cuentas en soles.
		penUsdRate: numeric("pen_usd_rate", { precision: 10, scale: 4 }),
		notes: text("notes"),
		// SPEC 35: fondo de cambio de la cuenta congelado al cerrar (NULL en cierres historicos).
		changeFund: numeric("change_fund", { precision: 12, scale: 2 }),
		// SPEC 51: doble firma del acta.
		countedBy: varchar("counted_by", { length: 100 }),
		verifiedBy: varchar("verified_by", { length: 100 }),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		// `unique (cash_account_id, period_end)`: el nombre de la constraint en la base. Es el
		// indice que serializa dos cierres del mismo periodo (S5).
		unique("cash_close_cash_account_id_period_end_key").on(table.cashAccountId, table.periodEnd),
	],
);

/**
 * Detalle del conteo fisico de un cierre. Sin `owner_id`: la pertenencia se hereda del cierre
 * padre y la fila es inmutable (solo la escribe la RPC).
 */
export const cashCloseDenomination = pgTable(
	"cash_close_denomination",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		cashCloseId: uuid("cash_close_id")
			.notNull()
			.references(() => cashClose.id, { onDelete: "cascade" }),
		denomination: numeric("denomination", { precision: 5, scale: 2 }).notNull(),
		quantity: integer("quantity").notNull(),
	},
	(table) => [
		unique("cash_close_denomination_unique").on(table.cashCloseId, table.denomination),
	],
);
