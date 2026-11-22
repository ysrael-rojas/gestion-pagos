// Entorno del suite e2e: un solo lugar que resuelve puertos, origenes y rutas.
//
// Por que existe: `playwright.config.ts` arranca los dos servidores y los specs hablan con
// ellos; si cada uno derivara los origenes por su cuenta, un puerto distinto entre servidor y
// test produciria un fallo que parece del producto. Todo sale de aca.
//
// Puertos y origenes: se fijan a 127.0.0.1 (no `localhost`) porque el navegador manda
// `Origin: http://127.0.0.1:<puerto>` en el POST del formulario de login y Better Auth lo valida
// contra `BETTER_AUTH_TRUSTED_ORIGINS`. `localhost` puede resolver a ::1 y cambiar la cabecera.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** `apps/web/e2e/support` -> `apps/web`. */
export const WEB_PACKAGE_DIR = resolve(__dirname, "..", "..");
/** `apps/web/e2e/support` -> raiz del monorepo. */
export const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");

function port(name: string, fallback: number): number {
	const raw = process.env[name];
	if (raw === undefined || raw === "") {
		return fallback;
	}

	const parsed = Number(raw);

	if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
		throw new Error(`${name} no es un puerto valido: ${JSON.stringify(raw)}`);
	}

	return parsed;
}

/** Puerto de `next start` (la web). */
export const WEB_PORT = port("E2E_WEB_PORT", 3000);
/** Puerto de `apps/api`. */
export const API_PORT = port("E2E_API_PORT", 3001);

export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

/**
 * Cadena de conexion de la base.
 *
 * Obligatoria: `apps/api` no inventa una (`db.provider.ts`) y el suite la necesita para sembrar
 * y borrar sus propias fixtures. No tiene default y no se escribe en ningun archivo del repo: se
 * exporta en el entorno, igual que para `pnpm test` de `apps/api`. Ver `.github/CI.md`.
 */
export function databaseUrl(): string {
	const value = process.env.DATABASE_URL?.trim();

	if (!value) {
		throw new Error(
			"Falta DATABASE_URL. El e2e siembra y borra sus propias fixtures en la base que " +
				"tambien usa apps/api, asi que necesita la misma cadena. Exportala y volve a " +
				"intentar (ver .github/CI.md, seccion e2e).",
		);
	}

	return value;
}

/** Nombre de la base que nombra `DATABASE_URL`, para contrastarlo con el transporte de psql. */
export function databaseNameFromUrl(url: string): string {
	try {
		const parsed = new URL(url);

		return decodeURIComponent(parsed.pathname.replace(/^\//, ""));
	} catch {
		throw new Error("DATABASE_URL no es una URL valida.");
	}
}

/** `true` si `binary` se resuelve en el PATH (en Windows con sus extensiones ejecutables). */
export function isOnPath(binary: string): boolean {
	const extensions =
		process.platform === "win32" ? ["", ".exe", ".cmd", ".bat", ".ps1"] : [""];
	const entries = (process.env.PATH ?? "").split(process.platform === "win32" ? ";" : ":");

	return entries.some((entry) =>
		entry === ""
			? false
			: extensions.some((extension) => existsSync(resolve(entry, `${binary}${extension}`))),
	);
}
