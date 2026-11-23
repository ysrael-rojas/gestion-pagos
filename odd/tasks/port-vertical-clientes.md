# T5c — Vertical `clientes`

Segundo vertical del port (después de `pagos`): maestros de clientes y proveedores sobre la tabla
`public.entidad`, con módulo de escritura en `apps/api`, capa de datos y UI en `apps/web`, y e2e
propio. Fuente del port: `C:/Users/Lenovo/Desktop/devtalles/OpenCode/gestion-app` (solo lectura).

## Specs

- **S1 — Alcance del vertical (verbatim del doc padre, S4).** "Port completo (SQL + dominio + UI)".
  Se porta el schema Zod, `lib/clientes`, `components/clientes` y la ruta
  `app/(app)/clientes/listado`. La capa Supabase (`.from()` sobre PostgREST, `@supabase/ssr`)
  NO se porta: `apps/web` consume `apps/api` por HTTP (doc padre, S8).
- **S2 — Aislamiento por dueño (verbatim del doc padre, S2).** "Ninguna query puede escapar del
  dueño aunque el servicio olvide filtrar." Toda escritura de `entidad` pasa por `withOwner`
  (`set_config('app.user_id', …, true)` + `set local role authenticated`) y ningún input de
  cliente acepta `owner_id`: lo completa el default `auth.uid()` de la tabla.
- **S3 — Strings del source que se preservan textualmente.** Confirmación de borrado:
  "¿Seguro que quieres eliminar este cliente? Esta acción no se puede deshacer."
  (`gestion-app/app/(app)/clientes/listado/page.tsx:138`); toasts: "Cliente registrado"
  (`:62`), "Cliente actualizado" (`:59`), "Cliente eliminado" (`:77`); checkbox: "Es proveedor"
  (`components/clientes/client-form.tsx:258`); conflicto de documento:
  "Ya existe un cliente con ese tipo y número de documento."
  (`lib/clientes/entidades.ts:52`).
- **S4 — Soft delete heredado, sin guard nuevo.** El source solo escribe `deleted_at`; eliminar un
  cliente referenciado por `comprobante`/`payment` sigue permitido. Agregar un guard sería
  comportamiento no pedido: se documenta la decisión, no se inventa.
- **S5 — Contrato de error del vertical.** Un `23505` sobre `entidad` responde con el mensaje de
  S3. El texto de `pagos` ("El comprobante ya está asignado a este pago.") no debe aparecer nunca
  en una respuesta de clientes.
- **S6 — Una sola fuente de tipos.** El tipo `Client` no puede vivir duplicado en
  `packages/shared` y `apps/web`; `isSupplier` deja de ser opcional si el contrato del API lo exige.
- **S7 — Verificación.** `pnpm typecheck` verde; `node:test` del API contra base real; spec de
  Playwright del vertical; los tests afirman efectos observables (status, código y mensaje, y que
  una entrada rechazada no deja fila ni contador tocado) por la interfaz pública.

## Tasks

- C1 — API `entities`: `POST /entities`, `PATCH /entities/:id`, `POST /entities/:id/delete`,
  traducción de `23505`/`23514` propia del vertical y `test/entities.e2e.test.ts`.
  Specs: S2, S3, S5. Ruta: inline. **Hecho**: 9/9 tests verdes (L8), commit: _(pendiente)_.
- C2 — Capa de datos web: endpoints en `apps/web/lib/api/client.ts`, escrituras en
  `apps/web/lib/clientes/entidades.ts`, mutaciones del provider. Specs: S1, S3, S5. Ruta: inline.
  **Hecho**: typecheck verde, commit `959d50c`.
- C3 — UI: port de `components/clientes/*`, ruta `app/(app)/clientes/listado` y entrada "Maestro"
  en la navbar. Specs: S1, S3, S4, S6. Ruta: worker (context backstop). **Hecho**: typecheck 0,
  34/34, commit `e58a4a3`; el worker detecto el error de S3 (L11).
- C4 — Consistencia de tipos y cobertura del schema Zod por el borde HTTP (hoy huérfano en
  `packages/shared`). Specs: S6. Ruta: inline. **Hecho**: typecheck web + 34/34 tests, commit
  `cbad13b`.
- C5 — e2e `08-clientes.spec.ts`: alta, conflicto de documento duplicado, edición, baja lógica que
  persiste tras recargar. Specs: S3, S4, S5, S7. Ruta: worker + padre. **Hecho**: 6/6 verde y
  conteos intactos (L13), commits `a7ae99d` (spec) y `2ec7bdc` (fix del puente, L12).
- C6 — Docs: fila en `.github/CI.md`, cierre en `port-monorepo.md` y handoff del vertical.
  Specs: S7. Ruta: inline. Commit: _(pendiente)_.

## Cortes de entrega

Rama `feat/vertical-clientes`. Un commit por unidad revisable.

- **Slice 1 — `151453d`** `feat(api)`: modulo `entities` completo (6 archivos, 505 lineas). Va por
  encima de las ~400 por slice a proposito: son cinco archivos de una sola unidad de
  comportamiento (el alta no existe sin el error map ni la normalizacion) y partirlos dejaria el
  primer commit sin comportamiento observable. Revisar `entities.errors.ts` primero: ahi esta la
  decision del mensaje de conflicto.
- **Slice 2 — `84396b7`** `test(api)`: los 9 tests del e2e (~500 lineas). Se revisan contra la
  tabla de S2/S3/S5, no contra la implementacion.
- **Slice 3 — `cbad13b`** `refactor(shared)`: colapso del tipo `Client` duplicado.
- **Slice 4 — `959d50c`** `feat(web)`: capa de datos del vertical.
- **Slice 5 — `e58a4a3`** `feat(web)`: port de las pantallas de clientes (1.033 lineas de diff,
  ~370 autoradas: el resto es codigo portado casi literal del source, que se revisa por diff contra
  el original y no linea por linea).
- **Slice 6 — `2ec7bdc`** `fix(web)`: PATCH en el puente same-origin. Es un defecto que solo el
  e2e podia encontrar (L12).
- **Slice 7 — `a7ae99d`** `test(web)`: el spec 08 y sus fixtures.

Un PR de este vertical supera las ~400 lineas: cuando se publique, la forma (PR encadenado API+UI
o un PR unico con el orden de los commits como guia) es decision del usuario, no de este documento.

## Log

- **L1 (usuario, verbatim).** "arranca"
- **L2 (usuario, verbatim, sesión anterior).** "si es largo en una nueva sesion"
- **L3 — Recon (gentle-ai-explore).** `entidad` ya existe completa en `packages/db` (tabla,
  índices partial-unique, constraints `entidad_document_type_required`/`entidad_some_role`, trigger
  `set_updated_at`, RLS de dueño, grants de `authenticated`, seed demo): **no hay migración ni
  seed pendiente**. La lectura ya está cableada: `GET /entities` →
  `apps/web/lib/clientes/entidades.ts` → autocomplete de pagos. Faltan las escrituras, la UI y
  el e2e. `apps/web/lib/clientes/entidades.ts:7-9` declara explícitamente que las escrituras están
  ausentes a propósito.
- **L4 — Trampa identificada (L3).** `apps/api/src/payments/payments.errors.ts:60` mapea `23505` a
  "El comprobante ya está asignado a este pago." Reutilizar ese traductor tal cual mostraría un
  mensaje de pagos en un alta de cliente duplicado. C1 introduce el mapa del vertical.
- **L5 — Decisión (padre, derivada de L3).** `update` puede cambiar `document_type` a
  `SIN_DOCUMENTO` con número no vacío → `23514` del check de la tabla. El API responde con el
  mensaje del check, no con el de pagos (S5).
- **L6 — Decisión (padre).** Se hereda el soft delete sin guard (S4): portar fiel gana sobre
  agregar comportamiento no pedido; queda anotado como deuda si ventas/compras lo necesitan.
- **L10 — Nota de slice (harness).** Los slices 1 y 2 superan las ~400 lineas por commit (505 y
  500). Van separados a proposito (codigo vs tests) y la revision se guia por el orden de los
  commits; se anota para que no parezca un descuido.
- **L12 — Defecto encontrado por el e2e (no por revision).** `app/api/backend/[...path]/route.ts`
  solo permitia `GET` y `POST`, asi que `PATCH /entities/:id` moria en el puente con 405 y la
  pantalla de edicion mostraba "El API respondio 405": un defecto de la web que parecia del API.
  La lista de prefijos ya incluia `entities`; faltaba el metodo. El test 4 del spec 08 fallo por
  esta causa exacta y paso sin tocar la asercion despues del fix (`2ec7bdc`).
- **L13 — Hallazgo de entorno, ajeno a este vertical.** En la suite completa fallan
  `04-create-payment` y `05-void-payment` (pagos) con "La fecha del recibo (2026-11-22) es
  anterior al saldo inicial de la cuenta (2026-11-23)". Causa: el contenedor corre en UTC y ya es
  2026-11-23, mientras la UI calcula "hoy" en `America/Lima` (2026-11-22) y los fixtures crean la
  cuenta con el `current_date` de la base. **No es una regresion de esta rama**: la regla es de
  fechas, no toca `entidad` ni el puente, y el mismo codigo de pagos sin cambios falla igual entre
  las 19:00 y las 24:00 de Lima. Queda como deuda: el fixture deberia crear la cuenta con la fecha
  local de la app, no con la de la base.
- **L14 — Verificacion independiente: no disponible.** `gentle-ai-verify` se colgo 30 minutos en
  una llamada de `bash` (mismo sintoma que el primer worker de C5). Sin verificador, los riesgos 2
  y 3 de C1 quedan **sin verificacion independiente**: hay evidencia propia (9/9 del e2e de API,
  6/6 del e2e del vertical, revision de los caminos de escritura), pero no la firma de un tercero.
  No se declara verificado.
- **L11 — Correccion de spec (error del padre).** S3 citaba como textual una confirmacion de
  borrado que **no** era la del source ("Estas seguro? Esto eliminara el cliente."), inventada al
  redactar el documento. El worker de C3 lo detecto al diffear contra el source. La cadena real es
  "¿Seguro que quieres eliminar este cliente? Esta acción no se puede deshacer."
  (`gestion-app/app/(app)/clientes/listado/page.tsx:138`). S3 queda reescrita **citando la linea**
  de cada string, para que no vuelva a pasar, y la UI se ajusta a la del source.
- **L7 — Hallazgo (regresión de contrato heredada).** `entidad_document_unique` es
  `(document_type, document_number)` **sin `owner_id`**: dos duenos distintos no pueden usar el
  mismo RUC/DNI. Viene de la migracion del origen, que es fuente de verdad (S7 del doc padre), asi
  que no se toca en este port; el e2e lo fija ("el numero de documento es unico entre duenos").
  Si el producto quiere unicidad por dueno, es una migracion nueva, con su propio slice.
- **L8 — Incidente y fix (el mas caro del slice).** `EntitiesModule` no importaba `AuthModule`, asi
  que Nest no podia resolver `Symbol(AUTH)` dentro de `SessionGuard`
  (`UnknownDependenciesException`). Como el harness y `main` corren con `logger: false` +
  `abortOnError`, la app abortaba con exit 1 **sin imprimir nada**: el sintoma era "file test
  failed" sin diagnostico, y arrastraba tambien el e2e de `pagos` (que antes estaba verde).
  Diagnostico: sonda con `abortOnError: false` + logger encendido, que devolvio el error de DI.
  Fix: `imports: [AuthModule]`, igual que `PaymentsModule`. Evidencia: `catalogs.e2e` 6/6 verde
  otra vez y `entities.e2e` 9/9 verde.
- **L9 — Hallazgo de infraestructura de tests.** El test unitario del schema Zod **no puede vivir
  en `apps/web`**: el barrel de `@gestion/shared` exporta sin extensiones y solo resuelve con
  bundler (Next/esbuild). Con `node --test` falla con `ERR_MODULE_NOT_FOUND` en
  `src/lib/schemas/auth`. Como el paquete compartido no tiene runner propio, los 7 casos del
  origen se cubren **por el borde HTTP** (test "el contrato compartido valida los formatos de
  documento del formulario"), que es lo que S7 pide: efectos observables por la interfaz publica.
  Se descarto el archivo `apps/web/lib/clientes/client-schema.test.ts`.

## Estado para retomar

**Donde esta todo.** Rama `feat/vertical-clientes`, 7 commits sobre `main`, sin push. El vertical
`clientes` esta completo: API con escrituras (`POST`/`PATCH`/`POST :id/delete`), capa de datos web,
pantallas, y e2e propio. No hay cambios en `packages/db`: la tabla `entidad` ya existia entera.

**Verificacion al cerrar.**
- `apps/api/test/entities.e2e.test.ts` — 9/9 verde contra base viva.
- `apps/api/test/catalogs.e2e.test.ts` (baseline de pagos) — 6/6 verde.
- `apps/web/e2e/specs/08-clientes.spec.ts` — 6/6 verde, conteos de la base identicos antes y despues.
- Suite completa: 14/16; los 2 fallos son `04`/`05` de pagos por el desfase de fecha (L13), no por
  esta rama.
- `typecheck` verde en api y web; `apps/web` unit 34/34.

**Lo que NO esta hecho.**
- Verificacion independiente de los riesgos 2 y 3 de C1: el verificador se colgo (L14).
- Deudas heredadas del vertical, sin tocar: unicidad global del documento (L7) y la fecha del
  fixture de caja (L13).
- `odd/tasks/port-monorepo.md` tiene un cambio sin commitear de la sesion de entorno (notas de los
  shims de `install/home/bin`, deuda L79): no pertenece a este vertical.

**Como correr el e2e en esta maquina.** Exportar `DOCKER` con la ruta absoluta al `docker.exe`
(Node no aplica `PATHEXT` y el shim `.cmd` no sirve para `spawnSync`), `DATABASE_URL` de la base dev,
`E2E_WEB_PORT`/`E2E_API_PORT` distintos de 3000/3001 (3001 suele estar ocupado por un API de una
sesion anterior) y `PLAYWRIGHT_BROWSERS_PATH` al `.cache/ms-playwright` del repo.

**Siguiente vertical.** `cajas-bancos` (arrastra `ensureDefaultSettings`, deuda L67 del doc padre),
despues ventas/compras.
