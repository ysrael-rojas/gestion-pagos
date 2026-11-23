// Esquemas de entrada de la conciliacion bancaria (C7 del vertical de cajas-bancos).
//
//   GET /bank-reconciliations?accountId=&periodStart=&periodEnd=   el triplete exacto
//   POST /bank-reconciliations                                     el body del acta
//
// POR QUE EL BODY ES MAS LAXO QUE EL DEL FORMULARIO, Y POR QUE ESO ES LO CORRECTO: la RPC
// `public.save_bank_reconciliation` decide y redacta TODAS las reglas de negocio de este vertical
// (cuenta indicada, cuenta visible, solo cuentas bancarias, periodo valido, los dos saldos,
// clase/monto de cada partida, descripcion no vacia, monto > 0). Reimplementarlas aca con Zod haria
// que el usuario viera el mensaje generico del pipe ("El payload no cumple el contrato
// compartido") en vez del mensaje de la base, y dejaria las ocho ramas de la RPC inalcanzables por
// HTTP. Es la misma doctrina que `closes.query.ts`: el borde valida el TIPO (uuid, fecha ISO,
// numero) y descarta la comprobacion que decide si la operacion se permite.
//
// Lo que SI se valida aca, porque no es una regla de negocio de la base:
//   - `accountId` es un uuid y `periodStart`/`periodEnd` tienen formato "YYYY-MM-DD";
//   - cada partida es un objeto y sus tres claves tienen el tipo del JSON que castea la RPC
//     (texto para `kind` y `description`, numero o texto para `amount`, que la base castea a
//     `numeric(12,2)`).
//
// Ninguna clave acepta `owner_id` ni ningun otro campo de identidad: el dueno sale de
// `request.sessionUser` (S6). Las partidas NO llevan `id` en la entrada: la RPC borra y reinserta,
// asi que el id del cliente no significa nada (el schema compartido lo declara opcional para el
// estado del formulario; aca se descarta con `z.object`).
import { z } from "zod";

const uuid = z.string().uuid("El identificador debe ser un uuid.");

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato YYYY-MM-DD.")
	.describe("Fecha en formato YYYY-MM-DD");

/**
 * Una partida del acta.
 *
 * `kind` es texto libre a proposito: el cast a `reconciliation_item_kind` lo hace la RPC y su
 * fallo es la regla `Hay una partida con una clase o un monto inválido`. Lo mismo con `amount`,
 * que la base castea a `numeric(12,2)` (un texto no numerico es esa misma regla) y con
 * `description`, cuyo vacio es `Cada partida necesita una descripción`.
 */
const reconciliationItemBodySchema = z.object({
	kind: z.string(),
	description: z.string().optional(),
	amount: z.union([z.number(), z.string()]).optional(),
});

/**
 * Body de `POST /bank-reconciliations`: el `SaveReconciliationInput` del origen.
 *
 * Los cinco campos que la RPC exige son opcionales en el borde porque es ella la que responde
 * `Indica la cuenta bancaria a conciliar` / `Indica el saldo según extracto y el saldo según
 * registros` (y `El período de la conciliación no es válido` cuando falta una fecha o el periodo
 * esta invertido). El formulario de la web los manda siempre.
 */
export const bankReconciliationBodySchema = z.object({
	accountId: uuid.optional(),
	periodStart: isoDate.optional(),
	periodEnd: isoDate.optional(),
	// Los dos saldos son `numeric(12,2)` en la base: el redondeo y el rango los decide ella.
	statementBalance: z.number().nullish(),
	booksBalance: z.number().nullish(),
	preparedBy: z.string().nullish(),
	reviewedBy: z.string().nullish(),
	notes: z.string().nullish(),
	items: z.array(reconciliationItemBodySchema).default([]),
});

export type BankReconciliationBody = z.output<typeof bankReconciliationBodySchema>;

/**
 * Query de la lectura por triplete: los TRES son obligatorios.
 *
 * El origen hace un match EXACTO sobre `(cash_account_id, period_start, period_end)`
 * (`lib/caja/conciliacion.ts:99-116`), no un rango: la pantalla pide "la conciliacion de esta
 * cuenta en este periodo" y una respuesta parcial no tendria sentido. Sin fila, la ruta responde
 * `null` (ver el controlador).
 */
export const bankReconciliationTripleQuerySchema = z.object({
	accountId: uuid,
	periodStart: isoDate,
	periodEnd: isoDate,
});

export type BankReconciliationTripleQuery = z.output<typeof bankReconciliationTripleQuerySchema>;

/** Parametro de ruta de `GET /bank-reconciliations/:id`. */
export const bankReconciliationIdParamsSchema = z.object({ id: uuid });

export type BankReconciliationIdParams = z.output<typeof bankReconciliationIdParamsSchema>;
