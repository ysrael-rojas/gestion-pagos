// Reglas de fecha del cuadre de caja (C5 del vertical de cajas-bancos).
//
// Port de `tests/unit/lib/caja/periodo.test.ts` del origen (vitest) a `node:test`. Las tres
// funciones que se prueban aca deciden cosas que la base NO puede decidir por la UI: que periodo
// se propone al cerrar, desde que dia se pueden registrar movimientos y si una fecha ya quedo
// bloqueada por un cierre. Se prueban solas porque sin red y sin reloj son deterministas: la
// fecha "hoy" siempre entra por parametro.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, firstOpenDate, getMonthRange, isDateClosed, suggestedPeriodEnd } from "./periodo.ts";

describe("suggestedPeriodEnd", () => {
  // 2026-10-06 es martes.
  it("DAILY sugiere ayer", () => {
    assert.equal(suggestedPeriodEnd("DAILY", "2026-10-06"), "2026-10-05");
  });

  it("WEEKLY sugiere el domingo anterior", () => {
    assert.equal(suggestedPeriodEnd("WEEKLY", "2026-10-06"), "2026-10-04");
  });

  it("WEEKLY cuando hoy es domingo retrocede una semana completa", () => {
    // 2026-10-04 es domingo: si no retrocediera la semana entera propondria hoy mismo.
    assert.equal(suggestedPeriodEnd("WEEKLY", "2026-10-04"), "2026-09-27");
  });

  it("MONTHLY sugiere el ultimo dia del mes anterior", () => {
    assert.equal(suggestedPeriodEnd("MONTHLY", "2026-10-06"), "2026-09-30");
  });

  it("MONTHLY en enero cae en diciembre del ano anterior", () => {
    assert.equal(suggestedPeriodEnd("MONTHLY", "2026-01-15"), "2025-12-31");
  });
});

describe("addDays", () => {
  it("suma dias cruzando fin de mes", () => {
    assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  });

  it("resta dias cruzando ano", () => {
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  });
});

describe("firstOpenDate", () => {
  it("es el dia siguiente al ultimo cierre", () => {
    assert.equal(firstOpenDate("2026-10-31", "2026-11-05"), "2026-11-01");
  });

  it("es hoy cuando la cuenta no tiene cierres", () => {
    assert.equal(firstOpenDate(null, "2026-11-05"), "2026-11-05");
  });
});

describe("getMonthRange", () => {
  it("devuelve el primer y el ultimo dia del mes de la fecha", () => {
    assert.deepEqual(getMonthRange("2026-10-06"), {
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });

  it("respeta febrero en ano bisiesto y no bisiesto", () => {
    assert.equal(getMonthRange("2028-02-10").end, "2028-02-29");
    assert.equal(getMonthRange("2027-02-10").end, "2027-02-28");
  });

  it("cierra diciembre en el mismo ano", () => {
    assert.deepEqual(getMonthRange("2026-12-20"), {
      start: "2026-12-01",
      end: "2026-12-31",
    });
  });
});

describe("isDateClosed", () => {
  it("es verdadero para una fecha dentro del periodo cerrado, inclusive su fin", () => {
    assert.equal(isDateClosed("2026-10-31", "2026-10-31"), true);
    assert.equal(isDateClosed("2026-10-15", "2026-10-31"), true);
  });

  it("es falso para una fecha posterior al cierre", () => {
    assert.equal(isDateClosed("2026-11-01", "2026-10-31"), false);
  });

  it("es falso cuando no hay cierres", () => {
    assert.equal(isDateClosed("2026-10-15", null), false);
  });
});
