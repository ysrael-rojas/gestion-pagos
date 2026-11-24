// Lectura de filas del vertical de ventas para el spec 10 (T5 del port).
//
// Mismo criterio que `clientes-fixtures.ts`: `owner.ts` siembra el comprobante y lo borra, pero no
// devuelve la fila, y los casos de S11 necesitan afirmar lo que quedo ESCRITO (los montos que
// derivo el formulario con el 18 %, el estado, los dias de credito en NULL, la asignacion del
// pago que despues bloquea la edicion). Sin esto, el spec solo probaria lo que se ve en pantalla.
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
