// Prueba de los helpers puros del vertical de pagos.
//
// `computeBalance`, `isOverdue`, `distributeOldestFirst` y `getAssignState` son comportamiento
// del dominio, no del transporte: la UI los usa para pintar saldos y repartir importes sin ir al
// API. Se portan tal cual desde `lib/pagos/{saldos,auto-distribuir,asignacion}.ts` del proyecto
// de origen y se prueban aca para que la semantica no dependa de la base.
import assert from "node:assert/strict";
import test from "node:test";
import {
	ASSIGN_STATE_LABELS,
	getAssignState,
	type AssignState,
} from "../src/payments/domain/asignacion.ts";
import { distributeOldestFirst } from "../src/payments/domain/auto-distribuir.ts";
import { computeBalance, isOverdue } from "../src/payments/domain/saldos.ts";
import type { VoucherBalance } from "../src/payments/payments.types.ts";

function voucher(overrides: Partial<VoucherBalance>): VoucherBalance {
	return {
		comprobanteId: "00000000-0000-4000-8000-000000000000",
		entityId: "00000000-0000-4000-8000-000000000001",
		voucherKind: "VENTA",
		voucherType: "FACTURA",
		voucherNumber: "F001-1",
		issueDate: "2026-01-01",
		effectiveDueDate: "2026-01-01",
		paymentType: "CONTADO",
		total: 100,
		paidAmount: 0,
		balance: 100,
		...overrides,
	};
}

test("computeBalance resta y redondea a 2 decimales, sin saldos negativos", () => {
	assert.equal(computeBalance(1000, 400), 600);
	assert.equal(computeBalance(0.3, 0.1), 0.2);
	assert.equal(computeBalance(100, 100), 0);
	assert.equal(computeBalance(100, 140), 0, "un pago de mas no produce saldo negativo");
});

test("isOverdue solo vence con fecha anterior a hoy y saldo pendiente", () => {
	assert.equal(isOverdue("2026-01-01", 10, "2026-01-02"), true);
	assert.equal(isOverdue("2026-01-02", 10, "2026-01-02"), false, "vence el mismo dia no es vencido");
	assert.equal(isOverdue(null, 10, "2026-01-02"), false);
	assert.equal(isOverdue("2026-01-01", 0, "2026-01-02"), false);
});

test("distributeOldestFirst cubre primero los comprobantes mas antiguos y no asigna el excedente", () => {
	const vouchers = [
		voucher({
			comprobanteId: "nuevo",
			issueDate: "2026-03-01",
			effectiveDueDate: "2026-03-01",
			total: 100,
			balance: 100,
		}),
		voucher({
			comprobanteId: "viejo",
			issueDate: "2026-01-01",
			effectiveDueDate: "2026-01-01",
			total: 50,
			balance: 50,
		}),
		voucher({
			comprobanteId: "sin-saldo",
			issueDate: "2025-12-01",
			effectiveDueDate: "2025-12-01",
			total: 10,
			balance: 0,
		}),
	];

	const assignments = distributeOldestFirst(vouchers, 120);

	assert.deepEqual([...assignments.entries()], [
		["viejo", 50],
		["nuevo", 70],
	]);

	// Excedente: 300 sobre 150 de saldo deja 150 sin asignar.
	const overflow = distributeOldestFirst(vouchers, 300);

	assert.equal(
		[...overflow.values()].reduce((sum, value) => sum + value, 0),
		150,
		"lo que sobra del total de saldos no se asigna",
	);

	assert.equal(distributeOldestFirst(vouchers, 0).size, 0);
	assert.equal(distributeOldestFirst(vouchers, -5).size, 0);
});

test("getAssignState deriva el estado del saldo, la anulacion y el movimiento de caja", () => {
	const cases: Array<[string, number, boolean, AssignState]> = [
		["ANULADO", 500, false, "ANULADO"],
		["EN_REVISION", 500, true, "MOVIMIENTO"],
		["EN_REVISION", 500, false, "POR_ASIGNAR"],
		["PROCESADO", 0, false, "ASIGNADO"],
	];

	for (const [status, unassignedAmount, isCashMovement, expected] of cases) {
		assert.equal(
			getAssignState(
				status as Parameters<typeof getAssignState>[0],
				unassignedAmount,
				isCashMovement,
			),
			expected,
		);
		assert.ok(ASSIGN_STATE_LABELS[expected]);
	}
});
