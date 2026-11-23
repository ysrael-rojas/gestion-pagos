// Conciliacion bancaria: el contrato de las dos llamadas del vertical (C7).
//
// Este archivo fija la regla mas delicada del slice, que no se ve en la pantalla: la conciliacion
// que guarda la RPC es LA AUTORITATIVA. Eso significa dos cosas concretas en el transporte:
//
//   1. `saveReconciliation` manda SOLO lo que el usuario escribio (los dos saldos y las partidas) y
//      NUNCA un `difference` ni un `reconciledBalance` precalculado: el primero es display
//      (`computeReconciliation`) y el segundo lo deriva la RPC. Mandarlos seria dejar que el
//      cliente decidiera el resultado del acta.
//   2. "No hay conciliacion para ese periodo" es `null`, no un error: el API responde 200 con un
//      `null` literal y la funcion lo devuelve tal cual para que la pantalla abra el formulario en
//      blanco.
//
// Nacio como test de REGRESION: el port ya estaba implementado cuando se escribio, asi que no tuvo
// RED propio (a diferencia de `proyeccion.test.ts`, `flujo.test.ts`, `catalogos.test.ts` y el caso
// de `markableReceiptIds`, que fallaron antes de su implementacion).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getReconciliation, saveReconciliation } from "./conciliacion.ts";

const originalFetch = globalThis.fetch;

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
}

function stubFetch(status: number, payload: unknown): CapturedCall[] {
  const calls: CapturedCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });

    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  return calls;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("getReconciliation", () => {
  it("pide el triplete cuenta/periodo y devuelve null cuando no hay acta", async () => {
    const calls = stubFetch(200, null);

    const found = await getReconciliation("acc-bank", "2026-10-01", "2026-10-31");

    assert.equal(found, null);
    assert.match(
      calls[0]!.url,
      /\/bank-reconciliations\?accountId=acc-bank&periodStart=2026-10-01&periodEnd=2026-10-31$/,
    );
  });

  it("devuelve el acta con sus partidas tal como la manda el API", async () => {
    stubFetch(200, {
      id: "rec-1",
      accountId: "acc-bank",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      statementBalance: 17955.3,
      booksBalance: 18420,
      preparedBy: null,
      reviewedBy: null,
      notes: null,
      updatedAt: "2026-10-31T10:00:00.000Z",
      items: [{ id: "item-1", kind: "CARGO_NO_REGISTRADO", description: "ITF", amount: 15.3 }],
    });

    const saved = await getReconciliation("acc-bank", "2026-10-01", "2026-10-31");

    assert.equal(saved?.items.length, 1);
    assert.deepEqual(saved?.items[0], {
      id: "item-1",
      kind: "CARGO_NO_REGISTRADO",
      description: "ITF",
      amount: 15.3,
    });
  });
});

describe("saveReconciliation", () => {
  it("manda los dos saldos y las partidas, y ningun resultado calculado", async () => {
    const calls = stubFetch(201, {
      id: "rec-1",
      accountId: "acc-bank",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      statementBalance: 17955.3,
      booksBalance: 18420,
      preparedBy: "Ana Ríos",
      reviewedBy: null,
      notes: null,
      updatedAt: "2026-10-31T10:00:00.000Z",
      items: [],
    });

    const saved = await saveReconciliation({
      accountId: "acc-bank",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      statementBalance: 17955.3,
      booksBalance: 18420,
      preparedBy: "Ana Ríos",
      items: [
        { id: "item-1", kind: "DEPOSITO_EN_TRANSITO", description: "Depósito 30/10", amount: 970 },
      ],
    });

    const body = calls[0]?.body as Record<string, unknown>;

    assert.equal(saved.id, "rec-1");
    assert.equal(calls[0]?.method, "POST");
    assert.deepEqual(body, {
      accountId: "acc-bank",
      periodStart: "2026-10-01",
      periodEnd: "2026-10-31",
      statementBalance: 17955.3,
      booksBalance: 18420,
      preparedBy: "Ana Ríos",
      reviewedBy: null,
      notes: null,
      // El id del cliente se descarta: la RPC borra y reinserta las partidas.
      items: [{ kind: "DEPOSITO_EN_TRANSITO", description: "Depósito 30/10", amount: 970 }],
    });
    // Los dos campos calculados NO viajan: la diferencia es display y el saldo conciliado lo
    // deriva la RPC al guardar (S2).
    assert.equal("difference" in body, false);
    assert.equal("reconciledBalance" in body, false);
    assert.equal("isConciled" in body, false);
  });

  it("propaga el mensaje de negocio de la RPC sin traducirlo", async () => {
    stubFetch(400, {
      statusCode: 400,
      message: "Solo se concilian cuentas bancarias",
    });

    await assert.rejects(
      () =>
        saveReconciliation({
          accountId: "acc-caja",
          periodStart: "2026-10-01",
          periodEnd: "2026-10-31",
          statementBalance: 0,
          booksBalance: 0,
          items: [],
        }),
      /Solo se concilian cuentas bancarias/,
    );
  });
});
