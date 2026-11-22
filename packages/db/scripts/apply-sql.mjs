// Aplica las migraciones .sql en orden, una transaccion por archivo, y registra las
// aplicadas en `public.__sql_migrations`.
//
// Por que un runner y no el migrador de drizzle: las migraciones son SQL escrito a mano
// (funciones PL/pgSQL, triggers, 67 politicas RLS) que drizzle-kit no puede expresar. El
// SQL heredado es la fuente de verdad y Drizzle aporta los tipos por introspeccion
// (`pnpm db:pull`), no el esquema.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

const REQUIRED = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DB_PORT"];

function resolveConnectionString() {
	const direct = process.env.DATABASE_URL;
	if (direct) return direct;

	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length > 0) {
		throw new Error(
			`Falta DATABASE_URL, o estas variables de compose.yaml: ${missing.join(", ")}`,
		);
	}

	const user = encodeURIComponent(process.env.POSTGRES_USER);
	const password = encodeURIComponent(process.env.POSTGRES_PASSWORD);
	const database = encodeURIComponent(process.env.POSTGRES_DB);
	const port = encodeURIComponent(process.env.DB_PORT);
	return `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
}

const client = new pg.Client({ connectionString: resolveConnectionString() });
await client.connect();

try {
	await client.query(`
		create table if not exists public.__sql_migrations (
			name text primary key,
			applied_at timestamptz not null default now()
		)
	`);

	const { rows } = await client.query("select name from public.__sql_migrations");
	const applied = new Set(rows.map((row) => row.name));

	const files = (await readdir(migrationsDir)).filter((file) => file.endsWith(".sql")).sort();

	let freshlyApplied = 0;
	let skipped = 0;

	for (const file of files) {
		if (applied.has(file)) {
			skipped += 1;
			continue;
		}

		const contents = await readFile(join(migrationsDir, file), "utf8");
		process.stdout.write(`-> ${file} ... `);

		try {
			await client.query("begin");
			await client.query(contents);
			await client.query("insert into public.__sql_migrations (name) values ($1)", [file]);
			await client.query("commit");
			freshlyApplied += 1;
			console.log("ok");
		} catch (error) {
			await client.query("rollback");
			console.error("FALLO");
			console.error(`   archivo: ${file}`);
			console.error(`   error:   ${error.message}`);
			if (error.position) console.error(`   posicion en el archivo: ${error.position}`);
			process.exitCode = 1;
			break;
		}
	}

	console.log(
		`\n${freshlyApplied} aplicada(s), ${skipped} ya estaban, ${files.length} en total.`,
	);
} finally {
	await client.end();
}
