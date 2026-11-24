// Fecha de apertura de una cuenta de caja/banco (el resto de S4 de
// `odd/tasks/hoy-en-zona-del-negocio.md`).
//
// Los dos `default()` de `openingBalanceDate` eran `new Date().toISOString().slice(0, 10)`, o sea
// UTC. De 19:00 a 24:00 en Lima la cuenta nacia con la fecha de MANANA, mientras los seeds, los
// fixtures y el resto del API usan la fecha del NEGOCIO (`(now() at time zone 'America/Lima')::date`
// y `getTodayLocalDate()`). Es la mitad del bug que #17 arreglo en el helper; esta es la mitad que
// quedaba en los schemas.
//
// El reloj se fija con `mock.timers` de `node:test` para no depender de la hora a la que se corra el
// test: `2026-11-24T03:30:00Z` es 22:30 del 23 de noviembre en Lima, el instante exacto en el que las
// dos lecturas discrepan. El control explicito —`toISOString()` da otro dia en ese mismo instante—
// es lo que hace que volver a `toISOString()` ponga esto en rojo, corra cuando corra.
//
// Los schemas se importan por subruta y con extension por el mismo motivo que `catalogos.test.ts`:
// el barrel `@gestion/shared` usa imports relativos sin extension que el ESM de Node no resuelve.
import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import {
  cashAccountFormSchema,
  cashAccountSchema,
} from "@gestion/shared/lib/schemas/cash-account.ts";

// 22:30 del 23 de noviembre en Lima; 03:30 del 24 en UTC.
const LATE_EVENING_IN_LIMA = Date.parse("2026-11-24T03:30:00Z");

const freezeClockAtLateEvening = (t: TestContext) => {
  t.mock.timers.enable({ apis: ["Date"], now: LATE_EVENING_IN_LIMA });
};

describe("openingBalanceDate por defecto", () => {
  it("sin fecha, la cuenta nace con la fecha del negocio y no con la de UTC", (t) => {
    freezeClockAtLateEvening(t);

    // Control: en este instante la lectura vieja (UTC) daba el dia siguiente. Si alguien vuelve a
    // `toISOString()`, el primer assert de abajo pasa a devolver "2026-11-24" y este test falla.
    const utcReading = new Date().toISOString().slice(0, 10);
    assert.equal(utcReading, "2026-11-24");

    const { openingBalanceDate } = cashAccountSchema.parse({ name: "Caja Lima" });

    assert.equal(openingBalanceDate, "2026-11-23");
  });

  it("el formulario usa la misma fecha que el contrato de la fila", (t) => {
    freezeClockAtLateEvening(t);

    const { openingBalanceDate } = cashAccountFormSchema.parse({
      type: "CASH_BOX",
      name: "Caja Lima",
    });

    assert.equal(openingBalanceDate, "2026-11-23");
  });

  it("una fecha escrita por el usuario no se reemplaza por el default", (t) => {
    freezeClockAtLateEvening(t);

    const fromRow = cashAccountSchema.parse({
      name: "Caja Lima",
      openingBalanceDate: "2026-01-05",
    });
    const fromForm = cashAccountFormSchema.parse({
      type: "CASH_BOX",
      name: "Caja Lima",
      openingBalanceDate: "2026-01-05",
    });

    assert.equal(fromRow.openingBalanceDate, "2026-01-05");
    assert.equal(fromForm.openingBalanceDate, "2026-01-05");
  });

  it("una fecha con otro formato sigue rechazandose con el mismo mensaje", () => {
    for (const schema of [cashAccountSchema, cashAccountFormSchema]) {
      const result = schema.safeParse({
        type: "CASH_BOX",
        name: "Caja Lima",
        openingBalanceDate: "05/01/2026",
      });

      assert.equal(result.success, false);
      assert.equal(
        result.error?.issues.find((issue) => issue.path[0] === "openingBalanceDate")?.message,
        "Fecha inválida (YYYY-MM-DD)"
      );
    }
  });
});
