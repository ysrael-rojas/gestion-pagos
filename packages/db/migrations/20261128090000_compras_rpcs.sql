-- ============================================================================
-- Port del vertical compras (T1; S3, S4, S5 y S8 de `odd/tasks/port-vertical-compras.md`): el otro
-- lado del mostrador. `public.crear_compra` y `public.editar_compra` son el espejo de
-- `public.crear_venta` / `public.editar_venta` (`20261125090000_series_rpcs.sql`, con la guarda de
-- tipo de `20261126090000_series_rules.sql`) para `voucher_kind = 'COMPRA'`, con UNA diferencia
-- deliberada: el numero es un PARAMETRO.
--
-- ---------------------------------------------------------------------------
-- Por que aca NO hay bloque de serie (S2 y S3), a diferencia de `crear_venta`.
-- ---------------------------------------------------------------------------
-- La serie es de lo que NOSOTROS emitimos: `voucher_series.last_number` es el correlativo de una
-- numeracion propia, y `crear_venta` la lee con `for update` para que dos altas simultaneas no
-- repitan ni salteen un numero (S2 del port de series). Una compra no emite nada: lleva el
-- `voucher_number` del comprobante que emitio el PROVEEDOR, asi que el numero lo tipea el usuario
-- (L2/L3(a) del doc de la feature; en el origen `voucher-form.tsx:315-346` apaga la sugerencia para
-- compras).
--
-- Las consecuencias, que son la razon de que este bloque no exista:
--
--   * NO hay serie por defecto que buscar, ni `last_number` que avanzar, ni `for update` que tomar:
--     no hay una fila que serializar. Dos compras simultaneas con el mismo numero no necesitan
--     turnarse; el juez es el indice unico y el segundo intento recibe el mensaje de S8.
--   * NO hay `No hay una serie por defecto para este tipo de comprobante.`: una compra se registra
--     sin configurar ninguna serie. Inventar ese requisito bloquearia el alta por una regla del otro
--     vertical.
--   * NO se crea una serie `COMPRA`: el enum `public.voucher_kind` no es el de series, y ademas una
--     serie de compras volveria a introducir el "correlativo propio" que S2 niega.
--   * `crear_serie` (`20261126090000`) filtra el calculo del maximo ya emitido por
--     `voucher_kind = 'VENTA'`, asi que una compra con un numero alto en el mismo prefijo —el caso
--     que deja escrito `compras-rpc.e2e.test.ts`— no contamina el correlativo de la serie de venta.
--
-- ---------------------------------------------------------------------------
-- Por que el numero de una compra SI se puede corregir al editar (S2, L3(a)).
-- ---------------------------------------------------------------------------
-- El numero de una VENTA es inmutable porque lo asigno la base desde la serie: el par serie +
-- correlativo es exactamente lo que SUNAT identifica, y un comprobante emitido se corrige con nota
-- de credito o de debito, nunca reescribiendo su numeracion (L4b del port de series). Por eso
-- `editar_venta` ni siquiera recibe el numero.
--
-- El numero de una COMPRA es el del documento del proveedor: es un dato que el usuario digita y que
-- puede equivocar (un digito de mas, la serie mal copiada). Corregirlo no reescribe ninguna
-- numeracion nuestra, porque no hay ninguna detras. El limite temporal no lo pone esta funcion sino
-- el trigger que ya existe: `comprobante_protect_paid` (`private.protect_paid_comprobante`,
-- `20261017114635`) congela numero, importe, entidad y fecha en cuanto el comprobante tiene pagos o
-- notas, con su propio mensaje y su P0001. La RPC re-lanza ese P0001 tal cual (ver el bloque de
-- mensajes): reemplazarlo por el generico borraria la unica explicacion util de por que la edicion
-- no pasa.
--
-- Lo que NO se espeja de la venta es la guarda del TIPO: en una compra el tipo tambien es dato del
-- proveedor (`FACTURA` o `BOLETA` es lo que el proveedor emitio), igual que el numero, y el usuario
-- tiene que poder corregir una transcripcion equivocada. Se acota a los tres tipos base con el
-- mensaje de datos invalidos, y el candado por pagos (`comprobante_protect_paid`) sigue congelando
-- tipo, numero, importe, cliente y fecha cuando la compra ya tiene pagos.
--
-- Lo que NO cambia nunca es el `voucher_kind`: la firma no lo recibe, se escribe el literal
-- `'COMPRA'` en el alta y ninguna de las dos funciones lo toca en el UPDATE. Cambiarlo convertiria
-- una cuenta por pagar en una cuenta por cobrar, con la direccion del pago (S6) y la cartera
-- mirando al reves.
--
-- ---------------------------------------------------------------------------
-- Que invariantes se USAN en vez de duplicarse (S3, S4, S5).
-- ---------------------------------------------------------------------------
--   * Indice unico `comprobante_owner_kind_number_key` (`20261015053016`), sobre
--     `(owner_id, voucher_kind, voucher_number)` donde `deleted_at is null`: es el juez REAL del
--     "numero repetido" de la compra, y es por KIND. Que `F001-000001` exista como VENTA y como
--     COMPRA al mismo tiempo es intencional (S2): son documentos distintos. Las RPC no consultan
--     duplicados antes de escribir; traducen el `23505` al mensaje de S8, asi el juez sigue siendo
--     el indice y no una lectura que puede quedar vieja entre la validacion y el INSERT.
--   * El patron del numero (`^[A-Za-z0-9]{1,4}-[0-9]{1,8}$`) SI se valida aca, porque la tabla no
--     tiene CHECK de formato del numero (solo lo tiene el `code` de una serie). Se recorta con
--     `btrim` ANTES de validar y de guardar, como hacia `crear_venta` en el slice 1: si no,
--     `' F001-1 '` y `'F001-1'` serian dos numeros distintos para el indice unico. El patron es el
--     mismo de `VOUCHER_NUMBER_PATTERN` (`packages/shared/src/lib/schemas/voucher.ts`) y su rechazo
--     sale con el mensaje de S8, no con "function does not exist" ni con el generico.
--   * Solo los tres tipos base (`FACTURA`, `BOLETA`, `NOTA_VENTA`), igual que el alta de venta de
--     `20261125090000`: notas y retencion exigirian `referenced_comprobante_id` + `motive_code`, que
--     `comprobante_validate_adjustment` gobierna y que este slice no emite.
--   * `entity_id` tiene que ser del dueno de la SESION, no de la fila (S4): mismo criterio y mismo
--     texto que la venta, sin filtrar la existencia de entidades ajenas. `entidad.is_supplier` NO se
--     exige: el modelo admite una entidad cliente y proveedor a la vez
--     (`constraint entidad_some_role`) y una compra a un cliente es un dato raro pero posible (S4).
--     Es un filtro de pantalla, no una invariante de base.
--   * Trigger `comprobante_owner_consistency` (`20261028194204`): la entidad de la fila tiene que ser
--     del dueno de la fila. Es la segunda linea detras de la validacion de arriba; sus mensajes
--     (42501) se re-lanzan sin tocar.
--   * CHECK `comprobante_credit_days` (`20260928204043`): CREDITO exige `credit_days >= 1` y CONTADO
--     exige nulo. La RPC no lo re-implementa; el `when check_violation` solo TRADUCE el rechazo al
--     mensaje de S8. Por eso un CONTADO con dias de credito sigue muriendo en la tabla.
--   * CHECK inline `total > 0`, NOT NULL de las columnas, `due_date` generada
--     (`issue_date + credit_days` cuando es CREDITO) y `registration_date` por default: la RPC no
--     nombra ninguna columna generada. `status` tampoco se recibe ni se escribe: lo deriva la tabla
--     (`default 'PENDIENTE'`) y lo recalcula `private.refresh_comprobante_status` cuando hay pagos o
--     notas.
--   * `subtotal` / `igv` llegan CALCULADOS desde `packages/shared` (`saleAmounts`, S5): recalcularlos
--     aca seria una segunda formula del 18 %, con su propio redondeo.
--   * `validate_allocation` (`20261017114635`) ya exige que una COMPRA se pague con EGRESO: este
--     archivo no toca pagos ni saldos, la compra nace como cuenta por pagar y `voucher_balance` la
--     incluye sola.
--
-- ---------------------------------------------------------------------------
-- Mensajes (textuales de S8).
-- ---------------------------------------------------------------------------
--   * `El proveedor seleccionado no existe.` -- entidad inexistente, de otro dueno, o que desaparecio
--     entre la validacion y el INSERT (carrera con una baja; `23503`). Mismo texto para las tres
--     ramas: no se filtra la existencia de entidades ajenas.
--   * `Ya registraste una compra con ese número de comprobante.` -- `23505` del indice unico.
--   * `Los datos del comprobante no son válidos.` -- `23514`: numero fuera del patron, tipo que no es
--     base, dato faltante o un CHECK de la tabla. La familia se levanta explicita (como en
--     `20261127090000_notas_rpcs.sql`) para que el mapeador del API elija el status por familia y no
--     por texto.
--   * `El comprobante no existe.` -- en la EDICION: no existe, es de otro dueno o es una VENTA. Mismo
--     texto para las tres ramas (mismo criterio que `editar_venta`): la RPC no revela la existencia
--     de comprobantes que este vertical no edita.
--   * `No se pudo completar la operación con la base de datos. Intenta nuevamente.` -- cualquier otro
--     error. Las DOS excepciones que SI se re-lanzan son las de dominio de los triggers (P0001: la
--     guarda de pagos y la de tipo) y las de permisos/consistencia de dueno (42501): un mensaje ya
--     redactado para el usuario no se reemplaza por el generico.
--
-- Los errores se re-lanzan conservando la FAMILIA de SQLSTATE (23505 / 23514 / 23503) porque el
-- mapeador del API elige el status HTTP por familia y por mensaje: perder el codigo convertiria el
-- duplicado en un 500.
--
-- ---------------------------------------------------------------------------
-- Grants: las funciones y NADA mas.
-- ---------------------------------------------------------------------------
-- `authenticated` tiene SELECT e INSERT sobre `public.comprobante`, pero NO UPDATE ni DELETE:
-- `20261124090000_revoke_payments_writes.sql` los revoca y `packages/db/scripts/
-- check-rls-enforcement.mjs` fija esa matriz. Estas dos RPC son `SECURITY DEFINER` (corren como el
-- dueno de las tablas) con `set search_path = ''` y `grant execute` al rol de la sesion, igual que
-- cajas, pagos, series, ventas y notas. Este archivo NO otorga INSERT, UPDATE ni DELETE sobre
-- `comprobante` ni sobre ninguna otra tabla: re-otorgar el DML desharia ese hardening para ahorrar
-- dos funciones.
--
-- `withOwner` (`apps/api/src/db/with-owner.ts`) fija `app.user_id` y hace `set local role
-- authenticated` antes de llamar a la RPC, asi que `auth.uid()` resuelve el dueno de la sesion y el
-- `owner_id` que se escribe es el de la fila del request, nunca uno que viaje en el payload.
--
-- Idempotente: `create or replace function` sobre firmas nuevas y `revoke`/`grant` lo son (mismo
-- criterio que `20261124120000`). La tabla `comprobante` y el indice existen desde `20260928204043`
-- y `20261015053016`, asi que no hace falta guard de existencia.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Alta de una compra (S3, S4, S5).
--
-- `voucher_kind` es 'COMPRA' por construccion: la firma no lo recibe (ni podria, sin abrir la puerta
-- a escribir una cuenta por cobrar desde el vertical equivocado). El numero SI viaja, y es la unica
-- diferencia de forma con `crear_venta`.
-- ---------------------------------------------------------------------------
create or replace function public.crear_compra(
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

  -- El numero del proveedor se normaliza en los bordes ANTES de validar y de guardar: `' F001-1 '`
  -- no puede crear una fila que el indice unico considere distinta de `F001-1`. El patron es el del
  -- contrato compartido; la tabla no tiene CHECK de formato del numero.
  if v_number !~ '^[A-Za-z0-9]{1,4}-[0-9]{1,8}$' then
    raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514';
  end if;

  -- Solo los tres tipos base, igual que el alta de venta: notas y retencion exigen referencia y
  -- motivo, y este slice no las emite.
  if p_voucher_type is null
     or p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then
    raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514';
  end if;

  if p_payment_type is null
     or p_issue_date is null
     or p_subtotal is null
     or p_igv is null
     or p_total is null then
    raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514';
  end if;

  -- Mismo texto para "no existe" y "es de otro", igual que `crear_venta`: no se filtra la existencia
  -- de entidades ajenas. `is_supplier` NO se exige (S4): es un filtro de pantalla, no una invariante.
  if p_entity_id is null
     or not exists (
       select 1 from public.entidad e
        where e.id = p_entity_id and e.owner_id = v_owner
     ) then
    raise exception 'El proveedor seleccionado no existe.';
  end if;

  begin
    -- Sin serie que leer ni avanzar: el numero es el del documento del proveedor (S2). El `status`,
    -- `due_date` y `registration_date` no aparecen porque los pone la tabla.
    insert into public.comprobante (
      owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
      issue_date, subtotal, igv, total, payment_type, credit_days
    ) values (
      v_owner, p_entity_id, 'COMPRA', p_voucher_type, v_number,
      p_issue_date, p_subtotal, p_igv, p_total, p_payment_type, p_credit_days
    )
    returning id into v_id;
  exception
    when unique_violation then
      -- `comprobante_owner_kind_number_key`: ya hay una COMPRA viva del dueno con ese numero. Una
      -- VENTA con el mismo numero es legitima y no llega aca (S2).
      raise exception 'Ya registraste una compra con ese número de comprobante.'
        using errcode = '23505';
    when check_violation or not_null_violation then
      raise exception 'Los datos del comprobante no son válidos.'
        using errcode = '23514';
    when foreign_key_violation then
      -- La entidad desaparecio entre la validacion de arriba y el INSERT (carrera con una baja).
      raise exception 'El proveedor seleccionado no existe.'
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
-- 2. Edicion de una compra (S2, L3a): el numero SI se recibe y se reescribe.
--
-- Se conserva el `for update` de la fila del comprobante: dos ediciones simultaneas se serializan y
-- la segunda ve el estado que dejo la primera (incluidos los triggers de pagos y de tipo). El dueno
-- sale de la FILA, no del payload: es el mismo camino de `editar_venta` y de `close_cash_account`.
--
-- El limite para cambiar el numero no lo pone esta funcion: lo pone `comprobante_protect_paid`, que
-- con pagos o notas congela numero, importe, entidad y fecha y levanta P0001. La RPC re-lanza ese
-- mensaje sin reescribirlo.
-- ---------------------------------------------------------------------------
create or replace function public.editar_compra(
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
  v_number     text := btrim(coalesce(p_voucher_number, ''));
  v_owner      uuid;
  v_kind       public.voucher_kind;
begin
  if auth.uid() is null then
    raise exception 'Sesion no valida' using errcode = '42501';
  end if;

  -- El dueno y el kind de la fila bloqueada, para comparar contra lo que quedo ESCRITO en el alta y
  -- no contra el payload. El tipo NO se lee: es corregible, como el numero.
  select c.owner_id, c.voucher_kind
    into v_owner, v_kind
    from public.comprobante c
   where c.id = p_comprobante_id
     for update;

  -- Mismo texto para las tres ramas (no existe / es de otro / es una VENTA): la RPC es del vertical
  -- de compras y no revela la existencia de comprobantes que este vertical no edita.
  if v_owner is null
     or v_owner is distinct from auth.uid()
     or v_kind is distinct from 'COMPRA' then
    raise exception 'El comprobante no existe.';
  end if;

  if v_number !~ '^[A-Za-z0-9]{1,4}-[0-9]{1,8}$' then
    raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514';
  end if;

  if p_voucher_type is null then
    raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514';
  end if;

  -- El tipo de una compra es corregible como su numero: es lo que emitio el proveedor y una
  -- transcripcion equivocada tiene que poder arreglarse mientras la compra no tenga pagos (el
  -- candado de `comprobante_protect_paid` la congela igual). Solo se acota a los tipos base.
  if p_voucher_type not in ('FACTURA', 'BOLETA', 'NOTA_VENTA') then
    raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514';
  end if;

  if p_payment_type is null
     or p_issue_date is null
     or p_subtotal is null
     or p_igv is null
     or p_total is null then
    raise exception 'Los datos del comprobante no son válidos.' using errcode = '23514';
  end if;

  if p_entity_id is null
     or not exists (
       select 1 from public.entidad e
        where e.id = p_entity_id and e.owner_id = v_owner
     ) then
    raise exception 'El proveedor seleccionado no existe.';
  end if;

  begin
    -- `voucher_kind` no aparece en el SET: no se cambia nunca. `voucher_number` SI aparece: es la
    -- diferencia deliberada con `editar_venta` (S2, L3a), y su limite real es el trigger de pagos.
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
  exception
    when unique_violation then
      -- Corregir el numero a uno que ya es otra COMPRA del dueno: mismo mensaje que el alta.
      raise exception 'Ya registraste una compra con ese número de comprobante.'
        using errcode = '23505';
    when check_violation or not_null_violation then
      raise exception 'Los datos del comprobante no son válidos.'
        using errcode = '23514';
    when foreign_key_violation then
      -- La entidad desaparecio entre la validacion y el UPDATE (carrera con una baja).
      raise exception 'El proveedor seleccionado no existe.'
        using errcode = '23503';
    when others then
      -- `comprobante_protect_paid` levanta P0001 con el mensaje de pagos y no se puede saltar: si se
      -- reemplazara por el generico, el usuario perderia la unica explicacion util de por que su
      -- correccion del numero no pasa. Lo mismo para el 42501 de permisos/consistencia de dueno.
      if sqlstate = 'P0001' or sqlstate = '42501' then
        raise;
      end if;

      raise exception 'No se pudo completar la operación con la base de datos. Intenta nuevamente.'
        using errcode = 'XX000';
  end;

  return p_comprobante_id;
end;
$$;

comment on function public.crear_compra(
  uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) is
  'S3 del port de compras: alta de un comprobante de COMPRA con el numero que emitio el proveedor (no hay serie propia que avanzar), en una sola transaccion.';

comment on function public.editar_compra(
  uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) is
  'S2 del port de compras: edicion de un comprobante de COMPRA; el numero se puede corregir mientras el trigger de pagos no lo congele, y el kind y el tipo no cambian.';

-- ---------------------------------------------------------------------------
-- 3. Grants (S3).
--
-- `authenticated` recibe EXECUTE sobre las dos RPC y NADA mas: el DML directo de `comprobante` sigue
-- revocado por `20261124090000` (UPDATE/DELETE), y este archivo no lo re-otorga. `service_role`
-- conserva la via administrativa, igual que en `20261124120000` y `20261125090000`. `public` y `anon`
-- no ejecutan ninguna: la app exige sesion y `anon` no tiene privilegios de tabla en este port.
-- ---------------------------------------------------------------------------
revoke execute on function public.crear_compra(
  uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) from public, anon;

revoke execute on function public.editar_compra(
  uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) from public, anon;

grant execute on function public.crear_compra(
  uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) to authenticated, service_role;

grant execute on function public.editar_compra(
  uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer
) to authenticated, service_role;
