// Caja chica: el total de vales pendientes y la validacion del formulario de vale (C6 del vertical
// de cajas-bancos).
//
// Port de `tests/unit/lib/caja/caja-chica.test.ts` del origen (vitest) a `node:test`. Se prueban
// las dos reglas que la app decide —la suma del panel y lo que el modal rechaza antes de mandar—
// no la existencia de las funciones:
//
//   `pendingValesTotal`  es la parte del fondo que esta "en la calle" y la que el panel resta del
//                        fondo total para el arqueo. Solo suma PENDIENTE y redondea a centavos:
//                        sumar 0.1 + 0.2 en punto flotante da 0.30000000000000004 y el arqueo
//                        mostraria un centavo de diferencia que no existe.
//   `createPettyCashValeSchema(limit)`  es el validador del modal (`cash-vale-modal.tsx`). El
//                        limite por gasto lo revalida la RPC (S5) pero el modal lo adelanta para
//                        que el usuario no mande un vale que va a rebotar.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { createPettyCashValeSchema } from "@gestion/shared/lib/schemas/petty-cash-vale.ts";
import { anularVale, listVales, pendingValesTotal, replenishPettyCash, type PettyCashVale } from "./caja-chica.ts";

function vale(overrides: Partial<PettyCashVale> = {}): PettyCashVale {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    accountId: "550e8400-e29b-41d4-a716-446655440001",
    serial: 1,
    valeDate: "2026-10-20",
    paidTo: "Juan Perez",
    concept: "Pasajes",
    amount: 10,
    hasReceipt: true,
    status: "PENDIENTE",
    paymentId: "550e8400-e29b-41d4-a716-446655440002",
    createdAt: "2026-10-20T15:00:00.000Z",
    ...overrides,
  };
}

describe("pendingValesTotal", () => {
  it("suma solo los vales pendientes y redondea a centavos", () => {
    const total = pendingValesTotal([
      vale({ id: "a", amount: 0.1 }),
      vale({ id: "b", amount: 0.2 }),
      vale({ id: "c", amount: 15.5, status: "REPUESTO" }),
      vale({ id: "d", amount: 99, status: "ANULADO" }),
    ]);

    assert.equal(total, 0.3);
  });

  it("devuelve 0 cuando no hay vales o ninguno esta pendiente", () => {
    assert.equal(pendingValesTotal([]), 0);
    assert.equal(
      pendingValesTotal([
        vale({ status: "REPUESTO" }),
        vale({ status: "ANULADO" }),
      ]),
      0,
    );
  });
});

const VALE_FORM = {
  accountId: "550e8400-e29b-41d4-a716-446655440001",
  categoryId: "550e8400-e29b-41d4-a716-446655440003",
  valeDate: "2026-10-20",
  paidTo: "Juan Perez",
  concept: "Pasajes y movilidad",
  amount: 30,
  hasReceipt: false,
};

describe("validacion del formulario de vale", () => {
  it("acepta un vale dentro del limite por gasto", () => {
    const result = createPettyCashValeSchema(50).safeParse(VALE_FORM);

    assert.equal(result.success, true);
    assert.equal(result.data?.hasReceipt, false);
  });

  it("rechaza un vale que supera el limite por gasto con el texto del modal", () => {
    const result = createPettyCashValeSchema(50).safeParse({
      ...VALE_FORM,
      amount: 50.01,
    });

    assert.equal(result.success, false);
    assert.equal(
      result.error?.issues[0]?.message,
      "El monto no puede superar el límite por gasto (S/ 50.00).",
    );
  });

  it("no aplica el limite cuando la caja no lo tiene configurado", () => {
    const result = createPettyCashValeSchema(null).safeParse({
      ...VALE_FORM,
      amount: 5000,
    });

    assert.equal(result.success, true);
  });

  it("exige pagado a, concepto y un importe mayor a cero", () => {
    const result = createPettyCashValeSchema(null).safeParse({
      ...VALE_FORM,
      paidTo: "  ",
      concept: "",
      amount: 0,
    });

    assert.equal(result.success, false);
    assert.deepEqual(
      result.error?.issues.map((issue) => [issue.path[0], issue.message]),
      [
        ["paidTo", "Indica a quién se pagó el vale."],
        ["concept", "Indica el concepto del vale."],
        ["amount", "El monto debe ser mayor a cero."],
      ],
    );
  });
});

// ---------------------------------------------------------------------------
// Transporte: que se manda y que se devuelve (S5/S8)
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function stubFetch(body: unknown, status = 200) {
  calls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });

    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

after(() => {
  globalThis.fetch = originalFetch;
});

describe("transporte de caja chica", () => {
  it("filtra los vales por estado solo cuando se pide", async () => {
    stubFetch([]);

    await listVales("550e8400-e29b-41d4-a716-446655440001", "PENDIENTE");
    assert.match(calls[0]?.url ?? "", /\/petty-cash\/vales\?accountId=[^&]+&status=PENDIENTE$/);

    await listVales("550e8400-e29b-41d4-a716-446655440001");
    assert.doesNotMatch(calls[1]?.url ?? "", /status=/);
  });

  it("devuelve el id de la TRANSFERENCIA que creo la reposicion", async () => {
    stubFetch({
      transferId: "550e8400-e29b-41d4-a716-4466554400bb",
      vales: [],
    }, 201);

    const transferId = await replenishPettyCash({
      accountId: "550e8400-e29b-41d4-a716-446655440001",
      sourceAccountId: "550e8400-e29b-41d4-a716-446655440009",
      valeIds: ["550e8400-e29b-41d4-a716-446655440003"],
    });

    assert.equal(transferId, "550e8400-e29b-41d4-a716-4466554400bb");
    assert.equal(calls[0]?.init.method, "POST");
  });

  it("anula por POST y no devuelve nada utilizable", async () => {
    stubFetch({ id: "550e8400-e29b-41d4-a716-446655440003", status: "ANULADO" });

    const result = await anularVale("550e8400-e29b-41d4-a716-446655440003");

    assert.equal(result, undefined);
    assert.match(calls[0]?.url ?? "", /\/petty-cash\/vales\/[^/]+\/void$/);
    assert.equal(calls[0]?.init.method, "POST");
  });
});
