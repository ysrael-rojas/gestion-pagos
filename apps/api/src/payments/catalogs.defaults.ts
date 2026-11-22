// Semillas de catalogo del proyecto de origen, copiadas de su `lib/caja/defaults.ts`.
//
// Los `code` son el contrato: el formulario de pagos resuelve "es efectivo" por
// `code === "EFECTIVO"` y la categoría por codigo estable (SPEC 37 del origen), asi que renombrar
// una fila no rompe el combo. Estos valores tienen que coincidir con lo que ya sembro
// `packages/db/seeds` para que `POST /catalogs/ensure` sea compatible con la demo y con cualquier
// instalacion existente: si un codigo no coincide, la comparacion por codigo lo sembraria de
// nuevo y quedarian dos filas equivalentes con nombres distintos.
import type { PaymentDirection } from "./payments.types.ts";

export interface SeedPaymentMethod {
	code: string;
	name: string;
}

export interface SeedCategory {
	code: string;
	name: string;
}

/** `DEFAULT_PAYMENT_METHODS` del origen. */
export const DEFAULT_PAYMENT_METHODS: SeedPaymentMethod[] = [
	{ code: "EFECTIVO", name: "Efectivo" },
	{ code: "TRANSFERENCIA_BCP", name: "Transferencia BCP" },
	{ code: "TARJETA_CREDITO", name: "Tarjeta de crédito" },
];

/** `DEFAULT_CATEGORIES` del origen: 5 de ingreso y 8 de egreso, con su codigo estable. */
export const DEFAULT_CATEGORIES: Record<PaymentDirection, SeedCategory[]> = {
	INGRESO: [
		{ code: "COBRANZA_VENTA", name: "Cobranza de venta" },
		{ code: "ANTICIPO_CLIENTE", name: "Anticipo de cliente" },
		{ code: "APORTE_PROPIETARIO", name: "Aporte del propietario" },
		{ code: "ABONO_BANCARIO", name: "Abono bancario" },
		{ code: "OTRO_INGRESO", name: "Otro ingreso" },
	],
	EGRESO: [
		{ code: "PAGO_PROVEEDOR", name: "Pago a proveedor" },
		{ code: "ANTICIPO_PROVEEDOR", name: "Anticipo a proveedor" },
		{ code: "GASTO_OPERATIVO", name: "Gasto operativo" },
		{ code: "RETIRO_PROPIETARIO", name: "Retiro del propietario" },
		{ code: "ITF", name: "ITF" },
		{ code: "COMISION_BANCARIA", name: "Comisión bancaria" },
		{ code: "DETRACCION_SPOT", name: "Detracción SPOT" },
		{ code: "OTRO_EGRESO", name: "Otro egreso" },
	],
};
