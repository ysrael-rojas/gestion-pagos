// Esquemas de entrada de los vales de caja chica (C6 del vertical de cajas-bancos).
//
// Los bodies son los schemas COMPARTIDOS que validan los modales del origen
// (`petty-cash-panel.tsx` y `replenish-modal.tsx` via `zodResolver`), con los mismos nombres
// camelCase, para que el formulario de C5 no traduzca nada:
//
//   pettyCashValeSchema       accountId, categoryId, valeDate, paidTo, concept, amount, hasReceipt
//   pettyCashReplenishSchema  accountId, sourceAccountId, valeIds
//
// POR QUE EL ALTA USA `pettyCashValeSchema` PELADO: el schema con el limite por gasto
// (`createPettyCashValeSchema(expenseLimit)`) es el del FORMULARIO, y le suma un `superRefine` que
// compara el monto contra el limite de la cuenta. El API no tiene ese limite sin preguntarle a la
// base, y el juicio es suyo de todas formas: `create_petty_cash_vale` lo valida con la columna ya
// leida (`petty_expense_limit`) y responde `El monto del vale (%) supera el limite por gasto de la
// caja chica (%)`. Re-validarlo aca seria una segunda definicion del limite (y una lectura extra
// por request). Es el mismo reparto que C4 hizo con la regla de "fecha futura" (L12(b)).
//
// POR QUE EL REPLENISH USA `z.object(schema.shape)`: `pettyCashReplenishSchema` lleva un
// `superRefine` sobre el OBJETO ("el origen no puede ser la caja chica") cuya unica regla tambien
// vive en el SQL: `replenish_petty_cash` llama a `create_cash_transfer`, que levanta `Origen y
// destino deben ser cuentas distintas`. `schema.shape` conserva TODAS las reglas de campo (los
// tres uuid y el `.min(1)` de `valeIds`) y descarta solo la comprobacion de objeto, para que esa
// rama SQL sea alcanzable y no haya dos mensajes para la misma regla.
//
// Ninguna clave acepta `owner_id` ni ningun otro campo de identidad: el dueno sale de
// `request.sessionUser` (S6). `serial` y `status` tampoco estan: los pone la base (S5).
import { pettyCashReplenishSchema, pettyCashValeSchema } from "@gestion/shared";
import { z } from "zod";

const uuid = z.string().uuid("El identificador debe ser un uuid.");

/**
 * Estados de un vale, los labels de `public.vale_status` en su orden
 * (`20261014194051_create_cash_denomination_and_petty_cash.sql:15`).
 *
 * El tipo `ValeStatus` del contrato sale de aca y no de un union escrito a mano: un filtro que el
 * enum de la base no tuviera lo rechazaria la base con `22P02` (`invalid input value for enum`),
 * no Zod. Si una migracion suma un label, hay que sumarlo aca y en
 * `db/schema/petty-cash-vale.ts`.
 */
export const valeStatusSchema = z.enum(["PENDIENTE", "REPUESTO", "ANULADO"]);

export type ValeStatus = z.output<typeof valeStatusSchema>;

/** Body de `POST /petty-cash/vales` (el contrato del modal, sin la regla del limite). */
export const pettyCashValeBodySchema = pettyCashValeSchema;

export type PettyCashValeBody = z.output<typeof pettyCashValeBodySchema>;

/** Parametro de ruta de `GET /petty-cash/vales/:id` y de `POST /petty-cash/vales/:id/void`. */
export const pettyCashValeIdParamsSchema = z.object({ id: uuid });

export type PettyCashValeIdParams = z.output<typeof pettyCashValeIdParamsSchema>;

/**
 * Query de `GET /petty-cash/vales`: la caja chica y, opcionalmente, el estado.
 *
 * `accountId` es obligatorio porque en el origen `listVales(accountId, status?)` siempre se llama
 * con la caja elegida (`petty-cash-panel.tsx`), y sin ella la ruta seria "todos los vales del
 * dueno", que ningun consumidor pide. `status` es el filtro de la tabla (pendientes / repuestos /
 * anulados).
 */
export const pettyCashValeListQuerySchema = z.object({
	accountId: uuid,
	status: valeStatusSchema.optional(),
});

export type PettyCashValeListQuery = z.output<typeof pettyCashValeListQuerySchema>;

/** Body de `POST /petty-cash/replenish` (el contrato del modal, sin la regla de "cuenta distinta"). */
export const pettyCashReplenishBodySchema = z.object(pettyCashReplenishSchema.shape);

export type PettyCashReplenishBody = z.output<typeof pettyCashReplenishBodySchema>;
