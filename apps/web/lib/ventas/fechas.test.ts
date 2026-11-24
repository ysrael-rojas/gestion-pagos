// Fechas del comprobante (T4 del port del vertical ventas, S9).
//
// El formulario NO escribe `due_date`: es columna generada (`issue_date + credit_days`, solo en
// CREDITO). Lo que se prueba aca es la VISTA PREVIA que el usuario ve mientras tipea, y la regla
// que el origen calculaba con `new Date(year, month-1, day)` — o sea con la zona del navegador —
// que es justo la clase de bug que este monorepo cerro (`odd/tasks/hoy-en-zona-del-negocio.md`):
// un usuario en Madrid y uno en Lima verian vencimientos distintos para la misma venta.
//
// La aritmetica es sobre `Date.UTC` y devuelve texto `YYYY-MM-DD`, igual que `addDays` de
// `lib/cajas-bancos/periodo.ts` (otro vertical, misma razon).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addDays, calculateDueDate } from "./fechas.ts";

describe("addDays", () => {
  it("suma dias dentro del mes y cruza fin de mes", () => {
    assert.equal(addDays("2026-03-15", 1), "2026-03-16");
    assert.equal(addDays("2026-03-15", 30), "2026-04-14");
    assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  });

  it("cruza fin de anio y acepta dias negativos", () => {
    assert.equal(addDays("2026-12-25", 10), "2027-01-04");
    assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  });

  it("respeta el 29 de febrero de un anio bisiesto", () => {
    assert.equal(addDays("2024-02-28", 1), "2024-02-29");
    assert.equal(addDays("2024-02-29", 1), "2024-03-01");
  });
});

describe("calculateDueDate", () => {
  it("suma los dias de credito a la fecha de emision", () => {
    assert.equal(calculateDueDate("2026-03-15", 30), "2026-04-14");
    assert.equal(calculateDueDate("2026-11-24", 15), "2026-12-09");
  });

  it("devuelve vacio cuando no hay fecha, no hay dias o los dias no son validos", () => {
    assert.equal(calculateDueDate("", 30), "");
    assert.equal(calculateDueDate("2026-03-15", null), "");
    assert.equal(calculateDueDate("2026-03-15", undefined), "");
    assert.equal(calculateDueDate("2026-03-15", 0), "");
    assert.equal(calculateDueDate("2026-03-15", -5), "");
    // Medio dia de credito no existe: media fecha de vencimiento tampoco.
    assert.equal(calculateDueDate("2026-03-15", 1.5), "");
  });
});
