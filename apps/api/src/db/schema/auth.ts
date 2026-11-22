// Identidad. `auth.users` es la tabla canonica del monorepo (S15): Better Auth escribe en
// ella, no en un espejo. Introducida por la migracion `00000000000001_auth_compat.sql`, que
// ademas define `auth.uid()` leyendo el GUC `app.user_id`.
//
// DDL real (psql '\d auth.users' contra gestion_verify):
//   id uuid pk default gen_random_uuid()
//   name text null
//   email text not null
//   email_verified boolean not null default false
//   image text null
//   created_at timestamptz not null default now()
//   updated_at timestamptz not null default now()
//   unique index auth_users_email_key on (lower(email))
import { sql } from "drizzle-orm";
import { boolean, pgSchema, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const authSchema = pgSchema("auth");

export const users = authSchema.table(
	"users",
	{
		id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
		name: text("name"),
		email: text("email").notNull(),
		emailVerified: boolean("email_verified").notNull().default(false),
		image: text("image"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex("auth_users_email_key").on(sql`lower(${table.email})`)],
);

// ---------------------------------------------------------------------------
// Las tres tablas de abajo las crea la migracion
// `20261029101500_better_auth_tables_and_role_grants.sql` (T4b, S15): el shim solo aporta
// `auth.users` porque Supabase Auth creaba estas tres y no vienen en el SQL heredado.
//
// Se declaran aca con la forma exacta de esa migracion (`text` para los ids que genera Better
// Auth, `timestamptz` para los timestamps, `user_id uuid` porque `auth.users.id` es uuid) para
// que el mapeo del adapter de Drizzle sea completo. Un sign-up seguido de sign-in ya se probo
// contra la base migrada: Better Auth escribe `auth.session`, `auth.account` y
// `auth.verification` como owner (no pasan por `withOwner`) y `authenticated` no tiene
// privilegios sobre ellas, que es lo que afirma `db:check-rls`.
// ---------------------------------------------------------------------------

export const sessions = authSchema.table("session", {
	id: text("id").primaryKey(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	token: text("token").notNull().unique(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	ipAddress: text("ip_address"),
	userAgent: text("user_agent"),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
});

export const accounts = authSchema.table("account", {
	id: text("id").primaryKey(),
	accountId: text("account_id").notNull(),
	providerId: text("provider_id").notNull(),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	accessToken: text("access_token"),
	refreshToken: text("refresh_token"),
	idToken: text("id_token"),
	accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
	refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
	scope: text("scope"),
	password: text("password"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifications = authSchema.table("verification", {
	id: text("id").primaryKey(),
	identifier: text("identifier").notNull(),
	value: text("value").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
