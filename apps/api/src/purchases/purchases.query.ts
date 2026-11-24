// Esquemas de entrada del vertical de compras (T3), para pasar por `ZodValidationPipe`.
//
// EL BODY ES EL CONTRATO DE ESCRITURA DE `@gestion/shared` (`purchaseWriteSchema`), no un DTO propio
// ni el schema del formulario: es la misma definicion que valida el formulario de ventas y compras,
// asi que los mensajes de S9 y la limpieza de `creditDays` en CONTADO se comportan igual en la
// pantalla y en el API.
//
// LA DIFERENCIA CON LA VENTA ES EL NUMERO, y es de negocio, no de forma: en una compra el numero lo
// emitio el PROVEEDOR, asi que lo tipea el usuario, viaja en el body y es OBLIGATORIO (S2/L3a). En
// la venta lo asigna la base desde la serie por defecto dentro de la transaccion del alta, y por eso
// su contrato lo acepta y lo ignora. Las dos variantes salen de la misma fabrica (`voucherContract`
// en `packages/shared/src/lib/schemas/voucher.ts`), asi que no hay dos listas de reglas que se
// desincronicen.
import { purchaseWriteSchema } from "@gestion/shared";
import { z } from "zod";

/**
 * Body de `POST /purchases` y de `PATCH /purchases/:id`.
 *
 * NO se agrega el default de la fecha de emision que si tiene la venta: `issueDate` es un campo
 * requerido del contrato compartido y el formulario (que exige el mismo schema) siempre lo manda.
 * Inventar un default aca haria que el API acepte un alta que la pantalla no puede producir.
 *
 * `PATCH` recibe el MISMO body completo: el formulario manda todos los campos editables siempre y
 * `editar_compra` reescribe el conjunto entero. Un PATCH parcial dejaria el resto a criterio de quien
 * lo llame.
 *
 * `status` viaja en el body porque es parte del contrato del formulario, pero el API NO lo escribe:
 * lo deriva la tabla (`default 'PENDIENTE'`) y lo recalcula `private.refresh_comprobante_status` al
 * asignar o anular pagos. Ver `purchases.service.ts`.
 */
export const purchaseBodySchema = purchaseWriteSchema;

export type PurchaseBody = z.output<typeof purchaseBodySchema>;

/** Parametro de ruta de todas las rutas por id. */
export const purchaseIdParamsSchema = z.object({
	id: z.string().uuid("El identificador debe ser un uuid."),
});

export type PurchaseIdParams = z.output<typeof purchaseIdParamsSchema>;
