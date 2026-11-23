// Fixtures y lectura de filas para el vertical de clientes (spec 08).
//
// Por que existe, en vez de reusar `owner.ts`:
//
// 1. El indice unico de documento de `entidad` es POR DUENO (`(owner_id, document_type,
//    document_number)` desde `20261123030000_entidad_document_unique_per_owner.sql`). Cada spec
//    corre con un dueno desechable, asi que dos corridas no se pisan. Los numeros se siguen
//    generando por corrida para que el spec no dependa de que un numero fijo este libre dentro de
//    SU dueno.
// 2. Las pruebas de S4 (baja logica: la fila queda MARCADA, no borrada) y de la entrada rechazada
//    ("no deja fila") necesitan mirar `public.entidad` despues de la accion. Los helpers de
//    `owner.ts` siembran entidades pero no devuelven la fila.
//
// Todo lo de este archivo es aditivo: no cambia ningun helper existente ni el baseline de conteos
// (`database.ts`). Las filas que se crean por la UI se borran en el teardown del dueno
// (`deleteOwnerFixtures`), que elimina tambien las marcadas con `deleted_at`.
import { randomInt } from "node:crypto";

import type { Owner } from "./owner";
import { psqlLines, psqlValue, sqlText } from "./psql";

/** Los valores del enum `document_type` de la tabla (espejo local: el e2e no importa la app). */
export type DocumentType = "RUC" | "DNI" | "CARNET_EXTRANJERIA" | "SIN_DOCUMENTO";

/** Filas de `public.entidad` que el spec necesita afirmar. */
export interface EntidadRow {
	id: string;
	name: string;
	documentType: string;
	documentNumber: string;
	isSupplier: boolean;
	/** `null` = viva. Cualquier texto = la baja logica la marco. */
	deletedAt: string | null;
}

/** Solo se piden columnas sin separador propio: `-A` devuelve una linea y los campos van con `|`. */
const ENTIDAD_COLUMNS = [
	"id",
	"name",
	"document_type",
	"document_number",
	"is_supplier::text",
	"coalesce(deleted_at::text, '')",
].join(" || '|' || ");

function uuidLiteral(value: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
		throw new Error(`No es un uuid: ${JSON.stringify(value)}`);
	}

	return sqlText(value);
}

/**
 * RUC de 11 digitos distinto en cada corrida.
 *
 * Prefijo `99`: la demo usa RUCs reales (`20…`), asi que un numero generado no se confunde con
 * uno sembrado al leer filas por documento. El resto es al azar sobre 10^9; la unicidad es por
 * dueno, de modo que el prefijo es legibilidad y no una defensa contra colisiones entre duenos.
 */
export function randomRuc(): string {
	return `99${Array.from({ length: 9 }, () => randomInt(0, 10)).join("")}`;
}

/** DNI de 8 digitos, con el mismo criterio que `randomRuc`. */
export function randomDni(): string {
	return Array.from({ length: 8 }, () => randomInt(0, 10)).join("");
}

function entidadRows(owner: Owner, where: string): EntidadRow[] {
	const sql =
		`select ${ENTIDAD_COLUMNS} from public.entidad ` +
		`where owner_id = ${sqlText(owner.id)} and ${where} order by created_at;\n`;

	return psqlLines(sql).map((line) => {
		const fields = line.split("|");

		if (fields.length !== 6) {
			throw new Error(`Fila de entidad ilegible (${fields.length} campos): ${JSON.stringify(line)}`);
		}

		const [id, name, documentType, documentNumber, isSupplier, deletedAt] = fields as [
			string,
			string,
			string,
			string,
			string,
			string,
		];

		return {
			id,
			name,
			documentType,
			documentNumber,
			isSupplier: isSupplier === "true",
			deletedAt: deletedAt === "" ? null : deletedAt,
		};
	});
}

/** La fila del dueno, por id. `null` si no existe (o si es de otro dueno). */
export function entidadById(owner: Owner, id: string): EntidadRow | null {
	return entidadRows(owner, `id = ${uuidLiteral(id)}`)[0] ?? null;
}

/**
 * Filas del dueno con ese documento, borradas incluidas.
 *
 * Devuelve una lista a proposito: el spec afirma cuantas quedaron (0 = rechazo, 1 = conflicto sin
 * alta nueva).
 */
export function entidadesByDocument(
	owner: Owner,
	documentType: DocumentType,
	documentNumber: string,
): EntidadRow[] {
	return entidadRows(
		owner,
		`document_type = ${sqlText(documentType)} and document_number = ${sqlText(documentNumber)}`,
	);
}

/** Cuantas filas de `entidad` tiene el dueno (vivas y marcadas). */
export function countOwnerEntidades(owner: Owner): number {
	return Number(
		psqlValue(`select count(*) from public.entidad where owner_id = ${sqlText(owner.id)};`),
	);
}

/**
 * `true` si el comprobante sigue en la tabla.
 *
 * Es la otra mitad de S4: la baja del cliente no arrastra lo que lo referencia (el port hereda el
 * soft delete sin guard ni cascada).
 */
export function comprobanteExists(owner: Owner, comprobanteId: string): boolean {
	const value = psqlValue(
		`select count(*) from public.comprobante where owner_id = ${sqlText(owner.id)} and id = ${uuidLiteral(comprobanteId)};`,
	);

	return value === "1";
}
