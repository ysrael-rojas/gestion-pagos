// Rutas de catalogo del vertical de pagos (T5b2), mas las escrituras de C7 del vertical de
// cajas-bancos.
//
// Lecturas y escrituras del dueno de la sesion. `SessionGuard` corre antes de los pipes, asi que
// sin sesion la respuesta es 401 aunque la query o el body sean invalidos y ningun handler toca la
// base.
//
//   GET    /entities                   entidades del dueno por rol
//   GET    /cash-accounts              cuentas de caja y banco (selector del formulario)
//   GET    /payment-methods            metodos de pago (`onlyActive`)
//   GET    /receipt-categories         categorias de recibo (`direction`, `onlyActive`)
//   POST   /catalogs/ensure            sembrado idempotente de las semillas
//   POST   /payment-methods            alta de metodo (C7)
//   PATCH  /payment-methods/:id        nombre y estado; el `code` es inmutable (C7)
//   POST   /receipt-categories         alta de categoria; el `code` se DERIVA del nombre (C7)
//   PATCH  /receipt-categories/:id     nombre y estado; el `code` no se re-deriva (C7)
//
// NO hay `DELETE` en ninguna: en el origen, "borrar" un catalogo es desactivarlo
// (`isActive: false`), porque los recibos lo referencian desde `payment.method_id` y
// `payment.category_id`. Por eso la desactivacion es un `PATCH` y no una ruta `/delete` como la de
// las cuentas (que si tienen `deleted_at`).
//
// Las rutas nuevas viven ACA y no en `catalogs/...`: las cuatro lecturas ya usan el prefijo del
// recurso (`/payment-methods`, `/receipt-categories`) y `POST /catalogs/ensure` es el unico que
// cuelga de `/catalogs`. Un `POST /catalogs/payment-methods` obligaria a la web a tener dos rutas
// por catalogo sin ninguna ganancia.
//
// No hay ninguna columna ni parametro de entrada que fije el dueno: sale de `request.sessionUser`.
import {
	Body,
	Controller,
	Get,
	HttpCode,
	Inject,
	Param,
	Patch,
	Post,
	Query,
	Req,
	UseGuards,
} from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
	type CatalogIdParams,
	type EntitiesQuery,
	type PaymentMethodBody,
	type PaymentMethodPatch,
	type PaymentMethodsQuery,
	type ReceiptCategoriesQuery,
	type ReceiptCategoryBody,
	type ReceiptCategoryPatch,
	catalogIdParamsSchema,
	entitiesQuerySchema,
	paymentMethodBodySchema,
	paymentMethodPatchSchema,
	paymentMethodsQuerySchema,
	receiptCategoriesQuerySchema,
	receiptCategoryBodySchema,
	receiptCategoryPatchSchema,
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

	/**
	 * `GET /receipt-categories?direction=&onlyActive=` — categorias de recibo (`listCategories`).
	 *
	 * `onlyActive` es aditivo de C7 y su default preserva el contrato anterior: sin el parametro
	 * solo vuelven las activas. La tarjeta de configuracion manda `false` para poder reactivar.
	 */
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

	/**
	 * `POST /payment-methods` — alta de metodo de pago (`createPaymentMethod` del origen).
	 *
	 * 201 con la fila creada (mismas cuatro columnas que la lectura). El `code` llega normalizado
	 * por el schema compartido; un codigo repetido responde 409 nombrandolo.
	 */
	@Post("payment-methods")
	createPaymentMethod(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(paymentMethodBodySchema)) body: PaymentMethodBody,
	): Promise<PaymentMethodCatalogItem> {
		return this.catalogs.createPaymentMethod(sessionUserOf(request.sessionUser).id, body);
	}

	/**
	 * `PATCH /payment-methods/:id` — renombrar y/o activar o desactivar.
	 *
	 * El `code` NO se puede cambiar: no esta en el schema del body (Zod descarta la clave si el
	 * cliente la manda) y el servicio solo escribe `name` e `isActive`.
	 */
	@Patch("payment-methods/:id")
	updatePaymentMethod(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(catalogIdParamsSchema)) params: CatalogIdParams,
		@Body(new ZodValidationPipe(paymentMethodPatchSchema)) body: PaymentMethodPatch,
	): Promise<PaymentMethodCatalogItem> {
		return this.catalogs.updatePaymentMethod(
			sessionUserOf(request.sessionUser).id,
			params.id,
			body,
		);
	}

	/**
	 * `POST /receipt-categories` — alta de categoria (`createCategory` del origen).
	 *
	 * El body NO lleva `code`: lo deriva el servicio del nombre (`categoryCodeFromName`) porque la
	 * columna es `not null` y unica por dueno, y porque el wizard resuelve la categoria por ese
	 * codigo estable. Un nombre sin letras ni numeros responde el mensaje del origen.
	 */
	@Post("receipt-categories")
	createReceiptCategory(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(receiptCategoryBodySchema)) body: ReceiptCategoryBody,
	): Promise<CashReceiptCategoryCatalogItem> {
		return this.catalogs.createReceiptCategory(sessionUserOf(request.sessionUser).id, body);
	}

	/**
	 * `PATCH /receipt-categories/:id` — renombrar y/o activar o desactivar.
	 *
	 * Renombrar no re-deriva el `code` (SPEC 37: el codigo sobrevive al renombre) y la `direction`
	 * no se toca.
	 */
	@Patch("receipt-categories/:id")
	updateReceiptCategory(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(catalogIdParamsSchema)) params: CatalogIdParams,
		@Body(new ZodValidationPipe(receiptCategoryPatchSchema)) body: ReceiptCategoryPatch,
	): Promise<CashReceiptCategoryCatalogItem> {
		return this.catalogs.updateReceiptCategory(
			sessionUserOf(request.sessionUser).id,
			params.id,
			body,
		);
	}
}
