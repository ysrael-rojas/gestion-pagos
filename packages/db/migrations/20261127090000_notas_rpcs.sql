-- ============================================================================
-- Port del vertical ventas, slice 3 (T1; S3, S5 y S6 de `odd/tasks/port-vertical-notas.md`): emitir
-- una nota de credito o de debito pasa a ser UNA transaccion de la base, con el mismo camino que
-- `crear_venta` (`20261125090000_series_rpcs.sql`).
--
-- ---------------------------------------------------------------------------
-- Por que una RPC y no dos escrituras de la aplicacion.
-- ---------------------------------------------------------------------------
-- Una nota escribe DOS cosas: la fila de `public.comprobante` con su serie y correlativo, y el
-- avance de `public.voucher_series.last_number`. En el origen el formulario hacia dos requests
-- independientes y, si la segunda fallaba, quedaba un comprobante sin correlativo avanzado (mismo
-- defecto que cerro el slice 2 para las ventas: L5 y S2 de `port-vertical-series.md`). Aca el
-- numero sale de la serie por defecto del TIPO DE LA NOTA y el avance vive en la misma transaccion
-- que el INSERT, asi que o pasan los dos o no pasa ninguno.
--
-- Ademas `authenticated` no puede escribir esas tablas como el rol de la sesion:
-- `20261124090000_revoke_payments_writes.sql` revoca UPDATE y DELETE de `comprobante` y
-- `voucher_series`, y `check-rls-enforcement.mjs` fija esa matriz. Re-otorgar el DML seria deshacer
-- ese hardening para ahorrar una funcion. Este archivo NO otorga INSERT, UPDATE ni DELETE sobre
-- ninguna de las dos tablas: solo `execute` sobre `crear_nota`.
--
-- `withOwner` (`apps/api/src/db/with-owner.ts`) fija `app.user_id` y hace `set local role
-- authenticated` antes de llamar a la RPC, asi que `auth.uid()` resuelve el dueno de la sesion. El
-- `owner_id` de la nota lo escribe la funcion desde `auth.uid()`: no hay ningun parametro que lo
-- fije, y el de la nota es SIEMPRE el de la sesion, nunca el del comprobante referenciado.
--
-- ---------------------------------------------------------------------------
-- Por que DOS locks, y en ese orden.
-- ---------------------------------------------------------------------------
--   1. PRIMERO el comprobante referenciado (`select ... for update`). Es lo que hace que el tope de
--      S5 sea una invariante y no una sugerencia: dos notas de credito simultaneas sobre el mismo
--      comprobante se serializan sobre esa fila, y la segunda SUMA despues de que la primera
--      confirmo, asi que ve su total ya aplicado y no puede pasarse. Sin el lock las dos leen la
--      misma suma y las dos pasan: el tope quedaria a cargo de la pantalla, que es justo lo que S5
--      prohibe. El lock tambien serializa la lectura de la herencia (`entity_id`, `voucher_kind`),
--      asi que no hay ventana entre leer el referenciado y escribir la nota.
--
--   2. DESPUES la serie por defecto del tipo de la nota (`for update`), igual que `crear_venta`: dos
--      emisiones simultaneas del mismo dueno y tipo se serializan y la segunda lee el `last_number`
--      que dejo la primera. Va despues del referenciado por dos razones: el lock de la serie es el
--      mas corto de los dos (se toma cuando las validaciones ya pasaron, asi que un rechazo del
--      tope no lo retiene) y el orden es el mismo que usa `crear_venta` para su unico lock, con lo
--      que un alta de venta y un alta de nota nunca se esperan en circulo.
--
-- ---------------------------------------------------------------------------
-- Por que los importes llegan CALCULADOS (S4).
-- ---------------------------------------------------------------------------
-- `subtotal` / `igv` / `total` los deriva el llamador con `saleAmounts` de `packages/shared`: la
-- formula del 18 % vive en TypeScript y en un solo lugar. Recalcularla aca seria una segunda
-- formula de la misma regla, con su propio redondeo, y las dos se podrian separar. La base valida lo
-- que puede validar sin conocer la regla: que los tres vengan, que `total > 0` (CHECK de la tabla) y
-- que el total no pase el tope de S5. Por la misma razon el motivo (`motive_code`) no se valida
-- contra catalogo: el catalogo de S9 vive en `packages/shared/src/lib/data/nota-options.ts` y la
-- base solo exige que venga (CHECK `comprobante_ajuste_check`).
--
-- ---------------------------------------------------------------------------
-- Que invariantes se USAN en vez de duplicarse.
-- ---------------------------------------------------------------------------
--   * Trigger `comprobante_validate_adjustment` (`20261017114635:39-89`): existe la referencia, es
--     del mismo dueno, del mismo `voucher_kind` y es un comprobante base. Sus mensajes salen TAL
--     CUAL (P0001): la RPC no los reescribe. Su regla de "solo factura, boleta o nota de venta" se
--     mira por TIPO, y un comprobante de COMPRA tiene el mismo tipo que su par de venta (una compra
--     es `FACTURA` igual que una venta), asi que la RPC valida ademas el `voucher_kind` con el
--     mensaje de S10; el trigger queda como segunda linea.
--   * Trigger `comprobante_owner_consistency` (`20261028194204`): la entidad de la fila y el
--     comprobante referenciado tienen que ser del dueno de la fila. La RPC HEREDA `entity_id` del
--     referenciado, asi que una referencia ajena muere en este trigger con su mensaje (42501) y no
--     con uno inventado aca.
--   * CHECK `comprobante_ajuste_check` (`20261017114635:11-32`): una nota exige referencia y
--     motivo. La RPC no lo re-implementa; el `when check_violation` solo TRADUCE el rechazo al
--     mensaje de S10.
--   * CHECK `comprobante_credit_days`, CHECK inline `total > 0`, `due_date` generada y
--     `registration_date` por default: la nota se escribe CONTADO con `credit_days` nulo (S4), asi
--     que `due_date` queda nula por construccion, igual que una venta al contado. La RPC no nombra
--     ninguna de esas columnas generadas.
--   * Triggers `comprobante_adjustment_status` / `private.refresh_referenced_status`
--     (`20261017114635:130-162`): el saldo y el estado del referenciado se recalculan solos al nacer
--     la nota. La RPC no toca el comprobante original: una nota NUNCA se paga editando el emitido.
--   * Vista `voucher_balance` (`20261017114635:275-310`): resta NC y suma ND, y excluye las notas de
--     su `where`. La RPC no mantiene ningun saldo: se limita a escribir la nota.
--   * Indice unico `comprobante_owner_kind_number_key` (`20261015053016`): es el juez REAL del
--     numero repetido, y es TEXTUAL. La RPC no consulta duplicados antes de insertar; traduce el
--     `23505` al mensaje de S10.
--
-- ---------------------------------------------------------------------------
-- Mensajes (textuales de S10).
-- ---------------------------------------------------------------------------
--   * `El comprobante referenciado no existe.` -- id inexistente o dado de baja logica.
--   * `Solo puedes referenciar factura, boleta o nota de venta.` -- el referenciado no es un
--     comprobante base de VENTA (una compra, o una nota sobre otra nota).
--   * `Ya registraste una nota con ese número de comprobante.` -- `23505` del indice unico.
--   * `Los datos de la nota no son válidos.` -- tipo que no es de nota, datos incompletos, motivo
--     vacio o un CHECK de la tabla.
--   * `Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.`
--     -- tope de S5.
--   * `No se pudo completar la operación con la base de datos. Intenta nuevamente.` -- cualquier
--     otro error. Las dos excepciones que SI se re-lanzan son las de dominio de los triggers
--     (P0001) y las de consistencia de dueno (42501): un mensaje ya redactado para el usuario no se
--     reemplaza por el generico.
--
-- Los errores se re-lanzan conservando la FAMILIA de SQLSTATE (23505 / 23514 / 23503) porque el
-- mapeador del API elige el status HTTP por familia y por mensaje.
--
-- ---------------------------------------------------------------------------
-- `crear_serie` acepta los tipos de nota (S3).
-- ---------------------------------------------------------------------------
-- Sin una serie por defecto del tipo de la nota no hay correlativo que asignar, y el slice 2 habia
-- cerrado `crear_serie` a los tres comprobantes base (S13.2 de `port-vertical-series.md`). Este
-- slice abre los dos tipos que ahora se emiten y deja `COMPROBANTE_RETENCION` rechazado con su
-- mismo mensaje hasta que exista su flujo (L3.e).
--
-- El calculo del correlativo inicial (S13.1) NO cambia y funciona tal cual para una serie de nota:
-- filtra por `voucher_kind = 'VENTA'` y por el tipo pedido, y las notas se escriben con
-- `voucher_kind = 'VENTA'` heredado del comprobante referenciado. Recrear una serie de nota de
-- credito arranca en la ultima nota de credito emitida con ese codigo, y no en 0.
--
-- Idempotente: `create or replace function` sobre firmas que ya existen y `revoke`/`grant` lo son
-- (mismo criterio que `20261126090000`). Las dos tablas existen desde `20260928204043` y
-- `20261026215202`.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Alta de una serie: los cinco tipos que la app emite (S3).
--
-- Todo lo demas es el cuerpo de `20261126090000` sin tocar: la limpieza del default anterior del
-- mismo tipo, el correlativo inicial leido de los comprobantes ya emitidos (S13.1) y las
-- traducciones de `23505` / `23514`. Solo cambia la guarda del tipo.
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

  -- S3 del port de notas: los cinco tipos que la app emite. La retencion sigue afuera hasta que
  -- exista el flujo que la emite (L3.e), con el mismo texto que un tipo invalido.
  if p_voucher_type is null
     or p_voucher_type not in (
       'FACTURA', 'BOLETA', 'NOTA_VENTA', 'NOTA_CREDITO', 'NOTA_DEBITO'
     ) then
    raise exception 'Los datos de la serie no son válidos.' using errcode = '23514';
  end if;

  -- S13.1: el correlativo inicial es el maximo YA EMITIDO con este `(dueno, tipo, codigo)`. Sin
  -- esto, recrear una serie dada de baja vuelve a 0 y la primera emision choca contra los
  -- comprobantes que ya existen. Las notas son `voucher_kind = 'VENTA'`, asi que el filtro por tipo
  -- las encuentra igual que a una venta.
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
-- 2. Alta de una nota de credito o de debito (S2, S3, S4, S5, S6).
--
-- La firma NO recibe: el numero (lo asigna la base, S3), el `owner_id` (sale de `auth.uid()`), ni
-- los datos que se heredan del referenciado (`entity_id`, `voucher_kind`, `payment_type` y
-- `credit_days`), ni el `status` (S4: una nota nace `PAGADO` porque no es cobrable ni pagable). Los
-- unicos datos propios son el tipo, la fecha, los tres importes ya calculados y el motivo.
-- ---------------------------------------------------------------------------
create or replace function public.crear_nota(
  p_referenced_comprobante_id uuid,
  p_voucher_type               public.voucher_type,
  p_issue_date                 date,
  p_subtotal                   numeric,
  p_igv                        numeric,
  p_total                      numeric,
  p_motive_code                text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid := auth.uid();
  v_ref         public.comprobante%rowtype;
  v_motive      text := btrim(coalesce(p_motive_code, ''));
  v_credit      numeric(12,2);
  v_serie_id    uuid;
  v_code        text;
  v_correlativo integer;
  v_number      text;
  v_id          uuid;
begin
  if v_owner is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  -- Una nota, no un comprobante base ni una retencion: la retencion tiene su propio slice (L3.e) y
  -- un comprobante base se corrige con una nota, no se "crea" como nota.
  if p_voucher_type is null
     or p_voucher_type not in ('NOTA_CREDITO', 'NOTA_DEBITO') then
    raise exception 'Los datos de la nota no son válidos.' using errcode = '23514';
  end if;

  if p_issue_date is null
     or p_subtotal is null
     or p_igv is null
     or p_total is null then
    raise exception 'Los datos de la nota no son válidos.' using errcode = '23514';
  end if;

  -- El motivo lo exige el CHECK `comprobante_ajuste_check`; un motivo vacio no es "sin motivo",
  -- asi que se rechaza aca con el mismo mensaje en vez de guardar una nota con motivo en blanco. El
  -- catalogo de S9 NO se valida aca: vive en el contrato de `packages/shared`.
  if v_motive = '' then
    raise exception 'Los datos de la nota no son válidos.' using errcode = '23514';
  end if;

  -- PRIMER LOCK (S5): el comprobante referenciado, hasta el commit. Es lo que serializa el tope de
  -- las notas de credito y lo que congela la herencia que se copia en el INSERT.
  select c.* into v_ref
    from public.comprobante c
   where c.id = p_referenced_comprobante_id
     for update;

  -- Una fila dada de baja es "no existe" para el usuario, igual que en los listados y en el
  -- origen (que filtraba `deleted_at is null`): no se emiten notas sobre un comprobante anulado.
  if not found or v_ref.deleted_at is not null then
    raise exception 'El comprobante referenciado no existe.';
  end if;

  -- S6: solo un comprobante base de VENTA. El trigger `comprobante_validate_adjustment` mira el
  -- TIPO del referenciado, y una compra comparte tipo con su par de venta (una compra es `FACTURA`
  -- tambien), asi que el `voucher_kind` se valida aca con el texto de S10; el trigger queda como
  -- segunda linea y sus mensajes siguen saliendo tal cual.
  if v_ref.voucher_kind is distinct from 'VENTA'
     or v_ref.voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then
    raise exception 'Solo puedes referenciar factura, boleta o nota de venta.';
  end if;

  -- TOPE (S5): la suma de notas de credito y retenciones del referenciado. La formula es la misma
  -- que usan `voucher_balance` (`:275-310`) y `private.refresh_comprobante_status`
  -- (`:93-126`): las dos restan NC y retencion. Se escribe con `voucher_type in (...)` en vez de
  -- pedir el catalogo, para que agregar la retencion en su slice no cambie la regla.
  --
  -- Se lee DESPUES del lock y antes de la serie: en concurrencia la segunda nota espera en el
  -- `for update`, y cuando entra esta suma ya incluye a la primera. Una NOTA_DEBITO no consume el
  -- tope: la nota de debito aumenta el saldo y no tiene que "entrar" en el total.
  select coalesce(sum(n.total) filter (
           where n.voucher_type in ('NOTA_CREDITO', 'COMPROBANTE_RETENCION')
         ), 0)
    into v_credit
    from public.comprobante n
   where n.referenced_comprobante_id = p_referenced_comprobante_id
     and n.deleted_at is null;

  if p_voucher_type = 'NOTA_CREDITO' and v_credit + p_total > v_ref.total then
    raise exception 'Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.';
  end if;

  -- SEGUNDO LOCK (S3): la serie por defecto del tipo de la nota, igual que `crear_venta`. Sin fila
  -- no hay numero que asignar y no hay fallback silencioso (L4c).
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
    -- `entity_id` y `voucher_kind` se HEREDAN del referenciado (S4): el body no los trae y no
    -- pueden contradecir al comprobante que la nota corrige. `payment_type` es CONTADO y
    -- `credit_days` nulo porque una nota no se cobra; `due_date` queda nula por la columna
    -- generada. `status` es PAGADO por la misma razon (S4): una nota no es pagable, y
    -- `voucher_balance` ya la excluye de su `where`.
    insert into public.comprobante (
      owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
      issue_date, subtotal, igv, total, payment_type, credit_days,
      status, referenced_comprobante_id, motive_code
    ) values (
      v_owner, v_ref.entity_id, v_ref.voucher_kind, p_voucher_type, v_number,
      p_issue_date, p_subtotal, p_igv, p_total, 'CONTADO', null,
      'PAGADO', p_referenced_comprobante_id, v_motive
    )
    returning id into v_id;

    -- Misma transaccion que el INSERT: si esto falla, la nota no queda; si el INSERT falla, la
    -- serie no avanza. La fila ya esta bloqueada por el `for update` de arriba.
    update public.voucher_series
       set last_number = v_correlativo
     where id = v_serie_id;
  exception
    when unique_violation then
      -- El juez es `comprobante_owner_kind_number_key`. Con el numero asignado por la base, este
      -- choque aparece si una fila quedo escrita por fuera de la RPC con un correlativo adelantado.
      raise exception 'Ya registraste una nota con ese número de comprobante.'
        using errcode = '23505';
    when check_violation or not_null_violation then
      raise exception 'Los datos de la nota no son válidos.'
        using errcode = '23514';
    when foreign_key_violation then
      -- El referenciado desaparecio entre la lectura y el INSERT (carrera con una baja).
      raise exception 'El comprobante referenciado no existe.'
        using errcode = '23503';
    when others then
      -- Los mensajes de dominio de los triggers son P0001 y los de consistencia de dueno 42501: se
      -- re-lanzan tal cual, la RPC no los tapa.
      if sqlstate = 'P0001' or sqlstate = '42501' then
        raise;
      end if;

      raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.'
        using errcode = 'XX000';
  end;

  return v_id;
end;
$$;

comment on function public.crear_nota(
  uuid, public.voucher_type, date, numeric, numeric, numeric, text
) is
  'S3/S5/S6 del port de notas: alta de una nota de credito o debito con el correlativo de la serie por defecto de su tipo, el tope de credito verificado bajo el lock del comprobante referenciado y el saldo ajustado por los triggers existentes.';

comment on function public.crear_serie(public.voucher_type, text, boolean) is
  'S13.1/S13.2 del port de series y S3 del port de notas: alta de una serie para los cinco tipos que se emiten (incluidas las notas), arrancando el correlativo en el maximo ya emitido con ese (dueno, tipo, codigo).';

-- ---------------------------------------------------------------------------
-- 3. Grants.
--
-- `authenticated` recibe EXECUTE sobre `crear_nota` y NADA mas: el DML directo de `comprobante` y
-- `voucher_series` sigue revocado por `20261124090000` y este archivo no lo re-otorga.
-- `crear_serie` conserva la ACL que ya tenia (`create or replace` no la toca); se repite el
-- `revoke`/`grant` para que reaplicar el archivo converja al mismo estado desde cero.
-- `service_role` conserva la via administrativa, igual que en `20261125090000`. `public` y `anon`
-- no ejecutan ninguna de las dos: la app exige sesion.
-- ---------------------------------------------------------------------------
revoke execute on function public.crear_nota(
  uuid, public.voucher_type, date, numeric, numeric, numeric, text
) from public, anon;

revoke execute on function public.crear_serie(public.voucher_type, text, boolean)
  from public, anon;

grant execute on function public.crear_nota(
  uuid, public.voucher_type, date, numeric, numeric, numeric, text
) to authenticated, service_role;

grant execute on function public.crear_serie(public.voucher_type, text, boolean)
  to authenticated, service_role;
