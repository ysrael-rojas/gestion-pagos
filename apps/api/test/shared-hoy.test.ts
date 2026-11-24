// "Hoy" es la fecha del negocio (`America/Lima`), no la del proceso.
//
// El bug que fija este test: `getTodayLocalDate()` sacaba el anio/mes/dia del reloj del proceso.
// En el runner de CI (TZ=UTC) el "hoy" del API iba un dia adelante del "hoy" de los seeds y sus
// fixtures (`(now() at time zone 'America/Lima')::date`), asi que entre las 00:00 y las 05:00 UTC
// todo comprobante `CONTADO` que vencia hoy aparecia como vencido con su `overdueAmount`.
//
// Los dos casos fijan el instante con `mock.timers`, asi que no dependen de cuando se corra la
// suite: sin eso el test solo seria rojo cinco horas por dia. El primero cae dentro de la ventana
// (en Lima todavia es el dia anterior al de UTC) y el segundo es un mediodia, donde las dos
// lecturas coinciden; sin el segundo, una funcion que devolviera una constante pasaria igual.
import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { getTodayLocalDate } from "@gestion/shared/lib/utils.ts";

// El TZ que rompe la implementacion vieja; el del runner de CI. Se declara en el archivo, no en el
// comando, para que el caso no se pierda si alguien corre el test a mano con el TZ del host.
process.env.TZ = "UTC";

/** Fija el reloj del proceso en un instante UTC concreto. */
function freezeAt(instant: string): void {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(instant) });
}

afterEach(() => {
  mock.timers.reset();
});

describe("getTodayLocalDate", () => {
  it("corre con TZ=UTC, el reloj que hoy rompe", () => {
    // Si el proceso no fuera UTC el caso de la ventana podria pasar por accidente.
    assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "UTC");
  });

  it("dentro de la ventana devuelve el dia de Lima, no el de UTC", () => {
    // 2026-11-24T03:30:00Z son las 22:30 del 23 de noviembre en Lima: UTC ya cambio de dia.
    freezeAt("2026-11-24T03:30:00Z");

    assert.equal(getTodayLocalDate(), "2026-11-23");
  });

  it("al mediodia devuelve el mismo dia que UTC", () => {
    // 2026-11-23T17:00:00Z son las 12:00 del 23 en Lima: aca las dos lecturas coinciden, y es lo
    // que prueba que la funcion sigue leyendo el reloj en vez de devolver una fecha fija.
    freezeAt("2026-11-23T17:00:00Z");

    assert.equal(getTodayLocalDate(), "2026-11-23");
  });
});
