// Aplica los seeds en el orden que documenta S20 (y que solo funciona en ese orden).
//
// Por que un runner: `seed-demo.sql` resuelve catalogos con `select ... into strict` que siembra
// `01-catalogs.sql`, y `seed-semana.sql` depende de las entidades de `seed-demo.sql`. Probado en
// ambas direcciones: cualquier otro orden falla. El orden vive aca, en un solo lugar, para que el
// CI y el desarrollador corran exactamente la misma secuencia.
//
// Reglas:
//   - un archivo = una transaccion (igual que `apply-sql.mjs`); si un archivo falla, se revierte
//     entero y no se aplica el siguiente,
//   - el primero que falla detiene la corrida y el proceso sale 1 con el archivo y el error,
//   - `seed-semana-verify.sql` es de solo lectura (sus controles se imprimen para el humano); se
//     ejecuta al final porque es el estado que describe `seed-semana.sql`.
//
// No es idempotente: los seeds insertan con UUID fijos y estan pensados para una base recien
// migrada. Sobre una base ya sembrada fallan por clave duplicada, que es lo correcto: esconder el
// error con `on conflict` falsearia los conteos de la demo.
//
// Conexion: `DATABASE_URL` (nunca se imprime ni se persiste). Igual que `check-rls-enforcement.mjs`,
// este script no compone una conexion a partir de `compose.yaml` porque no tiene un default util:
// sembrar la base equivocada es peor que fallar con un mensaje claro.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const seedsDir = join(here, "..", "seeds");

/** Orden de S20. `seed-semana-verify.sql` va ultimo: solo lee. */
const SEEDS = [
	"00-demo-user.sql",
	"01-catalogs.sql",
	"seed-demo.sql",
	"seed-semana.sql",
	"seed-semana-verify.sql",
];

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
	console.error(
		"apply-seeds: falta DATABASE_URL. Los seeds se aplican a una base concreta; este script no " +
			"inventa la conexion.",
	);
	process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
	for (const file of SEEDS) {
		const contents = await readFile(join(seedsDir, file), "utf8");
		process.stdout.write(`-> ${file} ... `);
		try {
			await client.query("begin");
			const result = await client.query(contents);
			await client.query("commit");
			console.log("ok");
			// `seed-semana-verify.sql` no afirma nada: imprime los controles de la semana para que
			// un humano los lea. Se muestran en el log del CI en vez de descartarlos.
			if (file === "seed-semana-verify.sql") {
				for (const { rows } of Array.isArray(result) ? result : [result]) {
					for (const row of rows ?? []) console.log(`   control: ${JSON.stringify(row)}`);
				}
			}
		} catch (error) {
			await client.query("rollback");
			console.error("FALLO");
			console.error(`   archivo: ${file}`);
			console.error(`   error:   ${error.message}`);
			process.exitCode = 1;
			break;
		}
	}

	if (process.exitCode !== 1) {
		console.log(`\n${SEEDS.length} seed(s) aplicado(s) en el orden de S20.`);
	}
} finally {
	await client.end();
}
