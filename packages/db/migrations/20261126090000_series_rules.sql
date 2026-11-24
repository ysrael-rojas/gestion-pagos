-- ============================================================================
-- Port del vertical ventas, slice 2 (T3b; S13 de `odd/tasks/port-vertical-series.md`): las tres
-- reglas que cierran los huecos que destapo el correlativo asignado por la base.
--
-- ---------------------------------------------------------------------------
-- Por que existe este archivo, si `20261125090000_series_rpcs.sql` ya esta aplicada.
-- ---------------------------------------------------------------------------
-- El cambio de criterio del numero (L1: la base asigna el correlativo desde la serie por defecto)
-- dejo tres consecuencias que no eran visibles mientras el numero lo tipeaba el usuario. Las tres
-- se cierran aca, en el mismo slice, porque las tres son invariantes de DATOS y no de pantalla:
--
--   1. RECREAR UNA SERIE DADA DE BAJA VOLVIA A 0 (S13.1). `crear_serie` insertaba con el default de
--      `last_number = 0`, asi que dar de baja `F001` y volver a crearla con el mismo codigo ponia
--      el siguiente numero en `F001-000001`, que ya existe: el alta moria con
--      `Ya registraste una venta con ese número de comprobante.` y el usuario no tenia forma de
--      arreglarlo desde la pantalla. El correlativo inicial pasa a ser el MAXIMO ya emitido con ese
--      `(dueño, tipo, código)`, leido de los comprobantes mismos.
--
--   2. `crear_serie` ACEPTABA CUALQUIER TIPO DEL ENUM (S13.2). La pantalla ofrece solo los tres
--      tipos que se emiten (S4), pero por RPC directa entraba una serie de `NOTA_CREDITO`, un tipo
--      que todavia no tiene flujo que lo emita. La restriccion no puede vivir solo en la interfaz:
--      queda en la RPC, con el mismo texto y el mismo criterio que `crear_venta`.
--
--   3. `editar_venta` DEJABA CAMBIAR EL TIPO DE UN COMPROBANTE EMITIDO (S13.3). El tipo y el numero
--      son lo que SUNAT identifica: si una FACTURA `F001-000007` pasaba a BOLETA, el correlativo
--      que asigno la serie de FACTURA quedaba publicado bajo otro tipo. El numero ya se habia
--      vuelto inmutable en `20261125090000` (L4b); el tipo lo es por la misma razon.
--
-- ---------------------------------------------------------------------------
-- Que NO cambia.
-- ---------------------------------------------------------------------------
--   * Las firmas son las mismas: `create or replace` reemplaza el CUERPO y conserva la ACL, asi
--     que `authenticated` y `service_role` siguen siendo los unicos que ejecutan las tres, y
--     `public`/`anon` siguen sin poder hacerlo (no hace falta re-otorgar nada, y este archivo no
--     re-otorga DML: `20261124090000_revoke_payments_writes.sql` sigue vigente y
--     `check-rls-enforcement.mjs` fija la matriz de `voucher_series` en SELECT + INSERT).
--   * `crear_venta`, `editar_serie` y `eliminar_serie` no se tocan: su comportamiento es el de
--     `20261125090000` y lo pinan los tests de ese archivo.
--   * El resto de `editar_venta` (bloqueo de la fila, validacion del cliente, traduccion de los
--     errores del trigger de pagos) queda igual: solo se agrega la regla del tipo.
--
-- Mensajes (textuales de S6 del doc de la feature):
--   * `Los datos de la serie no son válidos.` -- tipo fuera de los tres que se emiten (23514, 400).
--   * `El tipo de un comprobante emitido no se puede cambiar.` -- P0001, 409 en el mapeador del API,
--     igual que el resto de los rechazos por estado.
--
-- Idempotente: `create or replace function` sobre firmas que no cambian (mismo criterio que
-- `20261125090000`).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Alta de una serie (S13.1 y S13.2).
--
-- Dos cambios sobre la version de `20261125090000`:
--
--   * El tipo se valida contra los TRES tipos que la app emite (S4), no solo contra el NOT NULL de
--     la tabla. Mismo texto y misma familia (23514) que el rechazo del CHECK del codigo: para el
--     usuario es la misma clase de error.
--
--   * El correlativo inicial sale de los COMPROBANTES, no de 0. Se busca el maximo del sufijo
--     numerico de `voucher_number` entre las ventas de ese `(dueño, tipo)` cuyo numero empieza con
--     `<code>-` y termina en digitos, y se inserta como `last_number`. Asi `crear_venta` asigna
--     `max + 1` y la primera venta despues de recrear una serie NO choca con lo ya emitido.
--
-- Detalles del calculo, que no son de estilo:
--
--   * Se compara el PREFIJO con `left(...) = ...` y no con `like`: el codigo es texto que viene del
--     request, y en `like` un `_` o un `%` son comodines. El CHECK de la tabla solo admite
--     alfanumericos, pero la validacion corre DESPUES de este calculo.
--   * El sufijo tiene que ser `[0-9]{1,9}`: descarta numeros con formato viejo
--     (`VENTA-0001-x`, `F001-0001A`) y, al acotar los digitos, el cast a `integer` no puede
--     desbordar (un sufijo de 20 digitos abortaria la funcion entera con 22003).
--   * Solo `voucher_kind = 'VENTA'`: la unicidad que `crear_venta` puede violar es
--     `comprobante_owner_kind_number_key (owner_id, voucher_kind, voucher_number)`, y el numero de
--     una COMPRA es el del proveedor. Una compra `F001-000042` no dice nada de la serie de venta
--     `F001`.
--   * Se miran tambien los comprobantes dados de baja (`deleted_at` no se filtra): el numero de un
--     comprobante emitido no se reutiliza nunca, y el indice unico solo cubre los vivos. Reusar un
--     numero anulado es exactamente lo que SUNAT no permite.
--   * Si no hay ninguna venta con ese prefijo, `max` es NULL y el `coalesce` deja 0: una serie
--     nueva sigue arrancando en `...-000001`.
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
  v_owner       uuid := auth.uid();
  v_code        text := btrim(coalesce(p_code, ''));
  v_is_default  boolean := coalesce(p_is_default, false);
  v_last_number integer := 0;
  v_id          uuid;
begin
  if v_owner is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  -- S13.2: solo los tipos que la app emite (S4). El NOT NULL de la tabla lo rechazaria igual
  -- (23502), pero el mensaje tiene que ser el de S6 y no el generico.
  if p_voucher_type is null
     or p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then
    raise exception 'Los datos de la serie no son válidos.' using errcode = '23514';
  end if;

  -- S13.1: el correlativo inicial es el maximo YA EMITIDO con este `(dueño, tipo, codigo)`. Sin
  -- esto, recrear una serie dada de baja vuelve a 0 y la primera venta choca contra los
  -- comprobantes que ya existen.
  select coalesce(max(substring(c.voucher_number from char_length(v_code) + 2)::integer), 0)
    into v_last_number
    from public.comprobante c
   where c.owner_id = v_owner
     and c.voucher_kind = 'VENTA'
     and c.voucher_type = p_voucher_type
     and left(c.voucher_number, char_length(v_code) + 1) = v_code || '-'
     and substring(c.voucher_number from char_length(v_code) + 2) ~ '^[0-9]{1,9}$';

  begin
    if v_is_default then
      update public.voucher_series s
         set is_default = false
       where s.owner_id = v_owner
         and s.voucher_type = p_voucher_type
         and s.is_default
         and s.deleted_at is null;
    end if;

    insert into public.voucher_series (owner_id, voucher_type, code, last_number, is_default)
    values (v_owner, p_voucher_type, v_code, v_last_number, v_is_default)
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
-- 2. Edicion de una venta: el TIPO de un comprobante emitido es inmutable (S13.3).
--
-- El tipo se lee de la fila bloqueada, no del payload. El orden de las validaciones importa:
--
--   1. tipo ausente -> `Los datos del comprobante no son válidos.` (400). Es una peticion
--      incompleta, no un intento de cambiar el comprobante.
--   2. tipo DISTINTO al de la fila -> `El tipo de un comprobante emitido no se puede cambiar.`
--      (P0001, 409). Se compara antes que la lista de tipos emitibles a proposito: cambiar una
--      FACTURA a `NOTA_CREDITO` tambien es un cambio de tipo y el usuario tiene que ver la razon
--      real, no "los datos no son validos".
--   3. tipo fuera de los tres que se emiten -> `Los datos del comprobante no son válidos.`
--      (400), igual que antes. En la practica una fila emitida ya tiene uno de los tres, pero la
--      validacion se conserva: la firma es publica para `authenticated`.
--
-- El resto de la funcion es el de `20261125090000`: mismo bloqueo, misma validacion del cliente y
-- las mismas traducciones de los errores del trigger de pagos.
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
  v_row_type   public.voucher_type;
begin
  if auth.uid() is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  -- El tipo se lee de la fila bloqueada: la comparacion de S13.3 tiene que hacerse contra el valor
  -- que quedo escrito en el alta, no contra el payload.
  select c.owner_id, c.voucher_kind, c.voucher_type
    into v_owner, v_kind, v_row_type
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

  if p_voucher_type is null then
    raise exception 'Los datos del comprobante no son válidos.';
  end if;

  -- S13.3: si se pudiera cambiar de BOLETA a FACTURA, el numero que asigno la serie de un tipo
  -- quedaria publicado bajo otro. El comprobante se corrige con NC/ND, no cambiando de tipo.
  if v_row_type is distinct from p_voucher_type then
    raise exception 'El tipo de un comprobante emitido no se puede cambiar.';
  end if;

  if p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then
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
    -- `voucher_number` no aparece: es inmutable y la firma no lo recibe. `voucher_type` se
    -- reescribe con el MISMO valor que valido la guarda de arriba: no es lo que hace mutable al
    -- tipo, es el cuerpo de la funcion sin tocar mas de lo necesario.
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
      -- La entidad desaparecio entre la validacion y el UPDATE (carrera con una baja).
      raise exception 'El cliente seleccionado no existe.'
        using errcode = '23503';
    when others then
      -- `comprobante_protect_paid` levanta P0001 con el mensaje de pagos y no se puede saltar: si
      -- se reemplazara por el generico, el usuario perderia la unica explicacion util de por que su
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

comment on function public.crear_serie(public.voucher_type, text, boolean) is
  'S13.1/S13.2 del port de series: alta de una serie solo para los tipos que se emiten, arrancando el correlativo en el maximo ya emitido con ese (dueno, tipo, codigo).';
comment on function public.editar_venta(
  uuid, uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer
) is
  'S13.3 del port de series: edicion de un comprobante de VENTA sin tocar su numero ni su tipo (los dos son inmutables).';
