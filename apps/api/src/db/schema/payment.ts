// Pagos. DDL real (psql '\d payment' contra gestion_verify, PostgreSQL 18.7):
//   id uuid pk default gen_random_uuid()
//   entity_id uuid null            -> fk entidad(id)
//   direction payment_direction not null
//   payment_date date not null
//   receipt_serial integer not null            (lo asigna el trigger assign_receipt_number)
//   amount numeric(12,2) not null              check (amount > 0)
//   reference text null
//   status payment_status not null default 'EN_REVISION'
//   void_reason text null
//   voided_at timestamptz null
//   notes text null
//   created_at / updated_at timestamptz not null default now()
//   receipt_number text GENERATED ALWAYS AS (...) STORED
//   owner_id uuid not null default auth.uid()  -> fk auth.users(id) on delete cascade
//   method_id uuid not null                    -> fk payment_method(id)
//   cash_account_id uuid not null              -> fk cash_account(id)
//   category_id uuid not null                  -> fk cash_receipt_category(id)
//   is_cash_movement boolean not null default false
//   unique (direction, receipt_serial)
//
// `cash_account` y `cash_receipt_category` no forman parte de este slice, asi que sus claves
// foraneas quedan documentadas arriba pero no se declaran: `references()` a una tabla que no
// esta en el schema tipado rompe el tipado sin agregar nada. La base sigue siendo la fuente
// de verdad de las restricciones (S7).
import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	date,
	index,
	integer,
	numeric,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { entidad } from "./entidad";
import { paymentDirectionEnum, paymentStatusEnum } from "./enums";
import { paymentMethod } from "./payment-method";

export const payment = pgTable(
	"payment",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		entityId: uuid("entity_id").references(() => entidad.id),
		direction: paymentDirectionEnum("direction").notNull(),
		paymentDate: date("payment_date").notNull(),
		receiptSerial: integer("receipt_serial").notNull(),
		// numeric se declara como string en Drizzle: es la unica representacion que no
		// pierde centavos. El contrato Zod (`amount: z.coerce.number()` en @gestion/shared)
		// tipa la entrada del formulario, no la salida de lectura.
		amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
		reference: text("reference"),
		status: paymentStatusEnum("status").notNull().default("EN_REVISION"),
		voidReason: text("void_reason"),
		voidedAt: timestamp("voided_at", { withTimezone: true }),
		notes: text("notes"),
		createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
		// Columna generada por la base: apps/api nunca la escribe.
		receiptNumber: text("receipt_number").generatedAlwaysAs(
			sql`((CASE WHEN "direction" = 'INGRESO'::payment_direction THEN 'RI'::text ELSE 'RE'::text END || '-'::text) || lpad("receipt_serial"::text, 6, '0'::text))`,
		),
		ownerId: uuid("owner_id")
			.notNull()
			.default(sql`auth.uid()`)
			.references(() => users.id, { onDelete: "cascade" }),
		methodId: uuid("method_id")
			.notNull()
			.references(() => paymentMethod.id),
		cashAccountId: uuid("cash_account_id").notNull(),
		categoryId: uuid("category_id").notNull(),
		isCashMovement: boolean("is_cash_movement").notNull().default(false),
	},
	(table) => [
		unique("payment_receipt_unique").on(table.direction, table.receiptSerial),
		index("idx_payment_owner_id").on(table.ownerId),
		index("payment_direction_date_idx").on(table.direction, table.paymentDate.desc()),
		index("payment_cash_account_date_idx").on(table.cashAccountId, table.paymentDate.desc()),
		index("payment_entity_idx").on(table.entityId),
		index("payment_method_idx").on(table.methodId),
		index("payment_category_idx").on(table.categoryId),
		check("payment_amount_check", sql`${table.amount} > 0::numeric`),
		check(
			"payment_void_check",
			sql`${table.status} = 'ANULADO'::payment_status AND ${table.voidReason} IS NOT NULL AND ${table.voidedAt} IS NOT NULL OR (${table.status} = ANY (ARRAY['EN_REVISION'::payment_status, 'PROCESADO'::payment_status])) AND ${table.voidReason} IS NULL AND ${table.voidedAt} IS NULL`,
		),
	],
);
