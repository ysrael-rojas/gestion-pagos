-- L7: la unicidad del documento de una entidad es POR DUENO, no global.
--
-- `entidad_document_unique` se creo en 20260928195442 como (document_type, document_number), sin
-- `owner_id`. Pero el esquema ya era multi-tenant por `owner_id` con RLS: dos duenos no podian
-- registrar la misma contraparte. El segundo recibia 23505 y, peor, ese 409 le confirmaba que el
-- documento existia en una cuenta cuyas filas la politica le oculta.
--
-- El predicado parcial se conserva tal cual: las filas borradas y las que no tienen numero no
-- participan. El cambio es estrictamente mas debil —(owner_id, type, number) admite todo lo que
-- admitia (type, number)— asi que no puede fallar con las filas que ya existen, y no toca ninguna.
--
-- Ojo con el orden de las columnas: `owner_id` primero, porque toda consulta de la app filtra por
-- dueno (RLS + los servicios), asi que el indice sigue sirviendo para buscar por documento dentro
-- de una cuenta.
drop index if exists public.entidad_document_unique;

create unique index entidad_document_unique
  on public.entidad (owner_id, document_type, document_number)
  where deleted_at is null and document_number <> '';
