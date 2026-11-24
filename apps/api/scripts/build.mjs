// Build de apps/api con esbuild. Sin `--watch` emite `dist/main.js` una vez; con `--watch` queda
// recompilando en cada cambio de `src/`, sin arrancar el servidor (eso es `dev.mjs`).
//
// Las opciones viven en `esbuild-options.mjs` para que `dev.mjs` no tenga una copia que se
// desincronice.
import { build, context } from "esbuild";

import { options } from "./esbuild-options.mjs";

if (process.argv.includes("--watch")) {
	const ctx = await context(options);
	await ctx.watch();
	console.log("[build] esperando cambios en src/...");
} else {
	await build(options);
}
