// Test del estado derivado de un recibo (`lib/pagos/asignacion.ts` del origen, portado tal cual).
//
// `getAssignState` decide tres cosas visibles: si la fila muestra "Saldo por asignar" o "—", si
// ofrece el boton "Asignar", y que etiqueta aparece en la columna de saldo. SPEC 50 agrega
// MOVIMIENTO para los recibos que no se asignan a comprobantes (cargos, vales).
import assert from "node:assert/strict";
import { test } from "node:test";

import { ASSIGN_STATE_LABELS, getAssignState } from "./asignacion.ts";

test("un recibo con saldo pendiente esta POR_ASIGNAR, aunque este en revision", () => {
	assert.equal(getAssignState("EN_REVISION", 400), "POR_ASIGNAR");
	assert.equal(getAssignState("PROCESADO", 0.01), "POR_ASIGNAR");
});

test("un recibo sin saldo pendiente esta ASIGNADO", () => {
	assert.equal(getAssignState("EN_REVISION", 0), "ASIGNADO");
	assert.equal(getAssignState("PROCESADO", 0), "ASIGNADO");
});

test("ANULADO gana sobre todo, incluso sobre un movimiento de caja", () => {
	assert.equal(getAssignState("ANULADO", 0), "ANULADO");
	assert.equal(getAssignState("ANULADO", 500), "ANULADO");
	assert.equal(getAssignState("ANULADO", 400, true), "ANULADO");
});

test("un movimiento de caja nunca se ofrece para asignar", () => {
	assert.equal(getAssignState("EN_REVISION", 400, true), "MOVIMIENTO");
	assert.equal(getAssignState("PROCESADO", 0, true), "MOVIMIENTO");
});

test("cada estado tiene su etiqueta en espanol", () => {
	assert.deepEqual(ASSIGN_STATE_LABELS, {
		POR_ASIGNAR: "Por asignar",
		ASIGNADO: "Asignado",
		ANULADO: "Anulado",
		MOVIMIENTO: "Movimiento de caja",
	});
});
