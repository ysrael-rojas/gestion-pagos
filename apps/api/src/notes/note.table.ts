// Tipos Drizzle de `public.comprobante` para las LECTURAS del vertical de notas (T3 del port de
// notas).
//
// Por que un archivo propio y no `../vouchers/comprobante.table.ts`: aquel declara SOLO las columnas
// que el vertical de ventas lee, y las dos que definen una nota (`referenced_comprobante_id` y
// `motive_code`) no estan entre ellas. Extender aquel archivo obligaria a tocar una superficie que
// este slice no tiene asignada, y su propia cabecera ya anticipa este caso: cuando el vertical crezca
// el archivo se mueve a `src/db/schema/comprobante.ts` y los dos mapeos se fusionan. Hasta entonces
// este declara su subconjunto, igual que `voucher-series.table.ts` en el vertical de series.
//
// La ESCRITURA no pasa por esta tabla: el alta es la RPC `security definer` `public.crear_nota`
// (`20261127090000_notas_rpcs.sql`), porque `authenticated` no tiene INSERT/UPDATE/DELETE sobre
// `comprobante` (`20261124090000_revoke_payments_writes.sql`) ni sobre el correlativo de la serie.
//
// DDL real de las dos columnas del ajuste (psql '\d public.comprobante', PostgreSQL 18.7):
//   referenced_comprobante_id uuid null references public.comprobante(id)
//   motive_code text null
//   constraint comprobante_ajuste_check: una nota exige las DOS; una retencion no lleva motivo.
//
// `numeric` se declara como string (representacion exacta de node-postgres) y `date` como string
// (`"YYYY-MM-DD"`, que es lo que espera el contrato del detalle).
import { sql } from "drizzle-orm";
import { date, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { voucherKindEnum, voucherTypeEnum } from "../db/schema/enums";

export const comprobanteAjuste = pgTable("comprobante", {
	id: uuid("id").primaryKey().defaultRandom(),
	voucherKind: voucherKindEnum("voucher_kind").notNull(),
	voucherType: voucherTypeEnum("voucher_type").notNull(),
	voucherNumber: text("voucher_number").notNull(),
	issueDate: date("issue_date").notNull(),
	subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
	igv: numeric("igv", { precision: 12, scale: 2 }).notNull(),
	total: numeric("total", { precision: 12, scale: 2 }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	deletedAt: timestamp("deleted_at", { withTimezone: true }),
	ownerId: uuid("owner_id").notNull().default(sql`auth.uid()`),
	// Las dos columnas que identifican un ajuste: a que comprobante corrige y con que motivo.
	referencedComprobanteId: uuid("referenced_comprobante_id"),
	motiveCode: text("motive_code"),
});
