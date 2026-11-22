-- ============================================================================
-- Modelo de privilegios fuera de Supabase + tablas de Better Auth.
--
-- Cierra los dos huecos que dejan las 49 migraciones portadas:
--
--   1. Privilegios de tabla. En Supabase `auto_expose_new_tables = true` concede
--      implicitamente SELECT/INSERT/UPDATE/DELETE a `anon`/`authenticated`: eso no lo hace el
--      SQL heredado ni lo hace Postgres. Sin los GRANT de abajo, `set local role authenticated`
--      muere con `42501 permission denied for table ...` antes de que ninguna politica se
--      evalue, aunque las 39 politicas esten correctas.
--   2. Las tablas de Better Auth. El shim solo aporta `auth.users` (la tabla canonica de
--      identidad, S15). `auth.session`, `auth.account` y `auth.verification` las creaba
--      Supabase Auth y sin ellas no se puede iniciar sesion.
--
-- Modelo de acceso (quien escribe que):
--
--   * `dev_user` -- owner de las tablas y superusuario del contenedor. Es la via de las
--     migraciones, de los seeds y de Better Auth: `auth.*` se escribe con privilegios de owner,
--     por eso `apps/api/src/auth/*` NO pasa por `withOwner`.
--   * `authenticated` -- via de la aplicacion. `apps/api` hace
--     `set local role authenticated` dentro de la transaccion del request
--     (apps/api/src/db/with-owner.ts), asi que las politicas RLS se evaluan contra
--     `auth.uid()` = GUC `app.user_id`. Ninguna query de dominio escapa del dueno.
--   * `service_role` -- via administrativa. Mantiene BYPASSRLS.
--   * `anon` -- sin NINGUN privilegio de tabla. La app exige sesion; el default permisivo de
--     Supabase es justamente lo que no se copia.
--
-- Idempotente: `create table if not exists`, `grant` (que es idempotente por naturaleza) y un
-- guard para el atributo de rol.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Better Auth 1.7 -- modelos `session`, `account` y `verification`.
--
-- La forma es la de `apps/api/src/db/schema/auth.ts` (el mapeo que recibe el adapter de
-- Drizzle), columna por columna: `text` para los ids generados por la app, `timestamptz` para
-- los timestamps, `user_id uuid` porque `auth.users.id` es uuid (8 FK heredadas dependen de
-- eso). No se agregan columnas ni indices que el mapeo no declare.
-- ---------------------------------------------------------------------------

create table if not exists auth.session (
  id text primary key,
  expires_at timestamptz not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  user_id uuid not null references auth.users (id) on delete cascade
);

comment on table auth.session is
  'Sesiones de Better Auth. Escritas por apps/api como owner; no hay RLS: nadie mas que el owner tiene privilegios.';

create table if not exists auth.account (
  id text primary key,
  account_id text not null,
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  access_token text,
  refresh_token text,
  id_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scope text,
  password text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table auth.account is
  'Cuentas de Better Auth (credenciales del proveedor). `password` guarda el hash, nunca la clave.';

create table if not exists auth.verification (
  id text primary key,
  identifier text not null,
  value text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table auth.verification is
  'Tokens de verificacion de Better Auth (email, reset de clave).';

-- ---------------------------------------------------------------------------
-- Privilegios de tabla.
-- ---------------------------------------------------------------------------

-- Sin `usage` en el esquema, un rol no puede ni nombrar las tablas: el 42501 saldria antes de
-- la politica. `anon` recibe solo `usage` (puede resolver nombres), no privilegios de tabla.
grant usage on schema public to authenticated, anon;

-- La via de la aplicacion. Las politicas RLS de cada tabla son las que recortan las filas; este
-- GRANT es lo que permite llegar a evaluarlas.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Tablas futuras: el mismo contrato sin volver a tocar este archivo. `alter default privileges`
-- solo afecta a lo que cree el rol que ejecuta la migracion (`dev_user`), que es el mismo rol
-- que crea todas las tablas portadas.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- Excepcion al grant anterior: `public.__sql_migrations` es el libro contable del runner
-- (`apply-sql.mjs`), no una tabla de dominio. No tiene RLS -- ninguna politica la protege -- y el
-- rol de la aplicacion no la necesita para nada, asi que se le revoca todo. Sin este revoke, el
-- `grant ... on all tables` de arriba dejaria a la aplicacion reescribir el registro de que
-- migraciones estan aplicadas. Va DESPUES del grant a proposito: es el paso que lo recorta.
-- `service_role` si la conserva: es la via administrativa (BYPASSRLS, tareas de operacion).
-- El guard existe porque el runner crea la tabla antes de aplicar migraciones; si el archivo se
-- aplica a mano en una base donde el libro todavia no existe, el revoke no debe romper el orden.
do $$
begin
  if to_regclass('public.__sql_migrations') is not null then
    revoke all on table public.__sql_migrations from authenticated;
  end if;
end
$$;

-- Excepcion al grant anterior: el historial financiero es append-only por PRIVILEGIO, no solo
-- por trigger. `20261012221550_harden_financial_history_v1.sql` lo endurece a nivel de columna
-- (revoca UPDATE/DELETE y vuelve a conceder solo las columnas de asignacion y anulacion de
-- `payment`), pero el `grant select, insert, update, delete on all tables` de arriba lo deshace
-- en silencio: concede UPDATE sobre TODAS las columnas de `payment` y borra la distincion entre
-- columnas editables y no editables. Se reaplica aqui, DESPUES del grant y de los default
-- privileges, para que la intencion del origen sobreviva al port. Sin este bloque la propiedad
-- append-only descansa unicamente en los triggers de dominio.
--
-- Solo `authenticated`: `anon` no recibe ningun privilegio de tabla en este archivo, asi que no
-- hay nada que revocarle. `revoke` de tabla y `grant` de columnas son idempotentes, de modo que
-- reaplicar el archivo deja el mismo estado.
--
-- `revoke update, delete on table` retira el privilegio de TABLA; los grants a nivel de columna
-- son entradas de ACL independientes, por eso la ultima sentencia vuelve a conceder las cuatro
-- columnas que el origen autoriza (es el estado al que se converge, no un delta).
revoke update, delete on table public.cash_close from authenticated;
revoke update, delete on table public.payment_allocation from authenticated;
revoke delete on table public.payment from authenticated;
revoke update on table public.payment from authenticated;
grant update (entity_id, status, void_reason, voided_at)
  on table public.payment to authenticated;

-- `service_role`: via administrativa. El shim ya lo declara con BYPASSRLS; se reafirma por si
-- el rol existia de antes sin el atributo (el `if` lo hace idempotente).
do $$
begin
  if not (select rolbypassrls from pg_roles where rolname = 'service_role') then
    alter role service_role bypassrls;
  end if;
end
$$;

-- BYPASSRLS sin privilegios de tabla no sirve de nada: el owner de las tablas es `dev_user`,
-- no `service_role`.
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
alter default privileges in schema public
  grant select, insert, update, delete on tables to service_role;
