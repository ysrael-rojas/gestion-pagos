// Acceso a la base del e2e con el MISMO transporte doble que `packages/db/scripts/verify-rls.mjs`.
//
// Las fixtures del suite (usuario desechable, cuenta de caja, comprobante) no tienen ruta de API
// en este port: `apps/web` solo puede leer catalogos y `apps/api` no expone escritura de cuentas
// ni de comprobantes (T5c). Sembrarlas por SQL es la unica via, y es la misma que usan los seeds.
//
// Transportes, elegidos una sola vez por corrida:
//   url    -> `psql` local contra `DATABASE_URL`. Es el camino del CI (instala postgresql-client).
//   docker -> `docker exec -i <contenedor> psql`: las credenciales de la base de desarrollo
//             nunca salen del contenedor. Es el camino local del compose.
//
// La eleccion: `E2E_DB_TRANSPORT` si esta, si no `url` cuando hay `DATABASE_URL` y un psql
// alcanzable (`PSQL_BIN` o `psql` en el PATH), si no `docker`. El setup global imprime cual se
// uso y verifica que apunte a la MISMA base que `DATABASE_URL` (el API usa esa y las fixtures no
// pueden vivir en otra).
//
// Solo se piden columnas unicas: con `-t -A` cada linea de stdout es un valor. Asi no hace falta
// elegir un separador de campos y no hay comillas ni escapes que interpretar.
import { spawnSync } from "node:child_process";
import { databaseUrl, isOnPath } from "./env";

export interface PsqlTransport {
	kind: "url" | "docker";
	/** Texto para los mensajes: cual camino se uso. */
	label: string;
	program: string;
	args: string[];
}

/** Valida un nombre de contenedor antes de pasarlo a docker (no se interpreta en un shell). */
function containerName(value: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
		throw new Error(`DB_CONTAINER no es un nombre de contenedor valido: ${JSON.stringify(value)}`);
	}

	return value;
}

export function resolveTransport(): PsqlTransport {
	const forced = process.env.E2E_DB_TRANSPORT?.trim();
	const psqlBinary = process.env.PSQL_BIN?.trim() || (isOnPath("psql") ? "psql" : null);
	const hasUrl = Boolean(process.env.DATABASE_URL?.trim());

	const useUrl =
		forced === "url" ? true : forced === "docker" ? false : hasUrl && psqlBinary !== null;

	if (useUrl) {
		if (!psqlBinary) {
			throw new Error(
				"E2E_DB_TRANSPORT=url necesita un psql alcanzable: defini PSQL_BIN o pone psql en el PATH.",
			);
		}

		return {
			kind: "url",
			label: `psql local contra DATABASE_URL (${psqlBinary})`,
			program: psqlBinary,
			args: ["-X", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-d", databaseUrl()],
		};
	}

	const container = containerName(process.env.DB_CONTAINER?.trim() || "gestion-pagos-db-dev");
	const remote = 'psql -X -t -A -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"';

	return {
		kind: "docker",
		label: `docker exec -i ${container} sh -c '${remote}'`,
		program: process.env.DOCKER?.trim() || "docker",
		args: ["exec", "-i", container, "sh", "-c", remote],
	};
}

/**
 * Corre SQL por stdin y devuelve una linea por valor devuelto.
 *
 * `ON_ERROR_STOP=1` y exit distinto de 0 son error duro: una fixture que no se creo no puede
 * dejar el spec corriendo contra un estado a medias.
 */
export function psqlLines(sql: string, transport: PsqlTransport = resolveTransport()): string[] {
	const result = spawnSync(transport.program, transport.args, {
		input: sql,
		encoding: "utf8",
		env: process.env,
		maxBuffer: 32 * 1024 * 1024,
	});

	if (result.error) {
		throw new Error(`No se pudo ejecutar psql (${transport.label}): ${result.error.message}`);
	}

	if (result.status !== 0) {
		throw new Error(
			`psql fallo (${transport.label}), exit ${result.status}:\n${(result.stderr || "").trim()}`,
		);
	}

	return (result.stdout ?? "")
		.split(/\r?\n/)
		.filter((line) => line.length > 0);
}

/** Corre SQL por stdin y devuelve la primera columna de la primera fila. Falla si no hay fila. */
export function psqlValue(sql: string, transport?: PsqlTransport): string {
	const lines = psqlLines(sql, transport);
	const value = lines[0];

	if (value === undefined || value === "") {
		throw new Error(`La consulta no devolvio ningun valor:\n${sql.trim()}`);
	}

	return value;
}

/** Literal de texto SQL. Los valores del suite son uuids, correos y nombres generados aca. */
export function sqlText(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}
