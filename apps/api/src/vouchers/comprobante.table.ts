// Tipos Drizzle de `public.comprobante` para las LECTURAS del vertical de ventas (T3).
//
// Por que vive en el modulo y no en `src/db/schema`: la superficie de este slice es
// `apps/api/src/vouchers/**`, y `src/db/schema/index.ts` es un barrel compartido por los otros
// verticales (agregar el archivo alla obligaria a tocar un barrel que no es de este slice). Cuando
// el vertical crezca (notas, retenciones, compras) este archivo se mueve a
// `src/db/schema/comprobante.ts` y el barrel lo reexporta: los tipos son los mismos y la ubicacion
// es lo unico que cambia.
//
// Solo se declaran las columnas que el vertical lee. La ESCRITURA no pasa por esta tabla (S8): el
// alta y la edicion son las RPC `security definer` `public.crear_venta` / `public.editar_venta`,
// porque `authenticated` no tiene UPDATE ni DELETE sobre `comprobante`
// (`20261124090000_revoke_payments_writes.sql`).
//
// DDL real (psql '\d public.comprobante' contra la base migrada, PostgreSQL 18.7):
//   id uuid pk default gen_random_uuid()
//   entity_id uuid not null          -> fk entidad(id)
//   voucher_kind voucher_kind not null
//   voucher_type voucher_type not null
//   voucher_number text not null
//   issue_date date not null
//   registration_date date not null default current_date
//   subtotal / igv / total numeric(12,2) not null    check (total > 0)
//   payment_type payment_type not null
//   credit_days integer null
//   due_date date GENERATED ALWAYS AS (...) STORED   <- el API nunca la escribe (S9)
//   status comprobante_status not null default 'PENDIENTE'
//   created_at / updated_at timestamptz not null default now()
//   deleted_at timestamptz null
//   owner_id uuid not null default auth.uid()
//   referenced_comprobante_id uuid null, motive_code text null   (notas y retenciones: slice 2)
//   unique index comprobante_owner_kind_number_key (owner_id, voucher_kind, voucher_number)
//     where deleted_at is null
//
// `numeric` se declara como string: es la representacion exacta que devuelve node-postgres, y la
// conversion a number ocurre en el mapper (borde del contrato HTTP). `date` se declara como
// string: es el modo por defecto de Drizzle y es lo que el contrato del frontend espera
// (`"YYYY-MM-DD"`).
import { sql } from "drizzle-orm";
import { date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import {
	comprobanteStatusEnum,
	paymentTypeEnum,
	voucherKindEnum,
	voucherTypeEnum,
} from "../db/schema/enums";

export const comprobante = pgTable("comprobante", {
	id: uuid("id").primaryKey().defaultRandom(),
	entityId: uuid("entity_id").notNull(),
	voucherKind: voucherKindEnum("voucher_kind").notNull(),
	voucherType: voucherTypeEnum("voucher_type").notNull(),
	voucherNumber: text("voucher_number").notNull(),
	issueDate: date("issue_date").notNull(),
	registrationDate: date("registration_date").notNull().default(sql`current_date`),
	subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
	igv: numeric("igv", { precision: 12, scale: 2 }).notNull(),
	total: numeric("total", { precision: 12, scale: 2 }).notNull(),
	paymentType: paymentTypeEnum("payment_type").notNull(),
	creditDays: integer("credit_days"),
	// Columna generada por la base (`issue_date + credit_days`, solo en CREDITO): se lee, nunca se
	// escribe desde la app (S9).
	dueDate: date("due_date"),
	status: comprobanteStatusEnum("status").notNull().default("PENDIENTE"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	ownerId: uuid("owner_id").notNull().default(sql`auth.uid()`),
});
