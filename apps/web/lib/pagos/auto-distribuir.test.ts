// Test del reparto FIFO por antiguedad (`lib/pagos/auto-distribuir.ts` del origen, portado tal
// cual). Es el boton "Auto-distribuir" del formulario de pagos: si cambia el orden o el
// tratamiento del excedente, el usuario reparte plata distinto sin darse cuenta.
import assert from "node:assert/strict";
import { test } from "node:test";

import { distributeOldestFirst } from "./auto-distribuir.ts";
import type { VoucherBalance } from "../../components/pagos/types.ts";

function voucher(overrides: Partial<VoucherBalance> & { comprobanteId: string }): VoucherBalance {
	return {
		entityId: "11111111-1111-4111-8111-111111111111",
		voucherKind: "VENTA",
		voucherType: "FACTURA",
		voucherNumber: overrides.comprobanteId,
		issueDate: "2026-01-01",
		effectiveDueDate: null,
		paymentType: "CREDITO",
		total: 1000,
		paidAmount: 0,
		balance: 1000,
		...overrides,
	};
}

test("cubre primero las deudas mas antiguas", () => {
	const vouchers = [
		voucher({ comprobanteId: "nueva", effectiveDueDate: "2026-04-01", balance: 500 }),
		voucher({ comprobanteId: "vieja", effectiveDueDate: "2026-01-15", balance: 500 }),
	];

	const result = distributeOldestFirst(vouchers, 600);

	assert.deepEqual(
		[...result],
		[
			["vieja", 500],
			["nueva", 100],
		],
	);
});

test("sin fecha efectiva usa la fecha de emision, y desempata por emision", () => {
	const vouchers = [
		voucher({ comprobanteId: "contado", issueDate: "2026-01-10", balance: 100 }),
		voucher({ comprobanteId: "credito", effectiveDueDate: "2026-01-05", balance: 100 }),
		voucher({ comprobanteId: "empate-b", issueDate: "2026-02-01", balance: 100 }),
		voucher({ comprobanteId: "empate-a", issueDate: "2026-02-01", balance: 100 }),
	];

	const result = distributeOldestFirst(vouchers, 400);

	assert.deepEqual(
		[...result],
		[
			["credito", 100],
			["contado", 100],
			["empate-b", 100],
			["empate-a", 100],
		],
		"el orden es por vencimiento (o emision) y el empate conserva el orden de entrada",
	);
});

test("el excedente no se asigna y el remanente no pierde centavos", () => {
	// Suma de saldos 300, importe 1000: solo se reparten 300.
	const corto = distributeOldestFirst(
		[
			voucher({ comprobanteId: "a", balance: 100 }),
			voucher({ comprobanteId: "b", balance: 200 }),
		],
		1000,
	);

	assert.deepEqual([...corto], [
		["a", 100],
		["b", 200],
	]);
	assert.equal(
		[...corto.values()].reduce((sum, value) => sum + value, 0),
		300,
		"el excedente no se asigna a nadie",
	);

	// Un importe que corta a mitad de un saldo deja el remanente exacto en centavos.
	const parcial = distributeOldestFirst(
		[
			voucher({ comprobanteId: "a", balance: 33.33 }),
			voucher({ comprobanteId: "b", balance: 33.33 }),
			voucher({ comprobanteId: "c", balance: 33.34 }),
		],
		66.67,
	);

	assert.deepEqual([...parcial], [
		["a", 33.33],
		["b", 33.33],
		["c", 0.01],
	]);
});

test("no reparte nada si el importe es 0 o negativo, y salta los saldos cerrados", () => {
	assert.deepEqual([...distributeOldestFirst([voucher({ comprobanteId: "a" })], 0)], []);
	assert.deepEqual([...distributeOldestFirst([voucher({ comprobanteId: "a" })], -10)], []);

	const result = distributeOldestFirst(
		[
			voucher({ comprobanteId: "pagada", balance: 0, effectiveDueDate: "2026-01-01" }),
			voucher({ comprobanteId: "abierta", balance: 250, effectiveDueDate: "2026-02-01" }),
		],
		500,
	);

	assert.deepEqual([...result], [["abierta", 250]]);
});
