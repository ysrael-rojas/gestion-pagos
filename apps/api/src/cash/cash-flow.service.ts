// Agregado mensual de flujo de caja: UNA consulta de agregacion, ningun total en Node (C7).
//
// Fuente: `getMonthlyCashFlow` (`lib/caja/caja.ts:501-516`) + `summarizeCashFlow`
// (`lib/caja/dashboard.ts:46-65`) del proyecto de origen. El filtro se copia EXACTO:
//
//     status <> 'ANULADO' and payment_date between from and to
//
// Con dos precisiones que el origen no tenia que declarar y aca si:
//
//   - NO se filtra `is_cash_movement`. `getMonthlyCashFlow` del origen lee `payment` sin ese
//     predicado: el resultado del mes es "todos los recibos del periodo, menos los anulados",
//     incluidas las compras y ventas que no son movimiento de caja. Agregarlo cambiaria el numero
//     que el dashboard viene mostrando.
//   - NO se filtra por cuenta ni por direccion distinta de INGRESO/EGRESO: `payment_direction`
//     solo tiene esos dos valores, y `summarizeCashFlow` ignora cualquier otro (no existe).
//
// POR QUE UN ENDPOINT Y NO SUMAR `GET /payments` EN EL CLIENTE: ese listado esta topado a
// `pageSize` 100 por request (`apps/api/src/payments/payments.query.ts:26`), asi que sumar paginas
// en Node no es la semantica del origen y ademas es inseguro (dos paginas pueden ser de momentos
// distintos y el tope recorta el total sin avisar).
//
// S2 — EL DINERO LO CALCULA LA BASE. Un `SUM` no es un saldo que la app pueda derivar de filas: la
// agregacion (y el `net`) la hace PostgreSQL en la misma consulta que filtra; este archivo solo
// convierte `numeric` (string exacto) a number en el borde JSON. No hay `income += ...` en ningun
// lugar.
//
// `net` se calcula en SQL y no como `income - expense` en Node: la fila trae los tres numeros y la
// base es la unica que suma. Los importes son `numeric(12,2)`, asi que la suma es exacta en
// centavos y `net` coincide con la diferencia de los dos totales mostrados.
//
// S6 — EL DUENO SALE DE LA SESION. No hay ningun parametro de dueno: `withOwner` fija
// `app.user_id` + el rol `authenticated` y la politica de `payment` recorta las filas antes de que
// el agregado las vea. El `where owner_id = ...` es defensa en profundidad.
import { Inject, Injectable } from "@nestjs/common";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/db.provider";
import { payment } from "../db/schema/payment.ts";
import { withOwner } from "../db/with-owner";
import { toCashHttpException } from "./cash.errors.ts";
import type { MonthlyCashFlowQuery } from "./cash-flow.query.ts";
import type { MonthlyCashFlow, MonthlyCashFlowRow } from "./cash-flow.types.ts";

@Injectable()
export class CashFlowService {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	/**
	 * `GET /cash-flow/monthly?from=&to=` — ingresos, egresos y neto del periodo.
	 *
	 * Una sola fila de salida (`sum` sobre un conjunto vacio devuelve NULL, que el `coalesce`
	 * convierte en 0): un periodo sin movimientos es `{ income: 0, expense: 0, net: 0 }`, no un
	 * error ni un 404.
	 */
	async monthly(ownerId: string, query: MonthlyCashFlowQuery): Promise<MonthlyCashFlow> {
		try {
			return await withOwner(this.db, ownerId, async (tx) => {
				const [row] = await tx
					.select({
						income: sql<string>`coalesce(sum(case when ${payment.direction} = 'INGRESO' then ${payment.amount} else 0 end), 0)::text`,
						expense: sql<string>`coalesce(sum(case when ${payment.direction} = 'EGRESO' then ${payment.amount} else 0 end), 0)::text`,
						// El signo del egreso lo aplica la base: `net` no se resta en Node.
						net: sql<string>`coalesce(sum(case when ${payment.direction} = 'INGRESO' then ${payment.amount} when ${payment.direction} = 'EGRESO' then -${payment.amount} else 0 end), 0)::text`,
					})
					.from(payment)
					.where(
						and(
							eq(payment.ownerId, ownerId),
							ne(payment.status, "ANULADO"),
							gte(payment.paymentDate, query.from),
							lte(payment.paymentDate, query.to),
						),
					);

				if (!row) {
					throw new Error("El agregado de flujo de caja no devolvio la fila esperada.");
				}

				return toMonthlyCashFlow(row as MonthlyCashFlowRow);
			});
		} catch (error) {
			throw toCashHttpException(error);
		}
	}
}

/** Fila cruda -> contrato de salida: `numeric` (string) -> number, solo en el borde JSON. */
function toMonthlyCashFlow(row: MonthlyCashFlowRow): MonthlyCashFlow {
	return {
		income: Number(row.income),
		expense: Number(row.expense),
		net: Number(row.net),
	};
}
