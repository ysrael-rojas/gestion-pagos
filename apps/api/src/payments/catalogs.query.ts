// Esquemas de entrada de las cuatro lecturas de catalogo y del sembrado explicito.
//
// Igual que el resto del borde HTTP del vertical: la sesion la resuelve `SessionGuard` antes de
// estos pipes, y ninguna query acepta un `owner_id` — el dueno sale siempre de la sesion.
//
// `onlyActive` es un enum de strings y no `z.coerce.boolean()` a proposito: `Boolean("false")` es
// `true`, asi que coercionar convertiria `?onlyActive=false` en "solo activos", que es
// exactamente lo contrario de lo que pidio el cliente.
import { z } from "zod";

/** Mismos valores que el enum `payment_direction` de la base. */
const direction = z.enum(["INGRESO", "EGRESO"]);

/** `GET /entities?role=client|supplier`. Sin rol, cliente (el caso mas usado por el form). */
export const entitiesQuerySchema = z.object({
	role: z.enum(["client", "supplier"]).default("client"),
});

export type EntitiesQuery = z.output<typeof entitiesQuerySchema>;

/** `GET /payment-methods?onlyActive=true|false`. */
export const paymentMethodsQuerySchema = z.object({
	onlyActive: z
		.enum(["true", "false"])
		.default("true")
		.transform((value) => value === "true"),
});

export type PaymentMethodsQuery = z.output<typeof paymentMethodsQuerySchema>;

/**
 * `GET /receipt-categories?direction=INGRESO|EGRESO`.
 *
 * Opcional, como `listCategories(direction?)` del origen: sin direccion devuelve todas. El
 * formulario de pagos siempre la manda.
 */
export const receiptCategoriesQuerySchema = z.object({
	direction: direction.optional(),
});

export type ReceiptCategoriesQuery = z.output<typeof receiptCategoriesQuerySchema>;
