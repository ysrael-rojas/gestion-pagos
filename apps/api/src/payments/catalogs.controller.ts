// Rutas de catalogo del vertical de pagos (T5b2).
//
// Cuatro lecturas y una escritura, las cinco del dueno de la sesion. `SessionGuard` corre antes
// de los pipes, asi que sin sesion la respuesta es 401 aunque la query sea invalida y ningun
// handler toca la base.
//
// No hay ninguna columna ni parametro de entrada que fije el dueno: sale de `request.sessionUser`.
import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
	type EntitiesQuery,
	type PaymentMethodsQuery,
	type ReceiptCategoriesQuery,
	entitiesQuerySchema,
	paymentMethodsQuerySchema,
	receiptCategoriesQuerySchema,
} from "./catalogs.query.ts";
import { CatalogsService } from "./catalogs.service.ts";
import type {
	CashAccountCatalogItem,
	CashReceiptCategoryCatalogItem,
	CatalogSeedResult,
	EntityCatalogItem,
	PaymentMethodCatalogItem,
} from "./catalogs.types.ts";

@Controller()
@UseGuards(SessionGuard)
export class CatalogsController {
	constructor(@Inject(CatalogsService) private readonly catalogs: CatalogsService) {}

	/** `GET /entities?role=client|supplier` — entidades no borradas (`listClients`/`listSuppliers`). */
	@Get("entities")
	entities(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(entitiesQuerySchema)) query: EntitiesQuery,
	): Promise<EntityCatalogItem[]> {
		return this.catalogs.entities(sessionUserOf(request.sessionUser).id, query);
	}

	/** `GET /cash-accounts` — cuentas de caja y banco del dueno (`listCashAccounts`). */
	@Get("cash-accounts")
	cashAccounts(@Req() request: SessionRequest): Promise<CashAccountCatalogItem[]> {
		return this.catalogs.cashAccounts(sessionUserOf(request.sessionUser).id);
	}

	/** `GET /payment-methods?onlyActive=` — metodos de pago (`listPaymentMethods`). */
	@Get("payment-methods")
	paymentMethods(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(paymentMethodsQuerySchema)) query: PaymentMethodsQuery,
	): Promise<PaymentMethodCatalogItem[]> {
		return this.catalogs.paymentMethods(sessionUserOf(request.sessionUser).id, query);
	}

	/** `GET /receipt-categories?direction=` — categorias de recibo (`listCategories`). */
	@Get("receipt-categories")
	receiptCategories(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(receiptCategoriesQuerySchema)) query: ReceiptCategoriesQuery,
	): Promise<CashReceiptCategoryCatalogItem[]> {
		return this.catalogs.receiptCategories(sessionUserOf(request.sessionUser).id, query);
	}

	/**
	 * `POST /catalogs/ensure` — siembra idempotente de las semillas del origen.
	 *
	 * Reemplaza al `ensureCatalogsSeeded()` del origen, que escribia dentro del render del
	 * formulario (un GET que muta). Devuelve cuantas filas falto crear: 0/0 significa "ya estaba".
	 */
	@Post("catalogs/ensure")
	@HttpCode(200)
	ensure(@Req() request: SessionRequest, @Body() _body: unknown): Promise<CatalogSeedResult> {
		return this.catalogs.ensureDefaults(sessionUserOf(request.sessionUser).id);
	}
}
