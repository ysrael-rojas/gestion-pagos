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

/** El nombre de la categoria no tiene ni una letra ni un digito: no hay slug posible. */
export const CATEGORY_EMPTY_CODE_MESSAGE = "El nombre de la categoría debe contener letras o números.";

/**
 * Codigo estable de una categoria creada por el usuario, portado de `categoryCodeFromName`
 * (`lib/caja/defaults.ts:56-65` del proyecto de origen) con las MISMAS cuatro operaciones y en el
 * mismo orden:
 *
 *     "Comisión mensual" -> "COMISION_MENSUAL"
 *
 *   1. `normalize("NFD")` + quitar marcas combinantes: "Comisión" -> "Comision" (sin acentos).
 *   2. Mayusculas.
 *   3. Todo lo que no sea A-Z o 0-9, en bloques, a un guion bajo.
 *   4. Guiones bajos de los extremos fuera.
 *
 * Devuelve `""` si el nombre no tiene letras ni numeros (el llamador lo rechaza con
 * `CATEGORY_EMPTY_CODE_MESSAGE`).
 *
 * Vive en el API y no en el cliente a proposito: el `code` es `not null` y `unique (owner_id,
 * code)`, asi que la derivacion tiene que ocurrir en UN solo lugar. Si la web lo derivara tambien,
 * dos versiones de la regla podrian producir codigos distintos para el mismo nombre y el alta
 * chocaria contra el indice unico sin que el usuario entienda por que.
 */
export function categoryCodeFromName(name: string): string {
	return name
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}
