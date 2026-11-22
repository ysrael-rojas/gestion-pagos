// Ejecuta el suite de auditoria de RLS (`seeds/verify-owner-consistency.sql`) y clasifica su
// salida.
//
// Por que hace falta un runner: el archivo es un suite de aserciones NEGATIVAS. Los BLOQUEs 1 a
// 5 DEBEN fallar (42501) y el BLOQUE 6 DEBE pasar. Con `ON_ERROR_STOP=1` psql aborta en el
// primer fallo esperado, asi que la unica forma de correr el suite completo es con
// `ON_ERROR_STOP=0` -- y entonces psql termina con exit 0 aunque las aserciones fallen. Este
// runner pone esa red: corre el archivo entero y afirma el resultado exacto.
//
// Resultado esperado (tabla de S19 tras los grants de T4b; medido contra PostgreSQL 18):
//   BLOQUE 1   42501  La cuenta de caja no existe
//   BLOQUE 2   42501  La asignacion referencia un pago o comprobante de otro usuario
//   BLOQUE 3a  42501  El cierre referencia una cuenta de otro usuario
//   BLOQUE 3b  42501  El cierre referencia una cuenta de otro usuario
//   BLOQUE 4a  42501  La transferencia referencia una cuenta de otro usuario
//   BLOQUE 4b  42501  La transferencia referencia una cuenta de otro usuario
//   BLOQUE 5   42501  El comprobante referencia una entidad o comprobante de otro usuario
//   BLOQUE 6   exito  (su bloque `do $$ ... $$` imprime la etiqueta `DO`)
//
// Por que 2, 3a, 4a y 5 ya no dicen `permission denied`: al conceder los privilegios de tabla a
// `authenticated` (migracion 20261029101500_better_auth_tables_and_role_grants.sql), la escritura
// cruzada deja de morir por falta de privilegio y la rechaza el trigger de consistencia del
// dominio. Sigue siendo 42501 y ahora prueba la capa correcta.
//
// Reglas: no se suprime ni se reescribe ningun mensaje. El runner solo
//   1. antepone `\set VERBOSITY verbose` a la entrada de psql, para que la salida incluya el
//      SQLSTATE de cada error (sin eso psql imprime solo el mensaje),
//   2. clasifica lo que psql imprimio.
// Cualquier error inesperado, o un error esperado que falte, falla con exit 1 nombrando el
// BLOQUE. El archivo de auditoria no se modifica.
//
// Transporte: el runner corre en el host y llega a psql por `docker exec` (las credenciales
// nunca salen del contenedor). Variables:
//   DB_CONTAINER  contenedor (default: gestion-pagos-db-dev)
//   DB_NAME       base a auditar (default: gestion_verify)
//   DB_USER       usuario de psql (default: $POSTGRES_USER dentro del contenedor)
//   DOCKER        binario de docker (default: docker; en esta maquina no esta en PATH)
//   DATABASE_URL  si esta definida, se usa psql local contra esa cadena en vez de docker exec.
//                 Es el camino del CI (y de cualquier host sin Docker): el suite, la tabla
//                 EXPECTED y el analisis de la salida son los mismos; solo cambia el transporte.
//   PSQL_BIN      binario de psql para el camino de DATABASE_URL (default: psql). El CI instala
//                 el cliente de postgres; aca apunta a la instalacion local.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const auditPath = join(here, "..", "seeds", "verify-owner-consistency.sql");

const EXPECTED = [
	{ block: "BLOQUE 1", sqlstate: "42501", message: "La cuenta de caja no existe" },
	{
		block: "BLOQUE 2",
		sqlstate: "42501",
		message: "La asignacion referencia un pago o comprobante de otro usuario",
	},
	{ block: "BLOQUE 3a", sqlstate: "42501", message: "El cierre referencia una cuenta de otro usuario" },
	{
		block: "BLOQUE 3b",
		sqlstate: "42501",
		message: "El cierre referencia una cuenta de otro usuario",
	},
	{
		block: "BLOQUE 4a",
		sqlstate: "42501",
		message: "La transferencia referencia una cuenta de otro usuario",
	},
	{
		block: "BLOQUE 4b",
		sqlstate: "42501",
		message: "La transferencia referencia una cuenta de otro usuario",
	},
	{
		block: "BLOQUE 5",
		sqlstate: "42501",
		message: "El comprobante referencia una entidad o comprobante de otro usuario",
	},
];

const identifier = (value, name) => {
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
		throw new Error(`${name} no es un identificador valido: ${JSON.stringify(value)}`);
	}
	return value;
};

// El nombre del contenedor va como argumento de `docker exec` (no se interpreta en un shell),
// pero se valida igual para no pasarle a docker algo inesperado. Acepta `-`, `.` y `_`.
const containerName = (value) => {
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) {
		throw new Error(`DB_CONTAINER no es un nombre de contenedor valido: ${JSON.stringify(value)}`);
	}
	return value;
};

function resolveInvocation() {
	const databaseUrl = process.env.DATABASE_URL;
	if (databaseUrl) {
		return {
			program: process.env.PSQL_BIN ?? "psql",
			args: ["-X", "-v", "ON_ERROR_STOP=0", "-d", databaseUrl],
			label: "psql local (DATABASE_URL)",
		};
	}

	const container = containerName(process.env.DB_CONTAINER ?? "gestion-pagos-db-dev");
	const database = identifier(process.env.DB_NAME ?? "gestion_verify", "DB_NAME");
	const user = process.env.DB_USER
		? `-U ${identifier(process.env.DB_USER, "DB_USER")}`
		: '-U "$POSTGRES_USER"';
	const remote = `psql -X -v ON_ERROR_STOP=0 ${user} -d ${database} 2>&1`;

	return {
		program: process.env.DOCKER ?? "docker",
		args: ["exec", "-i", container, "sh", "-c", remote],
		label: `docker exec -i ${container} sh -c '${remote}'`,
	};
}

// `\set VERBOSITY verbose` es lo unico que agrega el runner a la sesion: sin el, psql imprime
// `ERROR:  <mensaje>` y el SQLSTATE se pierde. El archivo de auditoria se envia sin cambios.
const sql = `\\set VERBOSITY verbose\n${readFileSync(auditPath, "utf8")}`;

const invocation = resolveInvocation();
const run = spawnSync(invocation.program, invocation.args, {
	input: sql,
	encoding: "utf8",
	maxBuffer: 16 * 1024 * 1024,
});

if (run.error) {
	console.error(`verify-rls: no se pudo ejecutar ${invocation.program}: ${run.error.message}`);
	if (run.error.code === "ENOENT" && process.env.DATABASE_URL) {
		console.error(
			"verify-rls: el camino de DATABASE_URL usa un psql local. Instala el cliente de postgres \n" +
				"o define PSQL_BIN con la ruta absoluta del binario.",
		);
	} else if (run.error.code === "ENOENT") {
		console.error("verify-rls: define DOCKER con la ruta absoluta del binario de docker.");
	}
	process.exit(1);
}

const output = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
const lines = output.split(/\r?\n/);
const errors = [];
for (const line of lines) {
	const match = /^ERROR:\s+(?:([0-9A-Z]{5}):\s+)?(.*)$/.exec(line);
	if (match) errors.push({ sqlstate: match[1] ?? null, message: match[2].trim() });
}

// El BLOQUE 6 no imprime NOTICE propio: su exito se observa en la etiqueta `DO` que psql emite
// al terminar el bloque `do $$ ... $$` (si el bloque falla, psql imprime ERROR y no hay `DO`).
const blockSixSucceeded = lines.some((line) => line === "DO");

const failures = [];

if (run.status !== 0) {
	failures.push(
		`psql termino con exit ${run.status} (se esperaba 0 con ON_ERROR_STOP=0); salida final:\n${lines
			.filter((line) => line.trim() !== "")
			.slice(-8)
			.map((line) => `    ${line}`)
			.join("\n")}`,
	);
}

for (const [index, expected] of EXPECTED.entries()) {
	const observed = errors[index];
	if (!observed) {
		failures.push(
			`${expected.block}: no se observo el error esperado ${expected.sqlstate}: ${expected.message}`,
		);
		continue;
	}
	if (observed.sqlstate !== expected.sqlstate || observed.message !== expected.message) {
		failures.push(
			`${expected.block}: se esperaba ${expected.sqlstate}: ${expected.message}\n` +
				`    se observo  ${observed.sqlstate ?? "(sin SQLSTATE)"}: ${observed.message}`,
		);
	}
}

if (errors.length > EXPECTED.length) {
	const extra = errors.slice(EXPECTED.length);
	for (const observed of extra) {
		failures.push(
			`BLOQUE 6: error inesperado ${observed.sqlstate ?? "(sin SQLSTATE)"}: ${observed.message}`,
		);
	}
}

if (!blockSixSucceeded) {
	failures.push("BLOQUE 6: no llego a completarse (psql no imprimio la etiqueta DO)");
}

const report = (blocks) => {
	console.log(`verify-rls: ${auditPath}`);
	console.log(`verify-rls: ${invocation.label}`);
	for (const line of blocks) console.log(line);
};

if (failures.length > 0) {
	report(
		EXPECTED.map((expected, index) => {
			const observed = errors[index];
			const state =
				observed &&
				observed.sqlstate === expected.sqlstate &&
				observed.message === expected.message
					? "ok"
					: "FALLO";
			return `  ${expected.block.padEnd(10)} ${state.padEnd(6)} ${expected.sqlstate} ${expected.message}`;
		}).concat([
			`  ${"BLOQUE 6".padEnd(10)} ${(blockSixSucceeded ? "ok" : "FALLO").padEnd(6)} flujo del owner real`,
		]),
	);
	for (const failure of failures) console.error(`verify-rls: ${failure}`);
	process.exit(1);
}

report(
	EXPECTED.map((expected) => `  ${expected.block.padEnd(10)} ok     42501 ${expected.message}`).concat([
		`  ${"BLOQUE 6".padEnd(10)} ok     el flujo del owner real se completo (DO)`,
	]),
);
console.log(
	`verify-rls: ${EXPECTED.length} fallos esperados + BLOQUE 6 en exito. ${errors.length} error(es) observado(s).`,
);
