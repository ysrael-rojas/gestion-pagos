// Esquemas de entrada del vertical de cuentas de caja y banco (C2).
//
// El body es el schema COMPARTIDO (`cashAccountSchema` de `@gestion/shared`), el mismo que valida
// el formulario del frontend, asi que ningun campo se re-valida aca: nombre obligatorio, moneda,
// saldo inicial no negativo, fecha "YYYY-MM-DD", periodicidad de cierre, notas acotadas y caja
// chica se validan una sola vez (S8 del doc padre). Lo unico que el schema de la FILA no trae es
// `type` -- la fila del origen lo recibia aparte del formulario -- y por eso el body lo agrega con
// `cashAccountTypeSchema`, tambien compartido.
//
// POR QUE EL BODY NO ES `cashAccountFormSchema`: ese es el schema del FORMULARIO, y sus reglas
// por tipo (un banco necesita `bankName`, una caja no tiene datos bancarios, un banco no es caja
// chica ni tiene fondo) son las de la UI, que las muestra campo por campo. En la base las mismas
// reglas son CHECK (`cash_account_bank_requires_name`, `cash_account_petty_cash_type_check`), y
// son ellas las que deciden: el borde HTTP no adelanta una validacion que el SQL ya hace mejor
// (S5 del vertical: nadie valida en Node lo que la base valida). Consecuencia observable: un
// banco sin `bankName` pasa el parseo y lo rechaza el CHECK, que `cash.errors.ts` traduce al
// mensaje de dominio. Es el mismo reparto que tenia el origen (formulario en el cliente, CHECK en
// la base).
//
// No hay `owner_id` ni `id` entre los campos: el dueno sale de `request.sessionUser` (S6) y el id
// lo genera la base. Un `owner_id` que llegue en el body lo DESCARTA el schema (no es strict a
// proposito: el origen mandaba la fila cruda y un campo de mas no debe romper el alta), y el
// `default auth.uid()` de la columna lo ignora igual.
import {
	cashAccountSchema,
	cashAccountTypeSchema,
} from "@gestion/shared";
import { z } from "zod";

const uuid = z.string().uuid("El identificador debe ser un uuid.");

/**
 * Body de `POST /cash-accounts` y `PATCH /cash-accounts/:id`: la fila completa del contrato
 * compartido mas el tipo de cuenta.
 *
 * Es una interseccion y no un schema nuevo: cada regla vive en `@gestion/shared` y la salida
 * queda ya normalizada por el `transform` de `cashAccountSchema` (textos recortados, `""` de un
 * texto opcional -> `undefined`, `closingPeriodicity: ""` -> `null`).
 *
 * El PATCH es un REEMPLAZO de las columnas editables, no un merge: la UI manda el formulario
 * completo, igual que el `mapMutation` del origen (`lib/cuentas/entidades.ts:76-94`), y un campo
 * opcional omitido vuelve a su default del schema (no conserva el valor guardado).
 */
export const cashAccountBodySchema = z
	.object({ type: cashAccountTypeSchema })
	.and(cashAccountSchema);

export type CashAccountBody = z.output<typeof cashAccountBodySchema>;

/** Parametro de ruta de las escrituras y de la lectura por id. */
export const cashAccountIdParamsSchema = z.object({ id: uuid });

export type CashAccountIdParams = z.output<typeof cashAccountIdParamsSchema>;
