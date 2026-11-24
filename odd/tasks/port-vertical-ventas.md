# Port del vertical ventas — slice 1: comprobantes de VENTA

Origen: `C:/Users/Lenovo/Desktop/devtalles/OpenCode/gestion-app` (solo lectura). Monorepo destino:
`apps/api`, `apps/web`, `packages/{shared,db}`. `pagos`, `clientes` y `cajas-bancos` ya están
portados; notas, retenciones, series y compras quedan para slices posteriores.

## Specs

**S1.** Alcance del slice 1: comprobantes de **VENTA** — alta, edición, listado y detalle. Quedan
fuera: notas de crédito/débito, retenciones, la UI de series (`/configuracion`) y compras. El
formulario y la vista de detalle son compartidos con compras (`voucherKind`), así que el port no
puede romper ese prop.

**S2.** Los montos se derivan del total que tipea el usuario, con el 18 % y redondeo a 2 decimales:

```ts
round(value, d) = Math.round((value + Number.EPSILON) * 10**d) / 10**d
const subtotal = round(total / 1.18, 2);
const igv = round(total - subtotal, 2);
```

`subtotal`, `igv` y el vencimiento son de solo lectura en el formulario; la etiqueta es
`IGV 18 % (solo lectura)`. La fórmula vive hoy solo en el origen: `packages/shared` no conoce `1.18`.

**S3.** Los días de crédito existen **solo** en `CREDITO`; en `CONTADO` se guardan como `NULL`. El
formulario arranca con 30 al elegir Crédito y lo limpia al volver a Contado. La base ya lo exige con
el CHECK `comprobante_credit_days`, así que un payload `CONTADO` con días se rechaza hoy con un
mensaje genérico: el schema compartido tiene que limpiarlo antes.

**S4.** Mensajes del contrato (verbatim, `voucherFormSchema`):

```
El número de comprobante es requerido
Usa el formato serie-correlativo, por ejemplo F001-000001
Selecciona el tipo de comprobante
Selecciona el tipo de pago
Selecciona el estado
La fecha de emisión es requerida
Selecciona el cliente o proveedor
Ingresa un total válido
El total debe ser mayor a 0
Ingresa un número válido de días
Los días de crédito deben ser un número entero
Los días de crédito deben ser al menos 1
Ingresa los días de crédito
```

**S5.** Mensajes que hoy viven solo en el formulario del origen y tienen que conservarse:

```
No se puede emitir factura a un cliente sin RUC
Para emitir factura, el cliente debe tener RUC.
Configura una serie por defecto para {tipos} en Configuración → Series.
Aún no tienes series de venta configuradas.
Sin una serie por defecto no podrás elegir el tipo de comprobante ni registrar la venta.
Configurar series
Este comprobante tiene pagos registrados: importe, número, cliente y fecha quedan bloqueados. Anula los pagos si necesitas corregirlo.
Sin dirección registrada
```

La regla "FACTURA exige cliente con RUC" **no** está ni en el schema ni en la base: es solo de UI, y
en este port tiene que quedar en el contrato o seguir siendo una regla de pantalla, decidido a la
vista y escrito.

**S6.** Mensajes del API (verbatim):

```
El cliente seleccionado no existe.
Ya registraste una venta con ese número de comprobante.
Los datos del comprobante no son válidos.
No se pudo completar la operación con la base de datos. Intenta nuevamente.
No se pudo cargar el saldo de los comprobantes.
```

Y el del trigger ya portado, que el RPC **no** puede saltar:

```
No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha
```

**S7.** Correlativo: patrón `^[A-Za-z0-9]{1,4}-\d{1,8}$`, la sugerencia es `CÓDIGO-(last_number+1)`
con relleno a 6, y el avance es **monótono**: si el correlativo escrito no supera `last_number` no
pasa nada; si lo supera, se actualiza. La unicidad real la da el índice
`(owner_id, voucher_kind, voucher_number)` y es **textual**: `F001-1` y `F001-000001` son filas
distintas. La colisión se mapea al mensaje de S6, no al de pagos.

**S8.** Escritura con RPC `SECURITY DEFINER`, una transacción por operación:

- `crear_venta` / `editar_venta`: insertan o actualizan `comprobante` **y** avanzan
  `voucher_series.last_number` en la misma transacción. Hoy el origen hace dos llamadas
  independientes y, si la segunda falla, solo hay un toast: el invariante no lo garantiza nadie.
- `UPDATE`/`DELETE` de `comprobante` y `voucher_series` siguen **revocados** para `authenticated`
  (migración `20261124090000`); no se re-otorga DML. `INSERT`/`SELECT` no cambian.
- `withOwner` fija `app.user_id` y `set local role authenticated` antes del RPC, así que el default
  de `owner_id` y los triggers (`comprobante_protect_paid`, `comprobante_owner_consistency`,
  `validate_comprobante_adjustment`, `set_updated_at`) siguen vigentes.

**S9.** Fechas: el default de emisión sale de `getTodayLocalDate()` (`packages/shared/src/lib/utils.ts`,
zona `America/Lima`), nunca de `toISOString()` ni del reloj del proceso. `due_date` sigue siendo
columna generada (`issue_date + credit_days`, solo en CREDITO) y no se escribe desde la app. Fixtures
y seeds usan `(now() at time zone 'America/Lima')::date`.

**S10.** Listado: columnas `F. emisión`, `T. comprobante`, `Nro comprobante`, `Cliente`, `Total`,
`Estado pago` y acciones Ver/Editar; `Registrar pago` **solo** cuando `status === 'PENDIENTE'`. Filtro
global `Buscar ventas...`, filtros Desde/Hasta/Estado pago con `Limpiar filtros`, paginación de 10,
vacío `No hay ventas registradas`, skeleton de 5 filas. Título `Ventas`, subtítulo
`Registra y administra tus ventas`, botón `Registrar venta`. Los filtros se aplican en cliente sobre
`issue_date` y `status`, igual que el resto de los listados portados.

**S11.** Verificación del slice: `pnpm --filter @gestion/api test` verde con los casos nuevos;
`pnpm --filter @gestion/web test` verde con los helpers puros; `pnpm typecheck` 4/4; e2e
`specs/10-ventas.spec.ts` (alta, listado, edición bloqueada por pagos, detalle); y los cinco schemas
de `packages/shared` (`voucher`, `sale`, `purchase`, `nota`, `serie`) dejan de estar sin consumidores:
al menos `voucherFormSchema` se usa en el form y en el API.

## Tasks

| ID | Spec | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | S2, S3, S4 | inline: helper de montos en `packages/shared` + limpieza de `creditDays` en el schema, con tests unitarios | hecho (L9) |
| T2 | S6, S7, S8 | worker: migración con `crear_venta`/`editar_venta` + `advance_series_number`, grants y tests SQL | hecho (L10) |
| T3 | S5, S6, S9 | worker: módulo `vouchers` en `apps/api` (controller, service, mapa de errores) + e2e | hecho (L11) |
| T4 | S5, S9, S10 | worker: `apps/web/lib/ventas` y `components/ventas` + form y detalle compartidos | hecho (L12) |
| T5 | S10, S11 | worker: ruta `/ventas`, navbar, allowlist del BFF, `specs/10-ventas.spec.ts` | pendiente |
| T6 | S11 | parent: docs (`docs/operacion/` si hace falta), log y cierre del slice | pendiente |

## Log

**L1** (usuario): "dale las 3 planteadas, en orden de importancia". Contexto: las tres eran L78, L77 y
ventas/compras. L78 y L77 están cerradas (`bbda69c`, `153f60c`, PRs #22 y #23); esto abre la tercera.

**L2** (usuario, decisión): "¿Qué camino de escritura tomo para comprobantes y series?" →
**"RPCs SECURITY DEFINER"**. Descartado re-otorgar DML a `authenticated`.

**L3** (usuario, autorización): "¿Autorizás leer el proyecto de origen (solo lectura)?" → **sí**. El
origen está en `C:/Users/Lenovo/Desktop/devtalles/OpenCode/gestion-app`, fuera del root.

**L4** (evidencia, explorador): el origen escribe comprobantes por **DML directo de PostgREST**, sin
ninguna RPC (`lib/comprobantes/comprobantes.ts:113,157,174`; `series.ts:233`). Nuestra migración
`20261124090000_revoke_payments_writes.sql:98-99` revoca `UPDATE`/`DELETE` sobre `comprobante` y
`voucher_series` a `authenticated`: el port literal choca. De ahí S8.

**L5** (evidencia, explorador): el guardado de una venta y el avance del correlativo son **dos
llamadas sin transacción** (`components/comprobantes/voucher-form-view.tsx:76-88`), y el compromiso
de `advanceSeriesNumber` es "máximo visto", no "número único" (`series.ts:199-241`): los huecos son de
diseño y el juez de la colisión es el índice. De ahí S7 y la transacción de S8.

**L6** (evidencia, explorador): los cinco schemas de `packages/shared` no tienen consumidores hoy;
`saleSchema` duplica reglas de `voucherFormSchema` con mensajes distintos (`sale.ts:35` dice
"Selecciona un cliente", `voucher.ts:65` dice "Selecciona el cliente o proveedor") y en el origen
`saleSchema` tampoco se usa en producción. Decisión de T1: una sola fuente de verdad
(`voucherFormSchema`) y `saleSchema` deja de duplicar.

**L7** (evidencia, explorador): el origen calcula el default de la fecha de emisión con el reloj del
proceso (`voucher-form.tsx:67` → `lib/utils.ts:26-32`) y `registration_date` con `current_date` del
contenedor: es la clase de bug que el monorepo ya cerró (`odd/tasks/hoy-en-zona-del-negocio.md`). De
ahí S9.

**L8** (contradicciones del origen, quedan anotadas para no re-descubrirlas): SPEC 07 decide "número
manual sin unicidad" y SPEC 36 agrega el índice único; SPEC 44 pide `lastNumber` en el schema de
series y el schema no lo tiene; el `status` del formulario es editable pero los triggers lo
recalculan al asignar o anular pagos; `voucher_type` y `payment_type` quedan editables incluso cuando
el comprobante tiene pagos, aunque el trigger solo protege importe/número/cliente/fecha.

**L9** (evidencia, T1 cerrada): el helper quedó en `packages/shared/src/lib/ventas/montos.ts`
(`round`, `saleAmounts`, `IGV_FACTOR`) y `voucherFormSchema` limpia `creditDays` a `null` en
`CONTADO` con un `transform` después del `superRefine`; el test de T1 vive en
`apps/web/lib/ventas/montos.test.ts` y da 10/10 (`pnpm --filter @gestion/web test` 116/116,
`pnpm typecheck` 4/4). Dos cosas que la sesión anterior dejó escritas y que hubo que corregir al
verlas en rojo, porque afirmaban lo contrario del contrato vigente:
1. `voucherNumber: ""` devuelve **dos** mensajes (el `regex` corre después del `min` fallido), no uno:
   es el schema encadenado del origen y así quedó fijado.
2. `total: ""` se coacciona a 0, así que el mensaje es `El total debe ser mayor a 0`, no
   `Ingresa un total válido` (ese sale con texto no numérico).
Además, el runner de Node no resuelve imports relativos sin extensión: `voucher.ts` importa
`../data/sale-options.ts` y `packages/shared/tsconfig.json` ganó `allowImportingTsExtensions`
(la misma razón que documentó `odd/tasks/hoy-en-zona-del-negocio.md`).

**L10** (evidencia, T2 cerrada): `packages/db/migrations/20261124120000_ventas_rpcs.sql` define
`public.crear_venta` y `public.editar_venta` (`security definer`, `set search_path = ''`), el helper
`private.advance_series_number` y traduce familias de SQLSTATE a los mensajes de S6 sin re-otorgar
DML (S8). Verificación independiente: S6, S7 y S8 cubiertos con sondas propias (atomicidad con fallo
inyectado en el avance, ACL por `has_table_privilege`, dump del esquema con exactamente 10 líneas
nuevas, RED 9/9 sobre una base sin el archivo). Dos cosas que salieron de ahí:
1. `editar_venta` responde `El comprobante no existe.` cuando la fila no es una VENTA del dueño.
   **No** es un texto de S6: se decide conservarlo (mismo criterio que `close_cash_account`, no
   filtra existencia) y es T3 quien lo mapea a 404. Si el humano prefiere un texto de S6, es una
   línea en la migración.
2. La atomicidad no se probaba con el camino feliz: se agregaron dos casos a
   `apps/api/test/ventas-rpc.e2e.test.ts` que inyectan un trigger de fallo sobre `voucher_series`
   (alta y edición) y exigen que no quede comprobante escrito y que la serie no avance (11/11).

**L11** (evidencia, T3 cerrada): el worker de T3 se canceló a mitad de la corrida y **sí** dejó
material: `apps/api/src/vouchers/` (7 archivos: controller, service, query, errors, types, tabla
Drizzle y módulo) más `apps/api/test/vouchers.e2e.test.ts` y `vouchers.errors.test.ts`. Se terminó
inline, no se descartó: typecheck del API en 0, 11/11 en el mapa de errores sin base, 14/14 en el
e2e nuevo y **173/173** en la suite completa del API. El contrato HTTP quedó así, para T5:
`GET /vouchers` (lista), `GET /vouchers/:id` (detalle con saldo), `POST /vouchers` (201) y
`PATCH /vouchers/:id` (200, body completo); los cuatro con `SessionGuard`.

Decisiones que quedan escritas en el código y que T4/T5 tienen que respetar:
1. El cuerpo se valida con `voucherFormSchema` de `packages/shared` (S11) y los montos se derivan
   con `saleAmounts`, no en el servicio ni en la migración.
2. La fecha de emisión ausente se completa con `getTodayLocalDate()`, por composición sobre el
   schema compartido; una fecha vacía sigue siendo el error de S4.
3. "FACTURA exige cliente con RUC" **no** se valida en el API: es regla de pantalla del origen y
   validarla acá rompería la edición de comprobantes históricos. Queda en T4 con los textos de S5.
4. El saldo se lee aparte (`voucher_balance`) y su falla tiene mensaje propio (S6); el detalle no
   lo funde con el comprobante.
5. `VouchersModule` se registra DESPUÉS de `PaymentsModule`: `GET /vouchers/open` es la cartera y
   Express resuelve por orden de registro.

Nota de entorno para correr la suite del API: hace falta `BETTER_AUTH_URL` (sin ella los dos e2e
que mandan `Origin` reciben 403 `Invalid origin` y el rojo se lee como regresión).

**L12** (evidencia, T4 cerrada): `apps/web/lib/ventas/**` (capa pura: `tabla`, `formulario`,
`series`, `fechas`, `types`, `ventas`) con 42 casos nuevos de `node:test`, y
`apps/web/components/ventas/**` (formulario y detalle compartidos por `voucherKind`, listado,
columnas, toolbar, banda de montos). `pnpm --filter @gestion/web test` 158/158 y typecheck en 0.
Los nueve textos de S5 están en el código y verificados byte a byte contra este documento.

Lo que queda anotado y no es cosmético:
1. **El output de `voucherFormSchema` no era input válido del mismo schema**: en `CONTADO` devuelve
   `creditDays: null` y el `z.coerce.number` interno convierte `null` en 0, que falla `min(1)`. Un
   cliente que postee el output del formulario recibe 400 `Los días de crédito deben ser al menos
   1` en una venta de contado. T4 lo esquiva con `toVoucherRequestBody` (omite el campo), pero el
   contrato no debería depender de eso: se corrige en el schema (ver L13).
2. Los tres textos de S5 sobre series solo se pintan si alguien pasa `series` al formulario: no
existe endpoint de series (la UI de `/configuracion` está fuera del slice 1), así que hoy los fija
   un test unitario y no un e2e. Queda escrito para el slice de series.
3. `Registrar pago` se resuelve como link a `/pagos/ingresos/nuevo?entityId=..&comprobanteId=..`
   (esa página ya lee los dos parámetros) y solo se pinta con `status === 'PENDIENTE'`.
4. El listado toma los filtros de la URL (`?desde=&hasta=&estado=`) y no de un prop, así que T5
   monta las páginas sin plomería.

**L13** (decisión): `voucherFormSchema` acepta `null` en `creditDays` (se trata como ausente, igual
que `""`) para que su output sea input válido. El error de S4 de `CREDITO` sin días no cambia,
porque el `superRefine` sigue mirando `== null` después del schema.



## Trampas conocidas (del port anterior)

- `apps/web/app/api/backend/[...path]/route.ts` tiene allowlist de prefijos **y** métodos: cada ruta
  nueva del vertical hay que agregarla ahí o la UI recibe 405.
- Un módulo Nest nuevo con `SessionGuard` necesita `AuthModule` importado: sin eso Nest aborta con
  exit 1 **sin imprimir nada**.
- Los tests del API comparten el dueño demo y corren con `--test-concurrency=1`; los dueños nuevos se
  crean por SQL (`createSecondOwner`) porque el alta pública está cerrada.
