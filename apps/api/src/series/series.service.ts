// Servicio del vertical de series de comprobante (T3 del port de series; S4, S5 y S6).
//
// Que hace: listar las series vivas del dueno de la sesion y crear, editar y dar de baja las suyas.
// Nada mas: el correlativo lo mueve `public.crear_venta` al emitir (S2), no este modulo.
//
// Tres decisiones que no son de estilo:
//
// 1. LAS ESCRITURAS VAN POR RPC, NO POR DML (S5). `authenticated` tiene SELECT e INSERT sobre
//    `public.voucher_series` pero NO UPDATE ni DELETE
//    (`20261124090000_revoke_payments_writes.sql`; `check-rls-enforcement.mjs` grupo M fija la
//    matriz), asi que editar y dar de baja solo es posible con una funcion `security definer`. Las
//    tres RPC viven en `20261125090000_series_rpcs.sql` y se llaman con `withOwner`, que fija
//    `app.user_id` y cambia el rol a `authenticated` antes del `select` — el mismo camino que
//    `vouchers.service.ts` y `cash/closes.service.ts`. El `owner_id` de cada fila lo escribe la RPC
//    desde `auth.uid()`: no hay ningun campo de entrada que lo fije.
//
// 2. EL CONTRATO DE SALIDA ES `voucherSeriesSchema` (S10). El servicio devuelve esa fila y no un
//    eco del body: `lastNumber` no viaja en el body y la tabla lo muestra. La conversion a number
//    ocurre aca, en el borde JSON, y no en la pantalla.
//
// 3. EL UNIVERSO DEL MODULO SON LOS TRES TIPOS QUE SE EMITEN (S4). El listado filtra por
//    `ISSUED_SERIES_VOUCHER_TYPES` y las lecturas por id tambien, porque el contrato de fila solo
//    modela esos tres y `crear_serie` ya no deja crear otros (S13.2). Una serie de `NOTA_CREDITO`
//    sembrada por SQL directo queda fuera del contrato, igual que una serie dada de baja: no se
//    lista y un id suyo responde `La serie no existe.`.
//
// La traduccion de errores la hace `series.errors.ts`: aca solo se dejan pasar los mensajes de S6
// sin reescribirlos.
import { Inject, Injectable } from "@nestjs/common";
import type { VoucherType } from "@gestion/shared/components/comprobantes/types.ts";
// El subpath necesita la extension: el `exports` de `@gestion/shared` mapea `./*` -> `./src/*` y
// ni esbuild ni el runner de Node agregan `.ts` al resolver (misma razon que en `vouchers.service.ts`).
import { ISSUED_SERIES_VOUCHER_TYPES } from "@gestion/shared/lib/data/series-options.ts";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { DATABASE, type Database, type Transaction } from "../db/db.provider";
import { withOwner } from "../db/with-owner";
import { seriesNotFound, toSeriesHttpException } from "./series.errors.ts";
import type { SerieCreateBody, SerieEditBody } from "./series.query.ts";
import type { VoucherSeriesRow } from "./series.types.ts";
import { voucherSeries } from "./voucher-series.table.ts";

/**
 * Los tres tipos que la app emite (S4), derivados del contrato compartido y no de una segunda
 * lista: `ISSUED_SERIES_VOUCHER_TYPES` es el subconjunto de `SERIES_VOUCHER_TYPES` que tambien es
 * comprobante base de venta, y es el mismo enum que valida `serieFormSchema`.
 */
const ISSUED_VOUCHER_TYPES: VoucherType[] = ISSUED_SERIES_VOUCHER_TYPES.map((option) => option.value);

/** Fila de `voucher_series`, tal como la devuelve Drizzle. */
interface SeriesRow {
	id: string;
	voucherType: VoucherType;
	code: string;
	lastNumber: number;
	isDefault: boolean;
}

/** Las columnas del contrato, una sola vez para las tres lecturas. */
const SERIES_COLUMNS = {
	id: voucherSeries.id,
	voucherType: voucherSeries.voucherType,
	code: voucherSeries.code,
	lastNumber: voucherSeries.lastNumber,
	isDefault: voucherSeries.isDefault,
};

/** El `where` que define "una serie visible para esta sesion" (ver la decision 3 de la cabecera). */
function visibleTo(ownerId: string) {
	return and(
		eq(voucherSeries.ownerId, ownerId),
		isNull(voucherSeries.deletedAt),
		inArray(voucherSeries.voucherType, ISSUED_VOUCHER_TYPES),
	);
}

/** `VoucherSeriesRow['voucherType']` es el enum de los tres tipos del contrato (S10). */
function isIssuedVoucherType(value: VoucherType): value is VoucherSeriesRow["voucherType"] {
	return ISSUED_VOUCHER_TYPES.some((issued) => issued === value);
}

/**
 * Fila -> contrato de salida.
 *
 * La comprobacion del tipo no es defensa contra el usuario: la query ya filtro los tres tipos. Es
 * el borde donde el contrato (`voucherSeriesSchema`) y la tabla (seis tipos) se encuentran, y
 * preferimos un 500 honesto a devolver un tipo que el tipo de retorno no declara.
 */
function toSeriesRow(row: SeriesRow): VoucherSeriesRow {
	if (!isIssuedVoucherType(row.voucherType)) {
		throw new Error(
			`voucher_series devolvio un tipo que la pantalla no ofrece: ${row.voucherType}`,
		);
	}

	return {
		id: row.id,
		voucherType: row.voucherType,
		code: row.code,
		lastNumber: row.lastNumber,
		isDefault: row.isDefault,
	};
}

@Injectable()
export class SeriesService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /series` — las series vivas del dueno, ordenadas por tipo y codigo.
	 *
	 * El orden es el de la tabla de Configuración → Series (`Tipo`, `Serie`), y es estable para que
	 * dos requests no devuelvan las filas en orden distinto sin motivo.
	 */
	async list(ownerId: string): Promise<VoucherSeriesRow[]> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const rows = await tx
					.select(SERIES_COLUMNS)
					.from(voucherSeries)
					.where(visibleTo(ownerId))
					.orderBy(voucherSeries.voucherType, voucherSeries.code);

				return rows.map(toSeriesRow);
			});
		} catch (error) {
			throw toSeriesHttpException(error);
		}
	}

	/**
	 * `POST /series` — alta por `crear_serie(p_voucher_type, p_code, p_is_default)` (S5).
	 *
	 * La RPC limpia el default anterior del mismo tipo en la misma transaccion antes de insertar:
	 * el indice parcial `voucher_series_default_per_type_idx` admite una sola por tipo y el orden
	 * es obligatorio. Un rechazo no deja la limpieza hecha (si el alta falla, el tipo sigue con su
	 * default anterior).
	 *
	 * El correlativo inicial tampoco lo decide el API: `crear_serie` lo arranca en el maximo ya
	 * emitido con ese `(dueno, tipo, codigo)` (S13.1), asi que una serie recreada no vuelve a 0.
	 */
	async create(ownerId: string, body: SerieCreateBody): Promise<VoucherSeriesRow> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const result = await tx.execute<{ id: string }>(sql`
					select public.crear_serie(
						${body.voucherType}::public.voucher_type,
						${body.code}::text,
						${body.isDefault}::boolean
					) as id
				`);

				const id = result.rows[0]?.id;

				if (!id) {
					throw new Error("crear_serie no devolvio el id de la serie.");
				}

				// La respuesta se RELEE en la misma transaccion: muestra exactamente la fila que
				// quedo escrita (con el `last_number` que calculo la RPC) y no un eco del payload.
				return this.rowWithin(tx, ownerId, id);
			});
		} catch (error) {
			throw toSeriesHttpException(error);
		}
	}

	/**
	 * `PATCH /series/:id` — edicion por `editar_serie(p_serie_id, p_code, p_is_default)` (S5).
	 *
	 * El TIPO no viaja: `editar_serie` no lo recibe y el contrato de edicion lo omite (L4a). El
	 * dueno sale de la fila (la RPC la bloquea con `for update` y la compara con `auth.uid()`), no
	 * del payload.
	 *
	 * La visibilidad se comprueba ANTES de llamar a la RPC: sin esa lectura, una serie que el
	 * modulo no considera visible (de otro dueno, dada de baja o de un tipo que no se emite) se
	 * escribiria y despues responderia 404, que es un rechazo que miente sobre lo que paso.
	 */
	async edit(ownerId: string, id: string, body: SerieEditBody): Promise<VoucherSeriesRow> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				await this.rowWithin(tx, ownerId, id);

				const result = await tx.execute<{ id: string }>(sql`
					select public.editar_serie(
						${id}::uuid,
						${body.code}::text,
						${body.isDefault}::boolean
					) as id
				`);

				const written = result.rows[0]?.id;

				if (!written) {
					throw new Error("editar_serie no devolvio el id de la serie.");
				}

				return this.rowWithin(tx, ownerId, written);
			});
		} catch (error) {
			throw toSeriesHttpException(error);
		}
	}

	/**
	 * `POST /series/:id/delete` — baja LOGICA por `eliminar_serie(p_serie_id)` (S5).
	 *
	 * No borra la fila: escribe `deleted_at`, asi que los comprobantes ya emitidos con esa serie no
	 * cambian (el numero esta en el comprobante) y la serie deja de usarse porque `crear_venta` solo
	 * busca series vivas por defecto.
	 *
	 * Misma comprobacion de visibilidad previa que `edit`, por la misma razon.
	 */
	async remove(ownerId: string, id: string): Promise<void> {
		try {
			await withOwner(this.db, ownerId, async (tx) => {
				await this.rowWithin(tx, ownerId, id);

				const result = await tx.execute<{ id: string }>(sql`
					select public.eliminar_serie(${id}::uuid) as id
				`);

				if (!result.rows[0]?.id) {
					throw new Error("eliminar_serie no devolvio el id de la serie.");
				}
			});
		} catch (error) {
			throw toSeriesHttpException(error);
		}
	}

	/**
	 * Lectura compartida: la fila visible para la sesion, o el 404 de S6.
	 *
	 * El `where owner_id` es defensa en profundidad; la garantia es la politica RLS. El 404 es el
	 * mismo texto para "no existe", "es de otro dueno" y "esta dada de baja", igual que el de las
	 * RPC.
	 */
	private async rowWithin(
		tx: Transaction,
		ownerId: string,
		id: string,
	): Promise<VoucherSeriesRow> {
		const [row] = await tx
			.select(SERIES_COLUMNS)
			.from(voucherSeries)
			.where(and(eq(voucherSeries.id, id), visibleTo(ownerId)))
			.limit(1);

		if (!row) {
			throw seriesNotFound();
		}

		return toSeriesRow(row);
	}
}
