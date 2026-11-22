// Teardown global: la prueba de que el suite no dejo basura en la base sembrada.
//
// Corre una sola vez, despues de todos los specs y de sus teardowns. Vuelve a medir las mismas
// tablas y falla si alguna diferencia con el baseline. Es el check que convierte "cada spec borra
// lo suyo" en algo verificado en vez de prometido: si un teardown de un spec se rompe, la corrida
// entera termina en rojo aunque los 7 specs hayan pasado.
//
// `receipt_sequence` se cuenta por filas: el alta de un pago tiene que avanzar `last_serial`, asi
// que exigir que el valor vuelva atras seria exigir que la funcionalidad no funcionara.
import { countDifferences, describeCounts, loadBaseline, measureCounts, removeBaseline } from "./support/database";

export default async function globalTeardown(): Promise<void> {
	const baseline = loadBaseline();
	const current = measureCounts();
	// Se borra el archivo pase lo que pase: es scratch de la corrida, no un reporte.
	removeBaseline();

	const differences = countDifferences(baseline, current);

	if (differences.length > 0) {
		throw new Error(
			[
				"El e2e dejo filas en la base: los conteos no volvieron al baseline.",
				...differences.map((difference) => `  - ${difference}`),
				`  baseline: ${describeCounts(baseline)}`,
				`  ahora:    ${describeCounts(current)}`,
				"Cada spec tiene que borrar sus fixtures en orden de FK (e2e/support/owner.ts).",
			].join("\n"),
		);
	}

	console.log(`[e2e] conteos intactos tras la corrida: ${describeCounts(current)}`);
}
