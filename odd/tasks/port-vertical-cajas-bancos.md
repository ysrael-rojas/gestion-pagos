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

Ordinales para delegacion, uno a uno con los identificadores de esta lista: T1=C1, T2=C2, T3=C3, T4=C4,
T5=C5, T6=C6, T7=C7, T8=C8. El `C<n>` es el nombre historico del slice; el `T<n>` es el mismo slice
con el identificador que exige la admision de escritores delegados. No son tareas distintas.

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
  Specs: S1, S4. Ruta: worker. **Hecho**: 24 archivos, 26 tests unitarios nuevos verdes, typecheck
  verde. Commit: _(pendiente)_.
- C6 — Transferencias, caja chica y extractos.
  Specs: S5, S8. Ruta: dos workers en paralelo con superficies disjuntas (API y web). **Hecho**:
  `cash-transfers.e2e` 8/8 y `petty-cash.e2e` 9/9 contra la base viva, 82/82 unitarios de la web
  (eran 60), typecheck api+web 0, commits `5f08055` (api) y `b7cec9b` (web).
- C7 — Conciliación, configuración y dashboard/proyección.
  Specs: S1, S2. Ruta: dos workers secuenciales (API y web). **Hecho**: `bank-reconciliation.e2e`
  7/7, `cash-flow.e2e` 5/5, `catalogs-write.e2e` 11/11, vecinos `catalogs` 6/6, `payments` 18/18 y
  `cash-closes` 12/12 intactos; 111/111 unitarios de la web, typecheck api+web 0. Commits `cb20674`
  (api) y `368d3f9` (web).
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

- **Slice 3 — `20dd805`** `feat(api)`: cierres y arqueos (12/12). El e2e es el archivo más grande
  del slice: la prueba de que el guard vive en SQL son dos llamadas directas a la RPC en paralelo.
- **Slice 4 — C5** `feat(web)`: pantallas base (24 archivos, ~5.400 líneas de diff, casi todo código
  portado literal del origen; lo autorado de cero son los 4 helpers y sus 26 tests). **Es el slice
  más grande del vertical** y conviene revisarlo por pantalla, no por archivo: listado+cuentas,
  cuadres+cierre/arqueo, y acta/reporte impresos.
- **Slice 5 — `5f08055` + `b7cec9b`** `feat(api)` y `feat(web)`: transferencias, caja chica y
  extractos (C6). Van en DOS commits a propósito: ~3.200 líneas de API y ~7.100 de web, y el corte
  real del slice es la capa, no el slice. **Revisar por comportamiento:** en `5f08055`
  `cash.errors.ts` (la tabla mensaje→status, el reparto 404/400 y la rama 42501) y los mappers
  `to*Record` de los dos servicios (numeric→number, date, ISO y la relectura dentro de la
  transacción); en `b7cec9b` `cuentas-view.tsx` (el `refreshKey` y la intersección
  cuentas∩posiciones) y `cuadre-report.tsx` (el `StatementTable` completo reemplaza a la tabla
  reducida, y el CSV gana la columna `Tipo`).
- **Slice 6 — `cb20674` + `368d3f9`** `feat(api)` y `feat(web)`: conciliación, configuración y
  dashboard (C7). Mismo corte por capa que C6. **Revisar:** en `cb20674`, `cash-flow.service.ts`
  (el filtro copiado del origen, sin predicado de `is_cash_movement`) y
  `bank-reconciliations.controller.ts` (por qué el `null` se escribe a mano); en `368d3f9`,
  `conciliacion.ts` (el body no transporta `difference` ni `reconciledBalance`) y
  `categorias-card.tsx` con el `onlyActive` nuevo.

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
- **L13 — C5: deuda de rendimiento que dejó el port.** `GET /cash-accounts` devuelve 5 columnas
  (contrato del formulario de pagos) y la tabla de cuentas necesita la fila completa, así que el
  provider hidrata con un `GET /cash-accounts/:id` por cuenta (N+1). Se paga al montar el layout,
  no en cada navegación, y con las cuentas que tiene una MYPE es tolerable; la salida limpia es un
  `GET /cash-accounts?full=1` aditivo en el API, que hoy no existe. Sin medir no lo llamo problema,
  pero queda anotado con nombre y archivo.
- **L14 — C5: lo que NO se pudo probar.** Ningún componente se renderizó en un navegador: los
  server/Playwright están prohibidos en los slices de UI por el cuelgue del worker. Eso significa
  que las tres pantallas y los modales están probados por tipos y por los helpers puros, **no por
  comportamiento**. La prueba real es el spec 09 de C8, y hasta entonces la UI de este slice es
  código verificado a medias: no se declara funcionando.
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
- **L15 — C6: el contrato de la base, y el hallazgo de que "extractos" no tiene contrato.** Verificado
  contra las definiciones vivas antes de escribir una línea: `create_cash_transfer(5 args, sin
  defaults) → uuid`, `create_petty_cash_vale(7 args) → uuid`, `replenish_petty_cash(3 args) → uuid`
  (devuelve el `cash_transfer.id` que creó) y `void_petty_cash_vale(1 arg) → void`. Los cuatro son
  `security definer`; los mensajes de negocio salen con SQLSTATE `P0001` y los triggers de
  consistencia de dueño (`20261028194204:36,62`) con `42501`. **Extractos no existe como contrato:**
  no hay tabla, función ni import en `packages/db` (grep por `statement|extracto|import` solo
  devuelve columnas `statement_balance`). En el origen "extractos" es una vista de cliente sobre
  `listAccountStatement` (pagos), que el port ya expone en `GET /cartera/statement/:accountId`: C6 lo
  compone con `GET /cash-transfers?accountId&from&to` y no inventa backend para él. Consecuencia:
  C6 no toca `packages/db` ni necesita migraciones, y `db:dump --check` sigue verde sin cambios — las
  cinco tablas ya están en `schema-snapshot.sql`; lo que falta del baseline es el *conteo* del e2e
  (L5), y eso es C8.
  Se confirma además que estas tablas solo tienen política SELECT: `authenticated` conserva los
  grants de escritura del blanket de `20261029101500:96`, así que el DML directo afecta 0 filas (L12a).
  Toda escritura del slice va por RPC.
- **L16 — C6: lo que el contrato de la base forzo.** (a) `void_petty_cash_vale` devuelve `void` y
  `replenish_petty_cash` devuelve el `cash_transfer.id`, no los vales: el `{ id, status }` de la
  anulacion y el estado `REPUESTO` de la reposicion son la fila RELEIDA dentro de la misma
  transaccion, nunca un valor asumido. (b) La reposicion crea la transferencia con `current_date`
  del contenedor y no con una fecha del cliente: el test lee la fecha de la fila en vez de fijarla.
  (c) El mensaje del limite por vale tiene dos `%` y `p_amount` es `numeric` libre (`150`) mientras
  `petty_expense_limit` es `numeric(12,2)` (`100.00`): se matchea por forma, no por igualdad. (d)
  `createPettyCashValeSchema(expenseLimit)` no puede ser el body del API porque el limite es una
  columna de la cuenta y el juez es la base — mismo criterio que L12(b): se usa el schema base y la
  regla se prueba por el mensaje de la RPC.
- **L17 — C6: `amount` es number, no string.** El brief del padre pedia `"150.00"` y la API devuelve
  numero, como `closes` y `payments`. Se corrigio antes de que el slice web lo consumiera: no se
  introduce una segunda convencion de serializacion en el mismo repo.
- **L18 — C6: la deuda del transporte se cerro en el slice, no se anoto.** El worker web no podia
  escribir en `lib/api/client.ts` (fuera de su superficie) y habia duplicado las seis lineas del
  `fetch`. Se resolvio en el padre: `client.ts` exporta su `request` y
  `lib/cajas-bancos/transporte.ts` lo reexporta. Duplicar dos veces el manejo de errores y las
  credenciales es como divergen, y C7 habria producido una tercera copia.
- **L19 — C6: lo que sigue sin probarse.** Ninguna pantalla de C6 se renderizo en un navegador (la
  regla de L14 sigue vigente para los workers de UI): modales, panel de caja chica, extractos y el
  reporte de cuadre estan probados por tipos y por los helpers puros, no por comportamiento. La
  prueba real es el spec 09 de C8. `app-navbar.tsx` estaba fuera de las superficies del worker: la
  entrada de Extractos la agrego el padre, y con ella se corrigio el comentario que decia "extractos
  NO se enlaza".
- **L20 — C7: el recon que evito construir de mas.** El dashboard no tenia contrato en la base: los
  totales del mes salen de un SELECT sobre `payment`, no de una RPC. El port no podia reusar
  `GET /payments` (topa en `pageSize`) ni sumar paginas en Node, asi que se agrego un agregado en
  SQL con el filtro exacto del origen (`status <> 'ANULADO'` y fechas inclusivas) y SIN predicado de
  `is_cash_movement`: el origen tampoco lo tiene, y agregarlo habria cambiado el numero del
  dashboard. El brief del padre decia "copia su trato de isCashMovement" y era falso; el worker lo
  corrigio en vez de obedecer.
- **L21 — C7: la conciliacion no tiene lectura en SQL.** `save_bank_reconciliation` escribe, pero no
  hay funcion ni vista de lectura: el API lee las dos tablas (politica SELECT) por su cuenta, con
  match EXACTO de `(cuenta, inicio, fin)` y `null` cuando no hay acta. `null` y no 404: "no hay
  conciliacion para ese periodo" es el estado normal que abre un formulario en blanco.
- **L22 — C7: desactivar una categoria era irreversible desde la UI.** `GET /receipt-categories`
  devolvia solo activas, asi que el `PATCH` de reactivacion no tenia fila que lo disparara y una
  categoria desactivada desaparecia para siempre. El writer documento la limitacion en pantalla; el
  padre agrego `onlyActive` con default `true` (aditivo: el formulario de pagos no cambia, pineado
  por `catalogs.e2e` 6/6 mas un test nuevo que fija las dos caras) y el card ahora lista todas.
- **L6 — Orden de slices acordado (recon, seccion 7).** C1 settings, C2 cuentas, C3 posiciones,
  C4 cierres/arqueos, C5 pantallas base, C6 transferencias/caja chica, C7 conciliación y
  configuración, C8 e2e y RLS. C4 lleva riesgo 1 (irreversible) y 4 (concurrencia) y por eso va con
  verificación independiente.
- **L23 — C8: el e2e pago su deuda y encontro dos defectos de producto.** El spec 09 (6 casos) es la
  primera prueba en navegador de las pantallas de C5, C6 y C7, y encontro dos cosas que ningún test
  de API ni de tipos podía ver: (a) el `NavigationMenu` centraba, así que con 15 entradas el
  desborde se repartía a los dos lados y las cinco primeras quedaban en offset negativo, donde el
  navegador no puede scrollear: `Resumen`, `Ingresos`, `Egresos`, `Maestro` y `Caja y bancos` eran
  inalcanzables a 1280px y el click aterrizaba en el logo (el spec 08 ya lo sufría con `Maestro`);
  (b) `cashAccountSchema` es contrato de la fila Y del body del API, y el formulario manda la salida
  ya parseada (`closingPeriodicity: null`), que el contrato rechazaba con 400 `invalid_union` para
  casi toda cuenta. Los arreglos van en commits propios (`8481d7b`, `32a342d`) porque tocan
  superficie compartida.
- **L24 — C8: tres fallos del SPEC, no del producto, y la diferencia importó.** Las dos corridas
  intermedias fallaron por locators ambiguos: `getByText("Resultado del mes")` resolvía a la
  bajada del encabezado y al título de la tarjeta, y `getByRole("link", { name: "Cuadres de
  caja" })` resolvía al link del navbar (`Cuadres de Caja`, que `getByRole` compara sin distinguir
  mayúsculas) y al acceso rápido. Se corrigieron con `exact: true` y el motivo quedó comentado en
  el spec. No se barrieron los otros 22 locators sin `exact`: pasan, y endurecerlos sin un caso que
  los rompa es cambio no verificable.
- **L25 — C8: qué se cerró de RLS y qué no, con la matriz medida.** Evidencia dura de L12(a) leída
  de `information_schema.role_table_grants`: `authenticated` tiene **INSERT,SELECT** en `payment`
  y `cash_close`, y **DML completo** en `cash_account`, `cash_count`, `cash_close_denomination`,
  `cash_count_denomination`, `cash_transfer`, `petty_cash_vale`, `bank_reconciliation` y
  `bank_reconciliation_item`. **No se revoca en C8**: anular un vale desde la UI es un UPDATE sobre
  `petty_cash_vale`, así que cerrar el hardening exige grants por columna como los de `payment`, y
  eso es un slice propio con verificación independiente, no un apéndice del port. Lo que sí cierra
  C8 es el aislamiento **por comportamiento** sobre filas reales: `seedCajas` siembra transferencia,
  vale y conciliación (acta + partida) para los dos dueños, o sea que el bloque K deja de ser vacuo
  para esas tablas (`1 fila visible, 0 ajenas`), y se agregan 2 aserciones F y 2 G cruzadas.
- **L26 — C8: el entorno miente con exit 0.** `docker compose` **no existe** en esta instalación
  (el CLI no tiene registrado el plugin, aunque el binario esté en `resources/cli-plugins`), así que
  el camino documentado en `compose.yaml` no corre: la base se levanta con `docker start
  gestion-pagos-db-dev`. Peor, dos jobs en background devolvieron **exit 0 con la corrida abortada**
  porque el pipe a `tail` se come el código de salida de Playwright; se corrigió con
  `set -o pipefail`. Y `db-dev` no tiene política de reinicio (a diferencia de `db-prod`), así que
  cada reinicio del motor la deja abajo y el primer e2e falla por un motivo que parece del suite.
  Deuda de entorno, no del port.
- **L27 — Limpieza del vertical: tres decisiones y un defecto que no se tocó.** (a) `summarizeCashFlow`
  **se borró** (con `FlowLike`, `CashFlowTotals` y sus 5 casos de test): el único consumidor era su
  propio test, y la suma del mes la hace PostgreSQL en `GET /cash-flow/monthly`. (b)
  `GET /bank-reconciliations/:id` **se queda**: no lo usa la pantalla (lee por triplete), pero tiene
  cobertura e2e real —incluido el 404 de otro dueño— y es la lectura natural del acta por id;
  borrarlo habría quitado cobertura, no deuda. (c) Se corrigieron dos afirmaciones falsas:
  `ci.yml` decía "33 tests" de API cuando la suite tiene **127** casos (`grep -c '^test('`), y el
  comentario de `app-navbar.tsx` afirmaba que "Resumen" (`/`) es el dashboard de tesorería cuando `/`
  es el inventario del UI-kit y el dashboard vive en `/cajas-bancos`. El tercer aviso —"39 políticas
  RLS" en el README— resultó **verdadero**: medido en la base, hay 39.
- **L27(b) — hallazgo que NO se arregló**: la entrada "Resumen" del navbar apunta a `/`, que es el
  inventario del UI-kit. Es un defecto de navegación de producto, no de documentación: cambiarlo
  mueve la UX de la barra y merece su propia decisión, no un cambio silencioso dentro de una
  limpieza de deudas.

## Estado para retomar (handoff)

**Donde esta todo.** Rama `feat/vertical-cajas-bancos`, 19 commits sobre `main`, **sin push**. Los
ocho slices estan hechos y verdes: el vertical esta completo. El documento de arriba es la spec, el
plan y el log: una sesion nueva se lee de aca hasta `## Log`. Lo que queda es **publicacion**, que es
decision del humano, y las deudas anotadas abajo.

**Lo hecho, con su evidencia.**

| Slice | Commit | Evidencia |
| --- | --- | --- |
| C1 settings + `ensure` (cierra L67) | `7328a02` | `cash-settings.e2e` 7/7 |
| C2 cuentas CRUD + fila completa | `c260e41` | `cash-accounts.e2e` 8/8, `catalogs.e2e` 6/6 |
| C3 posiciones y fechas | `5d958dd` | `cash-positions.e2e` 6/6 |
| C4 cierres y arqueos | `20dd805` | `cash-closes.e2e` 12/12 + verificacion independiente |
| C5 pantallas base | `509f684` | `pnpm --filter @gestion/web test` 60/60, typecheck 0 |
| C6 transferencias y caja chica (API) | `5f08055` | `cash-transfers.e2e` 8/8, `petty-cash.e2e` 9/9 |
| C6 transferencias, caja chica y extractos (web) | `b7cec9b` | `pnpm --filter @gestion/web test` 82/82 |
| C7 conciliacion, catalogos y flujo (API) | `cb20674` | `bank-reconciliation.e2e` 7/7, `cash-flow.e2e` 5/5, `catalogs-write.e2e` 11/11 |
| C7 conciliacion, configuracion y dashboard (web) | `368d3f9` | `pnpm --filter @gestion/web test` 111/111 |
| C8 spec 09, teardown y baseline | `acc3287` | spec 09 6/6, `pnpm e2e` 22/22 (8.1m), conteos identicos antes y despues |
| C8 RLS de las tablas de cajas | `82f00ce` | `db:check-rls` 46/46 (42 antes) |
| Arreglos que el e2e obligo (fuera de slice C8) | `32a342d`, `8481d7b` | `cash-accounts.e2e` 9/9, suite 22/22 |

Estado del API verificado junto: `payments.e2e` 18/18 y `catalogs.e2e` 6/6 despues de cada slice.

**Lo que falta, en orden.**
1. **Publicar** (decision del humano): PR encadenado o unico. El vertical supera las 11.000 lineas.
2. **Deuda L12(a), con la matriz ya medida en L25**: revocar UPDATE/DELETE en las tablas de cajas
   exige grants por columna para la anulacion del vale. Slice propio, con verificacion independiente.
3. **Deuda de entorno (L26)**: `db-dev` sin politica de reinicio y `docker compose` no operable en
   esta instalacion. Nada de esto es del producto.

**Trampas que ya costaron tiempo, no las redescubras.**
- **El puente se olvida.** Cada prefijo nuevo tiene que agregarse a `ALLOWED_PREFIXES` de
  `apps/web/app/api/backend/[...path]/route.ts`, o el navegador recibe 404 del puente con la ruta
  viva en el API. Paso con C3 (`cash-positions`, `last-movement-dates`), con C4 (`cash-closes`,
  `cash-counts`) y con C6 (`cash-transfers`, `petty-cash`). C7 va a necesitar el suyo
  (`bank-reconciliations`).
- **Teardown y baseline (L5).** `deleteOwnerFixtures` borra `cash_account` antes que
  `cash_transfer`, `cash_count`, `cash_close_denomination` y `bank_reconciliation`, y el baseline de
  `e2e/support/database.ts` no cuenta esas tablas: el primer spec de cajas revienta por FK. C8 lo
  arregla y ningun spec de cajas corre antes.
- **`app_setting` no la limpia nadie** (L8): no tiene FK a `auth.users`, cada test la borra a mano.
- **Los workers de UI se cuelgan si abren servidores.** Los slices de API y de UI se delegan con la
  regla "nunca `next dev/start`, nunca Playwright"; asi ninguno se colgo. El e2e lo corre el padre.
- **Verificador sin shell.** `gentle-ai-verify` con shell se colgo 30 min dos veces; con "no tenes
  shell, usa read/grep/find y responde `needs execution`" termina en minutos y encuentra mas.

**Comandos.**
- API: `cd apps/api && DATABASE_URL=postgresql://dev_user:<pass>@localhost:5434/gestion_pagos_dev node --test --experimental-transform-types "test/<archivo>.e2e.test.ts"` (la password esta en `.env.dev`, que el lector de archivos bloquea: pedirla al humano).
- Web: `pnpm --filter @gestion/web typecheck` y `pnpm --filter @gestion/web test`.
- e2e (solo el padre): exportar `DOCKER` con la ruta absoluta al `docker.exe` (Node no aplica
  `PATHEXT`), `PLAYWRIGHT_BROWSERS_PATH=$PWD/.cache/ms-playwright`, `E2E_WEB_PORT`/`E2E_API_PORT`
  distintos de 3000/3001 (3001 suele estar ocupado), y `DATABASE_URL`.
- Drift: `node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql` y
  `pnpm --filter @gestion/db db:dump --check`.

**Deudas abiertas, con su referencia.**
- L13 — el provider hidrata la fila completa de cada cuenta con un `GET /cash-accounts/:id` (N+1).
  La salida limpia es un `GET /cash-accounts?full=1` aditivo.
- **L14 y L19 — cerradas por el spec 09 (C8).** Las pantallas de C5, C6 y C7 se prueban en un
  navegador: dashboard, alta de cuenta por formulario, transferencia, vale con su anulación,
  conciliación con su acta y el interruptor de una categoría.
- L12(a) — `authenticated` conserva UPDATE/DELETE sobre `cash_count` y las tablas de denominaciones
  (solo `cash_close` esta re-revokeado); sin politica de UPDATE/DELETE esas sentencias afectan 0
  filas, no fallan. Inocuo hoy, anotado. Aplica igual a `cash_transfer`, `petty_cash_vale` y
  `bank_reconciliation*`: todas tienen politica SELECT unicamente.
- L8 — `apps/api/src/db/schema/index.ts` no exporta los schemas nuevos (`cash_transfer`,
  `petty_cash_vale` y los dos de C7 cuando lleguen): los servicios importan directo.
- C7 no dejo prefijo pendiente: `bank-reconciliations` y `cash-flow` ya estan en el puente.
- **L20 — cerrada en la limpieza del vertical.** `summarizeCashFlow` (con `FlowLike` y
  `CashFlowTotals`) se borró junto con sus tests: no tenía consumidor de producción y era una segunda
  definición del flujo del mes al lado del SQL. Ver L27.
- **`GET /bank-reconciliations/:id` se queda, decidido en L27**: no tiene consumidor de producto,
  pero sí cuatro aserciones e2e que lo ejercitan, incluido el 404 de otro dueño, y es la única
  lectura de un acta por id. Borrarlo habría borrado cobertura sin ganar nada.
- **L5 y L8 — cerradas en C8.** El teardown borra `cash_transfer`, `petty_cash_vale`,
  `bank_reconciliation`, `bank_reconciliation_item` y `app_setting`, y el baseline cuenta esas cinco
  mas las cuatro de cajas/arqueos: la corrida del spec 09 dejo los conteos identicos antes y
  despues.

**Publicacion.** El vertical supera las 11.000 lineas en 19 commits: cuando se publique, la forma
natural es PR encadenado (API C1-C4, UI C5-C7, e2e y RLS C8) o un PR unico con el orden de los
commits como guia. Es decision del humano, no del documento.
