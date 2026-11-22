import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { API_ORIGIN, API_PORT, REPO_ROOT, WEB_ORIGIN, WEB_PORT, databaseUrl } from "./e2e/support/env";

// Navegador contenido en el proyecto: `playwright install` se corre con
// `PLAYWRIGHT_BROWSERS_PATH=$PWD/.cache/ms-playwright` (`.cache/` esta gitignored) para que la
// corrida no dependa de lo que haya en el perfil del usuario. Si el desarrollador ya lo exporto,
// se respeta.
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(REPO_ROOT, ".cache", "ms-playwright");

/** Entorno del proceso actual sin los valores `undefined` (el tipo de `env` es string->string). */
function inheritedEnv(): Record<string, string> {
	const env: Record<string, string> = {};

	for (const [key, value] of Object.entries(process.env)) {
		if (typeof value === "string") {
			env[key] = value;
		}
	}

	return env;
}

// Efimero y por corrida: nada que firmar se guarda en el repo. Si el entorno trae uno, se usa
// (es el caso del CI, que lo define con el mismo valor para todos los pasos).
const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET?.trim() || randomUUID();

export default defineConfig({
	// Solo los specs del vertical: `lib/**/*.test.ts` son los tests unitarios de la web
	// (`pnpm test`) y no se corren con Playwright.
	testDir: "./e2e/specs",
	testMatch: "**/*.spec.ts",

	// Serial: los specs comparten la base sembrada y el contador global de recibos
	// (`receipt_sequence` es por direccion, no por dueno). En paralelo el baseline de conteos
	// dejaria de ser comparable y un alta correria el numero de recibo de otro spec.
	fullyParallel: false,
	workers: 1,
	retries: 0,
	forbidOnly: Boolean(process.env.CI),

	timeout: 60_000,
	expect: { timeout: 15_000 },

	reporter: [["list"]],
	globalSetup: "./e2e/global-setup.ts",
	globalTeardown: "./e2e/global-teardown.ts",

	use: {
		baseURL: WEB_ORIGIN,
		// El navbar muestra el correo de la sesion desde `lg` (1024px).
		viewport: { width: 1280, height: 800 },
		locale: "es-PE",
		timezoneId: "America/Lima",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},

	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

	// Los dos procesos que el suite ejercita, arrancados desde cero en cada corrida.
	// `reuseExistingServer: false` es deliberado: reusar un servidor levantado a mano probaria
	// otra version del codigo, y un e2e que valida un build viejo es peor que no tener e2e.
	webServer: [
		{
			// El API se compila y se arranca como en produccion (`dist/main.js`). El build entra en
			// el mismo comando para que nadie pueda correr el suite contra un bundle viejo.
			command: "node ../api/scripts/build.mjs && node ../api/dist/main.js",
			url: `${API_ORIGIN}/health`,
			reuseExistingServer: false,
			timeout: 300_000,
			env: {
				...inheritedEnv(),
				PORT: String(API_PORT),
				DATABASE_URL: databaseUrl(),
				BETTER_AUTH_SECRET,
				BETTER_AUTH_URL: API_ORIGIN,
				// Deuda de L62 saldada: el navegador manda `Origin: WEB_ORIGIN` en el login y Better
				// Auth lo valida contra esta lista. Sin esto el formulario responde 403.
				BETTER_AUTH_TRUSTED_ORIGINS: WEB_ORIGIN,
			},
		},
		{
			// Build + start de la web, siempre: el e2e tiene que probar el codigo de este arbol.
			command:
				"node node_modules/next/dist/bin/next build && node node_modules/next/dist/bin/next start",
			url: `${WEB_ORIGIN}/login`,
			reuseExistingServer: false,
			timeout: 600_000,
			env: {
				...inheritedEnv(),
				PORT: String(WEB_PORT),
				// `NEXT_PUBLIC_API_URL` se inlinea en el build: el puente `/api/backend` lo usa
				// server-side y el navegador solo habla same-origin.
				API_URL: API_ORIGIN,
				NEXT_PUBLIC_API_URL: API_ORIGIN,
			},
		},
	],
});
