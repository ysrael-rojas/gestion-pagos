-- Catalogos que seed-demo.sql y seed-semana.sql asumen existentes.
--
-- `seed-demo.sql` resuelve metodos y categorias con `select ... into strict ... by code/name`.
-- En Supabase esos catalogos ya existian porque la app los creaba al usarse; en un entorno
-- limpio no existen y la siembra aborta con "query returned no rows". Este archivo los crea.
--
-- Los UUID son fijos a proposito: `seed-semana.sql` no resuelve los catalogos por `code`, los
-- referencia por id en cada RPC. El sexto argumento (`method_id`) es siempre `v_efectivo`
-- (37178d46) o `v_transfer` (fc385e8d); `TARJETA_CREDITO` no aparece en ese seed y conserva el
-- id fijo que le asigna el port. El septimo argumento (`category_id`) es uno de los siete
-- `cash_receipt_category`: v_cobranza 6055077c, v_pago_prov 7b1886f4, v_gasto c6eac462,
-- v_comision 90fc9171, v_itf 0fbe6be5, v_anticipo 0da485fc y v_retiro 0e838897. En la base
-- Supabase de origen esos ids eran filas creadas por la app; se conservan tal cual para no
-- tocar el seed heredado. Los nombres `Cobranza de venta` (INGRESO) son ademas el contrato que
-- `seed-demo.sql` resuelve por nombre.
--
-- Orden de seeds (probado sobre `gestion_verify` limpia, ver `packages/db/scripts/verify-rls.mjs`):
--   1. 00-demo-user.sql         identidad del owner en `auth.users`.
--   2. 01-catalogs.sql          este archivo.
--   3. seed-demo.sql            clientes y cuentas de la demo (~90 dias).
--   4. seed-semana.sql          siembra de la semana 21-27 oct 2026.
--   5. seed-semana-verify.sql   controles de solo lectura.
-- Este archivo va ANTES de `seed-demo.sql` porque esa siembra resuelve los catalogos por
-- `code`/nombre y aborta si no existen; `seed-demo.sql` va antes de `seed-semana.sql` porque
-- purga entidades y cuentas (borraria la semana) y porque la semana no las crea.
--
-- Idempotente: `on conflict do nothing` no duplica ni pisa filas existentes (claves unicas
-- (owner_id, code) y (owner_id, direction, name)).
do $$
declare
  v_owner uuid := '7f9e00ea-c5a0-4ddb-b72c-4f6ad912f782';
begin
  insert into public.payment_method (id, owner_id, code, name)
  values
    ('37178d46-97b1-4ef9-8f1e-77bef296873c', v_owner, 'EFECTIVO', 'Efectivo'),
    ('fc385e8d-a036-4199-98f5-8b4cc36ff29c', v_owner, 'TRANSFERENCIA_BCP', 'Transferencia BCP'),
    ('9c1e2d3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f', v_owner, 'TARJETA_CREDITO', 'Tarjeta de credito')
  on conflict do nothing;

  insert into public.cash_receipt_category (id, owner_id, direction, name, code)
  values
    ('6055077c-fe23-4f10-ab98-3476c410178d', v_owner, 'INGRESO', 'Cobranza de venta', 'COBRANZA_VENTA'),
    ('7b1886f4-a9ed-44a8-851a-e781e956f0f1', v_owner, 'EGRESO', 'Pago a proveedor', 'PAGO_PROVEEDOR'),
    ('c6eac462-51ea-4f71-a904-82fbaf120bf9', v_owner, 'EGRESO', 'Gasto', 'GASTO'),
    ('90fc9171-4a3a-40a7-bb9e-069c121034c4', v_owner, 'EGRESO', 'Comision bancaria', 'COMISION'),
    ('0fbe6be5-6f1e-4df7-9422-eb2828a9506e', v_owner, 'EGRESO', 'ITF', 'ITF'),
    ('0da485fc-5544-4c53-946a-b53e01513629', v_owner, 'INGRESO', 'Anticipo', 'ANTICIPO'),
    ('0e838897-95a5-443a-9168-4307f119e7d4', v_owner, 'EGRESO', 'Retiro', 'RETIRO')
  on conflict do nothing;
end
$$;
