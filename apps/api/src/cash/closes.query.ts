// Esquemas de entrada de cierres y arqueos (C4 del vertical de cajas-bancos).
//
// El body es el schema COMPARTIDO que valida el modal del origen
// (`components/cajas-bancos/cash-close-modal.tsx` y `cash-count-modal.tsx` via `zodResolver`), con
// los mismos nombres camelCase, para que el formulario de C5 no traduzca nada:
//
//   cashCloseSchema  cashAccountId, periodEnd, countedBalance, notes, differenceReason,
//                    countedBy, verifiedBy, emptyCashConfirmed, denominations
//   cashCountSchema  accountId, countDate, countedBalance, countedBy, notes, denominations
//
// POR QUE `z.object(schema.shape)` Y NO EL SCHEMA TAL CUAL: los dos schemas compartidos llevan un
// `superRefine` sobre el OBJETO cuya unica regla es "la fecha no puede ser futura"
// (`packages/shared/src/lib/schemas/cash-close.ts` y `cash-count.ts`). Esa es exactamente una
// decision de "se puede cerrar o no", y S4/S5 la radican en la base: `close_cash_account` y
// `register_cash_count` rechazan `> current_date` con su propio mensaje, y son ellas las que
// conocen el reloj con el que se compara el periodo y el ultimo cierre. Re-validarla en el borde
// HTTP con el "hoy" de America/Lima haria, ademas, que la rama SQL fuera inalcanzable por esta
// ruta (el contenedor corre en UTC: entre las 19:00 y las 24:00 de Lima el "hoy" de Node y el de
// PostgreSQL son dias distintos) y duplicaria un mensaje que el dominio ya redacta.
// `schema.shape` conserva TODAS las reglas de campo (uuid de la cuenta, formato de fecha,
// `countedBalance` no negativo, denominaciones PEN, cantidades enteras) y descarta solo la
// comprobacion de objeto, que es la que decide si el cierre se permite. Las reglas de campo de
// `denominations` que la base tambien valida (denominacion del arqueo) siguen viajando porque son
// parte del contrato del payload, y si alguna vez discrepan el SQL las vuelve a exigir.
//
// Ninguna clave acepta `owner_id` ni ningun otro campo de identidad: el dueno sale de
// `request.sessionUser` (S6). `emptyCashConfirmed` es una confirmacion de UI (caja en cero) que
// no viaja a la base: la RPC no la necesita porque recibe el conteo ya resuelto.
import { cashCloseSchema, cashCountSchema } from "@gestion/shared";
import { z } from "zod";

const uuid = z.string().uuid("El identificador debe ser un uuid.");

/** Body de `POST /cash-closes` (el contrato del modal de cierre, sin la regla de "hoy"). */
export const cashCloseBodySchema = z.object(cashCloseSchema.shape);

export type CashCloseBody = z.output<typeof cashCloseBodySchema>;

/** Body de `POST /cash-counts` (el contrato del modal de arqueo, sin la regla de "hoy"). */
export const cashCountBodySchema = z.object(cashCountSchema.shape);

export type CashCountBody = z.output<typeof cashCountBodySchema>;

/** Parametro de ruta de `GET /cash-closes/:id`. */
export const cashCloseIdParamsSchema = z.object({ id: uuid });

export type CashCloseIdParams = z.output<typeof cashCloseIdParamsSchema>;

/**
 * Query de las dos lecturas: `accountId` opcional.
 *
 * Es el filtro que usa el origen: la pantalla de cuadres llama `listCashCloses(id)` /
 * `listCashCounts(id)` con la cuenta elegida (`cuadres-view.tsx:337-338`,
 * `petty-cash-panel.tsx:129`). Sin el, la ruta devuelve todo el historial del dueno, que es lo
 * que necesita el dashboard (C7) para consolidar sin una llamada por cuenta. El mismo schema
 * sirve para las dos tablas: en las dos el filtro es una columna `cash_account_id`.
 */
export const cashHistoryQuerySchema = z.object({
	accountId: uuid.optional(),
});

export type CashHistoryQuery = z.output<typeof cashHistoryQuerySchema>;
