# CI del monorepo

Este es el unico lugar donde se documenta el contrato de entorno que el CI necesita. Si agregas
una variable que el codigo lee en build, test o arranque, se documenta aca y se declara en
`turbo.json` (ver "Variables y cache de Turborepo").

Referencias: `.github/workflows/ci.yml` (la pipeline), `odd/tasks/port-monorepo.md` T6 y S19 (el
contrato de la auditoria de RLS), `packages/db/scripts/` (los runners).

## Que corre

Dos jobs en paralelo, cada uno con su propio `postgres:18` de servicio (virgen).

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
| 8 | tests | `pnpm test` (turbo; hoy solo `@gestion/api`) |
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
| 6 | las 50 migraciones sobre base virgen | `pnpm --filter @gestion/db db:verify` |
| 7 | **drift guard** | `pnpm --filter @gestion/db db:dump --check` |
| 8 | seeds en el orden de S20 | `pnpm --filter @gestion/db db:seed` |
| 9 | auditoria de RLS (S19, 8 bloques) | `pnpm --filter @gestion/db db:verify-rls` |
| 10 | aislamiento por dueno (42 aserciones) | `pnpm --filter @gestion/db db:check-rls` |

## Variables de entorno

Todas las que lee el codigo, en un solo lugar. El CI las provee con valores de relleno (el postgres
del runner es efimero y se descarta con la maquina); ninguna es un secreto y ninguna se commitea.

| variable | quien la lee | en CI | en local |
| --- | --- | --- | --- |
| `DATABASE_URL` | `packages/db/scripts/*`, `apps/api` (`db.provider.ts`), los e2e | `postgresql://ci:ci-throwaway@127.0.0.1:5432/gestion_ci` | la de tu base (ver abajo) |
| `BETTER_AUTH_SECRET` | `apps/api` (firma de cookies/sesiones) | `ci-throwaway-secret-no-persistido` | cualquiera; los e2e generan uno efimero si falta |
| `BETTER_AUTH_URL` | `apps/api` (origen publico) | `http://127.0.0.1:3001` | idem |
| `PORT` | `apps/api` (default 3001) | no se define | no hace falta |
| `API_URL` | `apps/web/lib/api/client.ts` (llamadas server-side) | `http://127.0.0.1:3001` | idem |
| `NEXT_PUBLIC_API_URL` | `apps/web` (llamadas del navegador; se inlinea en el bundle) | `http://127.0.0.1:3001` | idem |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `DB_PORT` | `compose.yaml`, y `apply-sql.mjs` / `drizzle.config.ts` cuando no hay `DATABASE_URL` | no se definen | las de tu archivo de entorno local del compose (gitignored) |
| `DB_CONTAINER` / `DB_NAME` / `DB_USER` / `DOCKER` | `db:verify-rls` en su camino Docker | no se definen | ver "Auditoria de RLS" |
| `PSQL_BIN` | `db:verify-rls` en su camino `DATABASE_URL` | no hace falta (`psql` esta en el PATH) | ruta al `psql` si no esta en el PATH |
| `TURBO_TELEMETRY_DISABLED` / `DO_NOT_TRACK` | turbo | `1` | opcional |

### Variables y cache de Turborepo

Turborepo 2 corre en `envMode: strict`: **las variables que una tarea no declara no llegan al
proceso**. Sin `env` en `turbo.json`, `pnpm test` ve un entorno sin `DATABASE_URL` y los e2e de
`apps/api` fallan con "Falta DATABASE_URL" aunque la variable este exportada (se observo al armar
este CI). Por eso `turbo.json` declara:

- `test`: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- `build`: `NEXT_PUBLIC_API_URL`, `API_URL`

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

# 6) Limpieza del contenedor del CI.
docker rm -f gestion-ci
```

En el CI los dos jobs corren en paralelo, cada uno con su propio postgres de servicio. En local
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
pnpm --filter @gestion/db db:dump > packages/db/scripts/schema-snapshot.sql
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

Portabilidad probada con dos bases migradas con las mismas 50 migraciones y creadas de forma
distinta: una del `postgres:18` del CI (`public` de `template1`) y otra reseteada a mano con
`drop schema public cascade; create schema public;` como superusuario (la forma de
`gestion_pagos_dev`, L32). Las dos dan `db:dump --check` exit 0 contra el mismo snapshot
commiteado, y las cuatro mutaciones de control (grant de tabla, politica borrada, RLS
deshabilitada, revoke de un grant de columna) siguen saliendo 1 con un unico hunk legible. Una
tercera forma, `create database ... template template0`, da el mismo ACL en PostgreSQL 18 y
tambien exit 0.

## Lo que este CI no cubre

- `apps/web` no tiene tests (ni unitarios ni e2e). El e2e de Playwright es T7: no existe todavia.
- La concurrencia real (dos `void`/`allocate` en paralelo) sigue sin probarse (L46d).
- Nada de despliegue, migracion de produccion ni smoke test contra un entorno real: el workflow
  solo verifica el arbol y una base efimera.
- `pnpm deploy`/Docker de la imagen de la API y el `next start` de la web no se prueban (no hay
  pipeline de entrega todavia).
