// Tests de los dos helpers puros de saldos (`lib/pagos/saldos.ts` del origen, portados tal cual).
//
// `computeBalance` y `isOverdue` son la definicion de "saldo" y "vencido" que usan la cartera, la
// tabla de comprobantes pendientes y el resumen del formulario. Un cambio de redondeo o de
// comparacion de fechas mueve numeros que el usuario ve, asi que se fijan aca.
import assert from "node:assert/strict";
import { test } from "node:test";

import { computeBalance, isOverdue } from "./saldos.ts";

test("computeBalance resta y redondea a 2 decimales, sin negativos", () => {
	assert.equal(computeBalance(1000, 400), 600);
	assert.equal(computeBalance(1000, 1000), 0);
	// Un pago de mas no produce saldo negativo: el saldo se clampa en 0.
	assert.equal(computeBalance(1000, 1200), 0);
	// Centavos: 0.1 + 0.2 no puede aparecer como 0.30000000000000004.
	assert.equal(computeBalance(0.3, 0.1), 0.2);
	assert.equal(computeBalance(1200.55, 200.25), 1000.3);
});

test("isOverdue compara la fecha de vencimiento contra hoy, con saldo mayor a 0", () => {
	const today = "2026-03-15";

	assert.equal(isOverdue("2026-03-14", 100, today), true, "vencio ayer");
	assert.equal(isOverdue("2026-03-15", 100, today), false, "vence hoy: todavia no esta vencido");
	assert.equal(isOverdue("2026-03-16", 100, today), false, "vence manana");
	// Un comprobante sin fecha efectiva (contado) nunca esta vencido.
	assert.equal(isOverdue(null, 100, today), false);
	// Un comprobante ya cubierto no esta vencido aunque la fecha haya pasado.
	assert.equal(isOverdue("2026-01-01", 0, today), false);
});
