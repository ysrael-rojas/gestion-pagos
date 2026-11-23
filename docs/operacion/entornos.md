# Entornos (local, dev y producción)

Este monorepo no tiene Supabase ni un proveedor de hosting: la base es un contenedor
`postgres:18` que levanta `compose.yaml` con perfiles (`dev` / `prod`) y todo lo demás corre en tu
máquina. Consecuencias, dichas de frente:

- hay **dos bases** (los dos perfiles del compose) y **ningún entorno desplegado**;
- el tercer entorno del proyecto de origen (Vercel Preview) **no existe acá**: no hay destino de
  deploy, ni `ignoreCommand`, ni entornos efímeros por PR;
- las reglas que imponía el panel de Supabase o el pipeline de Vercel se cumplen hoy por
  disciplina, no por herramienta. Cada una se explica abajo con lo que sí la sostiene.

El contrato de variables que el CI necesita está en `.github/CI.md`, en un solo lugar, y no se
duplica acá: esa es la lista completa de lo que el código lee y lo que `turbo.json` declara.

## Matriz de entornos

| Entorno | Dónde corre | Base | Quién escribe |
| --- | --- | --- | --- |
| Local | tu máquina: `pnpm --filter …` y `pnpm dev` | contenedor `gestion-pagos-db-dev` (perfil `dev`), volumen `postgres_data_dev` | vos y el agente, libremente |
| Producción | **no existe**. El perfil `prod` del compose es otro contenedor local (`gestion-pagos-db-prod`, volumen `postgres_data_prod`); nada despliega ahí | ese contenedor, si lo levantás | nadie: no hay pipeline de entrega |
| Preview | **no existe** | — | nadie |

Los dos contenedores escuchan en `${DB_PORT}` (`compose.yaml` usa la misma variable para los dos
servicios), así que **cada perfil necesita su archivo de entorno** y un puerto distinto si vas a
tener los dos arriba. En esta máquina: `dev` en 5434 y `prod` en 5435.

## Dónde vive cada variable

Ninguna se commitea: `.env`, `.env.dev` y `.env.prod` están en `.gitignore`, y el CI usa valores
de relleno descartables.

| Dónde | Variables | Quién las lee |
| --- | --- | --- |
| archivo de entorno del compose (`.env.dev` / `.env.prod`) | `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DB_PORT` | `compose.yaml`, y `apply-sql.mjs` / `drizzle.config.ts` cuando no hay `DATABASE_URL` |
| tu shell | `DATABASE_URL` | `db:seed`, `db:dump`, `db:check-rls`, `apps/api` (`db.provider.ts`), el e2e |
| tu shell | `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `PORT` | `apps/api` (Better Auth) |
| tu shell | `API_URL` (servidor) y `NEXT_PUBLIC_API_URL` (bundle) | `apps/web` |

`DATABASE_URL` **manda** sobre `POSTGRES_*`: cuando está definida, los scripts que saben componer
una cadena (el runner de migraciones, `drizzle.config.ts`) la usan tal cual. Los que no la saben
componer (`db:seed`, `db:dump`, `db:check-rls`) la exigen y salen 1 con un mensaje si falta, en vez
de inventar una conexión: sembrar la base equivocada es peor que fallar.

## Reglas

1. **Local nunca apunta a los datos de producción.** Acá no hay un proyecto remoto que confundir,
   pero sí un volumen: `postgres_data_prod` es otra base en tu misma máquina, a un `DB_PORT` de
   distancia. No exportes su `DATABASE_URL` en una shell donde vas a correr `db:verify` (aplica
   migraciones), `db:seed` (no es idempotente) o `pnpm e2e` (siembra y borra fixtures). Ni los
   seeds ni el suite pueden detectar que se equivocaron de base.
2. **Una migración viaja en el mismo PR que el código que la necesita**, y en el mismo commit que
   su snapshot: `db:dump --check` falla si los `.sql` de `packages/db/migrations` y
   `packages/db/scripts/schema-snapshot.sql` divergen, y el CI corre ese check antes de sembrar.
   La migración sin el código (o al revés) es un PR a medias, no dos PRs ordenados.
3. **Una migración aplicada no se edita.** `apply-sql.mjs` anota el nombre del archivo en
   `public.__sql_migrations` y salta los ya aplicados: si editás uno aplicado, el cambio no llega a
   ninguna base y el drift guard es el único que lo nota (por el esquema, no por el archivo). Se
   corrige con un archivo nuevo.
4. **`NEXT_PUBLIC_API_URL` se incrusta en el build.** Cambiarla sin rebuild deja el bundle
   apuntando a la URL anterior. El CI tiene un paso de build frío (`rm -rf apps/web/.next`) por
   esta clase de error.
5. **El origen confiable tiene que coincidir carácter por carácter.** Better Auth valida la
   cabecera `Origin` de los POST contra `BETTER_AUTH_TRUSTED_ORIGINS`; `http://localhost:3000` y
   `http://127.0.0.1:3000` no son el mismo origen (`localhost` puede resolver a `::1`). Sin
   coincidencia, el login responde 403 y ese mensaje se muestra tal cual en `/login`.
6. **Producción se toca solo desde `main`** sigue siendo la política, pero ya no hay nada que la
   imponga: no hay pipeline de entrega, ni `--project-ref`, ni cancelación de previews. Lo único
   automático es `.github/workflows/ci.yml`, que verifica el árbol y una base efímera; **no migra,
   no despliega y no hace smoke contra nada real**. Hasta que exista un destino de deploy, esta
   regla se cumple por disciplina.
7. **Sin credenciales en el repo.** Ni las de la base, ni un secreto de Better Auth, ni un correo
   real más allá del que ya traen los seeds.

## Cambiar el esquema (flujo diario)

Los runners son los de `packages/db`; no hay `supabase` CLI en el medio.

```bash
git switch -c spec-61-lo-que-sea

# 1) Archivo nuevo. El runner aplica en orden lexicográfico, así que el prefijo ordena:
#    14 dígitos de timestamp, y el shim `00000000000001_auth_compat.sql` está numerado para ir
#    primero y declarar el esquema `auth`, los roles de plataforma y `auth.uid()`.
$EDITOR packages/db/migrations/$(date +%Y%m%d%H%M%S)_descripcion_del_cambio.sql

# 2) Aplicar a tu base: una transacción por archivo, salta las ya aplicadas, para en el primer
#    error. Es idempotente, así que se puede correr siempre.
export DATABASE_URL=postgresql://<usuario>:<clave>@127.0.0.1:5434/<base>   # la del perfil dev
pnpm --filter @gestion/db db:verify

# 3) Regenerar el snapshot y comprobarlo. El snapshot nunca se edita a mano, y se regenera
#    invocando el script con `node`: `pnpm … db:dump > archivo` mete el banner de pnpm en el
#    archivo y el guard falla después (verificado: 3 líneas de más).
node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql
pnpm --filter @gestion/db db:dump --check

# 4) Puertas del cambio, las mismas del CI y sobre una base migrada y sembrada.
pnpm typecheck
pnpm test
pnpm build
```

Si el cambio toca una tabla que `apps/api` ya modela, actualizá a mano
`apps/api/src/db/schema/*.ts` leyendo el DDL real (`psql -c '\d public.la_tabla'`): esos archivos
son la vista del API y el drift guard no los mira. `pnpm --filter @gestion/db db:pull` existe
(`drizzle-kit pull`, introspección) y escribe en `packages/db/src/schema`, una ruta que hoy no
existe en el árbol y que ningún paquete importa; sirve para consultar qué ve Drizzle, **no** es el
paso diario ni la fuente de verdad de los tipos.

### Semillas: una excepción que muerde

`db:seed` **no es idempotente** (inserta con UUID fijos) y solo tiene sentido sobre una base recién
migrada. Sobre una base ya sembrada falla por clave duplicada, y esconder eso con `on conflict`
falsearía los conteos de la demo. Los cinco archivos y su orden (S20) los fija
`packages/db/scripts/apply-seeds.mjs`, no tu memoria:

```bash
export DATABASE_URL=postgresql://<usuario>:<clave>@127.0.0.1:5434/<base>
pnpm --filter @gestion/db db:seed
```

Si cambiás un seed, no hace falta el drift guard (no toca esquema): hace falta una base limpia,
`db:verify` + `db:seed`, y volver a correr lo que verificabas.

## Los runners que existen

| Comando | Qué hace | Qué necesita | Se puede repetir |
| --- | --- | --- | --- |
| `pnpm --filter @gestion/db db:verify` | aplica los `.sql` en orden, una transacción por archivo, y anota en `public.__sql_migrations` | `DATABASE_URL` o `POSTGRES_*` + `DB_PORT` | sí (salta aplicadas) |
| `pnpm --filter @gestion/db db:seed` | los 5 seeds en orden S20 | `DATABASE_URL` | **no** |
| `pnpm --filter @gestion/db db:dump --check` | compara el catálogo real (`public`, `auth`, `private`) con el snapshot | `DATABASE_URL` | sí |
| `pnpm --filter @gestion/db db:verify-rls` | auditoría de RLS: 8 bloques con resultado esperado (S19) | `DB_CONTAINER` + `DB_NAME` (docker) o `DATABASE_URL` + un `psql` local | sí (hace rollback de todo) |
| `pnpm --filter @gestion/db db:check-rls` | aislamiento por dueño desde la ruta de la app: 46 aserciones en una base scratch que crea y borra | `DATABASE_URL` con permiso de `create database` | sí |
| `pnpm --filter @gestion/db db:pull` | introspección de Drizzle (no es el flujo diario, ver arriba) | `DATABASE_URL` o `POSTGRES_*` + `DB_PORT` | sí |
| `pnpm --filter @gestion/db db:studio` | Drizzle Studio | idem | sí |

Detalles de los dos suites de RLS (transportes, base scratch, exclusiones del dump) en
`.github/CI.md`; acá solo lo que cambia según la máquina:

- `db:verify-rls` elige transporte: si hay `DATABASE_URL` usa un `psql` **local** (y falla con
  `spawnSync psql ENOENT` si no lo tenés); si no, habla por `docker exec` dentro de
  `DB_CONTAINER` (default `gestion-pagos-db-dev`) contra `DB_NAME` (default `gestion_verify`, que
  tenés que crear y migrar si no existe). Las credenciales no salen del contenedor.
- El default de `DB_CONTAINER` y los scripts asumen `docker` en el `PATH`; si no está, pasá
  `DOCKER=<ruta absoluta del binario>`.
- `db:check-rls` necesita un usuario con permiso de crear bases; en el compose el usuario de
  `POSTGRES_USER` lo es.
- Para regenerar el snapshot, `node packages/db/scripts/dump-schema.mjs > …` (no la forma con
  `pnpm`, que antepone su banner al archivo). Es la única línea de esta página que no es un
  script de `package.json`, y es a propósito.

## Crear un entorno desde cero

```bash
# 1) Dependencias. pnpm sale del `packageManager` del package.json (10.20.0) vía corepack.
corepack enable
pnpm install --frozen-lockfile

# 2) Archivo de entorno del perfil (gitignored): POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB,
#    DB_PORT. Sin él, compose interpola vacío: el mapeo de puerto queda inválido y las
#    credenciales no son las tuyas.
# 3) La base. `pnpm db:up` es el atajo de este comando para el perfil dev.
docker compose --env-file .env.dev --profile dev up -d
docker exec gestion-pagos-db-dev pg_isready -U <usuario> -d <base>

# 4) Esquema y datos.
export DATABASE_URL=postgresql://<usuario>:<clave>@127.0.0.1:5434/<base>
pnpm --filter @gestion/db db:verify     # 50 migraciones
pnpm --filter @gestion/db db:seed       # 5 seeds, en el orden de S20
pnpm --filter @gestion/db db:dump --check

# 5) El usuario del sistema: docs/operacion/crear-usuario.md (la demo ya trae uno sin clave).

# 6) Los dos procesos, en dos terminales.
pnpm --filter @gestion/api build && pnpm --filter @gestion/api start   # :3001
pnpm --filter @gestion/web dev                                        # :3000
```

`pnpm --filter @gestion/api dev` es el build en modo watch: recompila a `dist/`, no arranca el
servidor. `pnpm dev` (turbo) corre esa tarea y el `next dev`, así que **el proceso del API hay que
levantarlo aparte**, como en el paso 6.

## Detalles que muerden

- **`psql` no viene incluido.** Los caminos que lo necesitan son la auditoría de RLS con
  `DATABASE_URL` y el transporte de fixtures del e2e; el `psql` del contenedor no sirve para eso.
  Si no lo tenés, quedate en el transporte docker.
- **`gestion_verify` no existe por default.** Lo crea cada uno; la auditoría no lo crea.
- **El e2e y los tests de `apps/api` escriben en la base que apunta `DATABASE_URL`.** Los dos
  siembran fixtures y las borran al terminar; si los corrés contra la base donde estás mirando
  datos, vas a ver movimientos que no hiciste. Contá con eso.
- **Un `pnpm install` sin lockfile actualizado** rompe el CI (`--frozen-lockfile`): si agregaste una
  dependencia, commiteá `pnpm-lock.yaml` en el mismo PR.
- **Los dos perfiles no pueden compartir `DB_PORT`** ni archivo de entorno si los querés arriba al
  mismo tiempo.

## Lo que este repo todavía no tiene

Escrito acá para que nadie lo invente en un documento:

- **no hay entorno desplegado**, ni hosting, ni dominio, ni certificados;
- **no hay pipeline de entrega**: el CI verifica, no publica; `next start` y el `dist/main.js` del
  API no los corre ningún servicio;
- **no hay backups ni PITR**: la base es un volumen de Docker; un `docker compose down -v` la
  borra y no hay nada que restaurar;
- **no hay monitoreo, alertas ni logs centralizados**;
- **no hay migración de producción**, porque no hay producción.

Cuando alguno de esos cinco exista, esta página y `.github/CI.md` son los dos lugares que hay que
actualizar en el mismo PR.
