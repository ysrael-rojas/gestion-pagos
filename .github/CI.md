# CI del monorepo

Este es el unico lugar donde se documenta el contrato de entorno que el CI necesita. Si agregas
una variable que el codigo lee en build, test o arranque, se documenta aca y se declara en
`turbo.json` (ver "Variables y cache de Turborepo").

Referencias: `.github/workflows/ci.yml` (la pipeline), `odd/tasks/port-monorepo.md` T6, T7 y S19 (el
contrato de la auditoria de RLS y el del e2e), `packages/db/scripts/` y `apps/web/e2e/` (los
runners).

## Que corre

Tres jobs en paralelo, cada uno con su propio `postgres:18` de servicio (virgen).

### `checks` -- tipos, tests y build frio

| # | paso | comando |
| --- | --- | --- |
| 1 | checkout | `actions/checkout@v4` |
| 2 | node 22 (LTS, `engines: >=22`) | `actions/setup-node@v4` |
| 3 | pnpm exactamente el del `packageManager` (10.20.0) | `corepack enable` |
| 4 | dependencias con lockfile | `pnpm install --frozen-lockfile` |
| 5 | migraciones (la API las necesita) | `pnpm --filter @gestion/db db:verify` |
| 6 | seeds en el orden de S20 | `pnpm --filter @gestion/db db:seed` |
| 7 | tipos de los 4 paquetes | `pnpm typecheck` (turbo) |
| 8 | tests | `pnpm test` (turbo; `@gestion/api` 173, con `--test-concurrency=1` porque sus e2e comparten el dueño demo y su credencial; `@gestion/web` 158) |
| 9 | build de todos los paquetes | `pnpm build` (turbo) |
| 10 | **build frio de la web** | `rm -rf apps/web/.next && pnpm --filter @gestion/web build` |

El paso 10 es el que faltaba: sin borrar `.next`, Turbopack reusa la cache del build anterior y un
import sin resolver queda tapado (L39). `pnpm --filter @gestion/web build` ejecuta `next build`
directo, sin la cache de Turborepo en el medio.

No hay paso de lint: ningun paquete define `lint`, y `turbo run lint` sale 0 con "No tasks were
executed". Agregar el paso seria un verde vacio.

### `database` -- migraciones, seeds, RLS y drift

| # | paso | comando |
| --- | --- | --- |
| 1-4 | checkout, node 22, corepack, install | igual que `checks` |
| 5 | cliente de postgres | `sudo apt-get update && sudo apt-get install -y postgresql-client` |
| 6 | todas las migraciones de `packages/db/migrations/` sobre base virgen | `pnpm --filter @gestion/db db:verify` |
| 7 | **drift guard** | `pnpm --filter @gestion/db db:dump --check` |
| 8 | seeds en el orden de S20 | `pnpm --filter @gestion/db db:seed` |
| 9 | auditoria de RLS (S19, 8 bloques) | `pnpm --filter @gestion/db db:verify-rls` |
| 10 | aislamiento por dueno (47 aserciones) | `pnpm --filter @gestion/db db:check-rls` |

### `e2e` -- los verticales de pagos, clientes y cajas-bancos con Playwright

T7 (pagos) + T5c (clientes) + T5c/C8 (cajas-bancos). Levanta los DOS procesos reales (`apps/api`
compilado con esbuild y `next build` + `next start`) sobre una base migrada y sembrada, y recorre
los verticales como los usa una persona: sin sesion -> login -> listado vacio -> alta con asignacion
-> anulacion -> error de dominio -> cierre de sesion (pagos); listado vacio -> alta -> documento
duplicado -> edicion -> baja logica -> documento invalido (clientes); y dashboard -> alta de cuenta
-> transferencia -> extractos -> vale de caja chica -> conciliacion -> configuracion (cajas-bancos).

| # | paso | comando |
| --- | --- | --- |
| 1-4 | checkout, node 22, corepack, install | igual que `checks` |
| 5 | cliente de postgres (transporte de psql del suite) | `sudo apt-get update && sudo apt-get install -y postgresql-client` |
| 6 | todas las migraciones | `pnpm --filter @gestion/db db:verify` |
| 7 | seeds en el orden de S20 (la demo tiene que existir) | `pnpm --filter @gestion/db db:seed` |
| 8 | **solo Chromium**, con sus dependencias de sistema | `pnpm --filter @gestion/web exec playwright install --with-deps chromium` |
| 9 | **los 22 tests de los 9 specs** | `pnpm e2e` |

Un solo comando (`pnpm e2e` -> `turbo run e2e` -> `playwright test`): el `webServer` de
`apps/web/playwright.config.ts` compila y levanta el API y la web, espera a que respondan y los
apaga al terminar. No hay `continue-on-error` ni reintentos: un spec que falla rompe el job.

Cada spec crea su propio usuario desechable y sus fixtures (cuenta de caja, comprobante) por SQL con
`psql`, y las borra en orden de FK. El `globalTeardown` vuelve a medir los conteos de las tablas
sembradas y falla la corrida si alguna diferencia con el baseline. Los detalles -- transporte de
psql, variables, que NO esta cubierto -- estan en "e2e de los verticales (Playwright)", abajo.

Nota de entorno para Windows: si `docker` solo se alcanza por un shim `.cmd` (no hay `docker.exe`
en el PATH), el transporte de psql del suite falla con `spawnSync docker ENOENT` porque Node no
aplica `PATHEXT`. Se resuelve exportando `DOCKER` con la ruta absoluta al `docker.exe` (el helper
ya lo soporta) o poniendo el directorio real de Docker Desktop en el PATH.

## Variables de entorno

Todas las que lee el codigo, en un solo lugar. El CI las provee con valores de relleno (el postgres
del runner es efimero y se descarta con la maquina); ninguna es un secreto y ninguna se commitea.

| variable | quien la lee | en CI | en local |
| --- | --- | --- | --- |
| `DATABASE_URL` | `packages/db/scripts/*`, `apps/api` (`db.provider.ts`), los e2e | `postgresql://ci:ci-throwaway@127.0.0.1:5432/gestion_ci` | la de tu base (ver abajo) |
| `BETTER_AUTH_SECRET` | `apps/api` (firma de cookies/sesiones) | `ci-throwaway-secret-no-persistido` | cualquiera; los e2e generan uno efimero si falta |
| `BETTER_AUTH_URL` | `apps/api` (origen publico) | `http://127.0.0.1:3001` | idem |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Better Auth en `apps/api` (validacion de `Origin` en los POST) | `http://127.0.0.1:3000` (el origen de la web) | el origen con el que abras la web, p. ej. `http://127.0.0.1:3000` |
| `PLAYWRIGHT_BROWSERS_PATH` | Playwright (donde busca/instala el navegador) | `${{ github.workspace }}/.cache/ms-playwright` | default del config: `<repo>/.cache/ms-playwright` |
| `E2E_WEB_PORT` / `E2E_API_PORT` | `apps/web/playwright.config.ts` y el suite | no se definen (3000 / 3001) | solo si esos puertos estan ocupados |
| `E2E_DB_TRANSPORT` | `apps/web/e2e/support/psql.ts` | no se define (elige `url` por haber `DATABASE_URL` + `psql`) | `docker` para forzar el camino del compose |
| `PORT` | `apps/api` (default 3001) | no se define | no hace falta |
| `API_URL` | `apps/web/lib/api/client.ts` (llamadas server-side) | `http://127.0.0.1:3001` | idem |
| `NEXT_PUBLIC_API_URL` | `apps/web` (llamadas del navegador; se inlinea en el bundle) | `http://127.0.0.1:3001` | idem |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `DB_PORT` | `compose.yaml`, y `apply-sql.mjs` / `drizzle.config.ts` cuando no hay `DATABASE_URL` | no se definen | las de tu archivo de entorno local del compose (gitignored) |
| `DB_CONTAINER` / `DB_NAME` / `DB_USER` / `DOCKER` | `db:verify-rls` en su camino Docker, y `apps/web/e2e/support/psql.ts` (`DB_CONTAINER`, `DOCKER`) | no se definen | ver "Auditoria de RLS" y "e2e" |
| `PSQL_BIN` | `db:verify-rls` y el e2e en su camino `DATABASE_URL` | no hace falta (`psql` esta en el PATH) | ruta al `psql` si no esta en el PATH |
| `TURBO_TELEMETRY_DISABLED` / `DO_NOT_TRACK` | turbo | `1` | opcional |

### Variables y cache de Turborepo

Turborepo 2 corre en `envMode: strict`: **las variables que una tarea no declara no llegan al
proceso**. Sin `env` en `turbo.json`, `pnpm test` ve un entorno sin `DATABASE_URL` y los e2e de
`apps/api` fallan con "Falta DATABASE_URL" aunque la variable este exportada (se observo al armar
este CI). Por eso `turbo.json` declara:

- `test`: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `build`: `NEXT_PUBLIC_API_URL`, `API_URL`
- `e2e`: `DATABASE_URL`, `API_URL`, `NEXT_PUBLIC_API_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
  `BETTER_AUTH_TRUSTED_ORIGINS`, `DB_CONTAINER`, `DOCKER`, `PSQL_BIN`, `E2E_DB_TRANSPORT`,
  `E2E_WEB_PORT`, `E2E_API_PORT`, `PLAYWRIGHT_BROWSERS_PATH`, `CI`

La tarea `e2e` va con `cache: false` aunque declare `env`: una corrida toca una base real y un
navegador, asi que reusar un resultado cacheado seria reportar como verde algo que no corrio.

Declararlas tambien las mete en el hash de la tarea: dos bases distintas ya no comparten resultado
cacheado.

### Turborepo necesita el binario de pnpm en el PATH

Turborepo no ejecuta los scripts de cada paquete por si mismo: los delega al **binario del package
manager** (`pnpm run <tarea>`) y lo busca en el PATH. Si la unica forma de invocar pnpm es
`corepack pnpm ...`, el binario no existe como comando, y `pnpm test` (o `build`, o `typecheck`)
muere con:

```
 x Unable to find package manager binary: cannot find binary path
```

No es un problema del repo ni de las tareas: es el entorno. En el CI no pasa porque el paso
`corepack enable` escribe los shims de `pnpm` en el directorio bin de Node, que ya esta en el PATH,
asi que turborepo siempre lo encuentra. En local, con corepack, elegi una:

- `corepack enable` una vez (deja los shims en el bin de Node; es lo que hace el CI), o
- un shim en un directorio propio agregado al PATH (en esta maquina: `.cache/bin/pnpm.cmd`, que
  ejecuta `corepack pnpm %*`, con `.cache/bin` en el PATH), o
- `corepack enable --install-directory ~/.local/bin` y `~/.local/bin` en el PATH.

Con el binario en el PATH, `corepack pnpm test` da 33/33 y exit 0.

## Reproducir el CI en local

Requisitos: Docker (para el `postgres:18`), Node 22+ y `corepack`. Los comandos son los mismos que
corre el workflow; aca se usa un contenedor propio con las mismas credenciales de relleno que el
CI, para no ensuciar la base de desarrollo.

```bash
# 1) Un postgres:18 virgen, con las credenciales de relleno del CI.
docker run -d --name gestion-ci -p 5440:5432 \
  -e POSTGRES_USER=ci -e POSTGRES_PASSWORD=ci-throwaway -e POSTGRES_DB=gestion_ci \
  postgres:18
docker exec gestion-ci pg_isready -U ci -d gestion_ci

# 2) Las variables del job (los valores de relleno estan en ci.yml).
export DATABASE_URL=postgresql://ci:ci-throwaway@127.0.0.1:5440/gestion_ci
export BETTER_AUTH_SECRET=ci-throwaway-secret-no-persistido
export BETTER_AUTH_URL=http://127.0.0.1:3001
export API_URL=http://127.0.0.1:3001
export NEXT_PUBLIC_API_URL=http://127.0.0.1:3001

# 3) Primera mitad del job `database`: esquema, sin datos todavia.
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @gestion/db db:verify
corepack pnpm --filter @gestion/db db:dump --check

# 4) Semillas (una sola vez: no son idempotentes) y el job `checks`.
corepack pnpm --filter @gestion/db db:seed
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
rm -rf apps/web/.next && corepack pnpm --filter @gestion/web build

# 5) Segunda mitad del job `database`: las dos suites de RLS.
corepack pnpm --filter @gestion/db db:verify-rls
corepack pnpm --filter @gestion/db db:check-rls

# 6) El job `e2e` (Playwright). El navegador va al workspace, no al perfil del runner.
export BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3000
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/ms-playwright"
corepack pnpm --filter @gestion/web exec playwright install --with-deps chromium
corepack pnpm e2e

# 7) Limpieza del contenedor del CI.
docker rm -f gestion-ci
```

En el CI los tres jobs corren en paralelo, cada uno con su propio postgres de servicio. En local
alcanza una sola base porque el drift guard corre **antes** de sembrar: es un contrato de
esquema, no de filas.

Para correr los pasos de base contra la base de desarrollo (`gestion_pagos_dev`, la del compose) en
vez de un contenedor nuevo, exporta `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` y `DB_PORT`
con los valores de tu archivo de entorno local: `apply-sql.mjs` y `drizzle.config.ts` componen
`DATABASE_URL` a partir de ellos, sin que la cadena quede en ningun archivo del repo.

## Auditoria de RLS (`db:verify-rls`) sin Docker

`packages/db/scripts/verify-rls.mjs` tiene dos transportes y elige uno solo:

- **Docker (default, uso local):** `docker exec -i "$DB_CONTAINER" sh -c 'psql ...'`. Las
  credenciales no salen del contenedor. Variables: `DB_CONTAINER` (default
  `gestion-pagos-db-dev`), `DB_NAME` (default `gestion_verify`), `DB_USER` (default el
  `POSTGRES_USER` del contenedor), `DOCKER` (ruta al binario si no esta en el PATH).
- **`DATABASE_URL` (CI y cualquier host sin Docker):** `psql` local contra esa cadena.
  `PSQL_BIN` permite apuntar a un binario que no esta en el PATH.

Lo unico que cambia es el transporte. El archivo de auditoria
(`packages/db/seeds/verify-owner-consistency.sql`), la tabla de resultados esperados de S19 y el
analisis de la salida son exactamente los mismos en los dos caminos. `psql` 16 (el que instala
Ubuntu) funciona contra el servidor 18 del CI: el cliente solo necesita hablar el protocolo, y el
suite no usa `pg_dump` (que si exige que el cliente sea del mismo major o mas nuevo).

## Drift guard (`db:dump`)

`packages/db/scripts/dump-schema.mjs` lee el catalogo de los esquemas `public`, `auth` y `private` y
emite texto plano: una linea por objeto, secciones en orden fijo, lineas ordenadas. Compara
relaciones, columnas, tipos, enums, constraints, indices, funciones (con su cuerpo), triggers,
politicas, RLS, los tres roles de la plataforma y los privilegios -- de tabla, **de columna**, de
funcion, de esquema y los default privileges de las tablas futuras.

- `pnpm --filter @gestion/db db:dump` imprime el dump en stdout.
- `pnpm --filter @gestion/db db:dump --check` lo compara con
  `packages/db/scripts/schema-snapshot.sql` y sale 1 con el diff si no coinciden.

Regenerar el snapshot (despues de una migracion nueva, nunca a mano):

```bash
node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql
```

Por que el snapshot vive en `packages/db/scripts/`: junto al script que lo genera, y el paquete ya
es el duenio del esquema. El dueno de los objetos se emite como `OWNER` y el `grantor` se omite,
porque los dos son el rol que despliega (S16) y cambian entre maquinas.

### Exclusiones: el guard mide el contrato, no como se inicializo la base

Un guard que falla por como se creo la base entrena a ignorarlo. Por eso el dump **no emite** dos
clases de entrada de ACL, y las dos son una reduccion deliberada de su alcance:

| clase excluida | por que |
| --- | --- |
| privilegios a nombre del pseudo-rol `pg_database_owner` (se emiten como `OWNER`) | Solo existen en una base provisionada por initdb, donde `public` viene de `template1` con `nspacl = {pg_database_owner=UC/…,=U/…}`. Reseteada a mano (`drop schema public cascade; create schema public;`), el mismo hecho se materializa a nombre del dueno real. Ninguna migracion lo nombra. |
| `GRANT USAGE ON SCHEMA public TO PUBLIC` | Es el default `=U` de initdb desde PostgreSQL 15. Una base cuyo `public` se recreo a mano no lo tiene. El unico grant a PUBLIC que hace este port es sobre `auth` (shim), y ese si se emite. Lo que se pierde: ver que alguien revoque ese default en una base de initdb. |

Todo lo demas se compara tal cual, incluidos los grants a `authenticated`, `anon` y
`service_role`, los de tabla y los **de columna** del hardening `20261012221550` (L30/L31).

Portabilidad probada con dos bases migradas con la misma lista de migraciones y creadas de forma
distinta: una del `postgres:18` del CI (`public` de `template1`) y otra reseteada a mano con
`drop schema public cascade; create schema public;` como superusuario (la forma de
`gestion_pagos_dev`, L32). Las dos dan `db:dump --check` exit 0 contra el mismo snapshot
commiteado, y las cuatro mutaciones de control (grant de tabla, politica borrada, RLS
deshabilitada, revoke de un grant de columna) siguen saliendo 1 con un unico hunk legible. Una
tercera forma, `create database ... template template0`, da el mismo ACL en PostgreSQL 18 y
tambien exit 0.

## e2e del vertical de pagos (Playwright)

T7. El suite vive en `apps/web/e2e/` (config: `apps/web/playwright.config.ts`). Un solo comando
desde la raiz:

```bash
export DATABASE_URL=postgresql://<lo que sea tu base>          # la MISMA que usa apps/api
export BETTER_AUTH_SECRET=<cualquiera>                           # efimera si falta
export BETTER_AUTH_TRUSTED_ORIGINS=http://127.0.0.1:3000         # el origen de la web
corepack pnpm e2e
```

`pnpm e2e` -> `turbo run e2e` -> `playwright test`. Playwright compila y levanta los dos
servicios en `webServer` (API: `node ../api/scripts/build.mjs && node ../api/dist/main.js`; web:
`next build && next start`), espera a que respondan y los apaga. No hace falta arrancar nada a
mano y no se reusa un servidor ya levantado (`reuseExistingServer: false`): un e2e que valida un
build viejo es peor que no tener e2e.

### Que prueba

| spec | afirmacion |
| --- | --- |
| `01-auth-redirect` | sin sesion, `/pagos/ingresos` y `/` redirigen a `/login` (redirect de servidor, no un shell vacio) |
| `02-sign-in` | login por el formulario real: cookie `HttpOnly`, sesion que sobrevive a la recarga, `/login` con sesion va a `/`; una contrasena incorrecta muestra el mensaje del API |
| `03-empty-state` | el dueno nuevo ve el estado vacio en ingresos y egresos (ni una fila de la demo) |
| `04-create-payment` | catalogos self-provisionados, resumen asignado/sin asignar (600/400), vuelta al listado, fila con numero de recibo y saldo, y la asignacion persistida en el detalle |
| `05-void-payment` | anular desde el listado: el estado pasa a Anulado y la accion de anular desaparece |
| `06-domain-error` | el mensaje del dominio llega **verbatim** a la notificacion ("La cuenta de caja no existe") y el pago no se crea; dos casos: cuenta de otro dueno y cuenta inexistente |
| `07-sign-out` | cerrar sesion revoca la sesion (`auth.session` vuelve a 0) y las rutas protegidas vuelven a `/login` |
| `08-clientes` | el maestro de clientes: listado vacio, alta por el formulario, documento duplicado rechazado con el mensaje del API, edicion y baja logica |
| `09-cajas-bancos` | el vertical de cajas-bancos de punta a punta: el dashboard como raiz del vertical, el alta de una cuenta bancaria por el formulario con su saldo calculado en la base, una transferencia entre cuentas que aparece en extractos, un vale de caja chica que se crea y se anula dejando su recibo anulado, una conciliacion guardada con su acta renderizada, y el interruptor de una categoria en configuracion |
| `10-ventas` | el vertical de ventas de punta a punta: el listado con sus columnas, filtros y `Registrar pago` solo en un comprobante pendiente, el alta por el formulario, el detalle con su saldo y la edicion de un comprobante con pagos (aviso de S5 y los cuatro campos protegidos deshabilitados) |

### Determinismo

- **Un usuario por spec**, creado por SQL con `createOwner()` (`auth.users` + `auth.account` con
  `provider_id = 'credential'` y el hash de `hashPassword`, por el mismo transporte de `psql` que
  las fixtures) y entrada por el formulario de `/login`, que es el camino real. El alta publica
  `POST /api/auth/sign-up/email` esta cerrada en el API (`disableSignUp`, L81): responde `400` y no
  escribe ninguna fila. La contrasena se genera en runtime: no hay credencial en ningun archivo del
  repo.
- **Fixtures propias** (cuenta de caja, entidad, comprobante) sembradas por SQL como dueno de las
  tablas, igual que los seeds, siempre con `owner_id` explicito. `apps/api` no expone escritura de
  cuentas ni de comprobantes, asi que no hay otra via. El dueno demo nunca se toca: todas las
  clausulas son por el uuid del usuario desechable.
- **Borrado en orden de FK** en el teardown de cada spec (y de la fixture si el spec falla).
- **Conteos medidos**: `globalSetup` toma el conteo de las tablas sembradas y `globalTeardown` lo
  vuelve a medir; cualquier diferencia falla la corrida. `receipt_sequence` se cuenta por filas, no
  por valor: `last_serial` es monotono y un alta real tiene que avanzarlo.
- Si una corrida anterior dejo usuarios desechables (Ctrl-C, un `| head` que corta el proceso), el
  setup **no arranca**: el baseline ya no representaria la base sembrada. Es deliberado -- un
  baseline sucio haria que el check del teardown no pruebe nada.

### puertos, navegador y transporte de psql

- Puertos 3000 (web) y 3001 (API) por default; `E2E_WEB_PORT` / `E2E_API_PORT` los cambian (util
  si algo ya ocupa esos puertos en tu maquina).
- El navegador se instala dentro del workspace: `PLAYWRIGHT_BROWSERS_PATH` apunta a
  `<repo>/.cache/ms-playwright` (gitignored) por default del config, y el workflow lo fija al mismo
  valor. No se usa el perfil del usuario ni el cache del runner.
- Las fixtures se siembran con `psql`, reusando el transporte doble de `db:verify-rls`: `url`
  (psql local contra `DATABASE_URL`) o `docker` (`docker exec`). Se elige `url` cuando hay
  `DATABASE_URL` y un psql alcanzable, `docker` en caso contrario; `E2E_DB_TRANSPORT` lo fuerza. El
  setup verifica que el transporte y `DATABASE_URL` apunten a la **misma** base: si no, las
  fixtures irian a una y la app leeria otra.

## Lo que este CI no cubre

- Del vertical de pagos quedan sin e2e (deudas de L67): las pestañas `?filtro=…`, el dialogo de
  asignacion sobre un pago existente, la seccion de asignacion del modal de detalle y el layout de
  impresion del recibo.
- La concurrencia real (dos `void`/`allocate` en paralelo) sigue sin probarse (L46d).
- Nada de despliegue, migracion de produccion ni smoke test contra un entorno real: el workflow
  solo verifica el arbol y una base efimera.
- `pnpm deploy`/Docker de la imagen de la API y el `next start` de la web no se prueban (no hay
  pipeline de entrega todavia).

