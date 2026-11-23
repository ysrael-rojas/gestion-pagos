// Rutas de transferencias entre cuentas del vertical de cajas-bancos (C6).
//
// Tres rutas, ninguna escribe la tabla: la escritura llama a la RPC `security definer`
// `create_cash_transfer` (S8) y las dos lecturas son `select` sobre la misma tabla.
//
//   POST /cash-transfers                    mueve fondos entre dos cuentas (`createCashTransfer`)
//   GET  /cash-transfers/:id                una transferencia (`getCashTransfer`)
//   GET  /cash-transfers?accountId&from&to  las del periodo en las que la cuenta participa
//                                           (`listAccountTransfers`)
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o los
// parametros sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S6).
//
// La escritura es `POST` (no `PUT`): la base genera el id y la transferencia es un hecho nuevo,
// igual que `POST /payments`. Responde 201 porque crea un recurso.
import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CashTransfersService } from "./cash-transfers.service.ts";
import {
	type CashTransferBody,
	type CashTransferIdParams,
	type CashTransferListQuery,
	cashTransferBodySchema,
	cashTransferIdParamsSchema,
	cashTransferListQuerySchema,
} from "./cash-transfers.query.ts";
import type { CashTransferRecord } from "./cash-transfers.types.ts";

@Controller("cash-transfers")
@UseGuards(SessionGuard)
export class CashTransfersController {
	constructor(@Inject(CashTransfersService) private readonly transfers: CashTransfersService) {}

	/**
	 * `GET /cash-transfers` — las transferencias del periodo en las que la cuenta participa.
	 *
	 * Los tres parametros son obligatorios (`accountId`, `from`, `to`) y los dos bordes de fecha
	 * son INCLUSIVE, igual que `listAccountTransfers` del origen.
	 */
	@Get()
	list(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(cashTransferListQuerySchema)) query: CashTransferListQuery,
	): Promise<CashTransferRecord[]> {
		return this.transfers.list(sessionUserOf(request.sessionUser).id, query);
	}

	/** `GET /cash-transfers/:id` — una transferencia (404 si no es del dueno). */
	@Get(":id")
	detail(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(cashTransferIdParamsSchema)) params: CashTransferIdParams,
	): Promise<CashTransferRecord> {
		return this.transfers.detail(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `POST /cash-transfers` — mueve fondos de `sourceAccountId` a `targetAccountId`.
	 *
	 * Todas las reglas (cuentas existentes y del dueno, distintas, en PEN, monto > 0, periodo
	 * abierto en las dos cuentas) las aplica la RPC; este borde solo traduce sus mensajes a HTTP.
	 */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(cashTransferBodySchema)) body: CashTransferBody,
	): Promise<CashTransferRecord> {
		return this.transfers.create(sessionUserOf(request.sessionUser).id, body);
	}
}
