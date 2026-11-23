// Vales de caja chica (`petty_cash_vale`). C6 del vertical de cajas-bancos.
//
// DDL real (psql '\d public.petty_cash_vale' contra `gestion_pagos_dev` y
// `packages/db/scripts/schema-snapshot.sql:272-283,558-574,653-655`):
//
//   id          uuid pk default gen_random_uuid()
//   owner_id    uuid not null default auth.uid()
//   account_id  uuid not null   -> fk cash_account(id)
//   serial      integer not null            <- correlativo POR CUENTA, lo asigna la RPC
//   vale_date   date not null default CURRENT_DATE
//   paid_to     varchar(200) not null
//   concept     varchar(300) not null
//   amount      numeric(12,2) not null
//   has_receipt boolean not null default false
//   status      vale_status not null default 'PENDIENTE'
//   created_at  timestamptz not null default now()
//   payment_id  uuid null      -> fk payment(id)   (SPEC 49: el vale genera su recibo de egreso)
//
//   check petty_cash_vale_amount_check   amount > 0
//   check petty_cash_vale_serial_check   serial > 0
//   unique petty_cash_vale_serial_unique (account_id, serial)   <- S5: el correlativo es unico
//                                                                  por cuenta incluso en carrera
//
// APPEND-ONLY: el API no inserta ni actualiza esta tabla (S5/S8). La crea
// `public.create_petty_cash_vale(...)`, la anula `public.void_petty_cash_vale(...)` y la repone
// `public.replenish_petty_cash(...)`, las tres `security definer`; la tabla solo tiene politica de
// SELECT, asi que un INSERT directo muere con `42501`. El `serial` y el `status` son de la base:
// `serial` sale de `max(serial) + 1` con la fila de `cash_account` bloqueada (`for update`) y
// `status` solo lo mueven las RPC — la app no numera vales ni decide transiciones.
//
// Las columnas se declaran con su nombre SQL (sin `casing`), igual que `cash-account.ts` y
// `cash-close.ts`; `numeric` viaja como string y `date` como "YYYY-MM-DD".
import { sql } from "drizzle-orm";
import {
	boolean,
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
import { payment } from "./payment";

/**
 * `public.vale_status`: PENDIENTE (1), REPUESTO (2), ANULADO (3)
 * (`20261014194051_create_cash_denomination_and_petty_cash.sql:15`).
 *
 * Se declara aca -- y no en `enums.ts`, donde viven los seis del slice de pagos -- porque la unica
 * columna que lo usa es `petty_cash_vale.status`; mismo criterio que `closing_periodicity` en
 * `cash-close.ts` (que tambien lo mantiene privado) y que L8 del doc de la feature.
 */
const valeStatusEnum = pgEnum("vale_status", ["PENDIENTE", "REPUESTO", "ANULADO"]);

export const pettyCashVale = pgTable(
	"petty_cash_vale",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id),
		accountId: uuid("account_id")
			.notNull()
			.references(() => cashAccount.id),
		// Correlativo por cuenta; NUNCA lo calcula la app (S5).
		serial: integer("serial").notNull(),
		valeDate: date("vale_date").notNull().defaultNow(),
		paidTo: varchar("paid_to", { length: 200 }).notNull(),
		concept: varchar("concept", { length: 300 }).notNull(),
		amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
		hasReceipt: boolean("has_receipt").notNull().default(false),
		// Solo lo mueven las RPC (PENDIENTE -> REPUESTO por reposicion, -> ANULADO por anulacion).
		status: valeStatusEnum("status").notNull().default("PENDIENTE"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		// Recibo de egreso que genera la RPC al crear el vale (SPEC 49); null en vales historicos.
		paymentId: uuid("payment_id").references(() => payment.id),
	},
	(table) => [
		// `unique (account_id, serial)`: el nombre de la constraint en la base. Es el indice que
		// rechaza un correlativo repetido si dos vales llegaran a numerarse igual (S5).
		unique("petty_cash_vale_serial_unique").on(table.accountId, table.serial),
	],
);
