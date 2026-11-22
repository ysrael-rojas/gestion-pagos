// Rutas del vertical de pagos (T5b1), derivadas de `lib/pagos` del proyecto de origen.
//
// Orden de declaracion: las rutas ESTATICAS van antes de `:id`. Nest registra los handlers en el
// orden en que aparecen, y `GET /payments/unassigned` matchearia `GET /payments/:id` si `:id`
// estuviera primero (el pipe de uuid la rechazaria con 400 en vez de servirla).
//
// Autenticacion: `SessionGuard` en el controlador. Corre antes de los pipes, asi que sin sesion
// la respuesta es 401 aunque el payload sea invalido, y ningun handler toca la base. El dueno
// sale de `sessionUserOf(request.sessionUser)`; no hay ningun campo de entrada que lo fije.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { paymentSchema, type PaymentFormValues } from "@gestion/shared";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { PaymentsService } from "./payments.service";
import {
	type AddAllocationsBody,
	type PaymentListQuery,
	addAllocationsBodySchema,
	assignStateQuerySchema,
	comprobanteIdParamsSchema,
	markProcessedBodySchema,
	paymentIdParamsSchema,
	paymentListQuerySchema,
	unassignedQuerySchema,
	voidPaymentBodySchema,
} from "./payments.query";
import type {
	Payment,
	PaymentAssignState,
	PaymentDetail,
	PaymentDirection,
	PaymentHistoryEntry,
	PaymentListItem,
} from "./payments.types";

@Controller("payments")
@UseGuards(SessionGuard)
export class PaymentsController {
	constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

	/** `GET /payments` — listado del dueno con filtros y paginacion (`listPayments`). */
	@Get()
	list(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(paymentListQuerySchema)) query: PaymentListQuery,
	): Promise<PaymentListItem[]> {
		return this.payments.list(sessionUserOf(request.sessionUser).id, query);
	}

	/** `GET /payments/unassigned` — recibos con saldo sin asignar (`listUnassignedPayments`). */
	@Get("unassigned")
	unassigned(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(unassignedQuerySchema)) query: { direction: PaymentDirection },
	): Promise<Payment[]> {
		return this.payments.unassigned(sessionUserOf(request.sessionUser).id, query.direction);
	}

	/** `GET /payments/assign-state` — estado derivado por pago (`getAssignState`). */
	@Get("assign-state")
	assignState(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(assignStateQuerySchema)) query: { direction?: PaymentDirection },
	): Promise<PaymentAssignState[]> {
		return this.payments.assignState(sessionUserOf(request.sessionUser).id, query.direction);
	}

	/** `POST /payments/mark-processed` — EN_REVISION -> PROCESADO (`markPaymentsProcessed`). */
	@Post("mark-processed")
	@HttpCode(200)
	markProcessed(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(markProcessedBodySchema)) body: { paymentIds: string[] },
	): Promise<number> {
		return this.payments.markProcessed(sessionUserOf(request.sessionUser).id, body.paymentIds);
	}

	/** `POST /payments` — alta por la RPC `create_payment_with_allocations` (`createPayment`). */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(paymentSchema)) body: PaymentFormValues,
	): Promise<PaymentDetail> {
		return this.payments.create(sessionUserOf(request.sessionUser).id, body);
	}

	/** `GET /payments/:id` — detalle con asignaciones y saldos (`getPaymentDetail`). */
	@Get(":id")
	detail(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(paymentIdParamsSchema)) params: { id: string },
	): Promise<PaymentDetail> {
		return this.payments.detail(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `GET /payments/:comprobanteId/history` — historial del COMPROBANTE
	 * (`getPaymentHistory(comprobanteId)` en el origen: el parametro es el comprobante, no el pago).
	 */
	@Get(":comprobanteId/history")
	history(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(comprobanteIdParamsSchema)) params: { comprobanteId: string },
	): Promise<PaymentHistoryEntry[]> {
		return this.payments.history(sessionUserOf(request.sessionUser).id, params.comprobanteId);
	}

	/** `POST /payments/:id/void` — anulacion con motivo (`voidPayment`). */
	@Post(":id/void")
	@HttpCode(200)
	async void(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(paymentIdParamsSchema)) params: { id: string },
		@Body(new ZodValidationPipe(voidPaymentBodySchema)) body: { reason: string },
	): Promise<{ voided: true }> {
		await this.payments.void(sessionUserOf(request.sessionUser).id, params.id, body.reason);

		return { voided: true };
	}

	/** `POST /payments/:id/allocations` — asignacion de saldo (`addAllocations`). */
	@Post(":id/allocations")
	@HttpCode(200)
	async addAllocations(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(paymentIdParamsSchema)) params: { id: string },
		@Body(new ZodValidationPipe(addAllocationsBodySchema)) body: AddAllocationsBody,
	): Promise<{ allocated: true }> {
		await this.payments.addAllocations(
			sessionUserOf(request.sessionUser).id,
			params.id,
			body,
		);

		return { allocated: true };
	}
}
