// Rutas del vertical de ventas, slice 1: comprobantes de VENTA (T3).
//
//   GET    /vouchers        las ventas del dueno de la sesion (listado de S10, sin filtros: la
//                           pantalla filtra en el cliente)
//   GET    /vouchers/:id    el comprobante con su saldo
//   POST   /vouchers        alta (RPC `crear_venta`, responde 201 con el detalle)
//   PATCH  /vouchers/:id    edicion (RPC `editar_venta`, responde 200 con el detalle)
//
// POR QUE EL PREFIJO ES `vouchers`: es la palabra del dominio que ya usa el API para el comprobante
// (`GET /vouchers/open` de la cartera) y `vouchers` ya esta en la allowlist del BFF
// (`apps/web/app/api/backend/[...path]/route.ts`), asi que T5 no tiene que abrir nada nuevo.
// OJO con el orden de registro: `GET /vouchers/open` la atiende `CarteraController`, que se
// registra ANTES (`PaymentsModule` va primero en `AppModule`). `open` no es un uuid, pero Express
// resuelve por orden de registro, no por especificidad: si alguien mueve `VouchersModule` arriba de
// `PaymentsModule`, esa ruta pasa a ser un 400 de `voucherIdParamsSchema`. Lo pina el e2e.
//
// POR QUE `PATCH` Y NO `PUT`: el BFF solo deja pasar GET, POST y PATCH (no reenvia PUT), y la
// edicion ya se hace con `PATCH /entities/:id`. El body es COMPLETO (el mismo `voucherFormSchema`
// del formulario, que siempre manda todos los campos editables), igual que en clientes: no es un
// patch parcial.
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o el id
// sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S6).
import { Body, Controller, Get, Inject, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
	type VoucherBody,
	type VoucherIdParams,
	voucherBodySchema,
	voucherIdParamsSchema,
} from "./vouchers.query.ts";
import { VouchersService } from "./vouchers.service.ts";
import type { VoucherDetail, VoucherListItem } from "./vouchers.types.ts";

@Controller("vouchers")
@UseGuards(SessionGuard)
export class VouchersController {
	constructor(@Inject(VouchersService) private readonly vouchers: VouchersService) {}

	/** `GET /vouchers` — las ventas del dueno, de la emision mas reciente a la mas vieja. */
	@Get()
	list(@Req() request: SessionRequest): Promise<VoucherListItem[]> {
		return this.vouchers.list(sessionUserOf(request.sessionUser).id);
	}

	/** `GET /vouchers/:id` — el comprobante con su saldo (404 si no es una venta del dueno). */
	@Get(":id")
	detail(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(voucherIdParamsSchema)) params: VoucherIdParams,
	): Promise<VoucherDetail> {
		return this.vouchers.detail(sessionUserOf(request.sessionUser).id, params.id);
	}

	/**
	 * `POST /vouchers` — registra una venta.
	 *
	 * Responde 201 porque crea un recurso (igual que `POST /payments` y `POST /cash-closes`). Si el
	 * body no manda `issueDate`, el servicio usa el "hoy" del negocio (S9).
	 */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(voucherBodySchema)) body: VoucherBody,
	): Promise<VoucherDetail> {
		return this.vouchers.create(sessionUserOf(request.sessionUser).id, body);
	}

	/**
	 * `PATCH /vouchers/:id` — edicion de una venta (body completo, ver la cabecera).
	 *
	 * Los 404/409 los decide la RPC y su trigger: un comprobante de otro dueno no existe para esta
	 * sesion, y uno con pagos no cambia importe, numero, cliente ni fecha.
	 */
	@Patch(":id")
	edit(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(voucherIdParamsSchema)) params: VoucherIdParams,
		@Body(new ZodValidationPipe(voucherBodySchema)) body: VoucherBody,
	): Promise<VoucherDetail> {
		return this.vouchers.edit(sessionUserOf(request.sessionUser).id, params.id, body);
	}
}
