# "Hoy" en la app: la zona del negocio, no la del proceso

`main` esta rojo de forma intermitente (`1 de 130` tests del API) y no es un test fragil: es un bug de
producto que el test detecta en una ventana de cinco horas por dia.

## El sintoma

`GET /cartera/resumen` devuelve `receivable.overdueCount = 2` mientras la misma base, consultada con
la semantica del origen, da 0. En CI falla solo cuando corre entre **00:00 y 05:00 UTC**, que en Lima
es 19:00 a 24:00.

## La causa

| Pieza | De donde saca "hoy" |
| --- | --- |
| seeds y fixtures | `(now() at time zone 'America/Lima')::date` (`apps/api/test/support/fixtures.ts:34`) |
| API | `getTodayLocalDate()` (`packages/shared/src/lib/utils.ts:26-32`): `getFullYear/getMonth/getDate` del **proceso** |

En el runner de CI el proceso corre en UTC, asi que a partir de las 00:00 UTC el "hoy" del API va un
dia adelante del "hoy" del negocio. Los comprobantes `CONTADO` tienen `effective_due_date =
issue_date`, o sea hoy en Lima, y el API los clasifica como **vencidos** durante cinco horas.

Consecuencia fuera del test: de 19:00 a 24:00 (hora de Lima) **todo documento que vence hoy aparece
como vencido**, con su `overdueAmount`. En una app de cobranzas eso mueve la prioridad de cobro y los
totales que ve el usuario.

## Specs

**S1.** `getTodayLocalDate()` devuelve la fecha en la zona del negocio, `America/Lima`, no la del
proceso, sea cual sea el `TZ` del host. Su firma y su contrato no cambian (sigue siendo `YYYY-MM-DD`);
lo que cambia es de que reloj sale.

**S2.** Un test unitario lo fija sin depender de la hora a la que se corra: para un instante dado en
UTC dentro de la ventana (p. ej. `2026-11-24T03:30:00Z`, que en Lima es `2026-11-23`), la funcion
devuelve la fecha de Lima. El test corre con `TZ` forzado a UTC para probar el caso que hoy rompe.

**S3.** No hay regresiones: `pnpm --filter @gestion/api test` 130/130 con `TZ=UTC`, y
`pnpm --filter @gestion/web test` + `pnpm typecheck` en verde. La suite del API es el criterio fuerte:
hoy falla en la ventana, despues del arreglo no puede fallar en ninguna.

**S4.** Si hay otros lugares que derivan "hoy" del reloj del proceso para decisiones de negocio, se
listan en el reporte con `path:line` — **arreglarlos no es parte de esta tarea** salvo que sean el
mismo helper.

## Tasks

| ID | Spec | Ruta |
| --- | --- | --- |
| T1 | S1, S2 | worker: el helper y su test unitario |
| T2 | S3 | worker: suites completas con `TZ=UTC` |
| T3 | S4 | worker: inventario de otros relojes de negocio |

## Log

**L1** (usuario): "cual iniciamos primero". Contexto: quedan el rojo de `main`, el slice de pagos y el
commit de las seis skills de better-auth. Se elige el rojo de `main` porque las otras dos se apoyan en
una base verde.

**L2** Fallo de CI, run `45323951857` sobre `main` = `65f0cc8`: `not ok 104 - GET /cartera/resumen
agrega los buckets del dueno de la sesion`, `AssertionError: 2 !== 0`, `location
apps/api/test/payments.e2e.test.ts:744`. El mismo codigo paso verde en el run `45284753449` (`76bdb0f`);
entre ambos solo se mergearon archivos `.md`.

**L3** Correccion de lectura del parent: el assert que rompe es
`payments.e2e.test.ts:777` = `assert.equal(result.body.receivable.overdueCount, ...)`, **no** el de
`payable` (`:779`). La primera lectura del log atribuyo el fallo a `payable` y quedo descartada.

**L4** Diagnostico (explorador, con evidencia): no es fuga entre duenos — el scope lo hace RLS
(`with-owner.ts:44-46` + vista `security_invoker` + politica `comprobante_select`); y ningun test crea
comprobantes `COMPRA`, asi que tampoco es contaminacion de fixture. Si hubiera fuga el numero seria 3.

**L5** Causa: discrepancia de zona horaria entre el "hoy" del negocio (Lima, en seeds y fixtures) y el
del proceso (UTC en el runner). La clase de bug ya habia aparecido una vez del lado de los fixtures
(commit `83ee045`); esta es la mitad que faltaba, del lado de la app.

**L6** Quedaban dos `default()` de `openingBalanceDate` en
`packages/shared/src/lib/schemas/cash-account.ts:59,114` con `new Date().toISOString().slice(0, 10)`,
o sea UTC: de 19:00 a 24:00 en Lima la cuenta nacia con la fecha de MAÑANA, mientras la fila, los
seeds y el resto del API usaban la fecha del negocio. Se cierran con `getTodayLocalDate()` y un test
unitario en `apps/web/lib/cajas-bancos/cuenta-fecha-apertura.test.ts` que fija el reloj con
`mock.timers` en `2026-11-24T03:30:00Z` (22:30 del 23 en Lima) y lleva como control el valor que daba
la lectura vieja, asi que volver a `toISOString()` lo pone en rojo.

Para que el runner de Node pueda cargar ese schema hizo falta que el import interno resuelva en ESM:
`packages/shared/tsconfig.json` habilita `allowImportingTsExtensions` y el import pasa a `../utils.ts`
— el mismo criterio que `apps/web` y `apps/api` ya tenian. Los otros tres schemas de la carpeta siguen
con `"../utils"` porque nadie los carga fuera de un bundler.

Inventario de S4, cerrado: ningun otro lugar deriva el "hoy" de negocio del reloj del proceso.
`apps/web/lib/cajas-bancos/periodo.ts:31` usa `toISOString()` sobre aritmetica de calendario en UTC
con la fecha entrando por parametro (`parseIsoDate` / `Date.UTC`), no sobre el reloj.
