// Esquema de entrada del agregado mensual de flujo de caja (C7 del vertical de cajas-bancos).
//
// LAS DOS FECHAS SON OBLIGATORIAS, como en el origen: `getMonthlyCashFlow(from, to)`
// (`lib/caja/caja.ts:501`) no tiene defaults, porque el rango lo elige la pantalla (mes actual,
// mes anterior, ...). No se agrega una validacion `from <= to`: el origen no la tiene y un rango
// invertido devuelve ceros, que es lo que ya hace su filtro.
import { z } from "zod";

const isoDate = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato YYYY-MM-DD.")
	.describe("Fecha en formato YYYY-MM-DD");

/** `GET /cash-flow/monthly?from=&to=` — rango INCLUSIVE en las dos puntas (filtro del origen). */
export const monthlyCashFlowQuerySchema = z.object({
	from: isoDate,
	to: isoDate,
});

export type MonthlyCashFlowQuery = z.output<typeof monthlyCashFlowQuerySchema>;
