// Rutas del vertical notas (T3 del port de notas).
//
//   POST  /notes                  alta de una nota de credito o de debito (201 con la fila del ajuste)
//   GET   /notes?voucherId=uuid   las notas de un comprobante (S1), para la solapa del detalle de venta
//
// POR QUE EL PREFIJO ES `notes` Y NO UNA RUTA BAJO `/vouchers`: `GET /vouchers/:id` ya lo publica
// `VouchersModule` y `GET /vouchers/open` lo publica `CarteraController`, con Express resolviendo por
// ORDEN DE REGISTRO (`vouchers.controller.ts` documenta esa trampa). Un controller de este modulo con
// prefijo `vouchers` volveria a apostar a ese orden —`/vouchers/:id/notes` sobrevive hoy solo porque
// tiene otro numero de segmentos— y dejaria el prefijo repartido entre dos modulos. Con `notes` el
// ruteo de este modulo no depende de la posicion en `AppModule`, y el prefijo es uno solo.
//
// POR QUE EL COMPROBANTE VA EN LA QUERY Y NO EN UN SEGUNDO SEGMENTO (`/notes/:voucherId`): un
// `/notes/:algo` se lee como "la nota con ese id", que es otra cosa. `?voucherId=` dice que se pide
// una COLECCION filtrada, que es lo que devuelve (un array de `voucherAdjustmentSchema`).
//
// NO HAY `PATCH` NI `DELETE`: una nota emitida es inmutable (S7). Su tipo y su referencia los rechaza
// el trigger `comprobante_validate_adjustment`, y una correccion se hace con OTRA nota. Tampoco hay
// edicion de comprobante para "arreglar" el saldo.
//
// `SessionGuard` corre antes de los pipes: sin sesion la respuesta es 401 aunque el body o la query
// sean invalidos, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo fije (S10).
import { Body, Controller, Get, Inject, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { VoucherAdjustmentRow } from "@gestion/shared/lib/schemas/nota.ts";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import {
	type NoteCreateBody,
	type NotesQuery,
	noteCreateBodySchema,
	notesQuerySchema,
} from "./notes.query.ts";
import { NotesService } from "./notes.service.ts";

@Controller("notes")
@UseGuards(SessionGuard)
export class NotesController {
	constructor(@Inject(NotesService) private readonly notes: NotesService) {}

	/**
	 * `POST /notes` — registra una nota de credito o de debito.
	 *
	 * Responde 201 porque crea un recurso (igual que `POST /vouchers`, `POST /series` y
	 * `POST /payments`). El body es `notaWriteSchema` (S8/S9), que ya exige el motivo y lo valida
	 * contra el catalogo del TIPO de la nota.
	 */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(noteCreateBodySchema)) body: NoteCreateBody,
	): Promise<VoucherAdjustmentRow> {
		return this.notes.create(sessionUserOf(request.sessionUser).id, body);
	}

	/**
	 * `GET /notes?voucherId=<uuid>` — las notas de ese comprobante, de la emision mas reciente a la
	 * mas vieja.
	 *
	 * Un comprobante ajeno o inexistente devuelve la lista vacia: la RLS ya lo hace invisible.
	 */
	@Get()
	list(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(notesQuerySchema)) query: NotesQuery,
	): Promise<VoucherAdjustmentRow[]> {
		return this.notes.list(sessionUserOf(request.sessionUser).id, query.voucherId);
	}
}
