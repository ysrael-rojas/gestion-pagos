// Rutas del vertical de compras (T3): comprobantes de COMPRA.
//
//   GET    /purchases        las compras del dueno de la sesion (listado de S10, sin filtros: la
//                            pantalla filtra en el cliente)
//   GET    /purchases/:id    la compra con su saldo POR PAGAR
//   POST   /purchases        alta (RPC `crear_compra`, responde 201 con el detalle)
//   PATCH  /purchases/:id    edicion (RPC `editar_compra`, responde 200 con el detalle)
//
// POR QUE EL PREFIJO ES `purchases`: el BFF reenvia por camino y T5 suma `purchases` a su allowlist
// (`apps/web/app/api/backend/[...path]/route.ts`); es la palabra que el origen usa para el vertical y
// no comparte prefijo con `vouchers`, asi que el vertical de ventas (`GET /vouchers/:id`) y sus notas
// siguen resolviendo exactamente igual. Ver la nota de orden de registro en `app.module.ts`.
//
// POR QUE `PATCH` Y NO `PUT`: el BFF solo deja pasar GET, POST y PATCH (no reenvia PUT), y la
// edicion ya se hace con `PATCH /vouchers/:id`. El body es COMPLETO (el mismo contrato del
// formulario, que siempre manda todos los campos editables): no es un patch parcial.
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o el id sean
// invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S4/S6).
import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
	type PurchaseBody,
	type PurchaseIdParams,
	purchaseBodySchema,
	purchaseIdParamsSchema,
} from "./purchases.query.ts";
import { PurchasesService } from "./purchases.service.ts";
import type { PurchaseDetail, PurchaseListItem } from "./purchases.types.ts";

@Controller("purchases")
@UseGuards(SessionGuard)
export class PurchasesController {
	constructor(@Inject(PurchasesService) private readonly purchases: PurchasesService) {}

	/** `GET /purchases` — las compras del dueno, de la emision mas reciente a la mas vieja. */
	@Get()
	list(@Req() request: SessionRequest): Promise<PurchaseListItem[]> {
		return this.purchases.list(sessionUserOf(request.sessionUser).id);
	}

	/** `GET /purchases/:id` — la compra con su saldo (404 si no es una compra del dueno). */
	@Get(":id")
	detail(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(purchaseIdParamsSchema)) params: PurchaseIdParams,
	): Promise<PurchaseDetail> {
		return this.purchases.detail(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `POST /purchases` — registra una compra.
	 *
	 * Responde 201 porque crea un recurso (igual que `POST /vouchers`). El body lleva el NUMERO del
	 * comprobante que emitio el proveedor: es requerido y no lo asigna ninguna serie nuestra (S2).
	 */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(purchaseBodySchema)) body: PurchaseBody,
	): Promise<PurchaseDetail> {
		return this.purchases.create(sessionUserOf(request.sessionUser).id, body);
	}

	/**
	 * `PATCH /purchases/:id` — edicion de una compra (body completo, ver la cabecera).
	 *
	 * El numero y el tipo son CORREGIBLES mientras el comprobante no tenga pagos: son datos del
	 * documento del proveedor (L3a/L3g). Los 404/409 los decide la RPC y su trigger: una compra de
	 * otro dueno (o una venta) no existe para esta sesion, y una con pagos no cambia importe, numero,
	 * tipo, proveedor ni fecha.
	 */
	@Patch(":id")
	edit(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(purchaseIdParamsSchema)) params: PurchaseIdParams,
		@Body(new ZodValidationPipe(purchaseBodySchema)) body: PurchaseBody,
	): Promise<PurchaseDetail> {
		return this.purchases.edit(sessionUserOf(request.sessionUser).id, params.id, body);
	}
}
