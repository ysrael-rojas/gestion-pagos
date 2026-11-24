-- ============================================================================
-- Port del vertical ventas, slice 2 (T1; S2, S3, S5 y S6 de
-- `odd/tasks/port-vertical-series.md`): el correlativo lo asigna la BASE, desde la serie por
-- defecto del tipo, dentro de la misma transaccion que escribe el comprobante; y el CRUD de series
-- pasa a tres RPC `SECURITY DEFINER`.
--
-- ---------------------------------------------------------------------------
-- Por que cambia el criterio del numero (L1 del doc de la feature).
-- ---------------------------------------------------------------------------
-- El slice 1 (`20261124120000_ventas_rpcs.sql`) copio el criterio del origen: el usuario tipea el
-- numero y la base avanza `last_number` al "maximo visto", con huecos por diseno. La skill
-- `facturacion-sunat-mype` pide "numeracion por serie (correlativo sin saltos)", y un maximo visto
-- no la puede dar: dos personas tipeando numeros al mismo tiempo pueden repetir o saltear, y la
-- base no tiene como saber cual es el siguiente. Desde este archivo el numero NO viaja en el
-- payload: sale de `code || '-' || lpad(last_number + 1, 6, '0')` de la serie POR DEFECTO de
-- `(auth.uid(), p_voucher_type)`. `private.advance_series_number` ("maximo visto") se borra: dos
-- reglas de numeracion a la vez serian una contradiccion, no una compatibilidad.
--
-- Por que `for update` (S2): el `select ... for update` sobre la fila de la serie es lo que
-- SERIALIZA dos altas simultaneas. La segunda espera el lock y, cuando entra, ya lee el
-- `last_number` que dejo la primera. Sin el lock las dos leen el mismo valor: o el indice unico
-- `comprobante_owner_kind_number_key` convierte el problema en un error para el usuario, o —si el
-- numero se resolviera por otro camino— aparece un hueco. El lock se toma ANTES del INSERT y se
-- mantiene hasta el commit, que es el MISMO commit que confirma el comprobante: no hay ventana en
-- la que la serie avance sin comprobante ni al reves. Lo prueba
-- `apps/api/test/ventas-rpc.e2e.test.ts` con dos transacciones vivas.
--
-- Por que el numero de un comprobante emitido es INMUTABLE (L4b, S2): un comprobante se corrige
-- con nota de credito o de debito, nunca reescribiendo su numeracion —la serie y el correlativo
-- son lo que SUNAT identifica—. `editar_venta` ya no recibe el numero y no puede pedir otro. Por
-- eso tampoco avanza la serie: no hay numero nuevo que avanzar.
--
-- ---------------------------------------------------------------------------
-- Por que tres RPC para las series (S5) y no DML de la aplicacion.
-- ---------------------------------------------------------------------------
-- `authenticated` tiene SELECT e INSERT sobre `public.voucher_series`, pero NO UPDATE ni DELETE:
-- `20261124090000_revoke_payments_writes.sql:134` los revoca, y `packages/db/scripts/
-- check-rls-enforcement.mjs` (grupo M) fija esa matriz. Re-otorgar el DML seria deshacer ese
-- hardening para ahorrar tres funciones. El camino es el mismo que ya usan cajas, pagos y el alta
-- de venta: una funcion `SECURITY DEFINER` (corre como el dueno de las tablas, no como
-- `authenticated`) con `set search_path = ''` y `grant execute` al rol de la sesion. Este archivo
-- NO otorga INSERT, UPDATE ni DELETE sobre `voucher_series` ni sobre `comprobante`.
--
-- `withOwner` (`apps/api/src/db/with-owner.ts`) fija `app.user_id` y hace `set local role
-- authenticated` antes de llamar a la RPC, asi que `auth.uid()` resuelve el dueno de la sesion y
-- el `owner_id` que escribe cada funcion es el de la fila del request, nunca uno que viaje en el
-- payload.
--
-- ---------------------------------------------------------------------------
-- Que invariantes se USAN en vez de duplicarse (S3).
-- ---------------------------------------------------------------------------
--   * Indice unico `voucher_series_owner_type_code_idx` (`20261026215202:20`), sobre
--     `(owner_id, voucher_type, code)` donde `deleted_at is null`: es el juez REAL del "codigo
--     repetido". Las RPC no consultan duplicados antes de escribir; traducen el `23505` al mensaje
--     de S6, asi el juez sigue siendo el indice y no una lectura de Node que puede quedar vieja.
--   * Indice unico parcial `voucher_series_default_per_type_idx` (`:22`), sobre
--     `(owner_id, voucher_type)` donde `is_default and deleted_at is null`: "una sola por defecto
--     por tipo". Por eso el ORDEN importa: `crear_serie` / `editar_serie` limpian el default
--     anterior del mismo tipo ANTES de marcar el nuevo, en la misma transaccion. Al reves, el
--     propio indice rechazaria el cambio.
--   * CHECK `code ~ '^[A-Za-z0-9]{1,4}$'` y `last_number >= 0`, NOT NULL de `voucher_type`/`code`:
--     el `when check_violation or not_null_violation` de las RPC solo TRADUCE el rechazo de la
--     tabla al mensaje de S6; la regla sigue viviendo en la tabla. `p_code` se normaliza con
--     `btrim(coalesce(..., ''))` para que un codigo ausente caiga en el mismo mensaje y no en el
--     generico.
--   * Trigger `voucher_series_set_updated_at` / `trg_voucher_series_owner_id`: no se nombran aca;
--     los siguen aplicando la tabla y sus triggers (las RPC no escriben `updated_at` ni
--     `owner_id`).
--   * El tipo de una serie NO se edita (L4a): `editar_serie` no lo recibe. Cambiarlo reescribiria
--     la numeracion ya emitida a nombre de otro tipo de comprobante.
--   * `eliminar_serie` es BAJA LOGICA (`deleted_at`), como la de un comprobante: los comprobantes
--     ya registrados no cambian y la serie deja de usarse porque el alta busca
--     `deleted_at is null`. Una serie dada de baja es invisible para las otras dos RPC (el mismo
--     texto que un id de otro dueno), igual que el listado que ve el usuario.
--   * El catalogo de TIPOS que ofrece la pantalla (S4: solo FACTURA, BOLETA y NOTA_VENTA) NO se
--     re-implementa aca: es una decision de la interfaz y del contrato compartido
--     (`packages/shared/src/lib/schemas/serie.ts`), no del almacenamiento. El enum de la base
--     admite los seis tipos de SUNAT y una serie de un tipo que todavia no se emite no rompe
--     ninguna regla; el flujo que la emitiria llega despues.
--
-- ---------------------------------------------------------------------------
-- Mensajes (textuales de S6).
-- ---------------------------------------------------------------------------
--   * `No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración
--     → Series.` -- alta sin serie por defecto del tipo. No hay fallback silencioso: sin serie no
--     se registra (L4c).
--   * `Ya existe una serie con ese código para ese tipo.` -- `23505` del indice unico.
--   * `Los datos de la serie no son válidos.` -- `23514`/`23502` (CHECK del codigo, NOT NULL).
--   * `La serie no existe.` -- no existe, es de otro dueno o esta dada de baja. Mismo texto para
--     las tres ramas (mismo criterio que `El comprobante no existe.`): la RPC no filtra la
--     existencia de series ajenas.
--   * `No se pudo completar la operación con la base de datos. Intenta nuevamente.` -- cualquier
--     otro error. Las DOS excepciones que SI se re-lanzan son las de dominio de los triggers
--     (P0001) y las de permisos (42501): un mensaje ya redactado para el usuario no se reemplaza
--     por el generico.
--
-- Los errores se re-lanzan conservando la FAMILIA de SQLSTATE (23505 / 23514 / 23503) porque el
-- mapeador del API (`apps/api/src/vouchers/vouchers.errors.ts`) elige el status HTTP por familia y
-- por mensaje: perder el codigo convertiria el duplicado en un 500.
--
-- Idempotente: `drop function if exists` + `create or replace function` y `revoke`/`grant` lo son
-- (mismo criterio que `20261124120000`). Las dos tablas existen desde `20260928204043` y
-- `20261026215202`, asi que no hace falta guard de existencia.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Fuera las firmas viejas y el helper del "maximo visto".
--
-- `create or replace function` NO reemplaza una funcion cuya LISTA DE ARGUMENTOS cambio: agrega
-- una sobrecarga y deja la vieja viva, ejecutable por `authenticated`, con el criterio anterior. El
-- `drop` explicito es lo que hace que "el numero ya no se recibe" sea cierto. `create or replace`
-- se mantiene para reaplicar el archivo sobre si mismo.
-- ---------------------------------------------------------------------------
drop function if exists public.crear_venta(
  uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
);

drop function if exists public.editar_venta(
  uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
);

-- Nada asigna ya un "maximo visto": dejarlo seria una segunda regla de numeracion, contradictoria
-- con la de esta migracion. `authenticated` nunca tuvo `usage` sobre el esquema `private`
-- (`check-rls-enforcement.mjs`, grupo H) ni `execute` sobre esta funcion.
drop function if exists private.advance_series_number(uuid, public.voucher_type, text);

-- ---------------------------------------------------------------------------
-- 1. Alta de una venta: el numero sale de la serie por defecto del tipo, en la misma transaccion
--    que el INSERT (S2).
--
-- `voucher_kind` sigue siendo 'VENTA' por construccion: la firma no lo recibe, porque una compra la
-- produce el vertical de compras con sus propias reglas (numero del proveedor, egreso). El `status`
-- no se recibe: lo deriva la tabla (`default 'PENDIENTE'`) y lo recalcula
-- `private.refresh_comprobante_status` cuando hay pagos o notas. Los montos (`subtotal`, `igv`) se
-- reciben ya calculados: S2 los deriva en `packages/shared`, y recalcularlos aca seria una segunda
-- formula de la misma regla.
-- ---------------------------------------------------------------------------
create or replace function public.crear_venta(
  p_entity_id    uuid,
  p_voucher_type public.voucher_type,
  p_issue_date   date,
  p_subtotal     numeric,
  p_igv          numeric,
  p_total        numeric,
  p_payment_type public.payment_type,
  p_credit_days  integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid := auth.uid();
  v_serie_id    uuid;
  v_code        text;
  v_correlativo integer;
  v_number      text;
  v_id          uuid;
begin
  if v_owner is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  -- El slice 1 solo da de alta comprobantes base de VENTA. Notas y retencion llegan en un slice
  -- posterior y exigen `referenced_comprobante_id` + `motive_code`, que
  -- `comprobante_validate_adjustment` ya gobierna.
  if p_voucher_type is null
     or p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then
    raise exception 'Los datos del comprobante no son válidos.';
  end if;

  if p_payment_type is null
     or p_issue_date is null
     or p_subtotal is null
     or p_igv is null
     or p_total is null then
    raise exception 'Los datos del comprobante no son válidos.';
  end if;

  -- Mismo texto para "no existe" y "es de otro", igual que `close_cash_account` y las RPC de
  -- cajas: no se filtra la existencia de clientes ajenos.
  if p_entity_id is null
     or not exists (
       select 1 from public.entidad e
        where e.id = p_entity_id and e.owner_id = v_owner
     ) then
    raise exception 'El cliente seleccionado no existe.';
  end if;

  -- EL CORAZON DE S2. `for update` bloquea la fila de la serie hasta el commit: dos altas
  -- simultaneas del mismo dueno y tipo se serializan y la segunda lee el `last_number` que dejo la
  -- primera. Sin fila (no hay serie por defecto viva del tipo) las variables quedan nulas y el alta
  -- no se registra: no hay fallback silencioso (L4c).
  select s.id, s.code, s.last_number + 1
    into v_serie_id, v_code, v_correlativo
    from public.voucher_series s
   where s.owner_id = v_owner
     and s.voucher_type = p_voucher_type
     and s.is_default
     and s.deleted_at is null
     for update;

  if v_serie_id is null then
    raise exception 'No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.';
  end if;

  v_number := v_code || '-' || lpad(v_correlativo::text, 6, '0');

  begin
    insert into public.comprobante (
      owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
      issue_date, subtotal, igv, total, payment_type, credit_days
    ) values (
      v_owner, p_entity_id, 'VENTA', p_voucher_type, v_number,
      p_issue_date, p_subtotal, p_igv, p_total, p_payment_type, p_credit_days
    )
    returning id into v_id;

    -- Misma transaccion que el INSERT: si esto falla, la fila del comprobante no queda, y si el
    -- INSERT falla la serie no avanza. La fila ya esta bloqueada por el `for update` de arriba, asi
    -- que el UPDATE no espera a nadie.
    update public.voucher_series
       set last_number = v_correlativo
     where id = v_serie_id;
  exception
    when unique_violation then
      -- Con el numero asignado por la base, este choque solo aparece si una fila quedo escrita por
      -- fuera de la RPC con un correlativo adelantado. El mensaje se conserva: el usuario tiene que
      -- poder resolverlo, y el juez sigue siendo el indice.
      raise exception 'Ya registraste una venta con ese número de comprobante.'
        using errcode = '23505';
    when check_violation then
      raise exception 'Los datos del comprobante no son válidos.'
        using errcode = '23514';
    when foreign_key_violation then
      -- La entidad desaparecio entre la validacion de arriba y el INSERT (carrera con una baja).
      raise exception 'El cliente seleccionado no existe.'
        using errcode = '23503';
    when others then
      -- Los mensajes de dominio de los triggers son P0001 y los de permisos 42501: se re-lanzan tal
      -- cual, la RPC no los tapa.
      if sqlstate = 'P0001' or sqlstate = '42501' then
        raise;
      end if;

      raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.'
        using errcode = 'XX000';
  end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Edicion de una venta: el numero de un comprobante emitido NO se toca (S2, L4b).
--
-- Se conserva el `for update` de la fila del comprobante: dos ediciones simultaneas se serializan y
-- la segunda ve el estado que dejo la primera (incluido el trigger de pagos). El dueno sale de la
-- FILA, no del payload, que es el mismo camino de `close_cash_account`.
--
-- NO se avanza ninguna serie: no hay numero nuevo. La numeracion de la serie que emitio este
-- comprobante ya quedo fijada en el alta y la correccion va por NC/ND.
-- ---------------------------------------------------------------------------
create or replace function public.editar_venta(
  p_comprobante_id uuid,
  p_entity_id      uuid,
  p_voucher_type   public.voucher_type,
  p_issue_date     date,
  p_subtotal       numeric,
  p_igv            numeric,
  p_total          numeric,
  p_payment_type   public.payment_type,
  p_credit_days    integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner      uuid;
  v_kind       public.voucher_kind;
begin
  if auth.uid() is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  select c.owner_id, c.voucher_kind
    into v_owner, v_kind
    from public.comprobante c
   where c.id = p_comprobante_id
     for update;

  -- Mismo texto para las tres ramas (no existe / es de otro / es una compra): la RPC es del
  -- vertical de ventas y no revela la existencia de comprobantes que este vertical no edita.
  if v_owner is null
     or v_owner is distinct from auth.uid()
     or v_kind is distinct from 'VENTA' then
    raise exception 'El comprobante no existe.';
  end if;

  if p_voucher_type is null
     or p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then
    raise exception 'Los datos del comprobante no son válidos.';
  end if;

  if p_payment_type is null
     or p_issue_date is null
     or p_subtotal is null
     or p_igv is null
     or p_total is null then
    raise exception 'Los datos del comprobante no son válidos.';
  end if;

  if p_entity_id is null
     or not exists (
       select 1 from public.entidad e
        where e.id = p_entity_id and e.owner_id = v_owner
     ) then
    raise exception 'El cliente seleccionado no existe.';
  end if;

  begin
    -- `voucher_number` no aparece: es inmutable y la firma no lo recibe.
    update public.comprobante
       set entity_id    = p_entity_id,
           voucher_type = p_voucher_type,
           issue_date   = p_issue_date,
           subtotal     = p_subtotal,
           igv          = p_igv,
           total        = p_total,
           payment_type = p_payment_type,
           credit_days  = p_credit_days
     where id = p_comprobante_id;
  exception
    when unique_violation then
      raise exception 'Ya registraste una venta con ese número de comprobante.'
        using errcode = '23505';
    when check_violation then
      raise exception 'Los datos del comprobante no son válidos.'
        using errcode = '23514';
    when foreign_key_violation then
      -- La entidad desaparecio entre la validacion de arriba y el UPDATE (carrera con una baja).
      raise exception 'El cliente seleccionado no existe.'
        using errcode = '23503';
    when others then
      -- `comprobante_protect_paid` levanta P0001 con el mensaje de pagos y no se puede saltar: si
      -- se reemplazara por el generico, el usuario perdería la unica explicacion util de por que su
      -- edicion no pasa. Lo mismo para el 42501 de permisos.
      if sqlstate = 'P0001' or sqlstate = '42501' then
        raise;
      end if;

      raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.'
        using errcode = 'XX000';
  end;

  return p_comprobante_id;
end;
$$;

comment on function public.crear_venta(
  uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer
) is
  'S2 del port de series: alta de un comprobante de VENTA con el correlativo que asigna la base desde la serie por defecto del tipo, en una sola transaccion.';

comment on function public.editar_venta(
  uuid, uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer
) is
  'S2 del port de series: edicion de un comprobante de VENTA sin tocar su numero (inmutable).';

-- ---------------------------------------------------------------------------
-- 3. Alta de una serie (S5).
--
-- `p_is_default` primero LIMPIA el default anterior del mismo tipo y despues inserta la nueva fila
-- marcada, todo en la misma transaccion: el indice parcial
-- `voucher_series_default_per_type_idx` admite una sola por tipo, asi que el orden es obligatorio.
-- Si el INSERT falla, la limpieza se revierte con el: un intento fallido NO puede dejar el tipo sin
-- serie por defecto.
--
-- `v_code` se normaliza antes de escribir para que un codigo ausente caiga en el CHECK del `code`
-- y su mensaje de S6, y no en el generico.
-- ---------------------------------------------------------------------------
create or replace function public.crear_serie(
  p_voucher_type public.voucher_type,
  p_code         text,
  p_is_default   boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner      uuid := auth.uid();
  v_code       text := btrim(coalesce(p_code, ''));
  v_is_default boolean := coalesce(p_is_default, false);
  v_id         uuid;
begin
  if v_owner is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  -- El NOT NULL de la tabla lo rechazaria igual (23502); se adelanta para que el mensaje sea el de
  -- S6 y no el generico.
  if p_voucher_type is null then
    raise exception 'Los datos de la serie no son válidos.' using errcode = '23514';
  end if;

  begin
    if v_is_default then
      update public.voucher_series s
         set is_default = false
       where s.owner_id = v_owner
         and s.voucher_type = p_voucher_type
         and s.is_default
         and s.deleted_at is null;
    end if;

    insert into public.voucher_series (owner_id, voucher_type, code, is_default)
    values (v_owner, p_voucher_type, v_code, v_is_default)
    returning id into v_id;
  exception
    when unique_violation then
      -- `voucher_series_owner_type_code_idx`: ya hay una serie viva con ese codigo y tipo.
      raise exception 'Ya existe una serie con ese código para ese tipo.' using errcode = '23505';
    when check_violation or not_null_violation then
      raise exception 'Los datos de la serie no son válidos.' using errcode = '23514';
    when others then
      if sqlstate = 'P0001' or sqlstate = '42501' then
        raise;
      end if;

      raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.'
        using errcode = 'XX000';
  end;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Edicion de una serie (S5): codigo y "por defecto". El tipo NO se recibe (L4a).
--
-- La fila se bloquea con `for update` antes de validar el dueno: dos ediciones simultaneas de la
-- misma serie se serializan. El texto de "no existe" es el mismo para los tres casos (no existe /
-- es de otro dueno / esta dada de baja), igual que en `editar_venta`.
--
-- El tipo con el que se limpia el default anterior sale de la FILA, no del payload: es el tipo de
-- la serie, que no se puede cambiar.
-- ---------------------------------------------------------------------------
create or replace function public.editar_serie(
  p_serie_id   uuid,
  p_code       text,
  p_is_default boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid := auth.uid();
  v_code        text := btrim(coalesce(p_code, ''));
  v_is_default  boolean := coalesce(p_is_default, false);
  v_row_owner   uuid;
  v_row_type    public.voucher_type;
  v_row_deleted timestamptz;
begin
  if v_owner is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  select s.owner_id, s.voucher_type, s.deleted_at
    into v_row_owner, v_row_type, v_row_deleted
    from public.voucher_series s
   where s.id = p_serie_id
     for update;

  if v_row_owner is null
     or v_row_owner is distinct from v_owner
     or v_row_deleted is not null then
    raise exception 'La serie no existe.';
  end if;

  begin
    if v_is_default then
      -- Mismo orden que en el alta: primero se limpia el default del tipo, despues se marca este.
      update public.voucher_series s
         set is_default = false
       where s.owner_id = v_owner
         and s.voucher_type = v_row_type
         and s.is_default
         and s.deleted_at is null
         and s.id <> p_serie_id;
    end if;

    update public.voucher_series
       set code       = v_code,
           is_default = v_is_default
     where id = p_serie_id;
  exception
    when unique_violation then
      raise exception 'Ya existe una serie con ese código para ese tipo.' using errcode = '23505';
    when check_violation or not_null_violation then
      raise exception 'Los datos de la serie no son válidos.' using errcode = '23514';
    when others then
      if sqlstate = 'P0001' or sqlstate = '42501' then
        raise;
      end if;

      raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.'
        using errcode = 'XX000';
  end;

  return p_serie_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Baja LOGICA de una serie (S5): `deleted_at`, sin tocar comprobantes.
--
-- No se borra la fila: es el historico de en que serie se emitio lo que ya se emitio, y el
-- comprobante guarda su numero completo (`F001-000001`) de todas formas. Con `deleted_at` la serie
-- deja de estar entre las vivas (el indice unico de codigo solo mira las vivas y el alta solo busca
-- `deleted_at is null`), que es exactamente "deja de usarse para nuevas ventas".
--
-- `is_default` no se limpia: la fila muerta ya no compite por el indice parcial
-- (`... where is_default and deleted_at is null`). Reescribirlo seria borrar el dato de lo que la
-- serie fue.
-- ---------------------------------------------------------------------------
create or replace function public.eliminar_serie(p_serie_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid := auth.uid();
  v_row_owner   uuid;
  v_row_deleted timestamptz;
begin
  if v_owner is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  select s.owner_id, s.deleted_at
    into v_row_owner, v_row_deleted
    from public.voucher_series s
   where s.id = p_serie_id
     for update;

  -- Una serie ya dada de baja es "no existe" para esta RPC: el universo visible del usuario es el
  -- de las vivas (la lista de Configuración → Series).
  if v_row_owner is null
     or v_row_owner is distinct from v_owner
     or v_row_deleted is not null then
    raise exception 'La serie no existe.';
  end if;

  begin
    update public.voucher_series
       set deleted_at = now()
     where id = p_serie_id;
  exception
    when others then
      if sqlstate = 'P0001' or sqlstate = '42501' then
        raise;
      end if;

      raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.'
        using errcode = 'XX000';
  end;

  return p_serie_id;
end;
$$;

comment on function public.crear_serie(public.voucher_type, text, boolean) is
  'S5 del port de series: alta de una serie; si es por defecto, limpia la anterior del mismo tipo en la misma transaccion.';
comment on function public.editar_serie(uuid, text, boolean) is
  'S5 del port de series: edicion del codigo y del "por defecto" de una serie; el tipo no se edita.';
comment on function public.eliminar_serie(uuid) is
  'S5 del port de series: baja logica de una serie; los comprobantes ya emitidos no cambian.';

-- ---------------------------------------------------------------------------
-- 6. Grants (S5).
--
-- `authenticated` recibe EXECUTE sobre las cinco RPC y NADA mas: el DML directo de `comprobante` y
-- `voucher_series` sigue revocado por `20261124090000` (UPDATE/DELETE), y este archivo no lo
-- re-otorga. `service_role` conserva la via administrativa, igual que en `20261027232454` y
-- `20261124120000`. `public` y `anon` no ejecutan ninguna: la app exige sesion y `anon` no tiene
-- privilegios de tabla en este port.
-- ---------------------------------------------------------------------------
revoke execute on function public.crear_venta(
  uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer
) from public, anon;

revoke execute on function public.editar_venta(
  uuid, uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer
) from public, anon;

revoke execute on function public.crear_serie(public.voucher_type, text, boolean)
  from public, anon;
revoke execute on function public.editar_serie(uuid, text, boolean) from public, anon;
revoke execute on function public.eliminar_serie(uuid) from public, anon;

grant execute on function public.crear_venta(
  uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer
) to authenticated, service_role;

grant execute on function public.editar_venta(
  uuid, uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer
) to authenticated, service_role;

grant execute on function public.crear_serie(public.voucher_type, text, boolean)
  to authenticated, service_role;
grant execute on function public.editar_serie(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.eliminar_serie(uuid) to authenticated, service_role;
