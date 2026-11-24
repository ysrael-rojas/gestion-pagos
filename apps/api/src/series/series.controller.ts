// Rutas del vertical de series de comprobante (T3 del port de series).
//
//   GET    /series              las series vivas del dueno de la sesion (S10, contrato de fila)
//   POST   /series              alta (RPC `crear_serie`, responde 201 con la fila)
//   PATCH  /series/:id          edicion del codigo y del "por defecto" (RPC `editar_serie`, 200)
//   POST   /series/:id/delete   baja LOGICA (RPC `eliminar_serie`, 204 sin cuerpo)
//
// POR QUE EL PREFIJO ES `series`: es la palabra de la ruta de la pantalla
// (`/configuracion/series`, S8/S9) y el prefijo que T5 suma a la allowlist del BFF
// (`apps/web/app/api/backend/[...path]/route.ts`). `series` puede convivir con `settings` y
// `cash-*` sin colisiones: ninguno de los otros modulos publica rutas bajo este prefijo.
//
// POR QUE EL BORRADO ES `POST /series/:id/delete` Y NO `DELETE /series/:id`: el unico consumidor
// es el BFF del navegador y su allowlist solo reenvia GET, POST y PATCH (S9); un `DELETE` seria una
// ruta que el frontend no puede alcanzar y habria que abrir el puente a un verbo mas solo para
// esto. El borrado es LOGICO (`deleted_at`), asi que la semantica que el usuario ve no cambia: el
// `POST` es la accion "dar de baja esta serie" y responde 204 porque no queda recurso que
// devolver. T5 tiene que llamar a ESTA ruta, no a un `DELETE`.
//
// POR QUE `PATCH` Y NO `PUT`: el BFF tampoco reenvia `PUT`, y la edicion ya se hace con
// `PATCH /entities/:id`, `PATCH /vouchers/:id` y `PATCH /settings`. El body es COMPLETO (codigo +
// default), no un patch parcial, igual que en esos tres.
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o el id
// sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S6).
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
import {
	type SerieCreateBody,
	type SerieEditBody,
	type SerieIdParams,
	serieCreateBodySchema,
	serieEditBodySchema,
	serieIdParamsSchema,
} from "./series.query.ts";
import { SeriesService } from "./series.service.ts";
import type { VoucherSeriesRow } from "./series.types.ts";

@Controller("series")
@UseGuards(SessionGuard)
export class SeriesController {
	constructor(@Inject(SeriesService) private readonly series: SeriesService) {}

	/** `GET /series` — las series vivas del dueno, por tipo y codigo. */
	@Get()
	list(@Req() request: SessionRequest): Promise<VoucherSeriesRow[]> {
		return this.series.list(sessionUserOf(request.sessionUser).id);
	}

	/**
	 * `POST /series` — registra una serie.
	 *
	 * Responde 201 porque crea un recurso (igual que `POST /vouchers` y `POST /payments`). El body
	 * es `serieFormSchema` (S7/S10), que ya restringe el tipo a los tres que se emiten (S4).
	 */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(serieCreateBodySchema)) body: SerieCreateBody,
	): Promise<VoucherSeriesRow> {
		return this.series.create(sessionUserOf(request.sessionUser).id, body);
	}

	/**
	 * `PATCH /series/:id` — edita el codigo y el "por defecto". El TIPO no se edita (L4a).
	 *
	 * Los 404/409 los decide la RPC con sus indices: una serie de otro dueno (o dada de baja) no
	 * existe para esta sesion, y un codigo repetido responde el mensaje de S6.
	 */
	@Patch(":id")
	edit(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(serieIdParamsSchema)) params: SerieIdParams,
		@Body(new ZodValidationPipe(serieEditBodySchema)) body: SerieEditBody,
	): Promise<VoucherSeriesRow> {
		return this.series.edit(sessionUserOf(request.sessionUser).id, params.id, body);
	}

	/**
	 * `POST /series/:id/delete` — baja logica (S5).
	 *
	 * `@HttpCode(204)`: la operacion no devuelve representacion (la fila sigue existiendo, con
	 * `deleted_at`, pero deja de estar en el listado). Ver la cabecera: no es un `DELETE` HTTP.
	 */
	@Post(":id/delete")
	@HttpCode(204)
	remove(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(serieIdParamsSchema)) params: SerieIdParams,
	): Promise<void> {
		return this.series.remove(sessionUserOf(request.sessionUser).id, params.id);
	}
}
