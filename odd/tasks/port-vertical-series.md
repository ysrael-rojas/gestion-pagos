# Port del vertical ventas — slice 2: series y asignación del correlativo

Origen: `C:/Users/Lenovo/Desktop/devtalles/OpenCode/gestion-app` (solo lectura). Monorepo destino:
`apps/api`, `apps/web`, `packages/{shared,db}`. El slice 1 (comprobantes de VENTA) está en `main`
(PR #24). Este slice toca lo que el slice 1 dejó explícitamente afuera: la UI de series y el
correlativo.

## Specs

**S1.** Alcance: la pantalla de series (`/configuracion/series`), su API, y el **cambio de
contrato** de las RPC de comprobante para que el número lo asigne la base. Quedan fuera: notas de
crédito/débito, retenciones, compras, guías y todo el CPE.

**S2.** Cambio de criterio del correlativo (decisión del humano, L1). Hoy el número lo tipea el
usuario y la base avanza `last_number` al máximo visto, con huecos posibles (S7 del slice 1, L5).
A partir de este slice el número **lo asigna la base** dentro de la misma transacción que escribe
el comprobante, tomándolo de la **serie por defecto** del tipo:

```sql
select id, code, last_number from public.voucher_series
 where owner_id = <dueno de la sesión> and voucher_type = <tipo>
   and is_default and deleted_at is null
   for update;                       -- el lock serializa dos altas simultáneas
-- número = code || '-' || lpad(last_number + 1, 6, '0')
```

Consecuencias que el resto del slice tiene que respetar:

- `public.crear_venta` **pierde** `p_voucher_number`; `public.editar_venta` también, porque el
  número de un comprobante emitido es inmutable (la corrección va por NC/ND). El resto de la firma
  y el `returns uuid` no cambian: el API ya relee el detalle en la misma transacción.
- Sin serie por defecto para el tipo, el alta falla con el mensaje de S6. Ya no existe el "se
  registra igual sin serie".
- El formulario deja de tipear el número: muestra un **preview de solo lectura** (`code-(last+1)`
  con relleno a 6) que puede venir viejo; el número real lo pone la base y es el que devuelve el
  detalle. Se va la lógica de "si el usuario lo editó, respetarlo".
- Dos altas simultáneas del mismo dueño y tipo no pueden repetir número ni saltear: el `for update`
  las serializa y cada una lee el `last_number` que dejó la anterior.

**S3.** Modelo de serie (la tabla ya existe, `20261026215202`): `voucher_type`, `code`
(`^[A-Za-z0-9]{1,4}$`), `last_number >= 0`, `is_default`, `deleted_at`. Reglas que la base ya
impone y este slice **usa** en vez de duplicar: índice único `(owner_id, voucher_type, code)` entre
los vivos, índice único parcial `(owner_id, voucher_type) where is_default` (una sola por defecto por
tipo), trigger `set_updated_at`, RLS por dueño.

**S4.** La UI de series por defecto se ofrece **solo para los tipos que hoy se emiten**:
`FACTURA`, `BOLETA`, `NOTA_VENTA`. Los otros tres del enum (`NOTA_CREDITO`, `NOTA_DEBITO`,
`COMPROBANTE_RETENCION`) se agregan cuando exista el flujo que los emite, no antes.

**S5.** `authenticated` tiene `SELECT` e `INSERT` sobre `voucher_series` pero **no** `UPDATE` ni
`DELETE` (`20261124090000_revoke_payments_writes.sql`; `db:check-rls` lo fija en el grupo M). Por eso
el CRUD completo va por RPC `SECURITY DEFINER` en una transacción:

- `public.crear_serie(p_voucher_type, p_code, p_is_default boolean)` → inserta; si
  `p_is_default`, limpia el default anterior del mismo tipo en la misma transacción.
- `public.editar_serie(p_serie_id, p_code, p_is_default)` → actualiza código y default; el tipo
  **no** se edita (cambiarlo reescribiría la numeración ya emitida).
- `public.eliminar_serie(p_serie_id)` → baja lógica (`deleted_at`), sin tocar comprobantes.
- Grants: `execute` a `authenticated`; **no** se re-otorga DML. El índice único se traduce al
  mensaje de S7.

**S6.** Mensajes del API (verbatim; los tres primeros vienen del origen
`lib/comprobantes/series.ts:37-51`):

```
Ya existe una serie con ese código para ese tipo.
Los datos de la serie no son válidos.
No se pudo completar la operación con la base de datos. Intenta nuevamente.
La serie no existe.
No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.
El tipo de un comprobante emitido no se puede cambiar.
```

Los tres últimos son nuevos y de este slice: `La serie no existe.` porque `eliminar_serie`/`editar_serie`
no pueden distinguir "no existe" de "es de otro dueño" sin filtrar existencia (mismo criterio que
`El comprobante no existe.` del slice 1); el segundo es el alta sin serie del S2; y el tercero es la
inmutabilidad del tipo (S13.3), que responde 409 como el resto de los rechazos por estado.

**S7.** Mensajes de validación del contrato (verbatim del origen `lib/schemas/serie.ts:21-32`):

```
Selecciona el tipo de comprobante
El código de serie es requerido
Usa 1 a 4 caracteres alfanuméricos, por ejemplo F001
```

**S8.** Pantalla `/configuracion/series` (textos del origen
`components/configuracion/{configuracion-view,series-view,series-columns,serie-modal}.tsx`, con las
dos correcciones que el correlativo asignado obliga, marcadas **[cambia]**):

```
Configuración
Administra la numeración de tus comprobantes de venta.
Series de comprobantes
Registra las series de cada tipo de comprobante y elige cuál se usa por defecto. El correlativo lo asigna el sistema al registrar ventas.   [cambia]
Solo una serie por tipo puede quedar como predeterminada.
Agregar serie
No hay series registradas. Agrega la primera para poder registrar ventas.
Tipo
Serie
Último correlativo
Por defecto
Predeterminada
Editar serie {code}
Eliminar serie {code}
Editar serie
Define el código de serie y si es la que se usa por defecto para ese tipo de comprobante.   [cambia]
Tipo de comprobante
Serie
Requerido
Usar como serie por defecto para este tipo
Solo puede haber una serie por defecto por tipo de comprobante.
De 1 a 4 caracteres alfanuméricos. El correlativo lo asigna el sistema al registrar ventas.   [cambia]
Serie agregada
Serie actualizada
Serie eliminada
Eliminar serie {code}
Dejará de usarse para nuevas ventas. Los comprobantes ya registrados no cambian.   [cambia]
Ocurrió un error inesperado. Intenta nuevamente.
```

Los tres textos marcados **[cambia]** dicen "se sugiere" en el origen y pasarían a mentir; el resto se
conserva textual. `Eliminar serie {code}` aparece como título del diálogo y como `aria-label` de la
acción, igual que en el origen.

**S9.** Rutas y puente: `/configuracion` redirige a `/configuracion/series` (así el enlace
`Configurar series` de S5 del slice 1 y la entrada `Configuración` del navbar, que ya apunta a
`/configuracion`, dejan de ser enlaces muertos). El BFF
(`apps/web/app/api/backend/[...path]/route.ts`) suma el prefijo `series` con `GET/POST/PATCH`; el
borrado es lógico, así que no hace falta `DELETE`.

**S10.** Contratos compartidos: `packages/shared/src/lib/schemas/serie.ts` sigue siendo el schema
del **formulario** (sin `lastNumber`), y se agrega `voucherSeriesSchema` (contrato de fila/respuesta,
con `id`, `voucherType`, `code`, `lastNumber`, `isDefault`) para cerrar el drift que anotó L8 del
slice 1 (SPEC 44 pide `lastNumber` y el schema no lo tenía). Los tres tipos que ofrecen la pantalla
salen de `packages/shared/src/lib/data/series-options.ts`, filtrados a S4.

**S11.** El formulario de comprobante (slice 1) pasa a: preview de solo lectura del número y
`series` obligatorio desde la página. Sin serie por defecto, la pantalla de alta queda bloqueada con
los textos de S5 del slice 1 (`Aún no tienes series de venta configuradas.` / `Sin una serie por
defecto no podrás elegir el tipo de comprobante ni registrar la venta.` / `Configurar series`).

**S12.** Verificación del slice: `pnpm --filter @gestion/api test` y
`pnpm --filter @gestion/web test` verdes con los casos nuevos; `pnpm typecheck` 4/4; `db:check-rls`
verde con la matriz de `voucher_series` sin cambios; `db:dump --check` en sincronía; e2e: el spec
`10-ventas` actualizado (ahora necesita una serie antes de la primera venta) y un spec nuevo
`11-series` con alta, edición, default y borrado lógico. Sin huecos: dos altas seguidas producen
`...-000001` y `...-000002`.

**S13.** Tres consecuencias del correlativo asignado que salieron al implementar S2/S5 y se cierran
en el mismo slice (L5):

1. **Recrear una serie dada de baja no puede volver a 0.** Si se crea una serie con el código de una
   que se dio de baja, el correlativo tiene que arrancar en el máximo ya emitido con ese
   `(dueño, tipo, código)`, o la primera venta choca contra los comprobantes que ya existen
   (`Ya registraste una venta con ese número de comprobante.`). El cálculo va en `crear_serie`.
2. **`crear_serie` acepta solo los tipos de S4**, igual que `crear_venta`: una serie de nota de
   crédito por RPC directa responde `Los datos de la serie no son válidos.` La restricción no puede
   vivir solo en la pantalla.
3. **El tipo de un comprobante emitido es inmutable**, como su número: si se pudiera cambiar de
   BOLETA a FACTURA, el número asignado por la serie de un tipo quedaría publicado bajo otro. Las
   reglas que SUNAT pide (anular o corregir con NC/ND) ya rigen el resto del comprobante.

## Tasks

| ID | Spec | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | S2, S3, S5, S6 | worker: migración con el correlativo asignado (`crear_venta`/`editar_venta` sin `p_voucher_number`) y las tres RPC de serie, con tests SQL | hecho (L5) |
| T2 | S10, S6, S7 | inline: contratos en `packages/shared` (`voucherSeriesSchema`, opciones filtradas a S4) + tests | hecho (L6) |
| T3 | S4, S5, S6 | worker: módulo `series` en `apps/api` (controller, service, mapa de errores) + e2e | pendiente |
| T3b | S13 | worker: migración con las tres reglas que cierran los huecos de S2/S5, con sus tests | pendiente |
| T4 | S8 | worker: pantalla `/configuracion/series` (tabla, modal, diálogo de borrado) + helpers puros con tests | hecho (L7) |
| T5 | S9, S11 | worker: ruta `/configuracion` → redirect, navbar, allowlist del BFF, preview de solo lectura en el formulario | hecho (L7) |
| T6 | S12 | parent: `specs/10-ventas` actualizado, `specs/11-series` nuevo, contadores de `.github/CI.md`, log y cierre | hecho (L8) |

## Log

**L1** (usuario, decisión): criterio del correlativo → **"Correlativo asignado por la base, sin
saltos"**. Elegido sobre "mantener lo actual: manual con máximo visto" y sobre "híbrido: automático
por serie, manual optativo". La skill `facturacion-sunat-mype` pide "numeración por serie
(correlativo sin saltos)"; el slice 1 había replicado el criterio del origen ("máximo visto", con
huecos por diseño, L5 de `port-vertical-ventas.md`).

**L2** (usuario): "dale ya se hizo" → continuar con el slice siguiente al de ventas, que era el
recomendado: series y `/configuracion`.

**L3** (evidencia, explorador): estado medido antes de escribir esto. `apps/web/app/(app)/configuracion`
**no existe** (el navbar ya tiene la entrada pendiente, `app-navbar.tsx:104`, y `SERIES_CONFIG_PATH`
es un enlace muerto). `voucher_series` no la lee ni la escribe **nadie** en `apps/api` ni en
`apps/web` hoy; solo fixtures de test. `authenticated` no tiene `UPDATE`/`DELETE` sobre la tabla, así
que el CRUD necesita RPC. `packages/shared/src/lib/schemas/serie.ts` y `series-options.ts` no tienen
consumidores. El número hoy es editable (`voucher-form.tsx:515-525`) y viaja en el body hasta
`crear_venta`. `advance_series_number` no lockea explícitamente: el lock lo toma su `update` con
`last_number < correlativo`. No hay seed de series y la tabla tiene 0 filas en desarrollo.

**L4** (decisiones que este documento cierra, para no re-litigarlas): (a) el tipo de una serie no se
edita; (b) el número de un comprobante emitido es inmutable, también al editar; (c) sin serie por
defecto no se registra, no hay fallback silencioso; (d) la pantalla ofrece solo los tres tipos que se
emiten (S4); (e) los tres textos del origen que dicen "se sugiere" se corrigen porque el sistema ya
no sugiere, asigna (S8); (f) `/configuracion` redirige a `/configuracion/series`.

**L5** (evidencia, T1 cerrada): migración `20261125090000_series_rpcs.sql` (620 líneas) con
`crear_venta` y `editar_venta` sin `p_voucher_number`, las tres RPC de serie y el `drop` explícito de
las firmas viejas (sin ese `drop`, `create or replace` habría dejado viva una sobrecarga con el
criterio anterior). Contrato de escritura derivado del mismo objeto en
`packages/shared/src/lib/schemas/voucher.ts` (`voucherWriteSchema`, con el número aceptado e
ignorado para no romper al cliente hasta T5). Evidencia: suite del API **179/179**, web 162/162,
`typecheck` 4/4, `db:check-rls` 47/47, `dump-schema --check` en sincronía, y una sonda de
concurrencia con dos conexiones que muestra a la segunda esperando `Lock/transactionid` y
terminando con `F001-000001` y `F001-000002`.

Tres huecos que el trabajo destapó y que este documento cierra en S13: recrear una serie dada de
baja arrancaría en 0 y chocaría con lo ya emitido; `crear_serie` no restringía el tipo a los de S4;
y `editar_venta` todavía dejaba cambiar el **tipo** de un comprobante emitido, que con número
asignado por serie deja un correlativo publicado bajo el tipo equivocado.

**L6** (evidencia, T2 cerrada): `voucherSeriesSchema` (contrato de fila con `lastNumber`) y
`ISSUED_SERIES_VOUCHER_TYPES` derivado de `VOUCHER_TYPES` en lugar de una segunda lista;
`serieFormSchema` pasa a aceptar solo los tres tipos que se emiten. Test
`apps/web/lib/ventas/series-contrato.test.ts` 4/4, web **162/162**, `typecheck` 4/4.

**L7** (evidencia, T4 y T5 cerradas): pantalla `/configuracion/series` con sus helpers puros
(`apps/web/lib/configuracion/series.ts`, 13 casos), `/configuracion` como redirect, `Configuración`
promovida de pendiente a real en el navbar, prefijo `series` en el BFF, y el número del formulario
convertido en preview de solo lectura (`previewVoucherNumber`), con la lógica de "si el usuario lo
editó, respetarlo" borrada porque ya no hay input. Web **181/181**, `typecheck` 0, build 20/20
páginas con `/configuracion` y `/configuracion/series` en el árbol.

Dos desvíos del plan, con razón: (a) las series se cargan en el cliente desde `VoucherFormView`, no
en las páginas de venta, porque `lib/api/client.ts` no reenvía la cookie de sesión desde el servidor
de Next y una lectura server-side daría 401 del `SessionGuard`; (b) el tipo de comprobante queda
**deshabilitado al editar** además de rechazado por la base, porque ofrecer un cambio que la RPC
contesta con 409 es una acción muerta.

**L8** (evidencia, T6 cerrada y slice cerrado): `specs/10-ventas` reescrito (6 casos, incluidos
"dos altas seguidas dan `-000001` y `-000002`" y "dueño sin series no puede registrar") y
`specs/11-series` nuevo (4 casos), con las fixtures extendidas y `voucher_series` sumada al teardown
y al baseline de conteos. `pnpm e2e` **32/32** en 11 specs (6m50s), teardown idéntico al baseline.

El e2e encontró un defecto de producto que ninguna prueba de unidad podía ver:
`apps/web/app/api/backend/[...path]/route.ts` armaba siempre `new Response(cuerpo, { status })`, y
con un upstream **204** el runtime lanza `Invalid response status code 204`. La baja lógica de una
serie borraba la fila y el usuario veía 500 y el toast de error. Se corrigió devolviendo sin cuerpo
los estados 204/205/304 (7 líneas dentro de `proxy`, con la razón escrita al lado). Contadores de
`.github/CI.md` actualizados: API 173→**194**, web 158→**181**, e2e 22 en 9 specs→**32 en 11 specs**,
y fila `11-series` en el catálogo.

Queda fuera de este slice, anotado: notas de crédito/débito, retenciones, compras, y un 404 de Next
para un `id` que no es uuid (hoy el detalle pinta el mensaje del API). Publicar la rama (push/PR) es
decisión del humano: los commits están en `feat/vertical-ventas-series`, stackeada sobre
`feat/vertical-ventas` (PR #24).
