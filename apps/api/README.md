# @gestion/api

Backend NestJS del monorepo. Better Auth montado como handler HTTP, Drizzle sobre PostgreSQL y
el contrato Zod de `@gestion/shared` como borde de validacion (T4).

## Scripts

| script      | que hace                                                       |
| ----------- | -------------------------------------------------------------- |
| `build`     | bundle de `src/main.ts` a `dist/main.js` con esbuild            |
| `dev`       | build en watch **y** servidor, reiniciado en cada recompilación |
| `start`     | `node dist/main.js`                                            |
| `typecheck` | `tsc --noEmit` (incluye `test/`)                               |
| `test`      | `node --test` sobre `test/**/*.test.ts`                         |

El build usa esbuild y no `tsc` porque `@gestion/shared` se consume como TypeScript fuente con
su alias interno `@/*`, y TypeScript 7 exige `rootDir` explicito: `tsc` no puede emitir un
ejecutable de `apps/api` que incluya fuentes de `packages/shared`. Consecuencia: el bundle no
emite `design:paramtypes`, asi que **todos los constructores usan `@Inject(TOKEN)` explicito**.

## Entorno

Nada de esto se persiste en el repositorio; todo llega por variables de entorno en runtime.

| variable             | uso                                                              |
| -------------------- | ---------------------------------------------------------------- |
| `DATABASE_URL`       | obligatoria. Cadena de conexion a PostgreSQL.                    |
| `BETTER_AUTH_SECRET` | firma de cookies y sesiones.                                      |
| `BETTER_AUTH_URL`    | origen publico del API (p. ej. `http://localhost:3001`).          |
| `PORT`               | puerto HTTP (default `3001`).                                     |
| `DATABASE_POOL_MAX`  | conexiones del pool de `pg` (default `10`).                       |

## Rutas

| ruta                          | que hace                                                       |
| ----------------------------- | -------------------------------------------------------------- |
| `GET /health`                 | liveness, sin tocar la base                                    |
| `ALL /api/auth/*`             | handler de Better Auth (`toNodeHandler`), montado como catch-all |
| `GET /payments`               | pagos del usuario de la sesion, dentro de `withOwner` (RLS)     |
| `POST /contract/payments`     | smoke del pipe Zod: valida el `paymentSchema` compartido y lo devuelve parseado; no persiste nada |

`GET /payments` resuelve la identidad con `auth.api.getSession`; sin sesion responde 401. Toda
query de dominio pasa por `withOwner` (`src/db/with-owner.ts`), que abre una transaccion de
Drizzle y fija `app.user_id` con `set_config(..., true)` antes del callback.

## Pendiente fuera de este paquete

- `auth.session`, `auth.account` y `auth.verification` **no existen** en las migraciones
  portadas (las creaba Supabase). El mapeo del adapter esta declarado en
  `src/db/schema/auth.ts`; sin esa migracion en `packages/db`, sign-in falla con
  `relation "auth.session" does not exist`.
- Las politicas RLS son `TO authenticated`, pero la base no tiene grants de tabla para ese rol
  ni las tablas tienen `FORCE ROW LEVEL SECURITY`: conectado como dueno (`dev_user`), RLS no se
  evalua. Los servicios filtran por `owner_id` de forma explicita mientras eso se resuelve.
