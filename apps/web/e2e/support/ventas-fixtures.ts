// Lectura de filas del vertical de ventas para los specs 10, 11 y 12 (T5 y T6 del port).
//
// Mismo criterio que `clientes-fixtures.ts`: `owner.ts` siembra el comprobante y lo borra, pero no
// devuelve la fila, y los casos de S11 necesitan afirmar lo que quedo ESCRITO (los montos que
// derivo el formulario con el 18 %, el estado, los dias de credito en NULL, la asignacion del
// pago que despues bloquea la edicion). Sin esto, el spec solo probaria lo que se ve en pantalla.
//
// Desde el slice 2 (S2) hay una segunda razon, y es la mas importante: el numero del comprobante ya
// no lo tipea el usuario, lo asigna la base desde la serie por defecto del tipo. La unica forma de
// afirmar "sin huecos" es leer la tabla `comprobante` (los numeros que quedaron escritos) y la
// tabla `voucher_series` (`last_number`, que avanzo la misma transaccion). Por eso este archivo
// tambien siembra series y las lee, incluidas las dadas de baja.
//
// El slice 3 agrega la lectura de NOTAS (`notesOf`): una nota es otra fila de `comprobante` con
// `referenced_comprobante_id` y `motive_code`, asi que el spec 12 afirma contra la misma tabla lo
// que la pantalla muestra y lo que la base escribio (el numero que asigno la serie, el motivo, el
// total y el tope).
//
// Todo es aditivo: no cambia ningun helper existente ni el baseline de conteos (`database.ts`).
// Las filas que el spec crea (por la UI o por fixtures) salen con el dueno en
// `deleteOwnerFixtures`, en el orden de FK que ya esta escrito ahi.
import { randomUUID } from "node:crypto";

import { APP_TODAY, type Owner } from "./owner";
import { psqlLines, psqlValue, sqlText } from "./psql";

/** Fila de `public.comprobante` que el spec necesita afirmar. */
export interface ComprobanteRow {
	id: string;
	voucherType: string;
	voucherNumber: string;
	/** `YYYY-MM-DD` (`date` sin hora). */
	issueDate: string;
	subtotal: number;
	igv: number;
	total: number;
	paymentType: string;
	/** `null` en CONTADO: la base guarda NULL, no 0 (S3). */
	creditDays: number | null;
	/** `null` en CONTADO: `due_date` es columna generada solo para CREDITO (S9). */
	dueDate: string | null;
	status: string;
	deletedAt: string | null;
}

/** Una asignacion de pago sobre el comprobante, con el estado del recibo que la respalda. */
export interface AllocationRow {
	paymentId: string;
	amount: number;
	paymentStatus: string;
}

/**
 * Columnas sin separador propio: `-t -A` devuelve una linea y los campos van con `|`.
 *
 * Los `numeric` y los `integer` se piden como texto (`::text`) porque es lo que devuelve el driver
 * sin ambiguedad de separador decimal; el parseo a numero lo hace este archivo, igual que
 * `clientes-fixtures.ts` con los booleanos.
 */
const COMPROBANTE_COLUMNS = [
	"id",
	"voucher_type::text",
	"voucher_number",
	"issue_date::text",
	"subtotal::text",
	"igv::text",
	"total::text",
	"payment_type::text",
	"coalesce(credit_days::text, '')",
	"coalesce(due_date::text, '')",
	"status::text",
	"coalesce(deleted_at::text, '')",
].join(" || '|' || ");

function uuidLiteral(value: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
		throw new Error(`No es un uuid: ${JSON.stringify(value)}`);
	}

	return sqlText(value);
}

function comprobanteRows(owner: Owner, where: string): ComprobanteRow[] {
	const sql =
		`select ${COMPROBANTE_COLUMNS} from public.comprobante ` +
		`where owner_id = ${sqlText(owner.id)} and ${where} order by created_at;\n`;

	return psqlLines(sql).map((line) => {
		const fields = line.split("|");

		if (fields.length !== 12) {
			throw new Error(
				`Fila de comprobante ilegible (${fields.length} campos): ${JSON.stringify(line)}`,
			);
		}

		const [
			id,
			voucherType,
			voucherNumber,
			issueDate,
			subtotal,
			igv,
			total,
			paymentType,
			creditDays,
			dueDate,
			status,
			deletedAt,
		] = fields as [
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
		];

		return {
			id,
			voucherType,
			voucherNumber,
			issueDate,
			subtotal: Number(subtotal),
			igv: Number(igv),
			total: Number(total),
			paymentType,
			creditDays: creditDays === "" ? null : Number(creditDays),
			dueDate: dueDate === "" ? null : dueDate,
			status,
			deletedAt: deletedAt === "" ? null : deletedAt,
		};
	});
}

/** La fila del dueno, por id. `null` si no existe (o si es de otro dueno). */
export function comprobanteById(owner: Owner, id: string): ComprobanteRow | null {
	return comprobanteRows(owner, `id = ${uuidLiteral(id)}`)[0] ?? null;
}

/**
 * Filas del dueno con ese numero de comprobante, borradas incluidas.
 *
 * Devuelve una lista porque el indice unico es textual (S7): `F001-1` y `F001-000001` son filas
 * distintas, y el spec afirma cuantas quedaron despues de un alta.
 */
export function comprobantesByNumber(owner: Owner, voucherNumber: string): ComprobanteRow[] {
	return comprobanteRows(owner, `voucher_number = ${sqlText(voucherNumber)}`);
}

/** La primera fila con ese numero, o `null`. Atajo para el caso de una sola. */
export function comprobanteByNumber(owner: Owner, voucherNumber: string): ComprobanteRow | null {
	return comprobantesByNumber(owner, voucherNumber)[0] ?? null;
}

/** Cuantas filas de `comprobante` tiene el dueno (vivas y marcadas). */
export function countOwnerComprobantes(owner: Owner): number {
	return Number(
		psqlValue(`select count(*) from public.comprobante where owner_id = ${sqlText(owner.id)};`),
	);
}

/** Valores de `status` que el spec necesita sembrar: son los del enum `comprobante_status`. */
export type VoucherFixtureStatus = "PENDIENTE" | "PAGADO";

/** Un comprobante de VENTA sembrado por SQL, para el listado. */
export interface InsertVentaInput {
	owner: Owner;
	/** La entidad tiene que ser del mismo dueno (`comprobante_owner_consistency`). */
	entityId: string;
	voucherNumber: string;
	total: number;
	/** Default `PENDIENTE`, que es el que deriva la tabla en un alta real. */
	status?: VoucherFixtureStatus;
}

/**
 * Siembra un comprobante de VENTA adicional, con el estado de pago que el caso necesite.
 *
 * Por que no `provisionFixtures` dos veces: su comprobante implica una entidad, y la segunda
 * entidad del mismo dueno choca con `entidad_document_unique_per_owner` (dos `SIN_DOCUMENTO` con
 * documento vacio). Este helper reusa la entidad de la primera fixture y solo agrega la fila.
 *
 * `PAGADO` es un estado que en produccion deriva `refresh_comprobante_status` al asignar pagos;
 * aca se escribe directo porque lo unico que el caso prueba es que la pantalla respeta el estado
 * que trae la fila (`Registrar pago` solo con `PENDIENTE`, S10).
 */
export function insertVenta(input: InsertVentaInput): ComprobanteRow {
	const id = randomUUID();
	const status: VoucherFixtureStatus = input.status ?? "PENDIENTE";

	if (status !== "PENDIENTE" && status !== "PAGADO") {
		throw new Error(`Estado de comprobante no soportado por la fixture: ${JSON.stringify(status)}`);
	}

	psqlLines(
		`insert into public.comprobante (id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, status, owner_id)
		 values ('${id}', ${uuidLiteral(input.entityId)}, 'VENTA', 'FACTURA', ${sqlText(input.voucherNumber)}, ${APP_TODAY}, ${input.total}, 0, ${input.total}, 'CONTADO', '${status}', ${sqlText(input.owner.id)});\n`,
	);

	const saved = comprobanteById(input.owner, id);

	if (!saved) {
		throw new Error(`El comprobante sembrado no quedo legible: ${JSON.stringify(input.voucherNumber)}`);
	}

	return saved;
}

/**
 * Asignaciones del comprobante, con el estado del recibo.
 *
 * Es la prueba de que el pago que bloquea la edicion (S5) quedo ESCRITO y de que
 * `voucher_balance` lo cuenta: el detalle muestra el abonado que calcula la base, no una resta del
 * navegador.
 */
export function allocationsOf(owner: Owner, comprobanteId: string): AllocationRow[] {
	const sql =
		"select a.payment_id::text || '|' || a.amount::text || '|' || p.status::text " +
		"from public.payment_allocation a join public.payment p on p.id = a.payment_id " +
		`where a.owner_id = ${sqlText(owner.id)} ` +
		`and a.comprobante_id = ${uuidLiteral(comprobanteId)} order by a.created_at;\n`;

	return psqlLines(sql).map((line) => {
		const fields = line.split("|");

		if (fields.length !== 3) {
			throw new Error(
				`Fila de asignacion ilegible (${fields.length} campos): ${JSON.stringify(line)}`,
			);
		}

		const [paymentId, amount, paymentStatus] = fields as [string, string, string];

		return { paymentId, amount: Number(amount), paymentStatus };
	});
}

/**
 * Notas de credito/debito aplicadas a un comprobante, de la mas vieja a la mas nueva.
 *
 * Es el contrato de fila del detalle (`GET /notes?voucherId=`) leido de la base: lo que el spec 12
 * afirma no es solo lo que la pantalla pinta, sino la fila que `public.crear_nota` escribio —con el
 * numero que asigno la serie del tipo— y el motivo del catalogo de S9. Se ordena por `created_at`
 * (el orden de emision) para que el caso del tope pueda afirmar cuantas notas quedaron.
 */
export interface NoteRow {
	id: string;
	/** `NOTA_CREDITO` / `NOTA_DEBITO`. */
	voucherType: string;
	voucherNumber: string;
	issueDate: string;
	/** Codigo del catalogo SUNAT de S9. En una nota nunca es `null`. */
	motiveCode: string | null;
	total: number;
}

const NOTE_COLUMNS = [
	"id",
	"voucher_type::text",
	"voucher_number",
	"issue_date::text",
	"coalesce(motive_code, '')",
	"total::text",
].join(" || '|' || ");

export function notesOf(owner: Owner, referencedComprobanteId: string): NoteRow[] {
	const sql =
		`select ${NOTE_COLUMNS} from public.comprobante ` +
		`where owner_id = ${sqlText(owner.id)} ` +
		`and referenced_comprobante_id = ${uuidLiteral(referencedComprobanteId)} ` +
		"order by created_at;\n";

	return psqlLines(sql).map((line) => {
		const fields = line.split("|");

		if (fields.length !== 6) {
			throw new Error(
				`Fila de nota ilegible (${fields.length} campos): ${JSON.stringify(line)}`,
			);
		}

		const [id, voucherType, voucherNumber, issueDate, motiveCode, total] = fields as [
			string,
			string,
			string,
			string,
			string,
			string,
		];

		return {
			id,
			voucherType,
			voucherNumber,
			issueDate,
			motiveCode: motiveCode === "" ? null : motiveCode,
			total: Number(total),
		};
	});
}

/**
 * Tipos que pueden tener serie: los CINCO que la app emite (S4 del slice 2 y S3 del slice 3).
 *
 * `NOTA_CREDITO` y `NOTA_DEBITO` entraron con el slice de notas: `public.crear_serie` los acepta
 * desde `20261127090000_notas_rpcs.sql` y son las series con las que la base numera una nota. El
 * `COMPROBANTE_RETENCION` sigue afuera: la RPC lo rechaza (`Los datos de la serie no son válidos.`)
 * hasta que exista el flujo que lo emite, asi que una fixture que lo pidiera solo podria fallar.
 */
export type SeriesVoucherType =
	| "FACTURA"
	| "BOLETA"
	| "NOTA_VENTA"
	| "NOTA_CREDITO"
	| "NOTA_DEBITO";

/** Los mismos cinco tipos, como lista, para validar la entrada de la fixture. */
const SERIES_VOUCHER_TYPES: SeriesVoucherType[] = [
	"FACTURA",
	"BOLETA",
	"NOTA_VENTA",
	"NOTA_CREDITO",
	"NOTA_DEBITO",
];

/** Fila de `public.voucher_series` que el spec necesita afirmar. */
export interface SeriesRow {
	id: string;
	voucherType: string;
	code: string;
	/** Ultimo correlativo usado: el proximo numero que asigna la base es `lastNumber + 1` (S2). */
	lastNumber: number;
	isDefault: boolean;
	/** `null` mientras la serie este viva; `eliminar_serie` escribe la fecha (S5). */
	deletedAt: string | null;
}

const SERIES_COLUMNS = [
	"id",
	"voucher_type::text",
	"code",
	"last_number::text",
	"is_default::text",
	"coalesce(deleted_at::text, '')",
].join(" || '|' || ");

/**
 * Filas de `voucher_series` del dueno, **dadas de baja incluidas**.
 *
 * Sin filtro por `deleted_at` a proposito: el borrado de una serie es LOGICO (S5), asi que la
 * unica prueba de que la baja dejo de existir para el usuario y siguio existiendo en la base es
 * ver la fila con su `deleted_at`. El orden es el del API (`por tipo y codigo`).
 */
export function seriesRows(owner: Owner): SeriesRow[] {
	const sql =
		`select ${SERIES_COLUMNS} from public.voucher_series ` +
		`where owner_id = ${sqlText(owner.id)} order by voucher_type, code;\n`;

	return psqlLines(sql).map((line) => {
		const fields = line.split("|");

		if (fields.length !== 6) {
			throw new Error(
				`Fila de serie ilegible (${fields.length} campos): ${JSON.stringify(line)}`,
			);
		}

		const [id, voucherType, code, lastNumber, isDefault, deletedAt] = fields as [
			string,
			string,
			string,
			string,
			string,
			string,
		];

		return {
			id,
			voucherType,
			code,
			lastNumber: Number(lastNumber),
			isDefault: isDefault === "true",
			deletedAt: deletedAt === "" ? null : deletedAt,
		};
	});
}

/**
 * La serie del dueno con ese tipo y codigo, o `null`. **Incluye las dadas de baja**: el caso de
 * baja logica de S8 necesita leer la fila que la pantalla ya no muestra.
 *
 * El codigo se normaliza a mayusculas porque es lo que hace la base (la RPC hace `btrim` y la
 * pantalla sube el caso al tipear).
 */
export function seriesByCode(
	owner: Owner,
	voucherType: SeriesVoucherType,
	code: string,
): SeriesRow | null {
	const normalized = code.trim().toUpperCase();

	return (
		seriesRows(owner).find(
			(row) => row.voucherType === voucherType && row.code === normalized,
		) ?? null
	);
}

/** Una serie sembrada por SQL, con el correlativo desde el que arranca. */
export interface InsertSeriesInput {
	owner: Owner;
	voucherType: SeriesVoucherType;
	/** 1 a 4 alfanumericos; el CHECK de la tabla es el juez (`^[A-Za-z0-9]{1,4}$`). */
	code: string;
	/** Ultimo correlativo ya usado. Default 0: la primera venta sera `-000001`. */
	lastNumber?: number;
	/** Default `false`. Marcar dos del mismo tipo choca con el indice unico parcial (S3). */
	isDefault?: boolean;
}

/**
 * Siembra una serie de comprobante.
 *
 * Por que por SQL y no por la pantalla: el alta por `/configuracion/series` la prueba el spec 11,
 * y el spec 10 necesita una serie ANTES de poder registrar la primera venta (S2/S11). Sembrarla
 * deja el caso de ventas midiendo lo suyo —que el numero lo asigne la base— sin depender de que la
 * pantalla de series este bien.
 *
 * `last_number` se escribe tal cual: es el contrato de la fixture (el caso afirma que la primera
 * venta sale `-000001` y la segunda `-000002`), no una simulacion del avance de la RPC.
 */
export function insertSeries(input: InsertSeriesInput): SeriesRow {
	const lastNumber = input.lastNumber ?? 0;
	const isDefault = input.isDefault ?? false;

	if (!SERIES_VOUCHER_TYPES.includes(input.voucherType)) {
		throw new Error(`Tipo de serie no soportado por la fixture: ${JSON.stringify(input.voucherType)}`);
	}

	if (!Number.isInteger(lastNumber) || lastNumber < 0) {
		throw new Error(`lastNumber invalido para la fixture: ${JSON.stringify(lastNumber)}`);
	}

	const id = randomUUID();

	psqlLines(
		`insert into public.voucher_series (id, owner_id, voucher_type, code, last_number, is_default)
		 values ('${id}', ${sqlText(input.owner.id)}, '${input.voucherType}', ${sqlText(input.code.trim().toUpperCase())}, ${lastNumber}, ${isDefault});\n`,
	);

	const saved = seriesRows(input.owner).find((row) => row.id === id);

	if (!saved) {
		throw new Error(`La serie sembrada no quedo legible: ${JSON.stringify(input.code)}`);
	}

	return saved;
}
