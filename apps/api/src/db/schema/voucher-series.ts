// Series de comprobante: la numeracion por tipo y por codigo (`odd/tasks/port-vertical-series.md`).
// DDL real (psql '\d public.voucher_series', PostgreSQL 18.7):
//   id uuid pk default gen_random_uuid()
//   owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade
//   voucher_type voucher_type not null
//   code text not null                   -> check (code ~ '^[A-Za-z0-9]{1,4}$')
//   last_number integer not null default 0  -> check (last_number >= 0)
//   is_default boolean not null default false
//   created_at / updated_at timestamptz not null default now()
//   deleted_at timestamptz null          -> la baja es logica
//   unique index voucher_series_owner_type_code_idx (owner_id, voucher_type, code)
//     where deleted_at is null
//   unique index voucher_series_default_per_type_idx (owner_id, voucher_type)
//     where is_default and deleted_at is null     -> una sola por defecto por tipo
//   index voucher_series_owner_idx (owner_id) where deleted_at is null
//
// Los indices y los CHECK NO se duplican en Node: la base es el juez y las RPC traducen sus rechazos
// a los mensajes del contrato. Este archivo solo da tipos a las lecturas.
//
// `voucher_type` es el enum de la base (seis tipos); que solo se puedan crear series de los cinco
// que la app emite es una regla de `crear_serie` y del contrato compartido, no del almacenamiento.
import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { voucherTypeEnum } from "./enums";

export const voucherSeries = pgTable("voucher_series", {
	id: uuid("id").primaryKey().defaultRandom(),
	ownerId: uuid("owner_id").notNull().default(sql`auth.uid()`),
	voucherType: voucherTypeEnum("voucher_type").notNull(),
	code: text("code").notNull(),
	lastNumber: integer("last_number").notNull().default(0),
	isDefault: boolean("is_default").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
