// Handle de base de datos como provider de Nest (S2).
//
// La cadena de conexion llega SOLO por entorno (`DATABASE_URL`); este paquete no trae un
// default, no la imprime y no la persiste. `pg.Pool` no abre conexiones al construirse, asi
// que el proceso puede arrancar sin base arriba.
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/** Token del handle de Drizzle. Se inyecta con `@Inject(DATABASE)`. */
export const DATABASE = Symbol("DATABASE");

/** Token del pool de `pg` (para cerrarlo en el shutdown, no para consultar). */
export const PG_POOL = Symbol("PG_POOL");

export type Database = NodePgDatabase<typeof schema>;

/** Transaccion de Drizzle; es lo que recibe el callback de `withOwner`. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createPool(): Pool {
	const connectionString = process.env.DATABASE_URL?.trim();

	if (!connectionString) {
		throw new Error(
			"Falta DATABASE_URL: apps/api no inventa ni persiste una cadena de conexion. " +
				"Exportala en el entorno antes de arrancar el servicio.",
		);
	}

	const max = Number(process.env.DATABASE_POOL_MAX ?? 10);

	return new Pool({ connectionString, max: Number.isFinite(max) && max > 0 ? max : 10 });
}

export function createDatabase(pool: Pool): Database {
	return drizzle(pool, { schema });
}
