// Esquemas de entrada del borde HTTP, para pasar por `ZodValidationPipe`.
//
// El body de alta usa el schema COMPARTIDO (`paymentSchema` de `@gestion/shared`): es el mismo
// que valida el formulario del frontend y no se duplica (S8). Lo que `@gestion/shared` no
// declara —query strings, parametros de ruta y los tres bodies de accion— se define aca con las
// mismas reglas (uuid, fecha ISO corta, importes positivos) y pasa por el mismo pipe.
//
// El `owner_id` no aparece en ninguno: la identidad sale de la sesion, nunca del cliente.
import { z } from "zod";

const uuid = z.string().uuid("El identificador debe ser un uuid.");

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato YYYY-MM-DD.")
	.describe("Fecha en formato YYYY-MM-DD");

const direction = z.enum(["INGRESO", "EGRESO"]);

/** Mismos valores que `parseListadoFilters` del origen, mas el estado ANULADO del recibo. */
export const paymentStatusFilter = z.enum(["TODOS", "EN_REVISION", "PROCESADO", "ANULADO"]);

export const paymentListQuerySchema = z.object({
	direction: direction.optional(),
	desde: isoDate.optional(),
	hasta: isoDate.optional(),
	estado: paymentStatusFilter.default("TODOS"),
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(100).default(100),
});

export type PaymentListQuery = z.output<typeof paymentListQuerySchema>;

export const paymentIdParamsSchema = z.object({ id: uuid });

/** El historial es por comprobante (firma del origen), no por pago. */
export const comprobanteIdParamsSchema = z.object({ comprobanteId: uuid });

export const accountIdParamsSchema = z.object({ accountId: uuid });

export const unassignedQuerySchema = z.object({ direction });

export const assignStateQuerySchema = z.object({
	direction: direction.optional(),
});

export const openVouchersQuerySchema = z.object({
	direction,
	entityId: uuid.optional(),
});

export const statementQuerySchema = z.object({ from: isoDate, to: isoDate });

export const voidPaymentBodySchema = z.object({
	reason: z.string().trim().min(1, "Escribe el motivo de la anulación."),
});

const allocationInputSchema = z.object({
	comprobanteId: uuid,
	amount: z.coerce.number().positive("El importe asignado debe ser mayor a 0."),
});

export const addAllocationsBodySchema = z.object({
	items: z.array(allocationInputSchema).default([]),
	/** Solo se usa para ligar un anticipo sin entidad a la entidad elegida al asignar. */
	entityId: uuid.optional(),
});

export type AddAllocationsBody = z.output<typeof addAllocationsBodySchema>;

export const markProcessedBodySchema = z.object({
	paymentIds: z.array(uuid).default([]),
});
