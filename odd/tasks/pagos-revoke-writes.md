# Pagos: revocar UPDATE/DELETE donde sólo escriben las RPC

La misma clase de exposición que cerro L12(a) en cajas, ahora en el modulo de pagos. El mapa ya esta
medido: la pregunta no es "que se puede revocar" sino "quien escribe cada tabla", y en casi todas la
respuesta es una funcion `security definer`.

## Specs

**S1 — se revoca `UPDATE`/`DELETE` de `authenticated` en:** `comprobante`, `voucher_series`,
`receipt_sequence`. Ningun camino de la app las escribe con DML directo: `comprobante` la escriben
`private.refresh_comprobante_status` y `refresh_referenced_status` (definer), `receipt_sequence` la
escribe `private.next_receipt_serial` (definer, invocada por trigger), y `voucher_series` **no la
escribe nadie** — cero filas, cero consumidores. Idempotente, estilo `20261029101500`.

**S2 — `payment` NO se toca.** Conserva `update (entity_id, status, void_reason, voided_at)` porque
`apps/api/src/payments/payments.service.ts:243-245` y `:288-290` la actualizan con DML directo del rol
de la app: anular un pago y asignarle entidad. Revocar ahi rompe dos pantallas. El `INSERT` de
`payment` es privilegio muerto (no hay politica de INSERT desde `20261028194204:67`) pero **no se
revoca**: mismo criterio que L12(a), no ampliar el alcance sin pedido.

**S3 — las dos vistas quedan documentadas, no revocadas a ciegas.** `payment_balance` y
`voucher_balance` son vistas `security_invoker` con `group by`, o sea no auto-actualizables: sus
grants de escritura son de catalogo y no de comportamiento. Si se revocan, es higiene y el comentario
de la migracion tiene que decir exactamente eso, no "cerramos una escritura".

**S4 — el guard de RLS sigue probando lo que dice.** Las aserciones de
`packages/db/scripts/check-rls-enforcement.mjs` que toquen estas tablas se actualizan si cambian de
resultado (0 filas vs 42501), el snapshot `schema-snapshot.sql` se regenera, y si el total de
aserciones cambia se actualizan los cuatro lugares que publican el numero. Ninguna asercion se
borra: si una deja de aplicar, se explica en el reporte.

**S5 — nada se rompe.** `pnpm --filter @gestion/api test` completo en verde (134 al escribir esto) y
`pnpm typecheck` en 0. Es el criterio fuerte: el modulo de pagos es el que mas e2e tiene.

## Tasks

| ID | Spec | Ruta |
| --- | --- | --- |
| T1 | S1, S2, S3 | worker: migracion nueva |
| T2 | S4 | worker: check-rls + snapshot + conteos |
| T3 | S5 | worker: suites |

## Log

**L1** (usuario): "dale arranca", sobre el slice de pagos. Antes se cerro el rojo de `main` (#17, zona
horaria) y el fixture de credencial (#18).

**L2** Mapa del explorador, con evidencia: `comprobante` tiene DELETE concedido y **sin politica** de
DELETE (`20261015053016:53` la dropeo) → inerte; `receipt_sequence` tiene DML completo y **cero
politicas** (la unica se dropeo en `20261003050013:71`) → inerte; `voucher_series` tiene CRUD completo,
politica CRUD completa (`20261026215202:28-35`) y **ningun escritor** en todo el repo; `payment_balance`
y `voucher_balance` son vistas `security_invoker`; `payment` es la unica con escritor directo real.

**L3** Leccion de L12(a) aplicada: la premisa se contrasta contra el codigo **antes** de escribir la
migracion. En cajas la deuda pedia grants por columna y no hacian falta; aca la deuda no existia como
documento y el mapa la construyo.
