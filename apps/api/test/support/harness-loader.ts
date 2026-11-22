import { rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { ApiHarness } from "./harness.ts";
import type { SessionGuard, sessionUserOf } from "../../src/auth/session.guard.ts";

const here = dirname(fileURLToPath(import.meta.url));
/** `apps/api` */
const packageRoot = resolve(here, "../..");
/**
 * Un bundle por PROCESO de test: `node --test` corre cada archivo en su propio proceso, y dos
 * bundles escribiendo el mismo `outfile` en paralelo se pisarian a mitad de escritura.
 */
const outfile = resolve(packageRoot, `dist/test-harness-${process.pid}.cjs`);

export interface HarnessModule {
	startApi(): Promise<ApiHarness>;
	/** La guardia real del API, para probarla sin importar sus decoradores en Node. */
	SessionGuard: typeof SessionGuard;
	sessionUserOf: typeof sessionUserOf;
}

export async function loadApiHarness(): Promise<HarnessModule> {
	await build({
		absWorkingDir: packageRoot,
		entryPoints: ["test/support/harness.ts"],
		outfile,
		bundle: true,
		platform: "node",
		target: "node22",
		format: "cjs",
		sourcemap: false,
		// Misma lista que scripts/build.mjs: se requieren en runtime, no se bundlean.
		external: [
			"@nestjs/*",
			"better-auth",
			"better-auth/*",
			"drizzle-orm",
			"drizzle-orm/*",
			"express",
			"pg",
			"reflect-metadata",
			"rxjs",
			"rxjs/*",
			"zod",
			"zod/*",
		],
		tsconfig: resolve(packageRoot, "tsconfig.json"),
		logLevel: "silent",
	});

	const require = createRequire(resolve(packageRoot, "package.json"));

	return require(outfile) as HarnessModule;
}

/** Borra el bundle del harness. Se llama en el teardown de cada archivo de test. */
export function removeApiHarnessBundle(): void {
	rmSync(outfile, { force: true });
}
