import { defineConfig } from "drizzle-kit";

// compose.yaml define POSTGRES_USER / POSTGRES_PASSWORD / POSTGRES_DB / DB_PORT por perfil
// (dev, prod). DATABASE_URL manda cuando esta definida; si no, se compone igual que en
// scripts/apply-sql.mjs, para que no haya dos formatos de conexion en el monorepo.
const REQUIRED = ["POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "DB_PORT"];

function resolveUrl(): string {
	const direct = process.env.DATABASE_URL;
	if (direct) return direct;

	const missing = REQUIRED.filter((key) => !process.env[key]);
	if (missing.length > 0) {
		throw new Error(
			`Falta DATABASE_URL, o estas variables de compose.yaml: ${missing.join(", ")}`,
		);
	}

	const user = encodeURIComponent(process.env.POSTGRES_USER as string);
	const password = encodeURIComponent(process.env.POSTGRES_PASSWORD as string);
	const database = encodeURIComponent(process.env.POSTGRES_DB as string);
	const port = encodeURIComponent(process.env.DB_PORT as string);
	return `postgresql://${user}:${password}@127.0.0.1:${port}/${database}`;
}

// El esquema es propiedad del SQL heredado; Drizzle solo aporta los tipos que genera
// `pnpm db:pull` por introspeccion. Por eso `out` apunta a migrations/ pero drizzle-kit
// nunca las genera: se ejecutan con scripts/apply-sql.mjs.
export default defineConfig({
	dialect: "postgresql",
	schema: "./src/schema",
	out: "./migrations",
	dbCredentials: {
		url: resolveUrl(),
	},
});
