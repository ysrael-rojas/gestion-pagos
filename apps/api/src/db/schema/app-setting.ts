// Ajustes generales por usuario, clave/valor. DDL real (psql '\d app_setting'):
//   owner_id   uuid not null default auth.uid()
//   key        text not null
//   value      text not null
//   updated_at timestamptz not null default now()
//   primary key (owner_id, key)
//
// Fuente: migracion `20261006063301_create_cash_close_module.sql:51-57` (no hay otra tabla ni
// columna: no tiene `id`, no tiene FK -- el snapshot
// `packages/db/scripts/schema-snapshot.sql:357-361` solo lista los NOT NULL y la pkey --, y
// `value` es `text`, no `numeric`: la UI escribe "0.50" y el SQL lo castea).
//
// Los grants de `authenticated` (select/insert/update/delete,
// `20261029101500_better_auth_tables_and_role_grants.sql`) permiten el PATCH del dueno; las
// politicas `app_setting_*` de la misma migracion recortan por `owner_id = auth.uid()`.
import { sql } from "drizzle-orm";
import { pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const appSetting = pgTable(
	"app_setting",
	{
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`),
		key: text("key").notNull(),
		value: text("value").notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [primaryKey({ name: "app_setting_pkey", columns: [table.ownerId, table.key] })],
);
