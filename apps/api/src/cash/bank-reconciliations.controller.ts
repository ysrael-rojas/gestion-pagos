// Rutas de conciliacion bancaria del vertical de cajas-bancos (C7).
//
// Tres rutas, ninguna escribe las tablas del vertical: la escritura llama a la RPC
// `security definer` `save_bank_reconciliation` (S8) y las dos lecturas son `select` sobre las
// mismas tablas (no hay vista ni RPC de lectura).
//
//   GET  /bank-reconciliations         la conciliacion del triplete (cuenta, periodo) o `null`
//   GET  /bank-reconciliations/:id     el acta con sus partidas (404 si no es del dueno)
//   POST /bank-reconciliations         upsert del acta por RPC, 201 con la fila releida
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o la
// query sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S6).
//
// `POST` y no `PUT` aunque la RPC sea un upsert: el origen ya exponia el guardado como un alta y
// la respuesta es un recurso con id (igual que `POST /payments` y `POST /cash-closes`).
import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { BankReconciliationsService } from "./bank-reconciliations.service.ts";
import {
	type BankReconciliationBody,
	type BankReconciliationIdParams,
	type BankReconciliationTripleQuery,
	bankReconciliationBodySchema,
	bankReconciliationIdParamsSchema,
	bankReconciliationTripleQuerySchema,
} from "./bank-reconciliations.query.ts";
import type { BankReconciliation } from "./bank-reconciliations.types.ts";

@Controller("bank-reconciliations")
@UseGuards(SessionGuard)
export class BankReconciliationsController {
	constructor(
		@Inject(BankReconciliationsService)
		private readonly reconciliations: BankReconciliationsService,
	) {}

	/**
	 * `GET /bank-reconciliations?accountId=&periodStart=&periodEnd=` — el acta del periodo.
	 *
	 * SIN CONCILIACION RESPONDE 200 CON UN `null` LITERAL, NO 404. "No hay conciliacion para ese
	 * periodo" es un estado NORMAL del negocio (es lo que abre el formulario en blanco), no un
	 * recurso ausente: la web tipa la lectura como `BankReconciliation | null` y un 404 la
	 * obligaria a tratar el caso normal como error.
	 *
	 * POR QUE `@Res()` EN ESTA RUTA Y EN NINGUNA OTRA: el adaptador de Express de Nest convierte un
	 * `null` devuelto por el handler en un cuerpo VACIO (`ExpressAdapter.reply` hace
	 * `if (isNil(body)) return response.send()`), y un cuerpo vacio no es JSON valido para el
	 * cliente. Escribir la respuesta a mano es la unica forma de emitir el `null` literal que pide
	 * el contrato; el status y los errores siguen siendo los de Nest (una excepcion del servicio la
	 * responde su filtro aunque el handler tenga `@Res()`).
	 */
	@Get()
	async find(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(bankReconciliationTripleQuerySchema))
		query: BankReconciliationTripleQuery,
		@Res() response: Response,
	): Promise<void> {
		const found = await this.reconciliations.find(sessionUserOf(request.sessionUser).id, query);

		response.status(200).json(found);
	}

	/** `GET /bank-reconciliations/:id` — el acta con sus partidas (404 si no es del dueno). */
	@Get(":id")
	detail(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(bankReconciliationIdParamsSchema))
		params: BankReconciliationIdParams,
	): Promise<BankReconciliation> {
		return this.reconciliations.detail(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `POST /bank-reconciliations` — guarda el acta (upsert sobre el triplete, S8).
	 *
	 * Responde 201 con el acta RELEIDA (cabecera + partidas en la misma transaccion), no con el id:
	 * la pantalla necesita el `id` de cada partida para pintar el detalle sin una segunda llamada.
	 * Las ocho reglas (cuenta indicada, cuenta visible, solo bancos, periodo, saldos, clase/monto,
	 * descripcion, monto > 0) las aplica la RPC y aca solo se traducen a HTTP.
	 */
	@Post()
	save(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(bankReconciliationBodySchema)) body: BankReconciliationBody,
	): Promise<BankReconciliation> {
		return this.reconciliations.save(sessionUserOf(request.sessionUser).id, body);
	}
}
