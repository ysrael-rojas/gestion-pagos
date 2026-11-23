// Flujo de caja del mes: la lectura que alimenta el dashboard (C7 del vertical de cajas-bancos).
//
// En el origen, `getMonthlyCashFlow` (`lib/caja/caja.ts:501-516`) pedia las filas del periodo con
// `.neq("status", "ANULADO")` y las sumaba en el cliente con `summarizeCashFlow`. En el port la
// suma la hace PostgreSQL (`GET /cash-flow/monthly`, S2) y la web solo TRANSPORTA tres numeros.
//
// Eso es justo lo que se prueba aca:
//
//   1. La ruta y la query son las del contrato (`/cash-flow/monthly?from=&to=`), con los dos
//      bordes inclusive.
//   2. El cuerpo que devuelve el API llega intacto, incluido un `net` NEGATIVO (un mes que gasto
//      mas de lo que cobro no es un error ni un cero).
//   3. El cliente no suma nada: si sumara, dos recibos anulados en el periodo se colarian en el
//      resultado, porque el filtro `status <> 'ANULADO'` es del SQL y no viaja en la respuesta.
//      El fixture es el agregado que el SQL ya calculo sin los anulados.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getMonthlyCashFlow } from "../api/client.ts";

const originalFetch = globalThis.fetch;

interface CapturedCall {
  url: string;
  method: string;
}

function stubFetch(payload: unknown, status = 200): CapturedCall[] {
  const calls: CapturedCall[] = [];

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });

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

describe("getMonthlyCashFlow", () => {
  it("pide el rango del mes al agregado del API", async () => {
    const calls = stubFetch({ income: 1250.5, expense: 400, net: 850.5 });

    await getMonthlyCashFlow("2026-10-01", "2026-10-31");

    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "GET");
    assert.match(calls[0]!.url, /\/cash-flow\/monthly\?from=2026-10-01&to=2026-10-31$/);
  });

  it("devuelve los tres numeros del SQL sin recalcular ni redondear", async () => {
    // Agregado de octubre: 2 ingresos (1,000 y 250.50), 1 egreso de 400 y un recibo ANULADO de
    // 900 que el SQL ya excluyo. Si el cliente sumara, el ingreso seria 1000 + 250.50 + 900.
    stubFetch({ income: 1250.5, expense: 400, net: 850.5 });

    const flow = await getMonthlyCashFlow("2026-10-01", "2026-10-31");

    assert.deepEqual(flow, { income: 1250.5, expense: 400, net: 850.5 });
  });

  it("acepta un neto negativo", async () => {
    stubFetch({ income: 100, expense: 350, net: -250 });

    const flow = await getMonthlyCashFlow("2026-10-01", "2026-10-31");

    assert.equal(flow.net, -250);
  });
});
