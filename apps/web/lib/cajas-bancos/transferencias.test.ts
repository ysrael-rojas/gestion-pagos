// Transferencias entre cuentas (C6 del vertical de cajas-bancos).
//
// Port de `tests/unit/lib/caja/transferencias.test.ts` del origen (vitest) a `node:test`. El
// origen probaba estas funciones con el cliente de Supabase mockeado; aca se prueba el contrato
// HTTP, que es lo unico que cambio: la ruta, los nombres de los parametros de la query (los tres
// son obligatorios y los bordes de fecha son INCLUSIVE) y que el mensaje del API llegue intacto.
//
// Se prueba con `fetch` reemplazado a proposito: los tres parametros de `GET /cash-transfers` son
// el contrato del filtro y un nombre mal escrito no falla en el typecheck porque viaja como query
// string. Es justo la clase de error que el compilador no ve.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";

import { ApiError, API_BASE_URL } from "../api/client.ts";
import { createCashTransfer, listAccountTransfers } from "./transferencias.ts";

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

const TRANSFER = {
  id: "550e8400-e29b-41d4-a716-4466554400bb",
  sourceAccountId: "550e8400-e29b-41d4-a716-446655440001",
  targetAccountId: "550e8400-e29b-41d4-a716-446655440009",
  amount: 150,
  transferDate: "2026-10-03",
  notes: null,
  createdAt: "2026-10-03T18:00:00.000Z",
};

const VALUES = {
  sourceAccountId: "550e8400-e29b-41d4-a716-446655440001",
  targetAccountId: "550e8400-e29b-41d4-a716-446655440009",
  amount: 150,
  transferDate: "2026-10-03",
  notes: "Traspaso de fondos",
};

describe("listAccountTransfers", () => {
  it("pide las transferencias de la cuenta y del periodo en la query", async () => {
    stubFetch([TRANSFER]);

    const transfers = await listAccountTransfers(
      "550e8400-e29b-41d4-a716-446655440001",
      "2026-10-01",
      "2026-10-31",
    );

    assert.equal(
      calls[0]?.url,
      `${API_BASE_URL}/cash-transfers?accountId=550e8400-e29b-41d4-a716-446655440001&from=2026-10-01&to=2026-10-31`,
    );
    assert.deepEqual(transfers, [TRANSFER]);
    // El importe viaja como numero desde el borde JSON: formatearlo aca romperia la suma.
    assert.equal(typeof transfers[0]?.amount, "number");
  });
});

describe("createCashTransfer", () => {
  it("manda el formulario del modal por POST y devuelve la transferencia creada", async () => {
    stubFetch(TRANSFER, 201);

    const transfer = await createCashTransfer(VALUES);

    assert.equal(calls[0]?.url, `${API_BASE_URL}/cash-transfers`);
    assert.equal(calls[0]?.init.method, "POST");
    assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), VALUES);
    assert.deepEqual(transfer, TRANSFER);
  });

  it("propaga el mensaje de negocio del API tal cual", async () => {
    stubFetch(
      {
        statusCode: 400,
        error: "Bad Request",
        message: "Origen y destino deben ser cuentas distintas",
      },
      400,
    );

    await assert.rejects(
      () => createCashTransfer(VALUES),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 400);
        assert.equal(error.message, "Origen y destino deben ser cuentas distintas");

        return true;
      },
    );
  });
});
