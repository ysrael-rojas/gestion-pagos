-- ============================================================================
-- Port del vertical ventas, slice 1 (S6, S7 y S8 de `odd/tasks/port-vertical-ventas.md`): el alta
-- y la edicion de un comprobante de VENTA escriben `public.comprobante` y avanzan
-- `public.voucher_series.last_number` en UNA transaccion, ejecutada por la base.
--
-- Por que una RPC y no DML de la aplicacion (S8): `20261124090000_revoke_payments_writes.sql:99`
-- revoca UPDATE y DELETE de `authenticated` sobre `comprobante` y `voucher_series`. La app no
-- puede escribir esas tablas como el rol de la sesion, y re-otorgar el DML seria deshacer ese
-- hardening. El camino es el mismo que ya usan cajas y pagos: una funcion `SECURITY DEFINER`
-- (corre como el dueno de las tablas, no como `authenticated`) con `set search_path = ''` y
-- `grant execute` a `authenticated`.
--
-- Por que son dos sentencias dentro de la funcion y no dos llamadas (L5 del doc de la feature): en
-- el origen el formulario guardaba el comprobante y despues avanzaba la serie con dos requests
-- independientes; si la segunda fallaba solo quedaba un toast y el correlativo no avanzaba. Aca el
-- avance vive en la MISMA transaccion que el INSERT/UPDATE: o pasan los dos, o no pasa ninguno.
--
-- `withOwner` (`apps/api/src/db/with-owner.ts`) fija `app.user_id` y hace `set local role
-- authenticated` antes de llamar a la RPC, asi que `auth.uid()` resuelve el dueno de la sesion y
-- el `owner_id` que escribe la funcion es el de la fila del request, nunca uno que viaje en el
-- payload.
--
-- ---------------------------------------------------------------------------
-- Que invariantes se USAN en vez de duplicarse.
-- ---------------------------------------------------------------------------
--   * `comprobante_owner_consistency` (`20261028194204`): valida que la entidad de la fila sea del
--     dueno de la fila. La RPC valida lo mismo ANTES, con el mensaje de S6, y el trigger queda
--     como segunda linea de defensa.
--   * `comprobante_protect_paid` / `private.protect_paid_comprobante` (`20261017114635`): con
--     pagos o notas registradas, importe, numero, cliente y fecha quedan fijos. Su `raise` sale
--     como P0001 y la RPC lo deja pasar TAL CUAL: S6 prohibe explicitamente que la RPC saltee ese
--     mensaje.
--   * `comprobante_validate_adjustment` (`20261017114635`): referencia y motivo de notas y
--     retencion. El slice 1 solo da de alta comprobantes base, asi que la RPC rechaza esos tipos
--     con su mensaje de datos invalidos y NO replica la regla de la referencia.
--   * CHECK `comprobante_credit_days` (`20260928204043`: CONTADO sin dias, CREDITO con dias >= 1)
--     y CHECK inline `total > 0`: NO se re-implementan. El `when check_violation` de la RPC solo
--     TRADUCE el rechazo de la base a un mensaje de S6; la regla sigue viviendo en la tabla. Por
--     eso la prueba de CONTADO con `credit_days` sigue siendo una prueba del CHECK.
--   * `due_date` generada (`issue_date + credit_days`, solo en CREDITO), `registration_date` por
--     default, `comprobante_set_updated_at` / `set_updated_at` y `set_owner_id_on_insert`: no se
--     nombran aca; los siguen aplicando la tabla y sus triggers (la RPC no escribe ninguna de esas
--     columnas).
--   * Indice unico `comprobante_owner_kind_number_key` (`20261015053016`) sobre
--     `(owner_id, voucher_kind, voucher_number)` donde `deleted_at is null`: es el juez REAL de la
--     unicidad y es TEXTUAL (S7). `F001-1` y `F001-000001` son filas distintas. La RPC no consulta
--     duplicados antes de insertar: traduce el `23505` al mensaje de S6, asi el juez sigue siendo
--     el indice y no una lectura de Node.
--   * `voucher_series` (`20261026215202`): `code` ya esta acotado por CHECK a `^[A-Za-z0-9]{1,4}$`
--     y hay un unico indice por `(owner_id, voucher_type, code)` entre las filas vivas. El avance
--     NO inserta filas: si no hay serie configurada para ese codigo y tipo, no hay nada que
--     avanzar y la venta se registra igual (el correlativo sugerido es una ayuda, no una
--     condicion; S7).
--
-- ---------------------------------------------------------------------------
-- Mensajes (textuales de S6).
-- ---------------------------------------------------------------------------
--   * `El cliente seleccionado no existe.` -- entidad nula, inexistente o de otro dueno.
--   * `Ya registraste una venta con ese número de comprobante.` -- `23505` del indice unico.
--   * `Los datos del comprobante no son válidos.` -- numero fuera del patron de S7, tipo que no es
--     de venta base, o un CHECK de la tabla (por ejemplo `credit_days` en CONTADO).
--   * `No se pudo completar la operación con la base de datos. Intenta nuevamente.` -- cualquier
--     otro error de la base. Las DOS excepciones que SI se re-lanzan son las de dominio de los
--     triggers (P0001, el mensaje de pagos) y las de consistencia de dueno (42501): un mensaje ya
--     redactado para el usuario no se reemplaza por el generico.
--
-- Los errores se re-lanzan conservando la FAMILIA de SQLSTATE (23505 / 23514 / 23503), porque el
-- mapeador del API (`apps/api/src/*`/*.errors.ts) elige el status HTTP por familia y por mensaje:
-- perder el codigo convertiria el duplicado en un 500.
--
-- Idempotente: `create or replace function` y `revoke`/`grant` lo son (mismo criterio que
-- `20261027232454` y `20261028194239`). Reaplicar el archivo converge al mismo estado; las dos
-- tablas existen desde `20260928204043` y `20261026215202`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Avance monotono del correlativo (S7).
--
-- "Maximo visto", no "numero unico": el indice unico decide la unicidad (los huecos son de
-- diseno, L5). Si el correlativo escrito no supera `last_number`, la serie no cambia y NO es un
-- error; si lo supera, se actualiza. Nunca retrocede: el `and s.last_number < v_correlativo` es
-- la garantia, y en concurrencia el segundo UPDATE espera el lock de la fila y vuelve a evaluar el
-- WHERE, asi que dos ventas simultaneas dejan el maximo de las dos.
--
-- Vive en `private` porque NO es una RPC del contrato: la llama `crear_venta` / `editar_venta`
-- dentro de su transaccion. `authenticated` no tiene `usage` sobre el esquema (lo afirma
-- `packages/db/scripts/check-rls-enforcement.mjs`, grupo H) ni `execute` sobre esta funcion.
-- ---------------------------------------------------------------------------
create or replace function private.advance_series_number(
  p_owner_id       uuid,
  p_voucher_type   public.voucher_type,
  p_voucher_number text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code        text := split_part(p_voucher_number, '-', 1);
  v_correlativo integer;
  v_last        integer;
begin
  -- El numero ya lo valido el llamador contra `^[A-Za-z0-9]{1,4}-[0-9]{1,8}$`, asi que los dos
  -- tramos existen y el correlativo entra en un integer (maximo 8 digitos).
  v_correlativo := split_part(p_voucher_number, '-', 2)::integer;

  update public.voucher_series s
     set last_number = v_correlativo
   where s.owner_id = p_owner_id
     and s.voucher_type = p_voucher_type
     and s.code = v_code
     and s.deleted_at is null
     and s.last_number < v_correlativo
  returning s.last_number into v_last;

  -- `null` = no habia serie para ese codigo y tipo, o el numero no supero el ultimo visto. Los dos
  -- casos son normales: el llamador no los distingue ni falla por ellos.
  return v_last;
end;
$$;

revoke all on function private.advance_series_number(uuid, public.voucher_type, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Alta de una venta: INSERT de `comprobante` + avance de su serie, en una transaccion.
--
-- `voucher_kind` es 'VENTA' por construccion: la firma no lo recibe, porque una compra la produce
-- el vertical de compras con sus propias reglas (numero del proveedor, egreso). El `status` no se
-- recibe: lo deriva la tabla (`default 'PENDIENTE'`) y lo recalcula
-- `private.refresh_comprobante_status` cuando hay pagos o notas. Los montos (`subtotal`, `igv`) se
-- reciben ya calculados: S2 los deriva en `packages/shared`, y recalcularlos aca seria una segunda
-- formula de la misma regla.
-- ---------------------------------------------------------------------------
create or replace function public.crear_venta(
  p_entity_id      uuid,
  p_voucher_type   public.voucher_type,
  p_voucher_number text,
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
  v_owner  uuid := auth.uid();
  v_number text := btrim(coalesce(p_voucher_number, ''));
  v_id     uuid;
begin
  if v_owner is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  -- S7: el numero de comprobante es serie-correlativo. Se normaliza el espacio de los bordes
  -- antes de validar y de guardar, para que `' F001-1 '` no cree una fila que el indice unico
  -- considere distinta de `F001-1`.
  if v_number !~ '^[A-Za-z0-9]{1,4}-[0-9]{1,8}$' then
    raise exception 'Los datos del comprobante no son válidos.';
  end if;

  -- Slice 1: solo comprobantes base de VENTA. Notas y retencion llegan en un slice posterior y
  -- exigen `referenced_comprobante_id` + `motive_code`, que `comprobante_validate_adjustment` ya
  -- gobierna.
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

  begin
    insert into public.comprobante (
      owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
      issue_date, subtotal, igv, total, payment_type, credit_days
    ) values (
      v_owner, p_entity_id, 'VENTA', p_voucher_type, v_number,
      p_issue_date, p_subtotal, p_igv, p_total, p_payment_type, p_credit_days
    )
    returning id into v_id;

    -- Misma transaccion que el INSERT: si esto falla, la fila del comprobante no queda.
    perform private.advance_series_number(v_owner, p_voucher_type, v_number);
  exception
    when unique_violation then
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
      -- Los mensajes de dominio de los triggers son P0001 (el de pagos de S6) y los de
      -- consistencia de dueno son 42501: se re-lanzan tal cual, la RPC no los tapa.
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
-- 3. Edicion de una venta: UPDATE de `comprobante` + avance de su serie, en una transaccion.
--
-- Bloquea la fila con `for update` antes de validar: dos ediciones simultaneas del mismo
-- comprobante se serializan y la segunda ve el estado que dejo la primera (incluido el trigger de
-- pagos). El dueno sale de la FILA, no del payload: es el mismo camino de `close_cash_account`.
--
-- El avance usa el numero y el tipo NUEVOS: si la edicion cambia de serie o de tipo, la serie que
-- avanza es la del comprobante que queda guardado. La serie vieja no retrocede ni se toca.
-- ---------------------------------------------------------------------------
create or replace function public.editar_venta(
  p_comprobante_id uuid,
  p_entity_id      uuid,
  p_voucher_type   public.voucher_type,
  p_voucher_number text,
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
  v_owner  uuid;
  v_kind   public.voucher_kind;
  v_number text := btrim(coalesce(p_voucher_number, ''));
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

  if v_number !~ '^[A-Za-z0-9]{1,4}-[0-9]{1,8}$' then
    raise exception 'Los datos del comprobante no son válidos.';
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
    update public.comprobante
       set entity_id      = p_entity_id,
           voucher_type   = p_voucher_type,
           voucher_number = v_number,
           issue_date     = p_issue_date,
           subtotal       = p_subtotal,
           igv            = p_igv,
           total          = p_total,
           payment_type   = p_payment_type,
           credit_days    = p_credit_days
     where id = p_comprobante_id;

    perform private.advance_series_number(v_owner, p_voucher_type, v_number);
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
      -- `comprobante_protect_paid` levanta P0001 con el mensaje de S6 y no se puede saltar: si se
      -- reemplazara por el generico, el usuario perdería la unica explicacion util de por que su
      -- edicion no pasa. Lo mismo para el 42501 de consistencia de dueno.
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
  uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) is
  'SPEC S8 del port de ventas: alta de un comprobante de VENTA y avance de su serie en una sola transaccion.';

comment on function public.editar_venta(
  uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) is
  'SPEC S8 del port de ventas: edicion de un comprobante de VENTA y avance de su serie en una sola transaccion.';

-- ---------------------------------------------------------------------------
-- 4. Grants (S8).
--
-- `authenticated` recibe EXECUTE sobre las dos RPC y NADA mas: el DML directo de `comprobante` y
-- `voucher_series` sigue revocado por `20261124090000` (UPDATE/DELETE) y este archivo no lo
-- re-otorga. El `INSERT`/`SELECT` de `comprobante` y el `SELECT` de `voucher_series` quedan como
-- estaban: no son parte de esta deuda y `db:check-rls` (grupo M) fija esa matriz.
--
-- `service_role` conserva la via administrativa, igual que en `20261027232454`. `public` y `anon`
-- no ejecutan ninguna de las dos: la app exige sesion y `anon` no tiene privilegios de tabla en
-- este port.
-- ---------------------------------------------------------------------------
revoke execute on function public.crear_venta(
  uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) from public, anon;

revoke execute on function public.editar_venta(
  uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) from public, anon;

grant execute on function public.crear_venta(
  uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) to authenticated, service_role;

grant execute on function public.editar_venta(
  uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) to authenticated, service_role;
