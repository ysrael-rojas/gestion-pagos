// Esquemas de entrada del vertical de notas (T3), para pasar por `ZodValidationPipe`.
//
// EL BODY ES EL CONTRATO DE `@gestion/shared` (`notaWriteSchema`), no un DTO propio: es el mismo
// objeto que valida el formulario (`notaSchema` menos el numero, que el formulario solo muestra como
// preview). Asi los mensajes de S8/S9 ("La fecha de emisión es requerida", "El total debe ser mayor a
// 0", "Selecciona el motivo de la nota", "El motivo no pertenece al catálogo de la nota") son
// exactamente los mismos en la pantalla y en el API, y el catalogo de motivos se valida por TIPO con
// una sola fuente (`NOTE_MOTIVES`).
//
// Dos cosas que el body NO lleva y por eso no se declaran aca:
//   * el NUMERO: lo asigna la base desde la serie por defecto del tipo de la nota (S3). El contrato
//     lo acepta como opcional (`voucherNumber`) porque el formulario lo manda como preview, y el
//     servicio lo ignora: la respuesta trae el que quedo escrito;
//   * los datos que se HEREDAN del comprobante referenciado (S4): `entity_id`, `voucher_kind`,
//     `payment_type` y `credit_days` los copia `public.crear_nota` del referenciado. El dueno tampoco
//     viaja: sale de la sesion (`withOwner` fija `app.user_id`).
import { notaWriteSchema } from "@gestion/shared";
import { z } from "zod";

/**
 * Body de `POST /notes`.
 *
 * `COMPROBANTE_RETENCION` sigue siendo un valor posible del enum (el contrato compartido lo modela
 * para su propio slice, S1) y este modulo no lo prohibe: la base lo rechaza con el mensaje de S10
 * ("Los datos de la nota no son válidos."), que es el contrato que el cliente ve.
 */
export const noteCreateBodySchema = notaWriteSchema;

export type NoteCreateBody = z.output<typeof noteCreateBodySchema>;

/**
 * Query de `GET /notes`: el comprobante cuyas notas se piden.
 *
 * Se exige uuid porque el id del detalle ya lo es: sin esta validacion un id con otra forma seria una
 * lista vacia por un motivo que el cliente no puede distinguir de "este comprobante no tiene notas".
 */
export const notesQuerySchema = z.object({
	voucherId: z.string().uuid("El comprobante referenciado debe ser un uuid."),
});

export type NotesQuery = z.output<typeof notesQuerySchema>;
