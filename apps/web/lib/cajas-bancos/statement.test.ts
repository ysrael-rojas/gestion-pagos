// Composicion de las filas del extracto (C6 del vertical de cajas-bancos).
//
// Port de `tests/unit/components/statement-table.test.ts` del origen (vitest) a `node:test`. La
// regla que se prueba es la que decide que ve el usuario en "Movimientos" y en el extracto: los
// recibos del periodo MAS las transferencias en las que la cuenta participo, con la direccion
// resuelta segun sea origen o destino y ordenadas por fecha.
//
// Por que importa la direccion: una transferencia no tiene direccion contable propia. Entrar a la
// cuenta es un INGRESO y salir de ella un EGRESO, y eso solo se puede saber comparando
// `targetAccountId` con la cuenta que se esta mirando. Equivocarlo pinta el signo al reves.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Payment } from "@/lib/api/client";
import { buildStatementRows } from "./statement.ts";
import type { CashTransfer } from "./transferencias.ts";

const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440001";

function payment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "550e8400-e29b-41d4-a716-4466554400aa",
    entityId: null,
    direction: "INGRESO",
    paymentDate: "2026-10-02",
    receiptNumber: "RI-000012",
    amount: 120.5,
    currency: "PEN",
    methodId: "550e8400-e29b-41d4-a716-4466554400m1",
    methodName: "Efectivo",
    cashAccountId: ACCOUNT_ID,
    cashAccountName: "Caja principal",
    categoryId: "550e8400-e29b-41d4-a716-4466554400c1",
    categoryName: "Ventas",
    reference: null,
    status: "PROCESADO",
    voidReason: null,
    voidedAt: null,
    notes: null,
    isCashMovement: false,
    ...overrides,
  } as Payment;
}

function transfer(overrides: Partial<CashTransfer> = {}): CashTransfer {
  return {
    id: "550e8400-e29b-41d4-a716-4466554400bb",
    sourceAccountId: ACCOUNT_ID,
    targetAccountId: "550e8400-e29b-41d4-a716-446655440009",
    amount: 200,
    transferDate: "2026-10-03",
    notes: null,
    createdAt: "2026-10-03T18:00:00.000Z",
    ...overrides,
  };
}

describe("buildStatementRows", () => {
  it("mapea los recibos con sus datos de conciliacion", () => {
    const rows = buildStatementRows([payment()], [], ACCOUNT_ID);

    assert.deepEqual(rows, [
      {
        id: "550e8400-e29b-41d4-a716-4466554400aa",
        kind: "PAYMENT",
        date: "2026-10-02",
        ref: "RI-000012",
        direction: "INGRESO",
        category: "Ventas",
        method: "Efectivo",
        amount: 120.5,
        status: "PROCESADO",
      },
    ]);
  });

  it("usa los textos por defecto del origen cuando el recibo no trae categoria ni metodo", () => {
    const [row] = buildStatementRows(
      [payment({ categoryName: "", methodName: "" })],
      [],
      ACCOUNT_ID,
    );

    assert.equal(row?.category, "Sin categoría");
    assert.equal(row?.method, "—");
  });

  it("marca las transferencias salientes como egreso y las entrantes como ingreso", () => {
    const outgoing = transfer({ id: "out" });
    const incoming = transfer({
      id: "in",
      sourceAccountId: "550e8400-e29b-41d4-a716-446655440009",
      targetAccountId: ACCOUNT_ID,
    });

    const rows = buildStatementRows([], [outgoing, incoming], ACCOUNT_ID);

    assert.deepEqual(
      rows.map((row) => [row.id, row.kind, row.direction, row.status]),
      [
        ["out", "TRANSFER", "EGRESO", null],
        ["in", "TRANSFER", "INGRESO", null],
      ],
    );
    assert.deepEqual(rows[0], {
      id: "out",
      kind: "TRANSFER",
      date: "2026-10-03",
      ref: "Transferencia",
      direction: "EGRESO",
      category: "Transferencia entre cuentas",
      method: "—",
      amount: 200,
      status: null,
    });
  });

  it("intercala recibos y transferencias en orden de fecha ascendente", () => {
    const rows = buildStatementRows(
      [
        payment({ id: "p1", paymentDate: "2026-10-01" }),
        payment({ id: "p2", paymentDate: "2026-10-05" }),
      ],
      [transfer({ id: "t1", transferDate: "2026-10-03" })],
      ACCOUNT_ID,
    );

    assert.deepEqual(
      rows.map((row) => row.id),
      ["p1", "t1", "p2"],
    );
  });

  it("devuelve una lista vacia sin recibos ni transferencias", () => {
    assert.deepEqual(buildStatementRows([], [], ACCOUNT_ID), []);
  });
});
