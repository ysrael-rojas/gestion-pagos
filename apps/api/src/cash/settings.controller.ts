// Rutas de ajustes generales del vertical de cajas-bancos (C1).
//
// Dos lecturas/escrituras de `app_setting` y el sembrado explicito, todas del dueno de la sesion.
// `SessionGuard` corre antes de los pipes, asi que sin sesion la respuesta es 401 aunque el body
// sea invalido y ningun handler toca la base.
//
// No hay ningun campo de entrada que fije el dueno: sale de `request.sessionUser` (S6).
//
//   GET   /settings          ajustes del dueno como mapa `key -> value` (`getAppSettings`)
//   PATCH /settings          upsert de las tres claves que expone la UI (`setAppSetting`)
//   POST  /settings/ensure   siembra idempotente de las semillas (`ensureDefaultSettings`, L67)
import { Body, Controller, Get, HttpCode, Inject, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { type SettingsPatch, settingsPatchSchema } from "./settings.query.ts";
import { SettingsService } from "./settings.service.ts";
import type { AppSettings, SettingsSeedResult } from "./settings.types.ts";

@Controller("settings")
@UseGuards(SessionGuard)
export class SettingsController {
	constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

	/**
	 * `GET /settings` — ajustes del dueno.
	 *
	 * En el origen esta lectura venia precedida de una siembra perezosa disparada por el render.
	 * Aca no escribe: un dueno sin filas recibe `{}` y es la UI (o `POST /settings/ensure`) quien
	 * decide sembrar (S7).
	 */
	@Get()
	get(@Req() request: SessionRequest): Promise<AppSettings> {
		return this.settings.getAll(sessionUserOf(request.sessionUser).id);
	}

	/** `PATCH /settings` — upsert parcial de las tres claves de la tarjeta de configuracion. */
	@Patch()
	update(
		@Req() request: SessionRequest,
		@Body(new ZodValidationPipe(settingsPatchSchema)) body: SettingsPatch,
	): Promise<AppSettings> {
		return this.settings.update(sessionUserOf(request.sessionUser).id, body);
	}

	/**
	 * `POST /settings/ensure` — siembra idempotente de las tres semillas del origen.
	 *
	 * Reemplaza al `ensureDefaultSettings()` que corria dentro del render de la tarjeta (un GET
	 * que muta). Devuelve cuantas filas falto crear: `{ created: 0 }` significa "ya estaba".
	 * `@HttpCode(200)`: `POST` responde 201 por defecto y aca no se creo un recurso que se
	 * consulte por id, igual que `POST /catalogs/ensure`.
	 */
	@Post("ensure")
	@HttpCode(200)
	ensure(@Req() request: SessionRequest, @Body() _body: unknown): Promise<SettingsSeedResult> {
		return this.settings.ensureDefaults(sessionUserOf(request.sessionUser).id);
	}
}
