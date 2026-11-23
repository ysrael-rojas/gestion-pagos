# gestion-pagos

Monorepo del gestor de pagos, cobranzas y caja de una MYPE peruana: el port de `gestion-app`
(Next.js + Supabase gestionada) a **pnpm + Turborepo**, con Next.js (App Router), NestJS, Better
Auth, Drizzle y un PostgreSQL 18 local en Docker. La spec del port, con sus decisiones (S1–S20) y
su bitácora, está en [`odd/tasks/port-monorepo.md`](odd/tasks/port-monorepo.md); este README solo
dice qué hay y cómo levantarlo.

## Paquetes

| Paquete | De qué es dueño |
| --- | --- |
| `apps/api` (`@gestion/api`) | NestJS: autenticación (Better Auth montado en `/api/auth/*`), acceso a datos con Drizzle y `SET LOCAL app.user_id` por transacción, y los endpoints de dominio (`/payments`, `/vouchers/open`, `/cartera/*`, catálogos, `/health`). Se compila con esbuild a `dist/main.js`. |
| `apps/web` (`@gestion/web`) | Next.js App Router + Tailwind v4: `/login`, layout autenticado, vertical de pagos (ingresos y egresos) y el puente same-origin `/api/backend/*` que reenvía al API (el API no habilita CORS y la cookie es `HttpOnly`). |
| `packages/db` (`@gestion/db`) | El esquema: las migraciones `.sql` escritas a mano (tablas, 39 políticas RLS, funciones PL/pgSQL, triggers), los seeds en su orden, y los runners (`db:verify`, `db:seed`, `db:dump`, `db:verify-rls`, `db:check-rls`). Es la fuente de verdad del esquema; Drizzle aporta tipos, no DDL. |
| `packages/shared` (`@gestion/shared`) | El contrato: los 18 schemas Zod (validados tanto por el API como por la web), tipos de dominio y datos de catálogo. Sin dependencias del backend ni de la base. |

## De una máquina limpia a la app andando

Requisitos: **Node ≥ 22**, **pnpm 10.20.0** (es el `packageManager` del repo: se activa con
`corepack enable`) y **Docker** para el `postgres:18`.

```bash
corepack enable && pnpm install --frozen-lockfile

# 1) Archivo de entorno del perfil dev (gitignored) con POSTGRES_USER, POSTGRES_PASSWORD,
#    POSTGRES_DB y DB_PORT. Sin él, compose interpola vacío y no levanta con tus credenciales.
#    Detalle y matriz de variables: docs/operacion/entornos.md
# 2) La base (atajo de este comando: `pnpm db:up`; para bajarla, `pnpm db:down`)
docker compose --env-file .env.dev --profile dev up -d

# 3) Esquema y datos de demo (50 migraciones + 5 seeds; el seed no es idempotente)
export DATABASE_URL=postgresql://<usuario>:<clave>@127.0.0.1:5434/<base>
pnpm --filter @gestion/db db:verify
pnpm --filter @gestion/db db:seed

# 4) Los dos procesos, en dos terminales
pnpm --filter @gestion/api build && pnpm --filter @gestion/api start   # http://127.0.0.1:3001
pnpm --filter @gestion/web dev                                        # http://localhost:3000
```

Variables que el API necesita para arrancar: `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL` y `BETTER_AUTH_TRUSTED_ORIGINS` (el origen exacto de la web: si no coincide, el
login responde 403). La web lee `API_URL` (servidor) y `NEXT_PUBLIC_API_URL` (bundle; se incrusta
en el build). La lista completa, con qué tarea de Turborepo las ve, está en
[`.github/CI.md`](.github/CI.md).

**Entrar**: una base recién sembrada no tiene ningún usuario con contraseña — el usuario demo
existe para dar `owner_id` a los seeds, a propósito. Cómo crear el tuyo (endpoint, o SQL con el
hash correcto) y cómo borrarlo: [`docs/operacion/crear-usuario.md`](docs/operacion/crear-usuario.md).

`pnpm --filter @gestion/api dev` es el build en modo watch: recompila, **no** arranca el servidor.
`pnpm dev` corre ese watcher y el `next dev`, no el proceso del API: arrancalo aparte, como en el
paso 4.

## Las puertas de un cambio

| Qué se verifica | Comando | Necesita |
| --- | --- | --- |
| tipos de los 4 paquetes | `pnpm typecheck` | nada |
| unitarios (API 39, web 34) | `pnpm test` | base migrada **y sembrada** |
| los verticales de pagos, clientes y cajas-bancos en un navegador | `pnpm e2e` | base migrada y sembrada, Chromium instalado |
| migraciones sobre base limpia | `pnpm --filter @gestion/db db:verify` | base vacía o ya migrada |
| esquema real vs snapshot (drift) | `pnpm --filter @gestion/db db:dump --check` | base migrada |
| auditoría de RLS (8 bloques) | `pnpm --filter @gestion/db db:verify-rls` | contenedor, o `DATABASE_URL` + un `psql` local |
| aislamiento por dueño (47 aserciones) | `pnpm --filter @gestion/db db:check-rls` | `DATABASE_URL` con permiso de crear base |
| build de los paquetes | `pnpm build` | nada |

`pnpm lint` existe en el `package.json` pero no hace nada: ningún paquete define la tarea. No lo
cuentes como puerta.

El CI corre todo esto en tres jobs (tipos/tests/build frío, base con RLS y drift, e2e) sobre un
`postgres:18` efímero. **La referencia canónica del pipeline, las variables y lo que no está
cubierto es [`.github/CI.md`](.github/CI.md)**; no la dupliques acá.

## Documentación

- [`odd/tasks/port-monorepo.md`](odd/tasks/port-monorepo.md) — la spec del port (S1–S20) y su bitácora.
- [`.github/CI.md`](.github/CI.md) — jobs, variables, runners de base, auditoría de RLS y e2e.
- [`docs/operacion/entornos.md`](docs/operacion/entornos.md) — qué entornos existen (y cuáles no),
  qué variable vive dónde, y el flujo diario de cambio de esquema.
- [`docs/operacion/crear-usuario.md`](docs/operacion/crear-usuario.md) — alta, reset y borrado de usuarios.
- [`.agents/skills/`](.agents/skills) — skills de dominio: `facturacion-sunat-mype`,
  `consultor-pagos-cobranzas`, `caja-bancos-mype`.

## Lo que todavía no existe

No hay deploy, ni hosting, ni dominio, ni backups, ni monitoreo, ni migración de producción: el CI
verifica, no publica. Está detallado al final de `docs/operacion/entornos.md`, que es el lugar a
actualizar (junto con `.github/CI.md`) el día que algo de eso exista.
