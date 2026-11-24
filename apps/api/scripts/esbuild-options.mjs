// Opciones de esbuild del API, compartidas por `build.mjs` (build/watch) y `dev.mjs` (watch +
// servidor). Un solo lugar: si las dos rutas tuvieran su copia, el build de release y el de
// desarrollo podrian divergir en `external`, `target` o `tsconfig` sin que nadie lo note.
//
// Por que no `tsc`: `@gestion/shared` se consume como TypeScript fuente (`main`/`types` apuntan a
// `src/index.ts`). TypeScript 7 exige `rootDir` explicito para emitir, y los fuentes de
// `packages/shared` quedan fuera de `apps/api/src`, asi que `tsc` no puede producir un ejecutable de
// este paquete sin tocar `packages/shared`. esbuild resuelve la fuente de shared (`main` del
// paquete, sin alias) y deja los paquetes de node_modules en `external`.
//
// Consecuencia de bundelear con esbuild: no hay `emitDecoratorMetadata`, asi que la inyeccion de
// dependencias de Nest usa tokens explicitos (`@Inject(TOKEN)`) en todos los constructores. No
// usamos DTOs de clase ni `class-validator`, donde esa metadata fuera imprescindible.
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import("esbuild").BuildOptions} */
export const options = {
	absWorkingDir: packageRoot,
	entryPoints: ["src/main.ts"],
	outfile: "dist/main.js",
	bundle: true,
	platform: "node",
	target: "node22",
	format: "cjs",
	sourcemap: true,
	// NestJS, Better Auth, Drizzle y pg viven en node_modules: se requieren en runtime, no se
	// bundlean. La lista es exactamente `dependencies` de package.json: `packages: "external"` no
	// sirve aca porque tambien marcaria `@gestion/shared` (que hay que bundlear, es TS fuente).
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
	logLevel: "info",
};
