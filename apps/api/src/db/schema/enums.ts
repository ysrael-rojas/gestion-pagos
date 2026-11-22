// Enums de PostgreSQL introspectados contra la base ya migrada (`gestion_verify` en el
// contenedor `gestion-pagos-db-dev`, PostgreSQL 18.7) con:
//
//   psql -c '\dT+ payment_direction'   (idem payment_status / payment_type / document_type)
//   select typname, enumlabel, enumsortorder from pg_enum order by enumtypid, enumsortorder;
//
// El orden de los labels es el `enumsortorder` real, no el alfabetico: `payment_status` se
// creo con EN_REVISION y ANULADO y PROCESADO se inserto despues ANTES de ANULADO
// (`alter type ... add value 'PROCESADO' before 'ANULADO'`), por eso su sortorder es 1.5.
// Cambiar el orden cambia el resultado de `order by status` en la base.
import { pgEnum } from "drizzle-orm/pg-core";

/** `payment_direction`: INGRESO (1), EGRESO (2). Usado por `payment.direction`. */
export const paymentDirectionEnum = pgEnum("payment_direction", ["INGRESO", "EGRESO"]);

/** `payment_status`: EN_REVISION (1), PROCESADO (1.5), ANULADO (2). Usado por `payment.status`. */
export const paymentStatusEnum = pgEnum("payment_status", ["EN_REVISION", "PROCESADO", "ANULADO"]);

/**
 * `payment_type`: CONTADO (1), CREDITO (2). No lo usa ninguna de las cuatro tablas de este
 * slice; vive en `comprobante.payment_type` y en la vista `voucher_balance`. Se declara
 * porque pertenece al dominio de pagos y el contrato Zod ya lo nombra.
 */
export const paymentTypeEnum = pgEnum("payment_type", ["CONTADO", "CREDITO"]);

/** `document_type`: SIN_DOCUMENTO (1), RUC (2), DNI (3), CARNET_EXTRANJERIA (4). */
export const documentTypeEnum = pgEnum("document_type", [
	"SIN_DOCUMENTO",
	"RUC",
	"DNI",
	"CARNET_EXTRANJERIA",
]);

/**
 * `voucher_kind`: COMPRA (1), VENTA (2). Vive en `comprobante.voucher_kind` y en la vista
 * `voucher_balance`; es lo que separa la cobranza (VENTA) de la deuda (COMPRA) en cartera.
 */
export const voucherKindEnum = pgEnum("voucher_kind", ["COMPRA", "VENTA"]);

/** `voucher_type`: el tipo de comprobante SUNAT. Lo expone `voucher_balance.voucher_type`. */
export const voucherTypeEnum = pgEnum("voucher_type", [
	"FACTURA",
	"BOLETA",
	"NOTA_VENTA",
	"NOTA_CREDITO",
	"NOTA_DEBITO",
	"COMPROBANTE_RETENCION",
]);

/** `comprobante_status`: PAGADO (1), PENDIENTE (2). Derivado del saldo, no lo escribe la app. */
export const comprobanteStatusEnum = pgEnum("comprobante_status", ["PAGADO", "PENDIENTE"]);

/** `cash_account_type`: CASH_BOX (1), BANK_ACCOUNT (2). */
export const cashAccountTypeEnum = pgEnum("cash_account_type", ["CASH_BOX", "BANK_ACCOUNT"]);
