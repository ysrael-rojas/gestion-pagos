// Esquemas de entrada del vertical de ventas (T3), para pasar por `ZodValidationPipe`.
//
// EL BODY ES EL CONTRATO DE ESCRITURA DE `@gestion/shared` (`voucherWriteSchema`), no un DTO
// propio ni el schema del formulario: es la misma definicion que valida el formulario de ventas y
// compras (S11 lo exige con consumidores reales), asi que los mensajes de S4 y la limpieza de
// `creditDays` en CONTADO (S3) se comportan igual en la pantalla y en el API. Duplicarlo aca
// abriria la puerta a que el formulario acepte algo que la base rechaza, o al reves.
//
// POR QUE NO EL DEL FORMULARIO (S2 del port de series): desde que el numero lo asigna la base
// dentro de la transaccion del alta, `voucherNumber` no es un dato del cliente. El formulario lo
// sigue mostrando como preview y por eso lo exige (`voucherFormSchema`); el API no lo puede
// exigir. Las dos variantes salen del mismo objeto en `packages/shared`, asi que no hay dos listas
// de reglas que se desincronicen.
//
// Lo unico que se agrega encima es el DEFAULT de la fecha de emision (S9), y se agrega por
// composicion (`z.preprocess` sobre el schema compartido), no reescribiendo sus reglas:
//
//   * `issueDate` AUSENTE (o `null`) -> `getTodayLocalDate()`, el "hoy" del NEGOCIO
//     (`America/Lima`), nunca `toISOString()` ni el reloj del proceso.
//   * `issueDate` presente pero vacia (`""`) -> sigue siendo el error de S4 ("La fecha de emisión
//     es requerida"). El default es "no mandaste el campo", no "mandaste cualquier cosa".
import { getTodayLocalDate, voucherWriteSchema } from "@gestion/shared";
import { z } from "zod";

/** El "hoy" del negocio cuando el request no manda la fecha de emision (S9). */
const withDefaultIssueDate = z.preprocess((input) => {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return input;
	}

	const values = input as Record<string, unknown>;

	if (values.issueDate === undefined || values.issueDate === null) {
		return { ...values, issueDate: getTodayLocalDate() };
	}

	return values;
}, voucherWriteSchema);

/**
 * Body de `POST /vouchers` y de `PATCH /vouchers/:id`.
 *
 * `PATCH` recibe el MISMO body completo: el formulario manda todos los campos editables siempre
 * (es la misma forma que `PATCH /entities/:id` con `clientSchema`), y la RPC de edicion reescribe
 * el conjunto entero. Un PATCH parcial dejaria el resto a criterio de quien lo llame.
 *
 * `status` viaja en el body porque es parte del contrato del formulario, pero el API NO lo escribe:
 * lo deriva la tabla (`default 'PENDIENTE'`) y lo recalcula `private.refresh_comprobante_status`
 * cuando se asignan o anulan pagos (L8 del doc de la feature). Ver `vouchers.service.ts`.
 */
export const voucherBodySchema = withDefaultIssueDate;

export type VoucherBody = z.output<typeof voucherBodySchema>;

/** Parametro de ruta de todas las rutas por id. */
export const voucherIdParamsSchema = z.object({
	id: z.string().uuid("El identificador debe ser un uuid."),
});

export type VoucherIdParams = z.output<typeof voucherIdParamsSchema>;
