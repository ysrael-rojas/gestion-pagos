// Ajustes generales del dueno: lectura, actualizacion y siembra idempotente.
//
// Fuente: `lib/caja/caja.ts` del proyecto de origen (`getAppSettings`, `setAppSetting`,
// `ensureDefaultSettings`). Las tres operaciones son las mismas; lo que cambia es el transporte:
// el origen hablaba PostgREST con la sesion de Supabase, aca es una transaccion con la identidad
// del request puesta por `withOwner` (RLS + rol `authenticated`).
//
// S6: ninguna entrada fija el dueno. `owner_id` sale del default `auth.uid()`, que dentro de
// `withOwner` es exactamente el usuario de la sesion; los `where owner_id = ...` que aparecen
// abajo son defensa en profundidad (la garantia es la politica `app_setting_*`), no la garantia.
//
// DESVIOS DELIBERADOS respecto del origen:
//
//   1. `ensureDefaultSettings()` del origen corria dentro del render de la tarjeta "Configuracion
//      general": un GET que escribia. Aca el mismo efecto es `POST /settings/ensure`, explicito e
//      idempotente, y `GET /settings` no escribe nada (S7, deuda L67).
//   2. El origen sembraba `key` por `key` comparando el VALOR (`if (!settings[KEY])`) y toleraba
//      el `23505` de duplicado. Aca se compara la PRESENCIA de la fila y el insert es un
//      `onConflictDoNothing`: mismo resultado observable (una fila que existe no se pisa, aunque
//      su valor sea vacio, porque la insercion habria chocado) y el conteo que devuelve la ruta
//      son filas creadas de verdad.
//   3. `PATCH /settings` normaliza los numeros como la tarjeta del origen (`String(rate)` y
//      `tolerance.toFixed(2)`), pero en el SERVIDOR: asi el valor guardado no depende de la
//      version del cliente que lo mando.
import {
	BadRequestException,
	ForbiddenException,
	HttpException,
	Inject,
	Injectable,
	InternalServerErrorException,
} from "@nestjs/common";
import { asc, eq, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { appSetting } from "../db/schema/app-setting.ts";
import { withOwner } from "../db/with-owner";
import type { SettingsPatch } from "./settings.query.ts";
import {
	type AppSettings,
	DEFAULT_SETTINGS,
	type SettingKey,
	type SettingsSeedResult,
} from "./settings.types.ts";

const GENERIC = "No se pudo completar la operación con la base de datos. Intenta nuevamente.";

interface PostgresError {
	code?: string;
	message?: string;
}

/** `42501` viene de la politica/privilegio con un mensaje de dominio; "permission denied" no. */
function isPrivilegeDenial(message: string): boolean {
	return /permission denied/i.test(message);
}

/**
 * Busca el codigo de PostgreSQL en la cadena de `cause`: drizzle 0.45 envuelve el error original
 * en `DrizzleQueryError`. Mismo recorrido que `payments.errors.ts` / `entities.errors.ts`; vive
 * aca porque los mensajes de este vertical son propios y no hay (todavia) un
 * `settings.errors.ts` en la superficie de esta tarea.
 */
function normalizePostgresError(error: unknown): PostgresError | null {
	let current: unknown = error;

	for (let depth = 0; depth < 4 && current !== null && typeof current === "object"; depth += 1) {
		const candidate = current as PostgresError;

		if (typeof candidate.code === "string") {
			return candidate;
		}

		current = (candidate as { cause?: unknown }).cause;
	}

	return null;
}

/** Traduce el error de una query de ajustes a la excepcion HTTP correspondiente. */
function toSettingsHttpException(error: unknown): HttpException {
	if (error instanceof HttpException) {
		return error;
	}

	const postgres = normalizePostgresError(error);

	if (!postgres?.code) {
		return new InternalServerErrorException(GENERIC);
	}

	const message = postgres.message ?? "";

	switch (postgres.code) {
		case "P0001":
			// Excepcion de dominio de PL/pgSQL, con su mensaje ya redactado.
			return new BadRequestException(message || GENERIC);
		case "42501":
			// Un grant revocado sobre `app_setting` es un hallazgo, no algo a sortear aca: se
			// reporta como 403 con el texto de la base.
			return new ForbiddenException(
				isPrivilegeDenial(message)
					? "No tienes permisos para esta operación. Cierra sesión y vuelve a entrar."
					: message || "No tienes permisos para esta operación.",
			);
		default:
			return new InternalServerErrorException(GENERIC);
	}
}

/**
 * Los pares clave/valor que la ruta guarda, ya normalizados como los guardaba el origen.
 *
 * `pen_usd_rate` viaja como numero y se guarda con `String(...)`
 * (`general-settings-card.tsx:92`, la tarjeta manda `String(numericRate)` al `upsert` de
 * `setAppSetting`); la tolerancia se guarda con dos decimales (`general-settings-card.tsx:95`,
 * `numericTolerance.toFixed(2)`), que es lo que el SQL castea.
 */
function storedValues(body: SettingsPatch): Array<{ key: SettingKey; value: string }> {
	const values: Array<{ key: SettingKey; value: string }> = [];

	if (body.default_closing_periodicity !== undefined) {
		values.push({
			key: "default_closing_periodicity",
			value: body.default_closing_periodicity,
		});
	}

	if (body.pen_usd_rate !== undefined) {
		values.push({ key: "pen_usd_rate", value: String(body.pen_usd_rate) });
	}

	if (body.cash_difference_tolerance !== undefined) {
		values.push({
			key: "cash_difference_tolerance",
			value: body.cash_difference_tolerance.toFixed(2),
		});
	}

	return values;
}

/** Mapa `key -> value` del dueno, ordenado por clave (el orden no cambia el contenido). */
async function readSettings(tx: Transaction, ownerId: string): Promise<AppSettings> {
	const rows = await tx
		.select({ key: appSetting.key, value: appSetting.value })
		.from(appSetting)
		.where(eq(appSetting.ownerId, ownerId))
		.orderBy(asc(appSetting.key));

	const settings: AppSettings = {};

	for (const row of rows) {
		settings[row.key] = row.value;
	}

	return settings;
}

@Injectable()
export class SettingsService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/** `GET /settings` — los ajustes del dueno como mapa (`getAppSettings`). No escribe. */
	async getAll(ownerId: string): Promise<AppSettings> {
		try {
			return await withOwner(this.db, ownerId, (tx) => readSettings(tx, ownerId));
		} catch (error) {
			throw toSettingsHttpException(error);
		}
	}

	/**
	 * `PATCH /settings` — upsert de las claves que expone la UI (`setAppSetting`).
	 *
	 * Es un upsert por `(owner_id, key)` y no un update: la tarjeta del origen guardaba con
	 * `upsert`, asi que un dueno que todavia no fue sembrado puede guardar su configuracion sin
	 * pasar por `POST /settings/ensure`. Devuelve el mapa completo despues de escribir, que es lo
	 * que la tarjeta vuelve a leer.
	 */
	async update(ownerId: string, body: SettingsPatch): Promise<AppSettings> {
		const values = storedValues(body);

		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				await tx
					.insert(appSetting)
					.values(values)
					.onConflictDoUpdate({
						target: [appSetting.ownerId, appSetting.key],
						set: { value: sql`excluded.value`, updatedAt: sql`now()` },
					});

				return readSettings(tx, ownerId);
			});
		} catch (error) {
			throw toSettingsHttpException(error);
		}
	}

	/**
	 * `POST /settings/ensure` — siembra idempotente de las tres semillas del origen.
	 *
	 * Compara por `key` (`app_setting_pkey` es `(owner_id, key)`, y `key` es el identificador
	 * estable que lee el SQL de cierre): si al dueno le falta una semilla se crea, si ya la tiene
	 * no se toca —aunque su valor sea otro— y el resultado dice cuantas filas falto crear. Un
	 * dueno nuevo recibe 3; la segunda llamada, 0.
	 *
	 * El `owner_id` no se escribe a mano: la columna tiene `default auth.uid()` y dentro de
	 * `withOwner` ese GUC es el dueno de la sesion, asi que es imposible sembrar para otro. El
	 * `onConflictDoNothing` cubre la carrera de dos requests simultaneos que vean el mismo hueco.
	 */
	async ensureDefaults(ownerId: string): Promise<SettingsSeedResult> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const existing = await tx
					.select({ key: appSetting.key })
					.from(appSetting)
					.where(eq(appSetting.ownerId, ownerId));
				const present = new Set(existing.map((row) => row.key));
				const missing = DEFAULT_SETTINGS.filter((seed) => !present.has(seed.key));

				if (missing.length === 0) {
					return { created: 0 };
				}

				const created = await tx
					.insert(appSetting)
					.values(missing.map((seed) => ({ key: seed.key, value: seed.value })))
					.onConflictDoNothing()
					.returning({ key: appSetting.key });

				return { created: created.length };
			});
		} catch (error) {
			throw toSettingsHttpException(error);
		}
	}
}
