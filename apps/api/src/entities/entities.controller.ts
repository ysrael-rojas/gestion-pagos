// Rutas de escritura del vertical de clientes (T5c).
//
// La LECTURA del listado sigue en `CatalogsController` (`GET /entities?role=client|supplier`),
// porque nacio como catalogo del formulario de pagos y su contrato (`EntityCatalogItem`) ya
// tiene consumidores. Aca solo se agrega lo que faltaba: alta, modificacion y baja logica.
//
// `SessionGuard` en el controlador corre antes de los pipes: sin sesion la respuesta es 401
// aunque el body sea invalido, y ningun handler toca la base. El dueno sale de
// `sessionUserOf(request.sessionUser)`; no hay ningun campo de entrada que lo fije.
import {
	Body,
	Controller,
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
	type ClientBody,
	type EntityIdParams,
	clientBodySchema,
	entityIdParamsSchema,
} from "./entities.query.ts";
import { EntitiesService } from "./entities.service.ts";
import type { ClientRecord } from "./entities.types.ts";

@Controller("entities")
@UseGuards(SessionGuard)
export class EntitiesController {
	constructor(@Inject(EntitiesService) private readonly entities: EntitiesService) {}

	/** `POST /entities` — alta de cliente (`createClientRecord`). */
	@Post()
	create(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(clientBodySchema)) body: ClientBody,
	): Promise<ClientRecord> {
		return this.entities.create(sessionUserOf(request.sessionUser).id, body);
	}

	/** `PATCH /entities/:id` — modificacion (`updateClientRecord`). */
	@Patch(":id")
	update(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(entityIdParamsSchema)) params: EntityIdParams,
		@Body(new ZodValidationPipe(clientBodySchema)) body: ClientBody,
	): Promise<ClientRecord> {
		return this.entities.update(sessionUserOf(request.sessionUser).id, params.id, body);
	}

	/**
	 * `POST /entities/:id/delete` — baja logica (`softDeleteClient`).
	 *
	 * POST y no DELETE porque el verbo HTTP sugiere una fila que desaparece y aca la fila
	 * persiste: es una escritura sobre `deleted_at`, igual que `POST /payments/:id/void`.
	 * `@HttpCode(200)`: `POST` responde 201 por defecto y aca no se creo nada.
	 */
	@Post(":id/delete")
	@HttpCode(200)
	async softDelete(
		@Req() request: SessionRequest,
		@Param(new ZodValidationPipe(entityIdParamsSchema)) params: EntityIdParams,
	): Promise<{ deleted: true }> {
		await this.entities.softDelete(sessionUserOf(request.sessionUser).id, params.id);

		return { deleted: true };
	}
}
