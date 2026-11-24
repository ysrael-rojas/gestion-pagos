// Conteo de filas de las tablas sembradas, y el contrato de "el suite no dejo basura".
//
// El e2e crea usuarios desechables y fixtures propias en la MISMA base de desarrollo que usa
// `apps/api` (no hay una base por corrida: la crearia `packages/db`, que esta fuera del alcance de
// esta tarea). Por eso la unica prueba de que cada spec limpio lo suyo es medir: el setup global
// toma el conteo antes de correr y el teardown global lo vuelve a medir despues. Cualquier
// diferencia falla la corrida.
//
// `receipt_sequence` se cuenta por filas (una por direccion), no por valor: `last_serial` es un
// contador monotono que un alta real tiene que avanzar, y pedir que vuelva atras seria pedir que
// la funcionalidad no funcione.
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { REPO_ROOT } from "./env";
import { psqlLines } from "./psql";

/** Tablas cuyo conteo tiene que volver al baseline. */
export const COUNTED_TABLES = [
	"public.entidad",
	"public.comprobante",
	// Series de comprobante (slice 2, S3): el spec 10 siembra una para poder registrar la primera
	// venta y el spec 11 crea, edita y da de baja por la pantalla. Sin contarla, una fila que el
	// teardown olvidara se acumularia en silencio (L5 del vertical de cajas-bancos).
	"public.voucher_series",
	"public.payment",
	"public.payment_allocation",
	"public.cash_account",
	"public.cash_receipt_category",
	"public.payment_method",
	"public.receipt_sequence",
	// Vertical de cajas y bancos (C8): las mismas tablas que `deleteOwnerFixtures` limpia para el
	// vertical. Una tabla que el teardown borra y el baseline no cuenta es una fuga silenciosa: el
	// suite queda verde mientras las filas se acumulan (L5 del doc del vertical).
	"public.cash_close",
	"public.cash_close_denomination",
	"public.cash_count",
	"public.cash_count_denomination",
	"public.cash_transfer",
	"public.petty_cash_vale",
	"public.bank_reconciliation",
	"public.bank_reconciliation_item",
	// Sin FK a `auth.users` (`20261006063301`): si el teardown la olvida, borrar el dueno no deja
	// rastro y solo el conteo lo delata (L8).
	"public.app_setting",
	"auth.users",
	"auth.session",
	"auth.account",
] as const;

export type TableCounts = Record<string, number>;

/** Baseline guardado entre el setup y el teardown globales. Vive en `.cache/`, gitignored. */
export const BASELINE_FILE = join(REPO_ROOT, ".cache", "tmp", "e2e-row-baseline.json");

/** Conteo real de cada tabla contada. Una consulta, una columna, una linea por tabla. */
export function measureCounts(): TableCounts {
	const sql = `${COUNTED_TABLES.map(
		(table) => `select '${table}=' || (select count(*) from ${table})`,
	).join("\nunion all\n")};\n`;

	const counts: TableCounts = {};

	for (const line of psqlLines(sql)) {
		const separator = line.lastIndexOf("=");
		const table = line.slice(0, separator);
		const value = Number(line.slice(separator + 1));

		if (!Number.isInteger(value)) {
			throw new Error(`psql devolvio un conteo ilegible para ${table}: ${JSON.stringify(line)}`);
		}

		counts[table] = value;
	}

	const missing = COUNTED_TABLES.filter((table) => counts[table] === undefined);

	if (missing.length > 0) {
		throw new Error(`El conteo no incluyo estas tablas: ${missing.join(", ")}`);
	}

	return counts;
}

/** Lineas legibles con las diferencias entre dos conteos. Vacio = identicos. */
export function countDifferences(baseline: TableCounts, current: TableCounts): string[] {
	const tables = [...new Set([...Object.keys(baseline), ...Object.keys(current)])].sort();

	return tables
		.filter((table) => baseline[table] !== current[table])
		.map((table) => `${table}: baseline ${baseline[table]} -> ahora ${current[table]}`);
}

export function saveBaseline(counts: TableCounts): void {
	mkdirSync(dirname(BASELINE_FILE), { recursive: true });
	writeFileSync(BASELINE_FILE, `${JSON.stringify(counts, null, 2)}\n`, "utf8");
}

export function loadBaseline(): TableCounts {
	const raw = readFileSync(BASELINE_FILE, "utf8");
	const parsed: unknown = JSON.parse(raw);

	if (parsed === null || typeof parsed !== "object") {
		throw new Error("El baseline de conteos no es un objeto JSON.");
	}

	return parsed as TableCounts;
}

export function removeBaseline(): void {
	try {
		unlinkSync(BASELINE_FILE);
	} catch {
		// No existia: el teardown no puede fallar por eso.
	}
}

/** `tabla=fila, tabla=fila` en el orden de `COUNTED_TABLES`, para los mensajes del runner. */
export function describeCounts(counts: TableCounts): string {
	return COUNTED_TABLES.map((table) => `${table.replace(/^.*\./, "")}=${counts[table]}`).join(
		", ",
	);
}
