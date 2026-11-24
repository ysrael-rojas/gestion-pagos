// Comprobante de pago (venta o compra) y sus ajustes (notas de credito/debito y retencion).
// DDL real (psql '\d public.comprobante', PostgreSQL 18.7):
//   id uuid pk default gen_random_uuid()
//   entity_id uuid not null                 -> fk entidad(id): cliente (VENTA) o proveedor (COMPRA)
//   voucher_kind voucher_kind not null      -> VENTA | COMPRA
//   voucher_type voucher_type not null      -> FACTURA | BOLETA | NOTA_VENTA | NOTA_CREDITO | ...
//   voucher_number text not null            -> '<serie>-<correlativo>'
//   issue_date date not null
//   registration_date date not null default current_date
//   subtotal / igv / total numeric(12,2) not null    check (total > 0)
//   payment_type payment_type not null
//   credit_days integer null                -> check comprobante_credit_days: solo en CREDITO
//   due_date date GENERATED ALWAYS AS (...) STORED   -> el API nunca la escribe
//   status comprobante_status not null default 'PENDIENTE'
//   created_at / updated_at timestamptz not null default now()
//   deleted_at timestamptz null
//   owner_id uuid not null default auth.uid()
//   referenced_comprobante_id uuid null references public.comprobante(id)
//   motive_code text null                   -> catalogo SUNAT (vive en @gestion/shared)
//   constraint comprobante_ajuste_check: una NC/ND exige referencia Y motivo; una retencion exige
//     referencia y NO lleva motivo; un comprobante base no lleva ninguna de las dos.
//   unique index comprobante_owner_kind_number_key (owner_id, voucher_kind, voucher_number)
//     where deleted_at is null
//
// Esta es la UNICA declaracion Drizzle de `public.comprobante`. Antes habia dos subconjuntos
// (`vouchers/comprobante.table.ts` y `notes/note.table.ts`) y cada vertical declaraba solo las
// columnas que leia: la tercera copia iba a ser la de compras, y con tres mapeos de la misma tabla el
// drift deja de ser teorico. Se declaran todas las columnas porque el costo es una linea por columna
// y el de una columna faltante es un bug silencioso en un vertical que no la declaro.
//
// `numeric` se declara como string (representacion exacta de node-postgres; la conversion a number
// ocurre en el borde HTTP) y `date` como string (`"YYYY-MM-DD"`).
//
// La ESCRITURA no pasa por Drizzle: `authenticated` no tiene UPDATE/DELETE sobre esta tabla
// (`20261124090000_revoke_payments_writes.sql`), asi que el alta y la edicion son las RPC
// `security definer` de `20261125090000_series_rpcs.sql` y `20261127090000_notas_rpcs.sql`.
import { sql } from "drizzle-orm";
import { date, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { comprobanteStatusEnum, paymentTypeEnum, voucherKindEnum, voucherTypeEnum } from "./enums";

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
	// escribe desde la app.
	dueDate: date("due_date"),
	status: comprobanteStatusEnum("status").notNull().default("PENDIENTE"),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	ownerId: uuid("owner_id").notNull().default(sql`auth.uid()`),
	// Ajuste: a que comprobante corrige esta fila y con que motivo del catalogo SUNAT.
	referencedComprobanteId: uuid("referenced_comprobante_id"),
	motiveCode: text("motive_code"),
});
