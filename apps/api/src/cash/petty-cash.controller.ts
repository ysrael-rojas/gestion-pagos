// Rutas de caja chica del vertical de cajas-bancos (C6).
//
// Cinco rutas, ninguna escribe las tablas del vertical: las tres escrituras llaman a las RPC
// `security definer` (S5/S8) y las dos lecturas son `select` sobre `petty_cash_vale`.
//
//   GET  /petty-cash/vales?accountId&status  los vales de la caja (`listVales`)
//   GET  /petty-cash/vales/:id               un vale (`getVale`)
//   POST /petty-cash/vales                   alta del vale (`create_petty_cash_vale`)
//   POST /petty-cash/vales/:id/void          anula un vale PENDIENTE (`void_petty_cash_vale`)
//   POST /petty-cash/replenish               repone el fondo (`replenish_petty_cash`)
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o el id
// sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S6).
//
// La anulacion responde 200 y no 201 porque no crea un recurso: cambia el estado de uno existente
// (misma decision que `POST /payments/:id/void`). El alta y la reposicion responden 201.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PettyCashService } from "./petty-cash.service.ts";
import {
	type PettyCashReplenishBody,
	type PettyCashValeBody,
	type PettyCashValeIdParams,
	type PettyCashValeListQuery,
	pettyCashReplenishBodySchema,
	pettyCashValeBodySchema,
	pettyCashValeIdParamsSchema,
	pettyCashValeListQuerySchema,
} from "./petty-cash.query.ts";
import type {
	PettyCashReplenishResult,
	PettyCashValeRecord,
	PettyCashValeVoidResult,
} from "./petty-cash.types.ts";

@Controller("petty-cash")
@UseGuards(SessionGuard)
export class PettyCashController {
	constructor(@Inject(PettyCashService) private readonly pettyCash: PettyCashService) {}

	/** `GET /petty-cash/vales` — los vales de la caja, por correlativo; `status` opcional. */
	@Get("vales")
	list(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(pettyCashValeListQuerySchema)) query: PettyCashValeListQuery,
	): Promise<PettyCashValeRecord[]> {
		return this.pettyCash.list(sessionUserOf(request.sessionUser).id, query);
	}

	/** `GET /petty-cash/vales/:id` — un vale (404 si no es del dueno). */
	@Get("vales/:id")
	detail(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(pettyCashValeIdParamsSchema)) params: PettyCashValeIdParams,
	): Promise<PettyCashValeRecord> {
		return this.pettyCash.detail(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `POST /petty-cash/vales` — alta del vale.
	 *
	 * El `serial`, el `status` y el `paymentId` los pone la RPC (S5/S8); el body no los acepta.
	 * Todas las reglas (caja chica, limite por gasto, textos obligatorios, categoria EGRESO,
	 * metodo EFECTIVO, periodo abierto) las aplica el SQL.
	 */
	@Post("vales")
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(pettyCashValeBodySchema)) body: PettyCashValeBody,
	): Promise<PettyCashValeRecord> {
		return this.pettyCash.create(sessionUserOf(request.sessionUser).id, body);
	}

	/** `POST /petty-cash/vales/:id/void` — anula un vale PENDIENTE y su recibo de egreso. */
	@Post("vales/:id/void")
	@HttpCode(200)
	voidOne(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(pettyCashValeIdParamsSchema)) params: PettyCashValeIdParams,
	): Promise<PettyCashValeVoidResult> {
		return this.pettyCash.voidVale(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `POST /petty-cash/replenish` — repone el fondo transfiriendo el total de los vales elegidos.
	 *
	 * Devuelve el id de la TRANSFERENCIA que creo la RPC y los vales ya repuestos, releidos
	 * despues del RPC.
	 */
	@Post("replenish")
	replenish(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(pettyCashReplenishBodySchema)) body: PettyCashReplenishBody,
	): Promise<PettyCashReplenishResult> {
		return this.pettyCash.replenish(sessionUserOf(request.sessionUser).id, body);
	}
}
