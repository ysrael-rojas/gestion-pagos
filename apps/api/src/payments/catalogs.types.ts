// Contrato de salida de los catalogos del vertical de pagos (T5b2).
//
// El formulario de alta de pagos necesita cuatro catalogos que en el origen leia directamente de
// Supabase (`lib/clientes/entidades.ts`, `lib/cuentas/entidades.ts`, `lib/caja/caja.ts`). Cada
// forma de aca es la que consume el componente, no una copia de la fila: solo viajan las columnas
// que la UI usa, con los mismos nombres en camelCase que el resto del contrato de pagos.
import { documentTypeEnum } from "../db/schema/enums.ts";
import type { PaymentDirection } from "./payments.types.ts";

/** Los cuatro valores del enum `document_type`, derivados del schema (una sola fuente de verdad). */
type DocumentType = (typeof documentTypeEnum.enumValues)[number];

/**
 * Entidad (cliente o proveedor) para el autocomplete y para resolver nombres de pagos.
 *
 * Es el `Client` de `components/clientes/types.ts` del origen. `isSupplier` viaja porque el
 * origen lo declara opcional en el tipo y la UI de pagos no lo usa, pero un consumidor de
 * `role=client` puede necesitar distinguir un cliente que tambien es proveedor.
 */
export interface EntityCatalogItem {
	id: string;
	documentType: DocumentType;
	documentNumber: string;
	name: string;
	address: string;
	phone: string;
	contactName: string;
	billingEmail: string;
	managementEmail: string;
	isSupplier: boolean;
}

/**
 * Cuenta de caja o banco para el selector del formulario (`CashAccount` del origen).
 *
 * Solo lo que el formulario de pagos usa: `type` separa caja de banco, `isActive` filtra y
 * `currency` se muestra junto al nombre. El resto de la fila (apertura, cierre, caja chica)
 * pertenece al vertical de cajas-bancos.
 */
export interface CashAccountCatalogItem {
	id: string;
	type: "CASH_BOX" | "BANK_ACCOUNT";
	name: string;
	currency: string;
	isActive: boolean;
}

/** Metodo de pago (`PaymentMethodRef` del origen). `code` decide caja vs banco en el formulario. */
export interface PaymentMethodCatalogItem {
	id: string;
	code: string;
	name: string;
	isActive: boolean;
}

/** Categoria de recibo de caja (`CashReceiptCategory` del origen), por direccion. */
export interface CashReceiptCategoryCatalogItem {
	id: string;
	direction: PaymentDirection;
	name: string;
	code: string;
	isActive: boolean;
}

/** Resultado de `POST /catalogs/ensure`: cuantas filas falto crear (0 = ya estaba sembrado). */
export interface CatalogSeedResult {
	methods: number;
	categories: number;
}
