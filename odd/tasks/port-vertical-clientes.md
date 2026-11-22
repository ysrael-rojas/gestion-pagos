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
  "Estás seguro? Esto eliminará el cliente."; toasts: "Cliente registrado", "Cliente actualizado",
  "Cliente eliminado"; checkbox: "Es proveedor"; conflicto de documento:
  "Ya existe un cliente con ese tipo y número de documento."
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
  Commit: _(pendiente)_.
- C3 — UI: port de `components/clientes/*`, ruta `app/(app)/clientes/listado` y entrada "Maestro"
  en la navbar. Specs: S1, S3, S4, S6. Ruta: inline. Commit: _(pendiente)_.
- C4 — Consistencia de tipos y test del schema Zod (hoy huérfano en `packages/shared`).
  Specs: S6. Ruta: inline. Commit: _(pendiente)_.
- C5 — e2e `08-clientes.spec.ts`: alta, conflicto de documento duplicado, edición, baja lógica que
  persiste tras recargar. Specs: S3, S4, S5, S7. Ruta: inline. Commit: _(pendiente)_.
- C6 — Docs: fila en `.github/CI.md`, cierre en `port-monorepo.md` y handoff del vertical.
  Specs: S7. Ruta: inline. Commit: _(pendiente)_.

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
