// Rutas de escritura y de lectura completa de las cuentas de caja y banco (C2).
//
// La LECTURA del catalogo sigue en `CatalogsController` (`GET /cash-accounts`, cinco columnas),
// porque nacio como selector del formulario de pagos y su contrato (`CashAccountCatalogItem`) ya
// tiene consumidores y esta pinneado por `apps/api/test/catalogs.e2e.test.ts`. Aca solo se agrega
// lo que faltaba: alta, modificacion, baja logica y la lectura por id de la fila completa.
//
//   POST   /cash-accounts            alta (`createCashAccount`)
//   GET    /cash-accounts/:id        fila completa que necesita el formulario de cuentas
//   PATCH  /cash-accounts/:id        modificacion (`updateCashAccount`)
//   POST   /cash-accounts/:id/delete baja logica (`softDeleteCashAccount`)
//
// `SessionGuard` en el controlador corre antes de los pipes: sin sesion la respuesta es 401
// aunque el body sea invalido, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser)`; no hay ningun campo de entrada que lo fije (S6).
import {
	Body,
	Controller,
	Get,
	HttpCode,
	Inject,
	Param,
	Patch,
	Post,
	Req,
	UseGuards,
} from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CashAccountsService } from "./cash-accounts.service.ts";
import {
	type CashAccountBody,
	type CashAccountIdParams,
	cashAccountBodySchema,
	cashAccountIdParamsSchema,
} from "./cash-accounts.query.ts";
import type { CashAccountRecord } from "./cash-accounts.types.ts";

@Controller("cash-accounts")
@UseGuards(SessionGuard)
export class CashAccountsController {
	constructor(@Inject(CashAccountsService) private readonly accounts: CashAccountsService) {}

	/**
	 * `GET /cash-accounts/:id` — la fila completa de una cuenta viva del dueno.
	 *
	 * Es lo que el formulario de cuentas necesita para editar; el `GET /cash-accounts` del
	 * catalogo de pagos no se toca.
	 */
	@Get(":id")
	get(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(cashAccountIdParamsSchema)) params: CashAccountIdParams,
	): Promise<CashAccountRecord> {
		return this.accounts.get(sessionUserOf(request.sessionUser).id, params.id);
	}

	/** `POST /cash-accounts` — alta de cuenta (`createCashAccount`). */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(cashAccountBodySchema)) body: CashAccountBody,
	): Promise<CashAccountRecord> {
		return this.accounts.create(sessionUserOf(request.sessionUser).id, body);
	}

	/** `PATCH /cash-accounts/:id` — modificacion (`updateCashAccount`). Reemplaza la fila. */
	@Patch(":id")
	update(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(cashAccountIdParamsSchema)) params: CashAccountIdParams,
		@Body(new ZodValidationPipe(cashAccountBodySchema)) body: CashAccountBody,
	): Promise<CashAccountRecord> {
		return this.accounts.update(sessionUserOf(request.sessionUser).id, params.id, body);
	}

	/**
	 * `POST /cash-accounts/:id/delete` — baja logica (`softDeleteCashAccount`).
	 *
	 * POST y no DELETE porque la fila persiste (los pagos y cierres la referencian): es una
	 * escritura sobre `deleted_at`, igual que `POST /entities/:id/delete` y
	 * `POST /payments/:id/void`. `@HttpCode(200)`: `POST` responde 201 por defecto y aca no se
	 * creo nada.
	 */
	@Post(":id/delete")
	@HttpCode(200)
	async softDelete(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(cashAccountIdParamsSchema)) params: CashAccountIdParams,
	): Promise<{ deleted: true }> {
		await this.accounts.softDelete(sessionUserOf(request.sessionUser).id, params.id);

		return { deleted: true };
	}
}
