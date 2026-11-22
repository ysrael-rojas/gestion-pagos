// Entidades (cliente/proveedor). DDL real (psql '\d entidad'):
//   id uuid pk default gen_random_uuid()
//   document_type document_type not null default 'SIN_DOCUMENTO'
//   document_number text not null default ''
//   name text not null
//   address text not null default ''
//   phone text not null default ''
//   contact_name text not null default ''
//   billing_email text not null            <-- sin default y NOT NULL
//   management_email text not null default ''
//   is_client boolean not null default false
//   is_supplier boolean not null default false
//   created_at / updated_at timestamptz not null default now()
//   deleted_at timestamptz null
//   owner_id uuid not null default auth.uid()
//   check (is_client or is_supplier)
//   unique index entidad_document_unique (document_type, document_number)
//     where deleted_at is null and document_number <> ''
import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { documentTypeEnum } from "./enums";

export const entidad = pgTable(
	"entidad",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		documentType: documentTypeEnum("document_type").notNull().default("SIN_DOCUMENTO"),
		documentNumber: text("document_number").notNull().default(""),
		name: text("name").notNull(),
		address: text("address").notNull().default(""),
		phone: text("phone").notNull().default(""),
		contactName: text("contact_name").notNull().default(""),
		billingEmail: text("billing_email").notNull(),
		managementEmail: text("management_email").notNull().default(""),
		isClient: boolean("is_client").notNull().default(false),
		isSupplier: boolean("is_supplier").notNull().default(false),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		deletedAt: timestamp("deleted_at", { withTimezone: true }),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("entidad_document_unique")
			.on(table.documentType, table.documentNumber)
			.where(sql`${table.deletedAt} is null and ${table.documentNumber} <> ''`),
		index("entidad_clientes_idx")
			.on(table.createdAt.desc())
			.where(sql`${table.isClient} and ${table.deletedAt} is null`),
		index("idx_entidad_owner_id").on(table.ownerId),
	],
);
