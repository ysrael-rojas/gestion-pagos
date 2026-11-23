// Rutas de LECTURA de posiciones de caja y banco (C3 del vertical de cajas-bancos).
//
// Tres lecturas, ninguna escritura (el slice es read-only: ningun `insert`/`update`/`delete` sale
// de este vertical por estas rutas):
//
//   GET /cash-positions                 una fila por cuenta viva con su saldo (`get_cash_positions`)
//   GET /cash-accounts/:id/position     el saldo de UNA cuenta (`get_cash_position`)
//   GET /last-movement-dates            ultimo recibo no anulado por cuenta (`list_last_movement_dates`)
//
// Rutas y nombres del origen (`lib/caja/caja.ts`): `listCashPositionsConsolidated`,
// `getCashPosition` y `listLastMovementDates`. La tercera NO usa el prefijo `/cash-` porque asi se
// llama la RPC y no hay ningun otro recurso con ese nombre.
//
// `SessionGuard` en el controlador corre antes de los pipes: sin sesion la respuesta es 401
// aunque la query o el id sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S6).
//
// POR QUE `cash-accounts/:id/position` NO VIVE EN `CashAccountsController`: ese controlador es la
// CRUD de la cuenta (C2). Esto es una lectura de SALDO, que es otro dominio y cuyo consumidor
// (cuadres, arqueos, conciliacion) no edita cuentas. Nest resuelve sin ambiguedad porque el
// `:id` de alla es un solo segmento y esta ruta tiene dos.
import { Controller, Get, Inject, Param, Query, Req, UseGuards } from "@nestjs/common";
import { z } from "zod";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { type CashAccountIdParams, cashAccountIdParamsSchema } from "./cash-accounts.query.ts";
import { PositionsService } from "./positions.service.ts";
import type { CashAccountPosition, LastMovementDates } from "./positions.types.ts";

/**
 * Query de las dos lecturas de saldo: `asOf` opcional, "YYYY-MM-DD".
 *
 * Es opcional porque la RPC tambien lo es (`p_as_of date default current_date`): sin fecha, el
 * corte es hoy segun la base. El mensaje es el del schema compartido de fechas
 * (`@gestion/shared/lib/schemas/cash-account.ts:51`) para que la UI muestre un solo texto.
 *
 * `z.object` descarta claves desconocidas: un parametro de mas en la query no rompe la lectura.
 */
const asOfQuerySchema = z.object({
	asOf: z
		.string()
		.regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)")
		.optional(),
});

export type AsOfQuery = z.output<typeof asOfQuerySchema>;

@Controller()
@UseGuards(SessionGuard)
export class PositionsController {
	constructor(@Inject(PositionsService) private readonly positions: PositionsService) {}

	/** `GET /cash-positions` — saldos de todas las cuentas vivas del dueno en una sola llamada. */
	@Get("cash-positions")
	list(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(asOfQuerySchema)) query: AsOfQuery,
	): Promise<CashAccountPosition[]> {
		return this.positions.list(sessionUserOf(request.sessionUser).id, query.asOf ?? null);
	}

	/** `GET /cash-accounts/:id/position` — el saldo de una cuenta a la fecha del corte. */
	@Get("cash-accounts/:id/position")
	position(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(cashAccountIdParamsSchema)) params: CashAccountIdParams,
		@Query(new ZodValidationPipe(asOfQuerySchema)) query: AsOfQuery,
	): Promise<number> {
		return this.positions.forAccount(
			sessionUserOf(request.sessionUser).id,
			params.id,
			query.asOf ?? null,
		);
	}

	/** `GET /last-movement-dates` — `accountId -> "YYYY-MM-DD"` del ultimo recibo no anulado. */
	@Get("last-movement-dates")
	lastMovementDates(@Req() request: SessionRequest): Promise<LastMovementDates> {
		return this.positions.lastMovementDates(sessionUserOf(request.sessionUser).id);
	}
}
