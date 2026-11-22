// Cartera y comprobantes abiertos.
//
// Dos recursos que la UI de pagos necesita y que en el origen vivian en `lib/pagos/cartera.ts`:
// el resumen de cartera (dashboard y provider de pagos) y los comprobantes con saldo abierto
// (selector de asignacion, proyeccion de flujo de caja, pantalla de inicio).
import { Controller, Get, Inject, Param, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CarteraService } from "./cartera.service";
import {
	accountIdParamsSchema,
	openVouchersQuerySchema,
	statementQuerySchema,
} from "./payments.query";
import type { CarteraResumen, Payment, PaymentDirection, VoucherBalance } from "./payments.types";

@Controller()
@UseGuards(SessionGuard)
export class CarteraController {
	constructor(@Inject(CarteraService) private readonly cartera: CarteraService) {}

	/** `GET /cartera/resumen` — buckets de cobranza, deuda y recibos sin asignar. */
	@Get("cartera/resumen")
	resumen(@Req() request: SessionRequest): Promise<CarteraResumen> {
		return this.cartera.resumen(sessionUserOf(request.sessionUser).id);
	}

	/** `GET /cartera/statement/:accountId?from&to` — movimientos de una cuenta de caja. */
	@Get("cartera/statement/:accountId")
	statement(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(accountIdParamsSchema)) params: { accountId: string },
		@Query(new ZodValidationPipe(statementQuerySchema)) query: { from: string; to: string },
	): Promise<Payment[]> {
		return this.cartera.statement(
			sessionUserOf(request.sessionUser).id,
			params.accountId,
			query.from,
			query.to,
		);
	}

	/** `GET /vouchers/open?direction&entityId` — comprobantes con saldo (vista `voucher_balance`). */
	@Get("vouchers/open")
	openVouchers(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(openVouchersQuerySchema)) query: {
			direction: PaymentDirection;
			entityId?: string;
		},
	): Promise<VoucherBalance[]> {
		return this.cartera.openVouchers(
			sessionUserOf(request.sessionUser).id,
			query.direction,
			query.entityId,
		);
	}
}
