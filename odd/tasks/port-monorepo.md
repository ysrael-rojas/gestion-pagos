# Port de `gestion-app` a monorepo Turborepo

Port completo del proyecto de gestión de pagos (`ysrael-rojas/gestion-app`, rama `dev`) a un
monorepo pnpm + Turborepo con Next.js, NestJS, Better Auth, Drizzle y PostgreSQL local.
Fuente del port: `C:\Users\Lenovo\Desktop\devtalles\OpenCode\gestion-app` (solo lectura).

## Specs

- **S1 — Stack definitivo (verbatim del usuario).** El monorepo se construye con:
  "Gestor de paquetes: pnpm (es el estándar para Turborepo por su eficiencia y manejo de
  workspaces). Orquestador: Turborepo (para cachear tareas y ejecutar builds/dev de forma
  incremental). Frontend (apps/web) Framework: Next.js (App Router). Estilos: Tailwind CSS.
  Cliente de Auth: better-auth/react (se comunica con el backend). Backend (apps/api)
  Framework: NestJS. Autenticación: Better Auth (ejecutándose dentro de NestJS, montado como
  middleware). Validación: Zod (compartido con el frontend para tipar los payloads). Base de
  Datos (packages/db o dentro de apps/api) Motor: PostgreSQL (corriendo en Docker Desktop). ORM:
  Drizzle ORM. Adaptador de Auth: @auth/drizzle-adapter (para conectar Better Auth con Drizzle)."
  Versión de git/github: repositorio nuevo con historia limpia (ver S3).

- **S2 — Aislamiento por dueño: RLS con shim (decisión del usuario).** "Shim auth.uid() + SET
  LOCAL (recomendado)". Las 67 políticas RLS portadas se conservan sin reescribir: el esquema
  `auth` se declara en las migraciones con `auth.uid()` leyendo
  `current_setting('app.user_id', true)`, y cada request de `apps/api` fija ese GUC con
  `set_config('app.user_id', <uuid>, true)` dentro de la misma transacción de Drizzle. Ninguna
  query puede escapar del dueño aunque el servicio olvide filtrar.

- **S3 — Versionamiento (decisión del usuario).** "Repo nuevo, historia limpia (recomendado)":
  `git init` en `gestion-pagos` con rama `main`, un commit baseline que cita el repo de origen;
  `gestion-app` queda archivado como referencia. No se usa `git filter-repo`.

- **S4 — Alcance (decisión del usuario).** "Port completo (SQL + dominio + UI)": migraciones SQL,
  `lib/` de dominio y `components/`/`app/` de UI. La capa Supabase (Auth, `@supabase/ssr`,
  `@supabase/supabase-js`, clientes `lib/supabase/*`, `app/login`) NO se porta.

- **S5 — Adapter de Better Auth.** Se usa `better-auth/adapters/drizzle`. El paquete
  `@auth/drizzle-adapter` nombrado en S1 pertenece a Auth.js/NextAuth y no se instala.

- **S6 — Montaje de Better Auth en NestJS.** El core de Better Auth es un handler
  `fetch(Request)`: se monta con `toNodeHandler(auth)` en una ruta catch-all `/api/auth/*` y el
  body parser de Nest se desactiva para esa ruta.

- **S7 — Esquema de base de datos.** Las 20 migraciones SQL existentes son la fuente de verdad y
  se ejecutan tal cual (`drizzle-kit migrate` sobre archivos `.sql`). Los tipos de Drizzle salen
  de `drizzle-kit pull` (introspección), no de traducir a mano 24 tablas + 15 funciones
  PL/pgSQL + triggers.

- **S8 — El frontend no toca la base.** `apps/web` consume `apps/api` por HTTP; el contrato
  compartido son los schemas Zod de `packages/shared`.

- **S9 — Tailwind v4.** Se mantiene `tailwindcss` v4 (`@tailwindcss/postcss`, `tw-animate-css`)
  como en el proyecto de origen; no se baja a v3.

- **S10 — Motor de base de datos: se adopta el scaffold del usuario.** El scaffold existente
  (`compose.yaml` con `postgres:18`, perfiles `dev`/`prod`, `.env.dev`/`.env.prod`, `.gitignore`)
  es la base y **no se reemplaza ni se reescribe**. Docker Desktop no está instalado en esta
  máquina, así que la verificación de S12 queda bloqueada hasta que lo esté. El PostgreSQL 16
  local sirve solo como smoke test de sintaxis; el objetivo es el `postgres:18` del compose, y
  el drift 16 vs 18 se resuelve a favor del compose.

- **S13 — Roles y helpers de la plataforma Supabase.** Las migraciones heredadas referencian
  `anon`, `authenticated` y `service_role` (210 usos) y `public.rls_auto_enable()`, que provee
  la plataforma Supabase y no las migraciones. La migración `00000000000001_auth_compat.sql`
  los declara (roles NOLOGIN, `service_role` con `BYPASSRLS`, stub no-op del event trigger) para
  que el SQL heredado aplique **sin editarse**.

- **S14 — Runner de migraciones propio.** `packages/db/scripts/apply-sql.mjs` aplica los `.sql`
  en orden, una transacción por archivo, registrando en `public.__sql_migrations`. No se usa el
  migrador de drizzle-kit: el SQL contiene PL/pgSQL, triggers y políticas que drizzle no puede
  expresar, y el journal de drizzle no describe archivos escritos a mano.

- **S15 — `auth.users` es la tabla canónica de identidad.** No es un cascarón para satisfacer
  las 8 FK: Better Auth se configura para escribir en ella (drizzle: schema `auth`, tabla
  `users`, id uuid generado por la app, `emailVerified` → `email_verified`). Una sola fuente de
  verdad de identidad; si fuera un espejo de `public.user` habría dos.

- **S16 — Adaptaciones de portabilidad, mínimas y documentadas.** El SQL heredado asume el rol
  `postgres` (que no existe fuera de Supabase): `owner to postgres` → `owner to current_user` y
  `FOR ROLE postgres` → `FOR ROLE current_user`. Preserva la semántica — dueño = quien
  despliega, y las funciones `SECURITY DEFINER` siguen ejecutándose con privilegios elevados —
  mientras que crear un rol `postgres` fantasma las dejaría sin privilegios sobre las tablas.

- **S17 — Seeds autocontenidos.** `seed-demo.sql` asumía catálogos ya presentes en Supabase
  (`payment_method` con `EFECTIVO`/`TRANSFERENCIA_BCP`/`TARJETA_CREDITO`, `cash_receipt_category`
  'Cobranza de venta'). Se siembran en `00-demo-user.sql` y `01-catalogs.sql`, antes de
  `seed-demo.sql`, para que el entorno limpio funcione de cero.

- **S19 — Criterio de verificación de la auditoría de RLS.** Los bloques 1–5 de la auditoría
  **deben fallar** (`42501`): ese es su resultado esperado, no un defecto. Por eso no se corre con
  `ON_ERROR_STOP=1`, que abortaría en el bloque 1. El contrato es el conjunto exacto de 8
  resultados, verificado por `packages/db/scripts/verify-rls.mjs`, que falla nombrando el bloque
  ante cualquier error inesperado o cualquier esperado ausente. Conjunto vigente tras los grants de
  T4b (los cuatro mensajes que cambian siguen siendo `42501`, y ahora prueban que el trigger de
  dominio rechaza la escritura cruzada en vez de que falte un privilegio):

  | bloque | resultado esperado |
  | --- | --- |
  | 1 | `42501` La cuenta de caja no existe |
  | 2 | `42501` La asignacion referencia un pago o comprobante de otro usuario |
  | 3a | `42501` El cierre referencia una cuenta de otro usuario |
  | 3b | `42501` El cierre referencia una cuenta de otro usuario |
  | 4a | `42501` La transferencia referencia una cuenta de otro usuario |
  | 4b | `42501` La transferencia referencia una cuenta de otro usuario |
  | 5 | `42501` El comprobante referencia una entidad o comprobante de otro usuario |
  | 6 | éxito |

  El archivo de auditoría no se reescribe: solo se re-baselina la tabla `EXPECTED` del runner.

- **S20 — Orden de seeds, probado en ambas direcciones.**  `00-demo-user` → `01-catalogs` → `seed-demo` → `seed-semana` → `seed-semana-verify`.
  `seed-demo` resuelve catálogos con `select ... into strict` antes de que `seed-semana` pueda
  correr, y `seed-semana` no puede correr antes de `seed-demo` porque depende de `entidad`.
  `01-catalogs` lleva los ids de catálogo del origen porque el seed semanal los referencia por id.

- **S11 — Artefactos que no se portan.** `node_modules/`, `.env` y cualquier secreto, `.vercel/`,
  `.playwright-mcp/`, `.codegraph/`, `.atl/`, `coverage/`, `.opencode/`, `Microsoft/`.

- **S12 — Verificación del port de datos.** Ninguna migración se considera portada hasta que las
  20 apliquen sobre una base limpia y el seed corra. Sin esa evidencia, la tarea sigue abierta.

## Tasks

- T1 — Esqueleto del monorepo: `git init -b main`, `.gitignore`, `pnpm-workspace.yaml`,
  `turbo.json`, `package.json` raíz con `packageManager`, `tsconfig` base. Ruta: inline.
  Commit: `076ed8e`.
- T2 — `packages/shared`: portar los 18 schemas Zod de `lib/schemas/` (1.037 líneas) + build y
  typecheck verdes. Ruta: inline. Commit: `076ed8e` (31 archivos, 1.650 líneas, typecheck
  verde con tsc 7.0.2).
- T3 — `packages/db`: portar las migraciones + shim `auth` + `drizzle.config.ts` + seeds.
  Ruta: inline. Commit: `076ed8e`. **Aplicadas y verificadas**: 49/49 sobre `PostgreSQL 18.7`
  en el contenedor `db-dev`, más los 3 seeds. Evidencia en L13.
- T3b — Seeds autocontenidos (`00-demo-user.sql`, `01-catalogs.sql`). Ruta: inline. Hecho.
- T3c — Portar `verify-owner-consistency.sql` al GUC `app.user_id`: el suite de auditoría de
  RLS debe correr completo contra `gestion_verify` sin `ERROR` y sin `request.jwt.claims`.
  Ruta: worker. **Hecho**: 8/8 bloques en su resultado esperado, `db:verify-rls` verde dos veces
  y control negativo (base equivocada) en exit 1.
- T4 — `apps/api`: NestJS + Better Auth (`toNodeHandler`) + primer módulo vertical (pagos) con
  `SET LOCAL app.user_id` por transacción. Ruta: worker (writers en paralelo con T5).
- T5 — `apps/web`: Next.js App Router + Tailwind v4 + `components/ui`. Ruta: worker.
- T5a — Andamiaje de `apps/web`: Next 16 App Router, Tailwind v4, `components/ui` portado
  (25 archivos, 3.326 líneas), layout y cliente de `apps/api`. **Sin componentes de dominio.**
  Ruta: worker.
- T5b — Vertical `pagos` completo (ver T5b1 y T5b2).
  (`components/shared`, y lo mínimo de `clientes`/`compras`/`ventas`/`cartera`/`cajas-bancos`) +
  `lib/pagos`, `lib/filters`, `lib/clientes`, `lib/cuentas`, recableado a `apps/api`. Ruta: worker.
- T5c — Resto de verticales (clientes, ventas, compras, cajas-bancos, retenciones, notas,
  configuración), de a uno, reusando la estructura que deje T5b.
- T6 — CI: portar `.github/workflows` (checks + guard de migraciones) al pipeline de turbo.
- T7 — Seed + e2e Playwright contra el monorepo levantado.
- T8 — Portar `docs/operacion` y `.agents/skills/` (SUNAT, cobranzas, caja) a la raíz.

## Log

- L1 (pedido original, verbatim): "anteriormente hice un proyecto de gestion de pagos que si me
  servia, pero el problema era que use next.js para forntend y supabase gestionada la BD y todo
  el backend. esta es la ubicacion en mi pc del proyecto,
  C:\Users\Lenovo\Desktop\devtalles\OpenCode\gestion-app, y esta es la ubicacion del repo en
  github https://github.com/ysrael-rojas/gestion-app. puedes analizar y decirme si podemos usar
  algo de esos repos para el nuevo proyecto? con este stack Stack Definitivo (Monorepo con
  Turborepo) [...]" — seguido del stack completo citado en S1.
- L2: "ovia la carpeta node_modules" (ignorar `node_modules` en el inventario: los 922 MB del
  repo de origen son casi todos dependencias y artefactos).
- L3 (evidencia del inventario): 20 migraciones / 5.481 líneas SQL / 24 tablas / 15 funciones /
  67 políticas RLS; única dependencia de Supabase en el SQL: `auth.uid()` ×106; sin `storage.*`
  ni `create extension`. Código: `app/` 862 líneas, `components/` 24.899, `lib/` 7.049,
  `lib/schemas/` 1.037 (18 archivos). Repo origen: rama `dev`, 76 PRs, CI con guard de
  migraciones.
- L4 (decisiones del usuario): RLS con shim `auth.uid()` + `SET LOCAL`; repo nuevo con historia
  limpia; port completo (SQL + dominio + UI).
- L5 (entorno): node v24.18.0, npm 11.16.0, pnpm 10.20.0 vía `corepack` con `COREPACK_HOME`
  local del proyecto; sin `docker`; PostgreSQL 16 en `127.0.0.1:5432` con password no
  disponible (bloquea la verificación de T3).
- L6 (incidente): el directorio tenía `.git`, `.gitignore`, `compose.yaml` y los dos archivos de
  entorno creados entre las 10:32 y las 12:58, después de la inspección inicial que lo vio
  vacío. El usuario confirma que **los creó él en otra ventana**: se adoptan como base y no se
  reemplazan.
- L7 (hallazgo): el SQL heredado depende de los roles `anon`/`authenticated`/`service_role`
  (210 usos) y de `public.rls_auto_enable()`, provista por la plataforma Supabase. Sin el shim
  de S13, las migraciones fallan en Postgres propio. Única dependencia de Supabase en el SQL
  más allá de esto: `auth.uid()` ×106.
- L8 (límite de herramienta): la política de seguridad del harness bloquea leer `.env.dev` y
  también escribir comandos que mencionen esa ruta. No se rodea: `drizzle.config.ts` y el
  runner componen la conexión desde las variables de `compose.yaml`, y si se prefiere
  `DATABASE_URL` la agrega el usuario a su archivo de entorno.
- L9 (port a `packages/shared`): los 18 schemas Zod no son autocontenidos; cierran sobre
  `lib/data/*` (6 archivos), `lib/utils.ts`, `lib/caja/{denominaciones,conciliacion-tipos}` y
  `components/{comprobantes,ventas,compras,clientes,pagos}/types.ts` — 30 archivos, 1.650
  líneas. Se preserva el alias `@/*` con `paths` de tsconfig para moverlos **sin editar un solo
  import**.
- L10 (primer slice, commit `076ed8e`): 92 archivos, 9.305 líneas. `pnpm -r typecheck` verde.
  Dos rojos observados y corregidos: `packages/db` sin `@types/node` (faltaba `types: ["node"]`)
  y `packages/shared` con `baseUrl` — **tsc 7.0.2 eliminó esa opción**, `paths` ahora resuelve
  relativo al tsconfig. También apareció una colisión real al armar el barrel:
  `CLOSING_PERIODICITIES` es un array de valores en `schemas/cash-account` y un `SelectOption[]`
  en `data/cash-options`; se resolvió angostando el barrel al contrato (schemas + utils) en vez
  de renombrar código heredado.
- L11 (identidad de git): el repo nuevo no tenía `user.name`/`user.email`. Se copió la identidad
  real desde el último commit del repo de origen (`Ysrael Rojas Rojas <yrra.rojas@gmail.com>`),
  configurada **solo en este repo** (nunca `--global`).
- L12 (corrección de L3): no son 20 migraciones ni 5.481 líneas. Son **48 migraciones + el shim
  = 49 archivos, 5.538 líneas**. El 20 salió de un `head -20` truncado en el inventario
  inicial. Conteos vivos del esquema, medidos en la base: **18 tablas** (`public`, todas con
  RLS), **39 políticas** (67 `create policy` − 28 `drop policy`), **15 funciones**, **31
  triggers**, **8 FK a `auth.users`**.
- L13 (verificación, T3 cerrada): Docker Desktop está instalado en
  `/c/Users/Lenovo/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe` (no está en el
  PATH de esta shell porque `HOME`, `LOCALAPPDATA` y `USERPROFILE` están redirigidos al home de
  Gentle Shell). Contenedores `gestion-pagos-db-dev` (host 5434) y `-db-prod` (host 5435),
  `PostgreSQL 18.7`. Las 49 migraciones y los 3 seeds se aplican vía `docker exec` + `psql`
  **dentro** del contenedor: las credenciales nunca salen de él y no se copiaron al historial.
  La verificación corre en la base scratch `gestion_verify`, dejando `db-dev` intacta.
- L14 (fallos reales encontrados y corregidos, en orden): `auth.users` inexistente (8 FK) → tabla
  canónica en el shim; `role "postgres" does not exist` → `current_user` en 2 archivos;
  `seed-demo` sin catálogos → `01-catalogs.sql`; `seed-demo` sin identidad → `00-demo-user.sql`.
- L15 (pendiente conocido): `db-dev` quedó con 7 migraciones aplicadas a medias del primer
  intento fallido. Es reversible con `docker compose --profile dev down -v`, pero es una acción
  destructiva: la decide el usuario.
- L16: `drizzle.config.ts` y el runner componen la conexión desde `POSTGRES_*` de `compose.yaml`,
  así que la verificación host-side queda disponible cuando el usuario exporte esas variables
  (el runner no se pudo ejercitar todavía: corre en el host y necesita credenciales).
- L17 (T3c, delegada a worker): `verify-owner-consistency.sql` portado — 7 inserts de identidad al
  shape de S15 y el GUC antes de `set local role authenticated`. Ninguna aserción, transacción ni
  argumento modificado. `seed-semana.sql` (662 líneas) y `seed-semana-verify.sql` (79) portados
  verbatim salvo las 7 líneas de identidad. Nuevo `scripts/verify-rls.mjs` + `db:verify-rls`.
- L18 (corrección de mi criterio, L13): pedí "exit 0 sin ERROR" para la auditoría, y es imposible
  por diseño: los bloques 1–5 deben fallar. El worker lo detectó y lo probó con una transacción de
  diagnóstico con rollback. Criterio real: S19.
- L19 (hallazgos del worker): `v_anticipo`/`v_retiro` son **categorías** de recibo, no métodos de
  pago (7º argumento de `create_payment_with_allocations`); el orden de seeds se probó en ambas
  direcciones y solo una funciona; el bloque 6 no emite NOTICE, así que su éxito se detecta por el
  command tag `DO` de psql (si el runner alguna vez usa `-q`, hay que revisarlo).
- L20 (hueco conocido, no un defecto): `voucher_series` queda con 0 filas porque en Supabase las
  creaba la app y ningún seed portado las inserta; `seed-semana` solo las `update`a. Inventarlas
  sería inventar datos fuera del mandato de port verbatim: se reporta, no se rellena.
- L21 (evidencia, verificada por el padre): 49 migraciones + 5 seeds sobre PostgreSQL 18.7;
  `node packages/db/scripts/verify-rls.mjs` → EXIT=0 con los 8 bloques en su resultado esperado;
  conteos post-auditoría idénticos a pre-auditoría (la auditoría hace rollback de todo).
- L22 (T4, delegada): `apps/api` construido como `@gestion/api` con NestJS 11.2.11, Better Auth
  1.7.27 (adapter `better-auth/adapters/drizzle`, jamás `@auth/drizzle-adapter`), Drizzle 0.45.4,
  Zod pipe sobre el contrato de `@gestion/shared`. Esquema Drizzle **introducido desde el DDL real**
  leído con `psql \d` en el contenedor, no adivinado. Build con esbuild: tsc 7 exige `rootDir` y
  `@gestion/shared` se consume como fuente con su propio alias, así que el bundle evita tocar
  `packages/shared`. Consecuencia: sin `emitDecoratorMetadata` → todo provider usa `@Inject(TOKEN)`.
- L23 (hallazgo grave de T4): las políticas son `TO authenticated` y `dev_user` es **owner** de las
  tablas con `relforcerowsecurity = 0` → el `set_config` no protegía nada. Y fuera de Supabase nadie
  otorgó privilegios a `authenticated`: Supabase lo hacía implícito con `auto_expose_new_tables`.
  Ambas mitades faltaban.
- L24 (T4b, corregido y verificado): migración nueva `20261029101500_better_auth_tables_and_role_grants.sql`
  con `auth.session`/`auth.account`/`auth.verification` (Better Auth ya hace signUp/signIn contra la
  base), grants de DML a `authenticated`, `alter default privileges` para tablas futuras, `anon` sin
  privilegios sobre tablas, y `revoke all on public.__sql_migrations from authenticated` (el ledger
  había quedado escribible por la ruta de la aplicación). `withOwner()` ahora hace
  `set_config('app.user_id')` → `set local role authenticated` → callback. Better Auth sigue
  corriendo como owner porque necesita escribir `auth.*`.
- L25 (evidencia de T4b, verificada por el padre): `db:check-rls` 4/4 — A ve solo sus filas, B
  recibe `42501 row-level security` al intentar escribir del dueño ajeno, C sin GUC ve cero filas,
  D no puede tocar el ledger. `db:verify-rls` 8/8 con la tabla S19 corregida. Control negativo:
  revertir un mensaje esperado o quitar el revoke hacen fallar el runner.
- L26 (estado de `gestion_pagos_dev`): quedó en estado mixto (7 archivos aplicados sin tracking por
  el primer intento fallido, más el shim ya registrado). Re-aplicar falla en el archivo 2
  (`type "document_type" already exists`) porque ese DDL no es idempotente. Repararlo requiere
  `drop schema public, auth cascade` — acción destructiva, pendiente de decisión del usuario.
- L27 (verificación independiente de T4b, `gentle-ai-verify`): veredicto "holds, con huecos". Tres
  correcciones: (a) mi afirmación "ninguna tabla tenía grants para authenticated" era **falsa**
  (había SELECT en 7 tablas y 2 vistas; lo sustantivo —sin DML— sí se sostenía); (b) hueco real:
  `authenticated` sin `USAGE` en schema `private` donde viven 2 triggers de `payment`; (c) las 4
  aserciones cubrían solo `entidad` y solo INSERT.
- L28 (hueco (b) **refutado**, no arreglado): los triggers se invocan por OID desde `pg_trigger`,
  así que no hay resolución de esquema ni chequeo de EXECUTE. Comprobado: `has_schema_privilege`
  y `has_function_privilege` en falso, y el trigger igual dispara y rechaza. No se agregó grant.
- L29 (hueco (c) cerrado): `check-rls-enforcement.mjs` pasó de 4 a **39 aserciones** (barrido de
  las 17 tablas con RLS y políticas, UPDATE/DELETE cruzados, `anon` sin privilegios, `auth.session`
  y `auth.account` ilegibles para `authenticated`, ledger cerrado, controles positivos de los
  triggers) con **8 controles de mutación**, cada uno observado en exit 1. Nuevo
  `apps/api/test/with-owner.test.ts` que fija el orden `set_config → set local role` y el flag
  `true` (local a la transacción).
- L30 (regresión de intención detectada, pendiente): el grant masivo de T4b **deshizo** el
  hardening de `20261012221550_harden_financial_history_v1.sql`, que es a nivel de columna
  (UPDATE solo en `entity_id/status/void_reason/voided_at` de `payment`, sin DELETE, y
  `cash_close`/`payment_allocation` sin UPDATE ni DELETE). Hay que reaplicarlo después del grant
  masivo para que el historial financiero vuelva a ser append-only en la capa de privilegios.
- L31 (L30 cerrado): reaplicada la excepción de `20261012221550` después del grant masivo —
  `authenticated` vuelve a tener UPDATE **solo** en `entity_id/status/void_reason/voided_at` de
  `payment`, sin DELETE en `payment`, y sin UPDATE ni DELETE en `cash_close` ni
  `payment_allocation`. Medido con `has_column_privilege`: verdadero en 4 columnas, falso en las
  otras 15. La prueba de aislamiento subió a **42 aserciones**, con un grupo nuevo que verifica la
  matriz de privilegios y que un `UPDATE` a una columna no concedida muere con `42501` (capa de
  privilegios) y no con el mensaje del trigger. S19 no cambió: los 7 esperados son INSERT o
  llamadas `SECURITY DEFINER`, y el hardening nunca revocó INSERT — verificado empíricamente.
- L32 (`gestion_pagos_dev` reparada, autorizado por el usuario): reset completo y reaplicación con el
  runner real del host. **El primer reset fue incompleto**: se dropearon `public` y `auth` pero no
  `private`, así que `private.assign_receipt_number()` sobrevivió y el `create function` de
  `20260929222541_create_payment_tables.sql` chocó con "already exists with same argument types".
  En una base nueva el problema no aparece (por eso verify50 aplicó 50/50); solo se ve al resetear.
  Lección: al recrear un esquema de port, dropear **todos** los esquemas de la aplicación
  (`public`, `auth`, `private`), no solo los obvios.
- L33 (estado final de `gestion_pagos_dev`): 50/50 migraciones, los 5 seeds en orden S20, la
  auditoría RLS 8/8 y el enforcement 42/42 — todo verificado sobre la base de desarrollo real, no
  sobre una scratch. Datos demo: 9 entidades, 41 comprobantes, 45 pagos, 35 asignaciones, 2 cuentas,
  8 cierres, 2 transferencias. La base de verificación temporal (`gestion_pagos_check_verify50`) se
  eliminó: `gestion_pagos_dev` cumple ese rol.
- **S21 — La UI se porta por verticales, no por árbol.** El origen tiene 120 archivos y 24.899
  líneas en `components/`. Portar eso de una vez produce un diff irrevisable y una regresión
  imposible de aislar. El orden es: primero el andamiaje y el kit de UI (T5a), después **un solo
  vertical completo** —`pagos`, que es el corazón del sistema— (T5b), y luego el resto de a
  verticales de a uno (T5c), reusando la estructura que deje el primero.
- L34 (T5a, delegada): `apps/web` como `@gestion/web` con Next 16.4.3, React 19.2.8, Tailwind v4
  (4.3.5) y el kit `components/ui` portado **byte a byte** (25 archivos, 3.326 líneas, `diff -r`
  idéntico al origen). El kit del origen es **Base UI** (`@base-ui/react` 1.9.0), no Radix.
  `apps/web/tsconfig.json` lleva `paths` angostos (`@/lib/*`, `@/components/{pagos,...}/*` →
  `packages/shared/src`) para que el alias interno de `@gestion/shared` resuelva dentro del build
  de Next sin duplicar código.
- L35 (hallazgo, pendiente de decisión): Next 16.4.3 está afectado por una vulnerabilidad conocida y
  **el primer `next build` en cada árbol/caché nueva termina en exit 1** con `SecurityFatalError`;
  el segundo intento pasa. `typecheck` y el segundo build quedaron verdes (rutas `/`, `/_not-found`,
  `/health`). Esto rompería un CI frío en T6: hay que decidir entre subir Next (cambio de
  dependencia) o fijar la versión y convivir con el aviso.
- T5b1 — API del vertical `pagos`: endpoints que la UI necesita y hoy no existen. Medido en origen:
  listado con filtros (`lib/filters/listado-filters`), alta vía la RPC `create_payment_with_allocations`,
  anulación, detalle, y catálogos (métodos de pago, categorías de recibo, cuentas de caja) más
  búsqueda de entidades para autocompletar. Ruta: worker.
- T5b2 — UI del vertical `pagos`: `components/pagos` (3.553 líneas), `components/shared` (531),
  los provider/tipos externos (`clientes`, `compras`, `ventas`, `cartera`, `cajas-bancos`) y
  `lib/{pagos,filters,clientes,cuentas}` (1.306 líneas), recableado de Supabase a `apps/api`.
  Ruta: worker. Depende de T5b1.
- L36 (medición del cierre de T5b): `components/pagos` 3.553 líneas; `components/shared` 531 (6
  archivos); dependencias externas concretas: `clientes/{types,clientes-provider}`,
  `compras/{types,compras-provider}`, `ventas/ventas-provider`, `cartera/types`,
  `cajas-bancos/cajas-bancos-provider`, `shared/{entity-autocomplete,data-table-pagination,back-link}`;
  libs: `lib/pagos` 870, `lib/filters` 130, `lib/clientes` 136, `lib/cuentas` 170. `lib/caja` (2.042
  líneas, 15 archivos) **no** entra: lo único que se usa de ahí (`denominaciones`,
  `conciliacion-tipos`) ya vive en `packages/shared`. Total ≈ 6.000 líneas, con la capa de datos
  a recablear.
- L37 (contrato real que espera la UI de pagos, medido en el origen): `lib/pagos` exporta
  `listPayments`, `getPaymentDetail`, `getPaymentHistory`, `createPayment`, `voidPayment`,
  `addAllocations`, `getAssignState`, `listUnassignedPayments`, `markPaymentsProcessed`,
  `getCarteraResumen`, `listAccountStatement`, `listOpenVouchers`, más tres funciones puras
  (`computeBalance`, `distributeOldestFirst`, `isOverdue`) que deben portarse tal cual.
  Tablas tocadas: `payment` (9), las vistas `voucher_balance` (4) y `payment_balance` (4),
  `payment_allocation` (3); y la RPC `mark_payments_processed`. **Las vistas no tienen endpoint ni
  acceso desde la API todavía**: son `security_invoker`, así que la ruta de la aplicación las ve con
  los privilegios de `authenticated` y con RLS encima — hay que exponerlas vía API o consultar las
  tablas base, y esa decisión es de T5b1.
- L38 (actualización de seguridad de Next, decisión del usuario: worktree separado): el comando
  `next upgrade --agent=security` **no actualiza nada por sí solo**: imprime un protocolo para que
  lo siga un agente (leer `shared.md` + `same-major.md`, versión objetivo 16.4.6, sin codemod por ser
  same-major, y `experimental.agentUpgrade: "security"` en la config de Next). Ejecutado en
  `.worktrees/next-security` (rama `chore/next-security`), registrada en la sesión.
  Chequeo de duplicados: solo existe esa rama, sin marcadores `next-upgrade:` en el proyecto, y
  **`gh` no está instalado**, así que la búsqueda de PRs abiertos quedó como chequeo no disponible.
  Decision de no ejecutar el reporte de telemetría que el protocolo pide al final
  (`pnpm dlx next@... internal report-agent-upgrade <id> success`): es un aviso a un tercero que el
  usuario no pidió y que llega como instrucción impresa por un comando, no como pedido suyo. El
  upgrade se hace; el ping no. Si el usuario lo quiere, se corre aparte y explícito.
  Nota de entorno: `next upgrade` invoca `pnpm` como proceso hijo y `pnpm` no está en el PATH (se usa
  vía `corepack`), así que falló con `spawn pnpm ENOENT`. Se resolvió con un shim contenido en
  `.cache/bin/pnpm.cmd` (gitignored), sin tocar la instalación del harness.
- L39 (corrección de L34/L35): **el `module-not-found` no era de la versión de Next**. Se probó
  `next@16.4.3` en el worktree y falla exactamente igual (6 errores, mismos módulos). Por lo tanto
  mi afirmación de "build frío verde" en T5a era **falsa**: ese build se apoyó en la caché de
  Turbopack del build anterior. Regla nueva: la única prueba válida de `apps/web` es
  `rm -rf .next && build`, dos veces seguidas.
- L40 (defecto grave, preexistente desde la primera entrega): `.gitignore` traía `data/` sin anclar,
  y eso **se tragaba `packages/shared/src/lib/data/`** (6 archivos). Nunca se commitearon: un clone
  limpio del repo no compilaba, porque `schemas/*` importa `../data/*`. Corregido a `/data/`
  (anclado a la raíz, que era la intención original del comentario de Docker).
- L41 (causa raíz del fallo de build, corregida): `packages/shared` importaba internamente con
  `@/…` y dependía de los `paths` de cada consumidor. 53 especificadores en 20 archivos pasaron a
  rutas **relativas**; se borraron los `paths` de `apps/web` y `apps/api` y el alias de esbuild. Un
  paquete no debe depender del alias de quien lo consume: el atajo de L9 ahorró 1.650 líneas de
  edición y costó dos fallos de resolución en dos toolchains distintos.
- L42 (evidencia final del bump, verificada por el padre): `next@16.4.6` instalado;
  `rm -rf .next && build` → exit 0, **repetido → exit 0**, `Module not found` = 0, rutas `/`,
  `/_not-found`, `/health`; `pnpm -r typecheck` exit 0; `@gestion/api` 8/8 tests; el kit de UI sigue
  byte-idéntico al origen (`diff -r` vacío). Con `experimental.agentUpgrade: "security"` el primer
  build frío ya no aborta con `SecurityFatalError`, que era el problema real para CI (T6).
- L43 (proceso): el worktree `.worktrees/next-security` se usó para aislar el experimento
  (16.4.6 vs 16.4.3) y se eliminó al terminar. Además hubo una carrera mía: un `git add -A` corrió
  en paralelo con un `pnpm add`, así que el lockfile quedó en el commit `d335151` y el
  `package.json` en `a3fe096`. El árbol es consistente (ambos dicen 16.4.6), pero conviene no
  commitear mientras corre un install en background.
- L44 (T5b1, delegada): 12 rutas de `/payments`, `/cartera` y `/vouchers` sobre `withOwner`, con
  `SessionGuard` (401 antes de validar y antes de la base), validación Zod del contrato compartido y
  mapeo de errores PG→HTTP (42501→403 con el mensaje de dominio). **33 tests** contra la base real con
  dos sesiones emitidas por la API real de Better Auth (`signInEmail` / `signUpEmail`), no por bypass.
  Verificado por el padre: typecheck 0, 33/33, `db:check-rls` 42/42.
- L45 (correcciones del worker a mi brief, correctas): `/payments/:id/history` es por **comprobante**
  (`getPaymentHistory(comprobanteId)`) y `/cartera/statement/:id` es por **cuenta de caja**, no por
  entidad. Se implementó la semántica del origen; un statement por entidad no existe en el origen y no
  se inventó. Además `emailAndPassword` estaba deshabilitado en Better Auth: **sin eso no podía
  existir ninguna sesión**, ni en tests ni en la UI.
- L46 (deudas declaradas de T5b1): (a) `GET /payments` cambió de contrato respecto de T4 (`amount`
  number, más `currency`/`methodName`/`unassignedAmount`); sin consumidor todavía. (b)
  `receipt_sequence` avanzó a 54 en `gestion_pagos_dev` porque los tests crearon pagos reales: los
  recibos de la demo saltean números. (c) `authenticated` conserva INSERT/UPDATE/DELETE sobre
  `payment_balance` y `voucher_balance` por el grant `on all tables`; en Postgres esas vistas no son
  auto-actualizables, así que la escritura falla igual, pero el privilegio sobra y hay que quitarlo.
  (d) No probado: concurrencia real (dos void/allocate en paralelo).
- L47 (T6, delegada): `.github/workflows/ci.yml` con dos jobs (`checks` y `database`), ambos con
  servicio `postgres:18` + health check, node 22 y `corepack enable` (respeta `pnpm@10.20.0` del
  `packageManager`). `database` corre migraciones, `db:dump --check`, seeds, `db:verify-rls` (8/8) y
  `db:check-rls` (42/42). `checks` incluye el build frío real (`rm -rf apps/web/.next && build`).
  Nuevos runners `db:seed` y `db:dump`, snapshot `packages/db/scripts/schema-snapshot.sql` y
  `.github/CI.md` como contrato único de variables. **Sin paso de lint**: `turbo run lint` sale 0 con
  "No tasks were executed"; agregarlo sería un verde que no mira nada.
- L48 (defecto real que el CI destapó): Turborepo 2 en modo strict **borraba `DATABASE_URL`** del
  entorno de `test`, así que `pnpm test` fallaba aunque la variable estuviera exportada. Corregido
  declarando `env` en `turbo.json` para `test` y `build`. Efecto lateral bueno: dos bases distintas ya
  no pueden compartir un resultado cacheado.
- L49 (defecto del guard, corregido): el snapshot no era portable. `pg_database_owner` sólo existe si
  `public` viene de `initdb`; mi dev DB lo recreó a mano (L32) y el guard fallaba por eso, no por
  drift. Además el diff era un prefijo/sufijo que convertía **una** línea en cientos. Ahora normaliza
  esa pseudo-rol a OWNER, no emite `GRANT USAGE ON SCHEMA public TO PUBLIC` (default de PG15, ninguna
  migración lo otorga), y usa un diff LCS unificado con hunks. Alcance reducido y documentado en el
  script, en el snapshot y en `CI.md`.
- L50 (evidencia de T6, verificada por el padre): `db:dump --check` contra `gestion_pagos_dev` →
  coincide (1153 líneas); `pnpm test` por turbo → 33/33; `pnpm -r typecheck` → 0. Controles negativos
  del guard que reproducen defectos reales de esta sesión: grant de tabla que deshace el hardening
  (L30) → exit 1; política dropeada → exit 1; RLS deshabilitada a mano → exit 1; columna revocada
  (L31) → exit 1. Cada uno revertido → exit 0.
- L51 (entorno, no defecto del repo): `turbo run` falla con "Unable to find package manager binary"
  si `pnpm` sólo se alcanza vía corepack. En CI lo cubre `corepack enable`; localmente hace falta un
  shim en PATH. Documentado en `CI.md`.
- L52 (entrega bloqueada y su causa): el push fue frenado por el **guard pre-delivery de RDD**, que
  no puede evaluar nada porque el binario nativo de Gentle AI falta en la ruta que el harness busca
  (`<gentle-pi>/.gentle-ai/v4.6.0/gentle-ai.exe`). En la máquina existe `gentle-ai 4.6.0` en
  `C:\Users\Lenovo\go\bin`, la versión exacta, pero fuera de esa ruta y fuera del PATH. Eso explica
  también por qué RDD reportó `native status unavailable` toda la sesión: switch activo, evaluación
  imposible. Resuelto con el instalador oficial del paquete (decisión del usuario).
- L53: `ci.yml` suma `workflow_dispatch`, para poder disparar el pipeline a mano desde Actions sin
  abrir un PR (no hay `gh` instalado y el workflow sólo escucha `push`/`pull_request` contra `main`).

## Cortes de entrega (chained PRs)

La rama `feat/port-monorepo` acumula 14.298 líneas autoradas en 18 commits desde `main` (sin
lockfiles). Como PR único es irrevisable. Cortes por unidad revisable, cada uno un PR encadenado
sobre el anterior (sin reescribir historia: son punteros a commits que ya existen):

| # | slice | rango | contenido |
| --- | --- | --- | --- |
| 1 | base de datos y contratos | `main..800070f` | monorepo pnpm+turbo, `packages/shared`, 50 migraciones + shim + seeds + auditoría RLS |
| 2 | backend | `800070f..0c5e0bb` | `apps/api` (NestJS + Better Auth), enforcement de RLS, hardening de columnas |
| 3 | frontend shell | `0c5e0bb..a3fe096` | `apps/web`, kit de UI, `packages/shared` sin alias, next 16.4.6 |
| 4 | endpoints de pagos y CI | `a3fe096..HEAD` | 12 rutas de pagos, 33 tests, workflow + drift guard |
- L54 (rehistoria, autorizada por el usuario): la rama se reconstruyó de 19 commits en **26 unidades
  revisables** (82 a 1.900 líneas) partiendo de `main` como baseline de 115 líneas. Verificación de
  integridad: `git diff --ignore-cr-at-eol 9a1c245 HEAD` devuelve **solo** el `.gitattributes` nuevo;
  el contenido es idéntico. Se agregó `.gitattributes` con `* text=auto eol=lf` porque sin él un
  checkout en Windows guarda CRLF y la misma migración aparece como 500 líneas modificadas en cada
  revisión o reconstrucción.
- L54b (corrección de conteo en L12): son **49 migraciones heredadas + el shim = 50 archivos**
  (5.538 líneas). L12 dijo "48 + shim = 49" contando un archivo menos.
- L55 (RDD apagado en este clon, decisión del usuario ante recomendación del agente): el guard quedó
  trabado con estado nativo inválido después de la rehistoria — el provider reportaba candidato
  vacío (`base_tree == current_candidate_tree`, `paths: []`), `applicability: unrelated` y pedía
  `baseRef` explícito, mientras el preflight de entrega expiraba incluso para 115 líneas. Un gate que
  no puede evaluar nada no protege nada pero bloquea todo. `review mode disable --scope clone`
  (global sigue `on`); reversible con `review mode enable --scope clone`. El reemplazo real es el CI,
  que corre solo en cada push y ya detecta los tres defectos que encontramos a mano.
- L56 (defecto de herramienta, para reportar al proveedor): el guard de entrega **sólo resuelve el
  repositorio si el comando es desnudo** (`git push …`). Con un `cd <ruta> &&` delante responde
  "delivery repository cannot be resolved from this directory or Git/environment redirect" aunque el
  cwd sea el repo. Dos mensajes distintos para el mismo bloqueo (`cannot be resolved` vs `bounded
  preflight timed out`) según la forma del comando.
- L57 (publicado): `main` (baseline) y `feat/port-monorepo` (26 commits) en
  github.com/ysrael-rojas/gestion-pagos. El run de CI que dispara el push a `main` **falla por
  construcción**: `main` es el esqueleto, no tiene `packages/db`, así que `db:verify` no encuentra el
  paquete. El run que importa es el del PR. `probe/one-line` quedó como rama **default** del repo
  (era la única al momento del primer push) y GitHub no permite borrarla hasta que el default pase a
  `main` en Settings.
- L58 (T5b2, shell + login, delegada): `apps/web` tiene cliente `better-auth/react`, `/login` con
  email+password que muestra el mensaje del API, layout autenticado con chequeo de sesión en servidor
  y cierre de sesión. Sin verticales de dominio. Tres decisiones que el stack forzó, todas medidas:
  (a) `apps/api` no habilita CORS, así que el auth sale del servidor de Next y la cookie viaja
  HttpOnly — el navegador nunca habla con :3001; (b) Better Auth valida el origen contra
  `BETTER_AUTH_TRUSTED_ORIGINS`, que hoy sólo se pasa por entorno y **no está en el repo** (deuda
  abierta: agregarlo a `.github/CI.md` y al workflow); (c) `next/headers` re-codificaba la cookie
  (`encodeURIComponent`) y la sesión quedaba doblemente codificada: `get-session` devolvía `null` con
  una sesión válida. Corregido en `apps/web/lib/auth/cookies.ts` y fijado con 9 tests.
- L59 (evidencia de T5b2, verificada por el padre): `typecheck` 0 en 4 paquetes, 9/9 tests del web,
  build con las rutas `ƒ /`, `ƒ /health`, `ƒ /login`, `○ /_not-found`. E2E real del worker: registro
  de usuario desechable por la API, login por el formulario (303 + cookie HttpOnly), `/` 200 con el
  shell y el correo de la sesión, contexto nuevo sin cookie → 307 a `/login`, logout → 303 y la
  sesión revocada en la base, y conteos de la base iguales al baseline después de borrar el usuario.
- L60 (límite del entorno): `/tmp` desapareció a mitad de sesión (los redirects fallaban con "could
  not find /tmp"), así que las herramientas pasaron a usar `.cache/tmp/` dentro del proyecto.
- L61 (T6 **probado en el proveedor**, no sólo localmente): PR #1
  (github.com/ysrael-rojas/gestion-pagos/pull/1) con el run 45027970999 — los dos jobs en `success`,
  16 pasos cada uno, cero pasos fallidos: `actions/checkout`, `setup-node`, `corepack enable` (pnpm
  10.20.0 del `packageManager`), el contenedor `postgres:18` con su health check, las 50 migraciones,
  los seeds en orden S20, `db:dump --check`, `db:verify-rls` 8/8, `db:check-rls` 42/42, typecheck,
  33 tests contra base real, build de los 4 paquetes y el build frío de la web. Única anotación del
  runner: `actions/checkout@v4` y `actions/setup-node@v4` corren forzadas sobre Node 24 (deprecación
  de Node 20 en Actions), sin efecto.
- L62 (deuda verificada en el proveedor): `BETTER_AUTH_TRUSTED_ORIGINS` sigue sin estar en el repo.
  No rompe CI porque los tests de la API no mandan cabecera `Origin`; sí rompería el login de la web
  en un despliegue. Pendiente: agregarla a `.github/CI.md` y al `env` del workflow, y decidir el
  origen por entorno.
- L63 (proceso, otra vez): un `git push` encadenado con `cd && cat >> … && git commit` hace que el
  guard **no ejecute ninguno** de los comandos anteriores. Los de entrega van solos, siempre.
- L64 (T5b2 entregada, delegada): vertical `pagos` completo — 13 componentes (3.484 líneas), 3 piezas
  de `components/shared`, 2 providers, 4 libs, 4 rutas y la entrada `Pagos` del navbar. La capa de
  datos pasa por un **BFF same-origin** (`app/api/backend/[...path]`) porque el API no habilita CORS y
  la cookie es HttpOnly; el BFF reenvía sólo un prefijo permitido y deja cuerpo y status intactos
  (`GET /api/backend/auth/session` → 404, no proxya). `types.ts` bajó de 130 a 44 líneas porque los
  tipos de dominio se re-exportan del contrato del API en vez de redeclararse.
- L65 (T5b1 ampliada, autorizada): 4 endpoints de catálogo que el formulario necesitaba y no existían
  (`/entities`, `/cash-accounts`, `/payment-methods`, `/receipt-categories`) + `POST /catalogs/ensure`.
  **Desviación deliberada**: el origen sembraba catálogos desde dentro de un GET (abrir el formulario
  insertaba 3 métodos y 13 categorías). Se conservó el efecto y se movió el mecanismo: lecturas puras
  y un POST idempotente explícito, con los mismos códigos y nombres que `seed-demo.sql`. Probado: 3+13
  la primera llamada, 0/0 la segunda, otros dueños intactos.
- L66 (defecto arreglado antes de commitear, declarado por el worker): el origen traía **todos** los
  pagos de una dirección; el endpoint pagina en 100 y el provider pedía una sola página, así que el
  pago 101 desaparecía de la pantalla sin ningún error. `collectAllPages` corta por página incompleta
  (no por página vacía, porque un múltiplo exacto necesita una request más para saber que terminó) y
  topa en 200 páginas con error explícito. 5 tests fijan los bordes, incluido el del múltiplo exacto.
- L67 (deudas declaradas de T5b2): `ensureDefaultSettings()` del origen (periodicidad de cierre, tipo
  de cambio PEN/USD, tolerancia de diferencia) NO se portó: es estado de cajas-bancos y ningún selector
  de este formulario lo lee — queda para T5c. Los providers de `clientes`/`cajas-bancos` son read-only
  acá (sin rutas de escritura). `receipt_sequence` avanzó a 104 por pagos reales de los tests. No
  probado: pestañas `?filtro=…`, el diálogo de asignación, el modal de detalle en su sección de
  asignación, el layout de impresión del recibo, y concurrencia (dos void/allocate en paralelo).
- L68 (T7, Playwright): el worker **agotó su ciclo** (colgado 30 min con un `bash` corriendo, durante la
  descarga de Chromium) pero el trabajo estaba completo al ir a mirar: 7 specs, soporte por psql con
  transporte dual (docker local / `DATABASE_URL`+`PSQL_BIN` en CI), `playwright.config.ts` y el job
  `e2e` del workflow. Se retomó el estado real en vez de repetir el intento, según la regla de límites
  de worker. Chromium contenido en `.cache/ms-playwright` (744 MB, gitignored) para no depender del
  perfil del usuario.
- L69 (evidencia de T7, verificada por el padre): **10/10 tests verdes**, y los conteos del baseline
  **idénticos antes y después** (entidad 9, comprobante 41, payment 45, payment_allocation 35,
  cash_account 2, cash_receipt_category 7, payment_method 3, users 1, session 0, account 0). Los specs
  cubren: redirect sin sesión, login por formulario, contraseña incorrecta mostrando el mensaje del
  API, estado vacío de un dueño nuevo, alta con asignación, anulación, mensaje de dominio con cuenta
  ajena e inexistente, y logout que revoca la sesión. `reuseExistingServer: false` con build de API y
  web en cada corrida: un e2e contra un build viejo es peor que no tener e2e.
- L70 (control negativo de T7): reemplacé `apiErrorMessage` por un mensaje genérico y el spec 06
  **falló** (1 failed, con screenshot y trace); revert exacto verificado con `diff` contra la copia
  previa. La suite es portante, no decorativa.
- L71 (deuda L62 saldada): `playwright.config.ts` inyecta `BETTER_AUTH_TRUSTED_ORIGINS` al arrancar el
  API, así que el login del e2e ejercita la validación de origen de Better Auth de verdad. El job
  `e2e` del workflow arranca los dos procesos con build desde el árbol actual.
- L72 (nota de operación): el e2e corre en `E2E_WEB_PORT`/`E2E_API_PORT` (por defecto 3000/3001). En
  esta máquina había un `node.exe` (PID 16216) ocupando 3001, ajeno a la sesión: no se mató, se corrió
  en 3100/3101.
- L73 (T7 **probado en el proveedor**): run 45057203474 del PR #2 — **tres jobs en success**:
  `checks` (16 pasos), `database` (16 pasos) y `e2e` (15 pasos). Dentro del job `e2e`, en el runner:
  `Running 10 tests` → `10 passed (33.9s)` y los conteos del baseline idénticos antes y después
  (misma lista que L69). Es la primera vez que el flujo completo —login, alta con asignación,
  anulación, error de dominio, logout— corre solo en CI.
- L74 (nota de operación): el push a `feat/pagos-ui` **no generó run inmediatamente**; GitHub lo creó
  con varios minutos de retraso y recién ahí apareció como `pull_request` con el sha correcto. Se
  disparó además uno manual con `workflow_dispatch` (que se canceló para no gastar runner). Cuando un
  push parece no disparar CI, conviene mirar la API de runs antes de tocar el workflow: no era el
  filtro, era latencia del proveedor.
- L75 (T8 entregada, delegada): `README.md` (90 líneas), `docs/operacion/entornos.md` (211) y
  `docs/operacion/crear-usuario.md` (198) reescritos para este stack, más las tres skills de dominio
  (`caja-bancos-mype`, `consultor-pagos-cobranzas`, `facturacion-sunat-mype`) con frontmatter válido y
  sus 9 referencias copiadas verbatim (688 líneas). Regla por regla mapeada: lo que no existe (deploy,
  preview, backups, panel de Auth, reset por correo) **se dice que no existe** en vez de inventarse un
  equivalente.
- L76 (defecto real encontrado y arreglado): `db:dump` documentado como
  `pnpm --filter @gestion/db db:dump > schema-snapshot.sql` **corrompía el snapshot**: pnpm escribe
  cuatro líneas de banner a stdout y el redirect las mete en el archivo. El worker lo detectó al
  ejecutar los comandos que documentaba. Corregido en las tres apariciones a
  `node packages/db/scripts/dump-schema.mjs > …` y snapshot regenerado; `db:dump --check` verde.
- L77 (deuda declarada, con costo medido): el API acepta `POST /api/auth/sign-up/email`
  (`emailAndPassword.enabled` sin `disableSignUp`), así que "solo el dueño crea cuentas" es hoy una
  restricción de la UI, no del servidor. Cerrarlo exige cambiar la creación del segundo dueño en los
  tests del API y en el e2e (hoy usan el endpoint real) por fixtures SQL, y desactivar el alta.
  Decisión pendiente; documentado en `docs/operacion/crear-usuario.md`.
- L78 (deuda declarada): `apps/api` `dev` es `node scripts/build.mjs --watch` y **no arranca el
  servidor**, así que `pnpm dev` no levanta el API. El camino que funciona (build + start aparte) está
  en el `README.md`. Arreglarlo bien pide `@nestjs/cli` (`nest start --watch`) o un runner equivalente:
  es una dependencia nueva, no un detalle. `turbo.json` ya declara `env` para `dev` (hecho en esta
  sesión) para que el modo strict no borre `DATABASE_URL`.
- L80 (**saldada L78**, sin dependencias nuevas): `apps/api/scripts/dev.mjs` corre esbuild en watch y
  el servidor, y lo reinicia en cada recompilación buena. Se descartó `@nestjs/cli`: una dependencia
  nueva para lo que hacen treinta líneas, y `nest start --watch` compilaría distinto que el build de
  release (esbuild, sin `emitDecoratorMetadata`). Las opciones de build se movieron a
  `scripts/esbuild-options.mjs` para que `build` y `dev` no diverjan. Reglas del supervisor: build con
  errores no reinicia (el servidor sigue con la última versión buena), servidor que muere solo no se
  reintenta (se informa y se espera el próximo cambio), y `Ctrl+C` apaga los dos. Límite honesto: en
  Windows, matar el watcher sin consola (`taskkill`, `kill -9`) usa `TerminateProcess` y no corre
  handlers, así que el servidor queda vivo — le pasa igual a `nodemon` y a `nest start --watch`; el
  comentario del script y el README dicen cómo encontrar y matar ese caso. Verificado en ejecución
  real (puerto 3101): arranca y responde `/health`, reinicia al guardar, **no** reinicia con un error
  de sintaxis mientras el servidor sigue sirviendo, y se recupera al arreglar el archivo. Esa última
  mitad es la que importa: un error de tipos no sirve como prueba, porque esbuild no typechequea.

## Estado para retomar (handoff)

**Dónde está todo.** PRs #1 y #2 mergeados a `main`; `main` es el tronco verde (CI en 3 jobs).
Rama única, limpia, sincronizada. Documento de operación en `docs/operacion/`, contrato de variables
en `.github/CI.md`, README en la raíz.

**Qué sigue: T5c.** Los seis verticales restantes (~20.000 líneas). Un vertical por vez, una rama, un
PR, con e2e propio. Orden propuesto: **clientes** primero (ventas y compras dependen de sus entidades),
después cajas-bancos (arrastra `ensureDefaultSettings`, ver L67), y al final ventas/compras, que son
los más entrelazados porque arrastran comprobantes y saldos.

**Deudas abiertas, con su referencia.**
- L77 — el API acepta `POST /api/auth/sign-up/email` de cualquiera: "solo el dueño crea cuentas" es
  restricción de UI. Cerrarlo pide fixtures SQL en los tests en vez del endpoint real.
- ~~L78~~ — cerrada en L80: `pnpm dev` levanta los dos procesos y el API se reinicia al guardar.
- L67 — `ensureDefaultSettings()` (cajas-bancos) sin portar; sin cubrir: pestañas de filtro, diálogo de
  asignación, impresión del recibo, concurrencia.
- L46c — `authenticated` conserva DML sobre `payment_balance` y `voucher_balance` (inocuo, sobra).
- L20 — `voucher_series` vacía: en Supabase la creaba la app.
- L65 — `GET /payments` cambió de contrato respecto de T4 (sin consumidor viejo).
- `receipt_sequence` en 104 en `gestion_pagos_dev` por pagos reales de los tests.

**Entorno de esta máquina (esto cuesta horas si se redescubre).**
- **Resuelto (L79).** La shell de Pi no hereda el PATH de Windows; usa uno curado que incluye
  `install/home/bin`. Ahí viven ahora shims `docker`, `gh`, `pnpm` (y sus variantes `.cmd`) que
  hornean la ruta absoluta y `GH_CONFIG_DIR`. `docker`, `gh` y `pnpm` se invocan sin prefijos ni
  rutas absolutas: `docker --version`, `gh auth status` y `pnpm turbo run …` responden directo.
  Si un update de Gentle Shell pisa `install/home/bin`, los comandos vuelven a faltar: recreá los
  shims con las rutas absolutas de abajo.
- Rutas reales de los binarios: `/c/Users/Lenovo/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe`,
  `/c/Program Files/GitHub CLI/gh.exe`, `install/runtime/node/corepack` (pnpm).
- `gh` necesita `GH_CONFIG_DIR="C:/Users/Lenovo/AppData/Roaming/GitHub CLI"` (ya lo fija el shim), porque
  `APPDATA` está redirigido al home de Gentle Shell.
- `/tmp` no existe y `bash.exe` avisa en cada comando: es cosmético, `TMPDIR`/`TEMP` apuntan a
  `install/tmp/…`.
- **Los comandos de entrega van solos**: un `git push` encadenado con `cd … &&` hace que el guard de
  RDD no ejecute *ninguno* de los comandos del encadenado (L56/L63).
- RDD está **apagado sólo en este clon** (`review mode disable --scope clone`) por el estado nativo
  inválido de L55; global sigue `on`. Reversible con `review mode enable --scope clone`.
- Chromium del e2e en `.cache/ms-playwright` (744 MB, gitignored). El e2e corre en
  `E2E_WEB_PORT`/`E2E_API_PORT` (3000/3001 por defecto); si esos puertos están tomados, cambiarlos.
- Contraseña de la base de dev: la de `compose.yaml` + el archivo de entorno del perfil; el
  `DATABASE_URL` usado en esta sesión es `postgresql://dev_user:…@localhost:5434/gestion_pagos_dev`.
