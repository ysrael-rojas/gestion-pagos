-- ============================================================================
-- Compatibilidad Supabase -> PostgreSQL propio.
--
-- Corre primero (el nombre ordena antes que todas las migraciones heredadas).
-- Aporta lo unico que el esquema portado asume de la plataforma Supabase:
--
--   1. el esquema `auth` con `auth.uid()` (106 usos en las migraciones heredadas),
--   2. la tabla `auth.users`, destino de 10 claves foraneas (`owner_id references auth.users`),
--   3. los roles `anon`, `authenticated` y `service_role` (210 usos en grants y policies),
--   4. un stub de `public.rls_auto_enable()`, que el esquema heredado revoca pero que
--      en Supabase lo provee la plataforma (event trigger), no las migraciones.
--
-- Decision de arquitectura: `auth.users` NO es un cascaron para satisfacer las FK. Es la
-- tabla canonica de identidad del monorepo y Better Auth se configura para escribir en ella
-- (drizzle: schema `auth`, tabla `users`, id uuid generado por la app). Asi hay una sola
-- fuente de verdad de identidad: si fuera una tabla vacia, todo insert con `owner_id`
-- fallaria por violacion de FK, y si fuera un espejo de `public.user` habria dos.
--
-- El aislamiento por dueno se conserva: apps/api fija el GUC por transaccion con
--   select set_config('app.user_id', <uuid>, true)
-- y las 67 politicas RLS heredadas evaluan contra ese valor. Ninguna query puede escapar
-- del dueno aunque la capa de servicio olvide filtrar.
-- ============================================================================

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

comment on function auth.uid() is
  'Identidad del request en Postgres propio. apps/api fija el GUC app.user_id por transaccion.';

-- Tabla canonica de identidad. Las columnas cubren el modelo `user` de Better Auth
-- (name, email, emailVerified, image, createdAt, updatedAt) y su id es uuid porque las
-- 10 FK heredadas son uuid.
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text not null,
  email_verified boolean not null default false,
  image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists auth_users_email_key on auth.users (lower(email));

comment on table auth.users is
  'Identidad canonica del monorepo. Better Auth escribe aca (drizzle: schema auth, tabla users).';

-- Roles que el esquema heredado referencia. NOLOGIN: no son usuarios, son destinatarios
-- de grants. `service_role` mantiene BYPASSRLS para tareas administrativas y migraciones.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- En Supabase esta funcion la crea la plataforma con un event trigger que habilita RLS
-- en tablas nuevas. Aca RLS se habilita explicitamente tabla por tabla en las migraciones
-- heredadas, asi que basta un stub para que los revoke del esquema apliquen.
create or replace function public.rls_auto_enable() returns event_trigger
language plpgsql
as $$
begin
  raise notice 'rls_auto_enable: no-op fuera de Supabase';
end
$$;

grant usage on schema auth to public;
