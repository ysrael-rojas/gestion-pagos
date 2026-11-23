// Esquemas de entrada de las transferencias entre cuentas (C6 del vertical de cajas-bancos).
//
// El body es el schema COMPARTIDO que valida el modal del origen
// (`components/cajas-bancos/transfer-modal.tsx` via `zodResolver`), con los mismos nombres
// camelCase, para que el formulario de C5 no traduzca nada:
//
//   cashTransferSchema  sourceAccountId, targetAccountId, amount, transferDate, notes
//
// POR QUE `z.object(schema.shape)` Y NO EL SCHEMA TAL CUAL: `cashTransferSchema` lleva un
// `superRefine` sobre el OBJETO cuya unica regla es "origen y destino no pueden ser la misma
// cuenta". Esa regla la aplica la base (`create_cash_transfer` levanta `Origen y destino deben ser
// cuentas distintas`) y con el mismo criterio que se aplico en C4 (L12(b) del doc de la feature):
// el borde HTTP no adelanta una decision que el SQL ya toma, porque re-validarla en Node haria
// inalcanzable la rama SQL y duplicaria un mensaje que el dominio ya redacta. `schema.shape`
// conserva TODAS las reglas de campo (uuid de las dos cuentas, monto positivo, fecha
// "YYYY-MM-DD", notas acotadas) y descarta solo la comprobacion de objeto.
//
// Ninguna clave acepta `owner_id` ni ningun otro campo de identidad: el dueno sale de
// `request.sessionUser` (S6) y el schema descarta cualquier campo de mas que llegue en el body.
import { cashTransferSchema } from "@gestion/shared";
import { z } from "zod";

const uuid = z.string().uuid("El identificador debe ser un uuid.");

/** Body de `POST /cash-transfers` (el contrato del modal, sin la regla de "cuentas distintas"). */
export const cashTransferBodySchema = z.object(cashTransferSchema.shape);

export type CashTransferBody = z.output<typeof cashTransferBodySchema>;

/** Parametro de ruta de `GET /cash-transfers/:id`. */
export const cashTransferIdParamsSchema = z.object({ id: uuid });

export type CashTransferIdParams = z.output<typeof cashTransferIdParamsSchema>;

/**
 * Query de `GET /cash-transfers`: la cuenta y el periodo que mira la pantalla de movimientos
 * (`listAccountTransfers(accountId, from, to)` del origen, que filtra `transfer_date` con
 * `>= from` y `<= to`, bordes INCLUSIVE).
 *
 * Las tres son obligatorias: la tabla de movimientos siempre las manda, y una lista sin periodo
 * seria otra ruta (el historial completo de la cuenta) que hoy no tiene consumidor. Las dos
 * fechas reusan la regla del schema compartido (`transferDate`) en vez de definir una segunda
 * convencion de fecha en el API.
 */
export const cashTransferListQuerySchema = z.object({
	accountId: uuid,
	from: cashTransferSchema.shape.transferDate,
	to: cashTransferSchema.shape.transferDate,
});

export type CashTransferListQuery = z.output<typeof cashTransferListQuerySchema>;
