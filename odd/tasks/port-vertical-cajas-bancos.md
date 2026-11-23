# T5c — Vertical `cajas-bancos`

Tercer vertical del port: caja y bancos (cuentas, posiciones, cuadres y arqueos, transferencias,
caja chica, conciliación, extractos y configuración). ~9.900 líneas de UI en el origen, 8 slices.
Fuente del port: `C:/Users/Lenovo/Desktop/devtalles/OpenCode/gestion-app` (solo lectura).

## Specs

- **S1 — Alcance (verbatim del usuario).** "arranca cajas-bancos". Port completo del vertical (doc
  padre, S4): dominio, UI y e2e. La capa Supabase no se porta: `apps/web` consume `apps/api` (padre,
  S8). El dominio peruano del vertical (arqueo, conciliación, caja chica, ITF, detracciones) se rige
  por `.agents/skills/caja-bancos-mype/SKILL.md`, que es autoridad para procedimientos y controles.
- **S2 — El saldo lo calcula la base, nunca la app.** La fórmula es
  `opening_balance + ingresos − egresos (status <> 'ANULADO') ± transferencias`, y la app solo
  muestra lo que devuelve una función SQL; no puede persistir un saldo calculado en JS.
  **Corregido en L10**: `private.cash_expected_balance` es la fórmula de las rutas que ESCRIBEN
  dinero (`close_cash_account`, `register_cash_count` la usan), pero `get_cash_position` y
  `get_cash_positions` la reimplementan inline. O sea que la "única fórmula" son en realidad tres
  definiciones en SQL: cambiar la semántica exige tocar las tres.
- **S3 — Cierre y arqueo son RPC, no DML.** `close_cash_account` y `register_cash_count` son
  `security definer`. Si el port intentara escribir `cash_close`/`cash_close_denomination`/
  `cash_count` directamente, falla con 42501. **Corregido en L12**: el revoke de
  `20261006063301` lo revirtió `20261029101500:96` (grant table-wide a `authenticated`), así que
  hoy lo que rechaza el DML directo es la RLS — esas tablas solo tienen política SELECT — y el
  SQLSTATE sigue siendo 42501. El efecto observable es el mismo que afirmeaba la spec; el
  mecanismo no.
- **S4 — El cierre es irreversible y valida en SQL.** No hay reapertura. La base rechaza
  `period_end > current_date`, un período ya cerrado (`El periodo ya esta cerrado hasta %`), un
  `period_end` anterior al saldo inicial, y una diferencia mayor a
  `app_setting.cash_difference_tolerance` sin motivo (default 0.50).
- **S5 — La concurrencia se serializa en la base.** El cierre toma `for update` sobre la cuenta y
  `unique (cash_account_id, period_end)`; el vale de caja chica toma `for update` y `unique
  (account_id, serial)`. Ningún slice valida en Node antes de escribir.
- **S6 — Aislamiento por dueño (verbatim del doc padre, S2).** "Ninguna query puede escapar del
  dueño aunque el servicio olvide filtrar." Toda escritura y lectura pasa por `withOwner`, y ningún
  input acepta `owner_id`.
- **S7 — `ensureDefaultSettings` explícito, nunca en un render.** Se porta como `POST
  /settings/ensure` idempotente (`default_closing_periodicity`, `pen_usd_rate`, `cash_difference_tolerance`),
  con el mismo criterio que ya se aplicó a `POST /catalogs/ensure`: un GET que escribe no es
  comportamiento a preservar. Cierra la deuda L67.
- **S8 — El dinero circula por los endpoints que ya existen.** Un cargo bancario (ITF, comisión,
  detracción) y un movimiento de caja son `POST /payments` con `isCashMovement: true`; el vertical
  no inserta `payment` directo.
- **S9 — Verificación.** Tests de API por slice contra base viva, `node --test` para los helpers
  puros de la web, e2e de Playwright del vertical, y `db:dump --check` verde si el slice toca
  `packages/db`. Las tablas nuevas entran en el baseline y en el teardown del e2e **antes** de que
  un spec las use (hoy `deleteOwnerFixtures` borra `cash_account` antes que sus hijas y revienta por
  FK).

## Tasks

- C1 — Settings: `GET/PATCH /settings`, `POST /settings/ensure` (cierra L67) + `lib/cajas-bancos/settings.ts`.
  Specs: S7, S6. Ruta: worker. **Hecho**: 7/7 del e2e nuevo, baseline de catálogos 6/6,
  typecheck api+web verde, commit: _(pendiente)_.
- C2 — Cuentas: `POST/PATCH /cash-accounts`, `POST /cash-accounts/:id/delete`, DTO completo.
  Specs: S1, S6. Ruta: worker. **Hecho**: 8/8 del e2e nuevo, catálogos 6/6, typecheck verde,
  commit `c260e41`.
- C3 — Posiciones y fechas: `GET /cash-positions`, `/cash-accounts/:id/position`, `/last-movement-dates`.
  Specs: S2, S6. Ruta: pendiente. Commit: _(pendiente)_.
- C4 — Cierres y arqueos por RPC: `GET/POST /cash-closes`, `GET/POST /cash-counts`.
  Specs: S2, S3, S4, S5. Ruta: worker + verificación independiente. **Hecho**: 10/10 del e2e nuevo,
  `payments` 18/18 y catálogos 6/6 verdes, commit: _(pendiente)_.
- C5 — Pantallas base: provider con escritura, listado, cuentas, cuadres, acta y reporte impresos.
  Specs: S1, S4. Ruta: pendiente. Commit: _(pendiente)_.
- C6 — Transferencias, caja chica y extractos.
  Specs: S5, S8. Ruta: pendiente. Commit: _(pendiente)_.
- C7 — Conciliación, configuración y dashboard/proyección.
  Specs: S1, S2. Ruta: pendiente. Commit: _(pendiente)_.
- C8 — e2e del vertical, teardown y baseline de las tablas de caja, RLS y docs.
  Specs: S9. Ruta: pendiente. Commit: _(pendiente)_.

## Cortes de entrega

Rama `feat/vertical-cajas-bancos`. Un commit por slice.

- **Slice 2 — `c260e41`** `feat(api)`: cuentas (escritura + lectura completa, ~586 líneas de
  implementación y 594 de test). El test es grande a propósito: cubre el alta por tipo, el CHECK del
  banco, el aislamiento entre dueños y que `GET /cash-accounts` no cambió de forma.
- **Slice 1 — `7328a02`** `feat(api)`: settings + ensure (1.138 líneas de diff, ~340 autoradas de
  implementación + 394 de test + el documento). Pasa las ~400 por commit porque el e2e del
  slice es grande y el documento de la feature entra en el mismo commit; la implementación sola
  son ~240 líneas en 5 archivos. Revisar `settings.service.ts` (semántica del ensure) y
  `settings.types.ts` (los tres valores sembrados).

## Log

- **L1 (usuario, verbatim).** "arranca cajas-bancos"
- **L2 — Recon (gentle-ai-explore).** Los schemas Zod del vertical ya están en `packages/shared` y
  los helpers puros `denominaciones`/`conciliacion-tipos` también: no se re-portan. El origen no
  tiene server actions (todo es PostgREST desde el cliente) y ningún componente importa Supabase:
  llaman a `lib/caja/*`, que es lo que se sustituye por `apps/api`.
- **L3 — La regla que ordena todo el vertical.** Cierres y arqueos son RPC con grants revocados: el
  port es "llamar la función", no "escribir la tabla". Recalcular saldos en Node no solo divergiría:
  fallaría por permisos (L3 del recon, riesgo 1).
- **L4 — Deuda L67 dentro del alcance.** `ensureDefaultSettings` no está portado y sin él
  `close_cash_account` cae a `DAILY`/`0.50` y `create_petty_cash_vale` muere por falta del método
  `EFECTIVO` y de una categoría EGRESO. Por eso C1 va primero: es el único slice sin matemática de
  dinero y desbloquea los tests de C4 y C6 con una tolerancia real.
- **L5 — Riesgo de infraestructura de test (riesgo 5 del recon).** `deleteOwnerFixtures` de
  `apps/web/e2e/support/owner.ts` borra `cash_account` antes de `cash_transfer`, `cash_count`,
  `cash_close_denomination` y `bank_reconciliation`, y el baseline de `e2e/support/database.ts` no
  cuenta esas tablas. Hoy no se nota porque ningún spec las usa; el primer spec de cajas rompería
  el teardown por FK. C8 lo arregla, y ningún spec de cajas corre antes.
- **L7 — C1, decisiones que la revisión tiene que mirar.** El sembrado cuenta por PRESENCIA de
  fila (no compara valor) y usa `onConflictDoNothing`: mismo efecto observable que el origen
  (que comparaba valor y se tragaba el `23505`), contado como filas creadas. La tolerancia se
  siembra `"0.50"` y no `"0.5"`: el origen empuja `"0.5"` (`lib/caja/caja.ts:377`) pero la
  migración `20261027202707` insertó `'0.50'` para los dueños existentes, y el `value` se castea
  `::numeric(12,2)` en la base: el número es el mismo. Se eligió quedar byte-idéntico a lo migrado.
- **L8 — Deuda que C1 deja anotada.** `deleteOwnerFixtures` (api y web) no borra `app_setting` y la
  tabla no tiene FK a `auth.users`, así que cada test limpia las suyas; C8 lo lleva al teardown
  común. El barrel `apps/api/src/db/schema/index.ts` no se tocó: el servicio importa el schema
  directo (una línea de seguimiento si se quiere consistencia).
- **L12 — C4: tres correcciones y una desviación de proceso.** (a) S3 describía mal el mecanismo
  (ver arriba): el INSERT directo lo bloquea la RLS, no los grants. (b) El body de cierre se arma
  con `z.object(cashCloseSchema.shape)` a propósito: el `superRefine` del schema compartido rechaza
  fechas futuras con el reloj del proceso, y ese juicio es de la base (`period_end > current_date`,
  zona del contenedor). Se conservan todas las reglas de campo y se descarta solo la de objeto; la
  rama SQL queda alcanzable y sigue devolviendo su mensaje. (c) El puente no tenía `cash-closes` ni
  `cash-counts`: agregados, como en C3. (d) **El worker no capturó el RED**: escribió test e
  implementación en el mismo hilo, así que las 10 pruebas verdes no prueban por sí solas que fallen
  sin la implementación. Se compensa con verificación independiente y con la observación de
  concurrencia (dos `fetch` simultáneos → `[201, 400]` y una sola fila), que es evidencia real y no
  una aserción de lectura.
- **L10 — Corrección de la spec (error del padre) y hallazgo de C3.** Verificado con
  `pg_get_functiondef` en la base viva: `close_cash_account` y `register_cash_count` **sí**
  referencian `private.cash_expected_balance`; `get_cash_position` y `get_cash_positions`
  **no** (position 0 en su definición), reimplementan la fórmula inline. S2 afirmaba una fórmula
  única: era falso. Consecuencia práctica: cualquier cambio de semántica del saldo hay que hacerlo
  en tres lugares, y por eso C4 (que llama a los RPC de escritura) no debe "ayudar" recalculando
  nada en Node — de eso no se salva ningún camino.
- **L11 — Hallazgo de C3: el puente no alcanzaba dos rutas nuevas.** `cash-positions` y
  `last-movement-dates` no estaban en la lista blanca de `app/api/backend/[...path]/route.ts`, así
  que el navegador recibía 404 del puente con la ruta existiendo en el API. Agregadas en este
  slice: son rutas de lectura y el prefijo ya estaba acotado por recurso.
- **L9 — El bug de fechas estaba también en el fixture del API.** Al verificar C2, `payments.e2e`
  quedó **14/18**: los tests arman `paymentDate` con `getTodayLocalDate()` (Lima) mientras
  `apps/api/test/support/fixtures.ts` creaba la cuenta y los comprobantes con el `current_date` del
  contenedor (UTC). Misma clase que L15 del vertical de clientes, pero del lado del API, y por eso
  el mismo arreglo: `APP_TODAY = (now() at time zone 'America/Lima')::date` en las cinco fechas del
  fixture. Evidencia: 14/18 antes, **18/18** después, con el mismo reloj.
  El arreglo destapó una segunda inconsistencia, tapada por casualidad: la expectativa del test de
  `/cartera/resumen` calculaba el vencimiento con el `current_date` del contenedor, mientras el API
  lo calcula con "hoy" local. Con las fechas alineadas, el test comparaba dos nociones distintas de
  hoy (0 !== 2). La expectativa usa ahora `APP_TODAY`; el API no se tocó, porque el correcto es el
  suyo: un comprobante que vence hoy no está vencido para el negocio.
- **L6 — Orden de slices acordado (recon, seccion 7).** C1 settings, C2 cuentas, C3 posiciones,
  C4 cierres/arqueos, C5 pantallas base, C6 transferencias/caja chica, C7 conciliación y
  configuración, C8 e2e y RLS. C4 lleva riesgo 1 (irreversible) y 4 (concurrencia) y por eso va con
  verificación independiente.
