// `pnpm --filter @gestion/api dev`: esbuild en watch MAS el servidor, reiniciado en cada
// recompilacion exitosa.
//
// Antes `dev` era solo el watch: recompilaba y no arrancaba nada, asi que `pnpm dev` levantaba la
// web y no el API, y habia que abrir una segunda terminal con `build && start` (README, paso 4).
// Se resuelve aca, sin `@nestjs/cli`: es una dependencia nueva para lo que este archivo hace en
// treinta lineas, y el build ya es esbuild (`nest start --watch` ademas compilaria distinto que el
// build de release).
//
// Reglas del supervisor:
//   1. Un build con errores NO reinicia: el servidor que corre sigue sirviendo lo ultimo bueno.
//      Es la diferencia entre "guarde un archivo a medio escribir" y "el API se cayo".
//   2. Si el servidor muere solo (puerto ocupado, error de arranque), no se reintenta: se informa y
//      se espera la proxima recompilacion. Un reinicio automatico en loop esconde el error real.
//   3. Ctrl+C apaga al hijo y al watcher; no queda un `dist/main.js` huerfano con el puerto tomado.
//
// Limite conocido en Windows: matar el watcher sin consola (`taskkill`, `kill -9` de git-bash, que
// usa TerminateProcess) NO corre ningun handler —ni en este script ni en nodemon o `nest start
// --watch`— asi que el servidor queda vivo. Ctrl+C si llega a los dos, porque el grupo de consola
// recibe `CTRL_C_EVENT` y el hijo se apaga solo. Si ves `EADDRINUSE` al arrancar, es un servidor de
// una corrida anterior: matalo por PID (`netstat -ano | grep :3001`).
import { context } from "esbuild";
import { spawn } from "node:child_process";

import { options, packageRoot } from "./esbuild-options.mjs";

/** @type {import("node:child_process").ChildProcess | null} */
let server = null;
let stopping = false;
let restarts = 0;

function startServer() {
	const child = spawn(process.execPath, ["dist/main.js"], {
		cwd: packageRoot,
		stdio: "inherit",
	});

	server = child;

	child.on("exit", (code, signal) => {
		// Solo interesa si es el servidor actual: los que se matan en un reinicio ya fueron
		// desligados (`server = null`) antes de que emitan su `exit`.
		if (server !== child) {
			return;
		}

		server = null;

		if (stopping) {
			return;
		}

		console.log(
			`[dev] el servidor termino (${signal ?? `code ${code}`}); no se reinicia solo. ` +
				"Guarda un archivo en src/ para levantarlo de nuevo."
		);
	});
}

function stopServer() {
	const child = server;

	if (!child) {
		return Promise.resolve();
	}

	server = null;

	return new Promise((done) => {
		if (child.exitCode !== null || child.signalCode !== null) {
			done();
			return;
		}

		child.once("exit", () => done());
		child.kill("SIGTERM");
	});
}

const restartOnRebuild = {
	name: "restart-server",
	setup(build) {
		build.onEnd(async (result) => {
			if (stopping) {
				return;
			}

			if (result.errors.length > 0) {
				console.log("[dev] build con errores: el servidor sigue con la ultima version buena.");
				return;
			}

			const previous = server !== null;

			await stopServer();

			if (stopping) {
				return;
			}

			if (previous) {
				restarts += 1;
				console.log(`[dev] recompilado, reiniciando el servidor (reinicio ${restarts}).`);
			}

			startServer();
		});
	},
};

const ctx = await context({ ...options, plugins: [restartOnRebuild] });
await ctx.watch();

console.log("[dev] watcher de esbuild listo; esperando cambios en src/...");

async function shutdown(signal) {
	if (stopping) {
		return;
	}

	stopping = true;
	console.log(`[dev] ${signal}: apagando el servidor y el watcher.`);

	await stopServer();
	await ctx.dispose();
	process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		void shutdown(signal);
	});
}
