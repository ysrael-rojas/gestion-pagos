// Servicio del vertical notas (T3 del port de notas; S1, S4 y S10 de
// `odd/tasks/port-vertical-notas.md`).
//
// Que hace: dar de alta una nota de credito/debito sobre un comprobante de venta y listar las notas
// de un comprobante. Nada mas: una nota no se edita ni se da de baja (S7), porque su tipo y su
// referencia son inmutables por trigger y porque el comprobante se corrige con OTRA nota.
//
// Tres decisiones que no son de estilo:
//
// 1. LA ESCRITURA VA POR RPC, NO POR DML (S2/S3). El alta escribe DOS filas de dos tablas con el rol
//    de la sesion: el comprobante y el avance de `voucher_series.last_number`. `authenticated` no
//    tiene INSERT/UPDATE sobre `comprobante` ni UPDATE sobre `voucher_series`
//    (`20261124090000_revoke_payments_writes.sql`), y el numero lo asigna la base desde la serie por
//    defecto del TIPO DE LA NOTA en la misma transaccion (`public.crear_nota`,
//    `20261127090000_notas_rpcs.sql`). Se llama con `withOwner`, que fija `app.user_id` y cambia el
//    rol a `authenticated` antes del `select` — el mismo camino que `vouchers.service.ts`,
//    `series.service.ts` y `cash/closes.service.ts`. El dueno NUNCA viaja en el body.
//
// 2. LOS MONTOS NO SE CALCULAN ACA (S4): salen de `saleAmounts` de `packages/shared`, la unica
//    formula del 18 % con redondeo a 2 decimales, y se mandan ya calculados. Recalcularlos en
//    PL/pgSQL seria una segunda formula de la misma regla.
//
// 3. EL LISTADO ES UNA LECTURA APARTE DEL DETALLE DEL COMPROBANTE (S1). `GET /notes?voucherId=` lee
//    los ajustes de un comprobante; el detalle de la venta sigue siendo `GET /vouchers/:id` de
//    `VouchersModule`. Separarlos evita que este modulo publique rutas bajo `/vouchers`, que es el
//    prefijo que ya se atiende en otro modulo y donde el orden de registro decide quien responde
//    (`GET /vouchers/open` vs `GET /vouchers/:id`).
//
// El `status` de la nota no se escribe desde aca: `crear_nota` la inserta `PAGADO` porque una nota no
// es cobrable ni pagable (S4), y `voucher_balance` ya la excluye de su `where`.
import { Inject, Injectable } from "@nestjs/common";
import type { VoucherAdjustmentRow } from "@gestion/shared/lib/schemas/nota.ts";
import type { VoucherType } from "@gestion/shared/components/comprobantes/types.ts";
import { saleAmounts } from "@gestion/shared/lib/ventas/montos.ts";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { withOwner } from "../db/with-owner";
import { comprobante as comprobanteAjuste } from "../db/schema";
import { toNoteHttpException } from "./notes.errors.ts";
import type { NoteCreateBody } from "./notes.query.ts";

/**
 * Los dos tipos de ajuste de este modulo (S1). `COMPROBANTE_RETENCION` queda fuera: tiene su propio
 * slice y no lleva motivo, asi que una fila suya no cumple el contrato de fila del detalle.
 */
const NOTE_VOUCHER_TYPES: VoucherType[] = ["NOTA_CREDITO", "NOTA_DEBITO"];

/** Los dos tipos del contrato de fila, como tipo estrecho para el mapper. */
type NoteVoucherType = VoucherAdjustmentRow["voucherType"];

/** Fila de `comprobante` tal como la devuelve Drizzle (`numeric` y `date` como string). */
interface NoteRow {
	id: string;
	voucherType: VoucherType;
	voucherNumber: string;
	issueDate: string;
	motiveCode: string | null;
	total: string;
}

/** Las columnas del contrato de fila, una sola vez para las dos lecturas. */
const NOTE_COLUMNS = {
	id: comprobanteAjuste.id,
	voucherType: comprobanteAjuste.voucherType,
	voucherNumber: comprobanteAjuste.voucherNumber,
	issueDate: comprobanteAjuste.issueDate,
	motiveCode: comprobanteAjuste.motiveCode,
	total: comprobanteAjuste.total,
};

/** El `where` que define "una nota visible para esta sesion sobre este comprobante". */
function visibleNotesOf(ownerId: string, referencedComprobanteId: string) {
	return and(
		eq(comprobanteAjuste.ownerId, ownerId),
		eq(comprobanteAjuste.referencedComprobanteId, referencedComprobanteId),
		inArray(comprobanteAjuste.voucherType, NOTE_VOUCHER_TYPES),
		isNull(comprobanteAjuste.deletedAt),
	);
}

/** `VoucherAdjustmentRow['voucherType']` es el enum de los dos tipos de nota del contrato. */
function isNoteVoucherType(value: VoucherType): value is NoteVoucherType {
	return NOTE_VOUCHER_TYPES.some((note) => note === value);
}

/**
 * Fila -> contrato de salida (`voucherAdjustmentSchema`).
 *
 * La comprobacion del tipo no es defensa contra el usuario: la query ya filtro los dos tipos. Es el
 * borde donde el contrato y el enum de seis valores de la tabla se encuentran, y preferimos un 500
 * honesto a devolver un tipo que el tipo de retorno no declara.
 */
function toNoteRow(row: NoteRow): VoucherAdjustmentRow {
	if (!isNoteVoucherType(row.voucherType)) {
		throw new Error(
			`comprobante devolvio un tipo que el detalle no lista: ${row.voucherType}`,
		);
	}

	return {
		id: row.id,
		voucherType: row.voucherType,
		voucherNumber: row.voucherNumber,
		issueDate: row.issueDate,
		motiveCode: row.motiveCode,
		// `numeric` -> number solo en el borde JSON, igual que en los otros verticales.
		total: Number(row.total),
	};
}

@Injectable()
export class NotesService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `POST /notes` — alta por `public.crear_nota` (7 argumentos, S3/S4).
	 *
	 * Argumentos de `20261127090000_notas_rpcs.sql`, en ese orden: el comprobante referenciado, el
	 * tipo de la nota, la fecha de emision, subtotal, igv, total y el motivo. No viajan el numero (lo
	 * asigna la base), el dueno (sale de `auth.uid()`) ni los datos heredados del referenciado
	 * (`entity_id`, `voucher_kind`, `payment_type`, `credit_days`), ni el `status` (S4).
	 *
	 * La respuesta se RELEE en la misma transaccion: muestra exactamente la fila que quedo escrita
	 * —con el numero que asigno la serie del tipo de la nota— y no un eco del payload, que ni siquiera
	 * trae numero.
	 */
	async create(ownerId: string, body: NoteCreateBody): Promise<VoucherAdjustmentRow> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const { subtotal, igv } = saleAmounts(body.total);
				const result = await tx.execute<{ id: string }>(sql`
					select public.crear_nota(
						${body.referencedComprobanteId}::uuid,
						${body.voucherType}::public.voucher_type,
						${body.issueDate}::date,
						${subtotal}::numeric,
						${igv}::numeric,
						${body.total}::numeric,
						${body.motiveCode ?? ""}::text
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("crear_nota no devolvio el id de la nota.");
				}

				return this.rowWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toNoteHttpException(error);
		}
	}

	/**
	 * `GET /notes?voucherId=` — las notas de credito/debito de un comprobante, de la emision mas
	 * reciente a la mas vieja y desempatando por numero (el orden del origen).
	 *
	 * Un comprobante sin notas, uno de otro dueno y uno inexistente devuelven la MISMA lista vacia: la
	 * RLS ya hace invisibles las filas ajenas y este listado no filtra su existencia. El 404 de S10 es
	 * del ALTA, que si tiene que decir por que no pudo escribir.
	 */
	async list(ownerId: string, referencedComprobanteId: string): Promise<VoucherAdjustmentRow[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select(NOTE_COLUMNS)
					.from(comprobanteAjuste)
					.where(visibleNotesOf(ownerId, referencedComprobanteId))
					.orderBy(desc(comprobanteAjuste.issueDate), asc(comprobanteAjuste.voucherNumber));

				return rows.map(toNoteRow);
			});
		} catch (error) {
			throw toNoteHttpException(error);
		}
	}

	/**
	 * Lectura de la fila recien escrita, por id y con el mismo universo que el listado.
	 *
	 * Si no aparece es que la RPC devolvio un id que este modulo no puede leer, y eso no es un 404 del
	 * usuario: es un 500 explicito con el generico, por el mismo criterio que `detailWithin` de
	 * `vouchers.service.ts`.
	 */
	private async rowWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<VoucherAdjustmentRow> {
		const [row] = await tx
			.select(NOTE_COLUMNS)
			.from(comprobanteAjuste)
			.where(and(eq(comprobanteAjuste.id, id), eq(comprobanteAjuste.ownerId, ownerId)))
			.limit(1);

		if (!row) {
			throw new Error("crear_nota no devolvio una nota legible para la sesion.");
		}

		return toNoteRow(row);
	}
}
