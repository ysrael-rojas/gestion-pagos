// Escrituras de catalogo desde la web (C7 del vertical de cajas-bancos).
//
// Las cuatro escrituras (alta y modificacion de metodos de pago y de categorias) son las del
// origen (`lib/caja/caja.ts:238-320`), donde eran `insert` / `update` de PostgREST. Aca son
// `POST` / `PATCH` contra `apps/api`, y lo que se prueba es el CONTRATO DEL BODY, porque es el
// punto donde un port se equivoca en silencio:
//
//   1. `POST /receipt-categories` NO lleva `code`. El codigo estable lo deriva el API del nombre
//      (`categoryCodeFromName`, columna `not null` y unica por dueno). Si la web lo derivara
//      tambien, el mismo nombre podria producir dos codigos distintos y el alta chocaria contra el
//      indice unico sin que el usuario entienda por que.
//   2. `PATCH` manda solo lo que cambio (`name` y/o `isActive`): el `code` es inmutable, y un
//      body con `isActive: true` fijo volveria a activar lo que el usuario acaba de desactivar.
//   3. El duplicado de codigo llega como 409 con el mensaje del API, que NOMBRA el codigo. El
//      cliente no lo reemplaza: el `toast` de la tarjeta muestra ese texto tal cual.
//
// `fetch` se sustituye por un doble (no hay red ni base en un test unitario) y se inspecciona lo
// que el cliente manda: es la unica forma de fijar el body sin levantar el API. Los dos schemas se
// importan por subruta y no por el barrel `@gestion/shared`: el barrel usa imports relativos sin
// extension (`./lib/schemas/auth`), que el ESM de Node no resuelve (mismo motivo por el que los
// componentes importan `@gestion/shared/lib/...`).
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { cashReceiptCategorySchema } from "@gestion/shared/lib/schemas/cash-receipt-category.ts";
import { paymentMethodSchema } from "@gestion/shared/lib/schemas/payment-method.ts";
import { ApiError } from "../api/client.ts";
import {
  createPaymentMethod,
  createReceiptCategory,
  updatePaymentMethod,
  updateReceiptCategory,
} from "../api/client.ts";

interface CapturedCall {
  url: string;
  method: string;
  body: unknown;
}

const originalFetch = globalThis.fetch;
let calls: CapturedCall[] = [];

function stubFetch(status: number, payload: unknown): void {
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
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("createPaymentMethod", () => {
  it("manda el codigo normalizado por el schema compartido", async () => {
    stubFetch(201, { id: "m-1", code: "PAGO_LINK", name: "Pago link", isActive: true });

    // El schema compartido es el contrato del formulario: normaliza el codigo a mayusculas y
    // espacios a guion bajo, y el API recibe exactamente eso.
    const values = paymentMethodSchema.parse({ code: " pago link ", name: "Pago link " });

    const created = await createPaymentMethod(values);

    assert.equal(created.id, "m-1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]!.url, /\/payment-methods$/);
    assert.deepEqual(calls[0]?.body, {
      code: "PAGO_LINK",
      name: "Pago link",
      isActive: true,
    });
  });

  it("propaga el 409 del codigo duplicado con el mensaje del API", async () => {
    stubFetch(409, {
      statusCode: 409,
      message: 'Ya existe un método de pago con el código "EFECTIVO".',
    });

    await assert.rejects(
      () => createPaymentMethod({ code: "EFECTIVO", name: "Efectivo", isActive: true }),
      (error: unknown) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal(error.message, 'Ya existe un método de pago con el código "EFECTIVO".');
        return true;
      },
    );
  });
});

describe("updatePaymentMethod", () => {
  it("manda solo los campos del PATCH parcial, sin el codigo", async () => {
    stubFetch(200, { id: "m-1", code: "EFECTIVO", name: "Efectivo", isActive: false });

    await updatePaymentMethod("m-1", { isActive: false });

    assert.equal(calls[0]?.method, "PATCH");
    assert.match(calls[0]!.url, /\/payment-methods\/m-1$/);
    assert.deepEqual(calls[0]?.body, { isActive: false });
  });
});

describe("createReceiptCategory", () => {
  it("no manda codigo: el API lo deriva del nombre", async () => {
    stubFetch(201, {
      id: "c-1",
      direction: "EGRESO",
      name: "Comisión mensual",
      code: "COMISION_MENSUAL",
      isActive: true,
    });

    const values = cashReceiptCategorySchema.parse({
      direction: "EGRESO",
      name: "Comisión mensual",
    });

    // La prueba de que el codigo no viaja: el schema compartido del alta no tiene esa clave, y el
    // body que sale del cliente tampoco.
    assert.equal("code" in values, false);

    const created = await createReceiptCategory(values);
    const body = calls[0]?.body as Record<string, unknown>;

    assert.equal(created.code, "COMISION_MENSUAL");
    assert.equal(calls[0]?.method, "POST");
    assert.match(calls[0]!.url, /\/receipt-categories$/);
    assert.deepEqual(body, {
      direction: "EGRESO",
      name: "Comisión mensual",
      isActive: true,
    });
    assert.equal("code" in body, false);
  });
});

describe("updateReceiptCategory", () => {
  it("renombrar no re-deriva el codigo", async () => {
    stubFetch(200, {
      id: "c-1",
      direction: "EGRESO",
      name: "Comisión bancaria",
      code: "COMISION_MENSUAL",
      isActive: true,
    });

    await updateReceiptCategory("c-1", { name: "Comisión bancaria" });

    assert.equal(calls[0]?.method, "PATCH");
    assert.match(calls[0]!.url, /\/receipt-categories\/c-1$/);
    assert.deepEqual(calls[0]?.body, { name: "Comisión bancaria" });
  });
});
