-- =============================================================================
-- Terceros (clientes y proveedores)
-- Esquema inicial: tipos de catálogo, tabla, validaciones, índices, trigger
-- de actualización y política de acceso.
-- =============================================================================

-- Tipos de catálogo del dominio.
create type public.document_type as enum (
  'dni',
  'ruc',
  'foreigner_card',
  'no_document'
);

create type public.third_party_role as enum (
  'customer',
  'supplier'
);

-- Tabla de Terceros. Un Tercero puede ser cliente, proveedor o ambos.
create table public.third_parties (
  id uuid primary key default gen_random_uuid(),
  document_type public.document_type not null,
  document_number text,
  name text not null,
  fiscal_address text,
  phone text,
  email text,
  roles public.third_party_role[] not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- El nombre debe tener al menos 2 caracteres, ignorando espacios extremos.
  constraint third_parties_name_min_length
    check (char_length(btrim(name)) >= 2),

  -- Todo Tercero tiene al menos un rol, sin elementos nulos.
  constraint third_parties_roles_not_empty
    check (cardinality(roles) >= 1),
  constraint third_parties_roles_no_nulls
    check (cardinality(roles) = cardinality(array_remove(roles, null::public.third_party_role))),

  -- El número de documento respeta el formato de su tipo.
  -- "no_document" exige número nulo; el resto lo exige presente y bien formado.
  constraint third_parties_document_format
    check (
      case document_type
        when 'no_document' then document_number is null
        when 'dni' then document_number is not null and document_number ~ '^[0-9]{8}$'
        when 'ruc' then document_number is not null and document_number ~ '^[0-9]{11}$'
        when 'foreigner_card' then document_number is not null and document_number ~ '^[A-Za-z0-9]{9,12}$'
        else false
      end
    ),

  -- El correo, cuando existe, debe tener forma de correo.
  constraint third_parties_email_format
    check (email is null or email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
);

-- Unicidad de (tipo, número) entre todos los Terceros, incluidos los inactivos.
-- Se exime a los que no tienen documento mediante un índice parcial.
create unique index third_parties_document_unique
  on public.third_parties (document_type, document_number)
  where document_number is not null;

-- Filtro por rol: roles @> array['customer'].
create index third_parties_roles_gin
  on public.third_parties using gin (roles);

-- Mantiene updated_at al día en cada modificación.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger third_parties_set_updated_at
  before update on public.third_parties
  for each row
  execute function public.set_updated_at();

-- Deny-by-default: RLS activo y sin políticas. Nadie accede por el Data API;
-- solo service_role (y el MCP) mientras no exista autenticación.
alter table public.third_parties enable row level security;
revoke all on public.third_parties from anon, authenticated;

-- Documentación del esquema.
comment on type public.document_type is 'Tipo de documento de identificación fiscal de un Tercero.';
comment on type public.third_party_role is 'Rol que un Tercero cumple frente a la empresa.';
comment on table public.third_parties is 'Terceros: personas naturales o jurídicas con las que la empresa se relaciona como cliente, proveedor o ambos.';
comment on column public.third_parties.id is 'Identificador interno del Tercero.';
comment on column public.third_parties.document_type is 'Tipo de documento de identificación fiscal.';
comment on column public.third_parties.document_number is 'Número de documento; nulo cuando el tipo es "no_document". Único dentro de su tipo.';
comment on column public.third_parties.name is 'Razón social (RUC) o nombre completo (resto de tipos).';
comment on column public.third_parties.fiscal_address is 'Domicilio fiscal registrado ante la administración tributaria.';
comment on column public.third_parties.phone is 'Teléfono de contacto.';
comment on column public.third_parties.email is 'Correo electrónico de contacto.';
comment on column public.third_parties.roles is 'Roles del Tercero; al menos uno (customer, supplier).';
comment on column public.third_parties.active is 'Vigencia de la relación comercial. La desactivación es un borrado lógico.';
comment on column public.third_parties.created_at is 'Momento de alta del Tercero.';
comment on column public.third_parties.updated_at is 'Momento de la última modificación.';
