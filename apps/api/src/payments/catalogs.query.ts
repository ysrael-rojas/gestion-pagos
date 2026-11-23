// Esquemas de entrada de las cuatro lecturas de catalogo, del sembrado explicito y de las
// escrituras de C7 del vertical de cajas-bancos (alta y modificacion de metodos y categorias).
//
// Igual que el resto del borde HTTP del vertical: la sesion la resuelve `SessionGuard` antes de
// estos pipes, y ninguna query ni body acepta un `owner_id` — el dueno sale siempre de la sesion.
//
// `onlyActive` es un enum de strings y no `z.coerce.boolean()` a proposito: `Boolean("false")` es
// `true`, asi que coercionar convertiria `?onlyActive=false` en "solo activos", que es
// exactamente lo contrario de lo que pidio el cliente.
import { cashReceiptCategorySchema, paymentMethodSchema } from "@gestion/shared";
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
 * `GET /receipt-categories?direction=INGRESO|EGRESO&onlyActive=false`.
 *
 * `direction` es opcional, como `listCategories(direction?)` del origen: sin direccion devuelve
 * todas. El formulario de pagos siempre la manda.
 *
 * `onlyActive` tambien es opcional y su default (`true`) es el contrato que ya consumian el
 * formulario y el sembrado: sin el parametro la respuesta es la de siempre. Existe porque la
 * tarjeta de configuracion necesita lo contrario — listar TAMBIEN las desactivadas para poder
 * volver a activar una categoria. Sin el parametro, desactivar saca la fila del listado y su
 * `PATCH` queda inalcanzable desde la UI, o sea que la desactivacion era irreversible.
 */
export const receiptCategoriesQuerySchema = z.object({
	direction: direction.optional(),
	onlyActive: z
		.enum(["true", "false"])
		.default("true")
		.transform((value) => value === "true"),
});

export type ReceiptCategoriesQuery = z.output<typeof receiptCategoriesQuerySchema>;

// ------------------------------------------------------------------------------------------
// C7 del vertical de cajas-bancos: ESCRITURAS de catalogo.
//
// El ALTA reusa el schema COMPARTIDO tal cual (`paymentMethodSchema` y
// `cashReceiptCategorySchema` de `@gestion/shared`): es el mismo que valida el formulario de la
// web, asi que el codigo se normaliza UNA vez (trim, mayusculas, espacios a guion bajo, maximo 40)
// y el mensaje de "El codigo no puede superar 40 caracteres." es el que ya ve el usuario.
//
// La MODIFICACION declara un schema propio de dos campos, y no un `.partial()` del compartido, por
// dos razones: el `code` es inmutable despues del alta (no esta en el schema, asi que Zod lo
// descarta si el cliente lo manda), y el `isActive` del alta tiene `.default(true)`, que un
// `.partial()` no desactiva — un PATCH sin `isActive` volveria a poner `true`. Es el mismo reparto
// parcial que tenia el origen (`updatePaymentMethod(id, { name?, isActive? })`).
//
// `receipt-categories` NO tiene `code` en ninguno de los dos: se DERIVA del nombre en el servicio
// (`categoryCodeFromName`), porque la columna es `not null` y unica por dueno y la derivacion tiene
// que vivir en un solo lugar. El cliente que mandara su propio `code` lo veria descartado.

/** Body de `POST /payment-methods` (el schema del formulario, sin duplicar reglas). */
export const paymentMethodBodySchema = paymentMethodSchema;

export type PaymentMethodBody = z.output<typeof paymentMethodBodySchema>;

/** Body de `PATCH /payment-methods/:id`: nombre y estado, los dos opcionales (PATCH parcial). */
export const paymentMethodPatchSchema = z.object({
	name: z.string().trim().min(1, "El nombre es obligatorio.").max(60),
	isActive: z.boolean(),
}).partial();

export type PaymentMethodPatch = z.output<typeof paymentMethodPatchSchema>;

/** Body de `POST /receipt-categories`: sin `code`, que lo deriva el servicio del nombre. */
export const receiptCategoryBodySchema = cashReceiptCategorySchema;

export type ReceiptCategoryBody = z.output<typeof receiptCategoryBodySchema>;

/** Body de `PATCH /receipt-categories/:id`: nombre y estado; el `code` no se re-deriva. */
export const receiptCategoryPatchSchema = z.object({
	name: z.string().trim().min(1, "El nombre es obligatorio.").max(60),
	isActive: z.boolean(),
}).partial();

export type ReceiptCategoryPatch = z.output<typeof receiptCategoryPatchSchema>;

/** Parametro de ruta de las dos modificaciones (`/payment-methods/:id`, `/receipt-categories/:id`). */
export const catalogIdParamsSchema = z.object({ id: z.string().uuid("El identificador debe ser un uuid.") });

export type CatalogIdParams = z.output<typeof catalogIdParamsSchema>;
