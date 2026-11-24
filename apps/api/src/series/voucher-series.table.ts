// Tipos Drizzle de `public.voucher_series` para el vertical de series (T3 del port de series).
//
// Misma decision de ubicacion que `vouchers/comprobante.table.ts`: la tabla se declara dentro del
// modulo de su vertical y no en `src/db/schema`, porque `src/db/schema/index.ts` es un barrel
// compartido por los otros verticales y agregar el archivo alla obligaria a tocar un barrel que no
// es de este slice. Cuando el vertical crezca, este archivo se mueve a
// `src/db/schema/voucher-series.ts` y el barrel lo reexporta: los tipos son los mismos y la
// ubicacion es lo unico que cambia.
//
// Solo se declaran las columnas que el vertical lee. La ESCRITURA no pasa por esta tabla (S5): el
// alta, la edicion y la baja son las RPC `security definer` `public.crear_serie` /
// `public.editar_serie` / `public.eliminar_serie` (`20261125090000_series_rpcs.sql`), porque
// `authenticated` no tiene UPDATE ni DELETE sobre `voucher_series`
// (`20261124090000_revoke_payments_writes.sql`, matriz del grupo M de
// `packages/db/scripts/check-rls-enforcement.mjs`). El `last_number` lo mueve `public.crear_venta`
// en la misma transaccion que el comprobante.
//
// DDL real (`20261026215202`, y `\d public.voucher_series` contra la base migrada, PostgreSQL 18):
//   id uuid pk default gen_random_uuid()
//   owner_id uuid not null default auth.uid()      -> fk auth.users(id) on delete cascade
//   voucher_type voucher_type not null
//   code text not null                             check (code ~ '^[A-Za-z0-9]{1,4}$')
//   last_number integer not null default 0         check (last_number >= 0)
//   is_default boolean not null default false
//   created_at / updated_at timestamptz not null default now()
//   deleted_at timestamptz null                    <- la baja es LOGICA (S5)
//   unique index voucher_series_owner_type_code_idx (owner_id, voucher_type, code)
//     where deleted_at is null                      <- juez del codigo repetido
//   unique index voucher_series_default_per_type_idx (owner_id, voucher_type)
//     where is_default and deleted_at is null       <- una sola por defecto por tipo
//   index voucher_series_owner_idx (owner_id) where deleted_at is null
//   trigger voucher_series_set_updated_at / trg_voucher_series_owner_id
//
// Los indices y los CHECK NO se duplican en Node (S3): la base es el juez y las RPC traducen sus
// rechazos a los mensajes de S6. Este archivo solo da tipos a las lecturas.
import { sql } from "drizzle-orm";
import { boolean, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { voucherTypeEnum } from "../db/schema/enums";

export const voucherSeries = pgTable("voucher_series", {
	id: uuid("id").primaryKey().defaultRandom(),
	ownerId: uuid("owner_id").notNull().default(sql`auth.uid()`),
	// Los seis tipos del enum de la base: la restriccion a los tres que se emiten es una regla de
	// la RPC y del contrato compartido (S4), no del almacenamiento.
	voucherType: voucherTypeEnum("voucher_type").notNull(),
	code: text("code").notNull(),
	lastNumber: integer("last_number").notNull().default(0),
	isDefault: boolean("is_default").notNull().default(false),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
});
