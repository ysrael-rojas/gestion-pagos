-- =============================================================================
-- Usuarios (perfil de Auth)
-- Enum de roles, tabla de perfil vinculada a auth.users, trigger de alta
-- automática y política de acceso deny-by-default.
-- =============================================================================

-- Roles del Usuario. RBAC cerrado: un rol por Usuario, permisos en código.
create type public.user_role as enum (
  'administrador',
  'operador'
);

-- Perfil del Usuario. El id es el mismo de auth.users, no un identificador
-- propio. El correo no se duplica: vive en auth.users y llega en los claims.
create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  role public.user_role not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- El nombre debe tener al menos 2 caracteres, ignorando espacios extremos.
  constraint users_name_min_length
    check (char_length(btrim(name)) >= 2)
);

-- Mantiene updated_at al día en cada modificación.
create trigger users_set_updated_at
  before update on public.users
  for each row
  execute function public.set_updated_at();

-- Alta automática del perfil. Garantiza que ningún Usuario de Auth existe sin
-- perfil. Es security definer porque GoTrue inserta en auth.users con un rol
-- sin privilegios sobre public.users.
--
-- Los valores son fijos a propósito: nunca lee el rol de raw_user_meta_data
-- (editable por el usuario y no apto para autorización) y nace inactivo, de
-- modo que una cuenta autocreada no accede a nada hasta que un administrador
-- la active.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id, name, role, active)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_app_meta_data ->> 'name'), ''), 'Sin nombre'),
    'operador'::public.user_role,
    false
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger handle_new_user
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

-- La función no debe quedar expuesta como RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Deny-by-default: RLS activo y sin políticas. La autorización vive en la DAL
-- con service_role (ADR-0005); nadie accede por el Data API.
alter table public.users enable row level security;
revoke all on public.users from anon, authenticated;

-- Documentación del esquema.
comment on type public.user_role is 'Rol del Usuario dentro del sistema: administrador u operador.';
comment on table public.users is 'Perfil del Usuario. El id es el mismo de auth.users; el correo vive solo en Auth.';
comment on column public.users.id is 'Identificador del Usuario, compartido con auth.users.';
comment on column public.users.name is 'Nombre visible del Usuario en la interfaz.';
comment on column public.users.role is 'Rol único del Usuario; los permisos se derivan de él en código.';
comment on column public.users.active is 'Habilitación del Usuario. Nace inactivo; la activación es explícita.';
comment on column public.users.created_at is 'Momento de alta del perfil.';
comment on column public.users.updated_at is 'Momento de la última modificación.';
comment on function public.handle_new_user() is 'Crea el perfil en public.users al insertar un Usuario en auth.users, con rol operador e inactivo.';
