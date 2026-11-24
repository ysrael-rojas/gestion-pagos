// Esquemas de entrada del vertical de series (T3), para pasar por `ZodValidationPipe`.
//
// EL BODY ES EL CONTRATO DE `@gestion/shared` (`serieFormSchema`), no un DTO propio: es el mismo
// objeto que valida el formulario de Configuración → Series (S10), asi que los mensajes de S7
// ("Selecciona el tipo de comprobante", "El código de serie es requerido", "Usa 1 a 4 caracteres
// alfanuméricos, por ejemplo F001") se comportan igual en la pantalla y en el API. Duplicarlo aca
// abriria la puerta a que el formulario acepte algo que la base rechaza, o al reves.
//
// Dos diferencias con el formulario, las dos derivadas de S4/S5 y no de una preferencia:
//
//   1. El schema ya NO ofrece los seis tipos del enum: solo `FACTURA`, `BOLETA` y `NOTA_VENTA`
//      (S4). El enum de `packages/shared` se recorto en T2 y este modulo lo hereda; la RPC
//      `crear_serie` lo vuelve a exigir por si alguien la llama por fuera del API (S13.2).
//   2. El contrato NO tiene `lastNumber`: el correlativo lo mueve la base al emitir (S2) y el
//      formulario no lo edita. El de lectura es `voucherSeriesSchema` (`series.types.ts`), no este.
import { serieFormSchema } from "@gestion/shared";
import { z } from "zod";

/**
 * Body de `POST /series`.
 *
 * El codigo llega ya normalizado (`trim` del contrato compartido), asi que un espacio de mas no
 * se convierte en un codigo distinto en la base.
 */
export const serieCreateBodySchema = serieFormSchema;

export type SerieCreateBody = z.output<typeof serieCreateBodySchema>;

/**
 * Body de `PATCH /series/:id`: el MISMO contrato menos `voucherType`.
 *
 * El tipo no se edita (S5, L4a): cambiarlo reescribiria la numeracion ya emitida a nombre de otro
 * tipo de comprobante, y `public.editar_serie` no lo recibe. Se deriva con `omit` del mismo objeto
 * en vez de escribir un segundo schema, para que las reglas del codigo y del default sean
 * exactamente las mismas que en el alta.
 *
 * Un `voucherType` que llegue igual en el body NO es un error: el contrato de edicion no lo
 * declara y Zod descarta lo que no declara. La pantalla no lo manda (`Editar serie` muestra el tipo
 * como dato fijo), y aceptarlo en silencio es preferible a inventar un mensaje que S6 no tiene.
 */
export const serieEditBodySchema = serieFormSchema.omit({ voucherType: true });

export type SerieEditBody = z.output<typeof serieEditBodySchema>;

/** Parametro de ruta de las tres rutas por id, con el mismo texto que el del vertical de ventas. */
export const serieIdParamsSchema = z.object({
	id: z.string().uuid("El identificador debe ser un uuid."),
});

export type SerieIdParams = z.output<typeof serieIdParamsSchema>;
