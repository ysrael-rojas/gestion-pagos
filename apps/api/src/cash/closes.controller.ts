// Rutas de cierres y arqueos del vertical de cajas-bancos (C4).
//
// Cinco rutas, ninguna escribe las tablas del vertical: las dos escrituras llaman a las RPC
// `security definer` (S3) y las tres lecturas son `select` sobre las mismas tablas.
//
//   GET    /cash-closes       los cierres del dueno (`listCashCloses`), filtro `accountId`
//   GET    /cash-closes/:id   el cierre con su arqueo (`getCashClose` + `listCloseDenominations`)
//   POST   /cash-closes       cierra el periodo (`close_cash_account`, irreversible: S4)
//   GET    /cash-counts       los arqueos del dueno (`listCashCounts`), filtro `accountId`
//   POST   /cash-counts       registra un arqueo sorpresivo (`register_cash_count`)
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o el id
// sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S6).
//
// Las dos escrituras son `POST` (no `PUT`): la base genera el id y el cierre es un hecho nuevo,
// igual que `POST /payments`. Responden 201 porque crean un recurso, a diferencia de
// `POST /settings/ensure` o de las bajas logicas.
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { ClosesService } from "./closes.service.ts";
import {
	type CashCloseBody,
	type CashCloseIdParams,
	type CashCountBody,
	type CashHistoryQuery,
	cashCloseBodySchema,
	cashCloseIdParamsSchema,
	cashCountBodySchema,
	cashHistoryQuerySchema,
} from "./closes.query.ts";
import type { CashCloseDetail, CashCloseRecord, CashCountRecord } from "./closes.types.ts";

@Controller()
@UseGuards(SessionGuard)
export class ClosesController {
	constructor(@Inject(ClosesService) private readonly closes: ClosesService) {}

	/**
	 * `GET /cash-closes` — los cierres del dueno, del mas reciente al mas antiguo.
	 *
	 * `accountId` es el filtro de la pantalla de cuadres; sin el, el historial completo del dueno.
	 */
	@Get("cash-closes")
	list(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(cashHistoryQuerySchema)) query: CashHistoryQuery,
	): Promise<CashCloseRecord[]> {
		return this.closes.list(sessionUserOf(request.sessionUser).id, query.accountId ?? null);
	}

	/** `GET /cash-closes/:id` — el cierre con su arqueo (404 si no es del dueno). */
	@Get("cash-closes/:id")
	detail(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(cashCloseIdParamsSchema)) params: CashCloseIdParams,
	): Promise<CashCloseDetail> {
		return this.closes.detail(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `POST /cash-closes` — cierra el periodo hasta `periodEnd`.
	 *
	 * El cierre es IRREVERSIBLE (S4): no hay ruta de reapertura en el origen ni aca. Todas las
	 * reglas (periodo ya cerrado, fecha futura, tolerancia sin motivo, denominaciones) las aplica
	 * la RPC; este borde solo traduce sus mensajes.
	 */
	@Post("cash-closes")
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(cashCloseBodySchema)) body: CashCloseBody,
	): Promise<CashCloseDetail> {
		return this.closes.create(sessionUserOf(request.sessionUser).id, body);
	}

	/** `GET /cash-counts` — los arqueos del dueno, del mas reciente al mas antiguo. */
	@Get("cash-counts")
	listCounts(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(cashHistoryQuerySchema)) query: CashHistoryQuery,
	): Promise<CashCountRecord[]> {
		return this.closes.listCounts(sessionUserOf(request.sessionUser).id, query.accountId ?? null);
	}

	/**
	 * `POST /cash-counts` — arqueo sorpresivo (no cierra periodo y no bloquea fechas).
	 *
	 * El saldo esperado y la diferencia los calcula la RPC con `private.cash_expected_balance`;
	 * la respuesta es la fila recien creada, ya con los numeros de la base.
	 */
	@Post("cash-counts")
	createCount(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(cashCountBodySchema)) body: CashCountBody,
	): Promise<CashCountRecord> {
		return this.closes.createCount(sessionUserOf(request.sessionUser).id, body);
	}
}
