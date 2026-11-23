// Ruta del agregado mensual de flujo de caja (C7 del vertical de cajas-bancos).
//
//   GET /cash-flow/monthly?from=&to=   ingresos, egresos y neto del periodo (SQL, no Node)
//
// Es la lectura que el dashboard del origen armaba con `getMonthlyCashFlow` + `summarizeCashFlow`
// (`lib/caja/caja.ts:501-516`, `lib/caja/dashboard.ts:46-65`). No vive en `CatalogsController` ni
// en `PaymentsController` porque no es un catalogo ni un listado de recibos: es un numero que la
// base agrega para la pantalla de caja y bancos.
//
// `SessionGuard` corre antes del pipe: sin sesion la respuesta es 401 aunque la query sea invalida.
// El dueno sale de `sessionUserOf(request.sessionUser).id`; no hay ningun campo de entrada que lo
// fije (S6).
import { Controller, Get, Inject, Query, Req, UseGuards } from "@nestjs/common";
import { SessionGuard, sessionUserOf, type SessionRequest } from "../auth/session.guard";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { CashFlowService } from "./cash-flow.service.ts";
import {
	type MonthlyCashFlowQuery,
	monthlyCashFlowQuerySchema,
} from "./cash-flow.query.ts";
import type { MonthlyCashFlow } from "./cash-flow.types.ts";

@Controller("cash-flow")
@UseGuards(SessionGuard)
export class CashFlowController {
	constructor(@Inject(CashFlowService) private readonly cashFlow: CashFlowService) {}

	/**
	 * `GET /cash-flow/monthly` — el resultado del mes.
	 *
	 * Mismos tres campos que `CashFlowTotals` del origen (`income`, `expense`, `net`), calculados
	 * por PostgreSQL con el filtro del origen (`status <> 'ANULADO'` y fecha INCLUSIVE en los dos
	 * bordes). Un periodo sin movimientos responde ceros.
	 */
	@Get("monthly")
	monthly(
		@Req() request: SessionRequest,
		@Query(new ZodValidationPipe(monthlyCashFlowQuerySchema)) query: MonthlyCashFlowQuery,
	): Promise<MonthlyCashFlow> {
		return this.cashFlow.monthly(sessionUserOf(request.sessionUser).id, query);
	}
}
