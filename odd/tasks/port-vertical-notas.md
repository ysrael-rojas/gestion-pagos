# Port del vertical ventas — slice 3: notas de crédito y débito

Origen: `C:/Users/Lenovo/Desktop/devtalles/OpenCode/gestion-app` (solo lectura). Monorepo destino:
`apps/api`, `apps/web`, `packages/{shared,db}`. Los slices 1 (comprobantes de VENTA) y 2 (series y
correlativo asignado) están en `main` / en review. Este slice cierra el ciclo de emisión: un
comprobante ya no se corrige editándolo, se corrige con una nota.

## Specs

**S1.** Alcance: notas de **crédito** y de **débito** sobre un comprobante de venta — alta, listado
en el detalle del comprobante y la serie propia de cada tipo de nota. Quedan fuera:
`COMPROBANTE_RETENCION` (su propio slice; el contrato compartido ya lo modela), compras, guías y CPE.

**S2.** Una nota es un comprobante con su **propia serie y correlativo**, que **referencia** el
comprobante original (regla de la skill `facturacion-sunat-mype`: "Modela la NC/ND como un
comprobante con su propia serie/correlativo y un campo comprobante_referenciado"). La NC
**disminuye** el importe y la ND lo **aumenta**; las dos ajustan el saldo del original por los
triggers que ya existen (`refresh_comprobante_status`, `comprobante_adjustment_status`). Nunca se
edita el comprobante original para corregirlo.

**S3.** El número lo asigna la base, igual que en el slice 2: `for update` sobre la **serie por
defecto del tipo de la nota** (`NOTA_CREDITO` o `NOTA_DEBITO`) y `code || '-' || lpad(last+1, 6,
'0')` en la misma transacción del INSERT. Eso exige que `public.crear_serie`
(`20261126090000_series_rules.sql`) acepte también esos dos tipos: hoy los rechaza con
`Los datos de la serie no son válidos.` Sin serie por defecto del tipo, el alta falla con
`No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.`

**S4.** Datos de la nota: `voucher_kind`, `entity_id`, `payment_type` (`CONTADO`) y `credit_days`
(`NULL`) se **heredan** del comprobante referenciado, no viajan en el body. `subtotal`/`igv` se
derivan del total con `saleAmounts` (una sola fórmula del 18 %). `status` se escribe `PAGADO`: una
nota no es cobrable ni pagable — `voucher_balance` ya las excluye de su `where`.

**S5.** El tope de la nota es una **invariante de base**, no de pantalla: la suma de notas de
crédito más el total nuevo no puede superar el total del comprobante referenciado. Rechazo con el
mensaje del origen, verbatim:

```
Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.
```

La validación va dentro de `crear_nota`, en la misma transacción y con el comprobante referenciado
bloqueado, así dos notas simultáneas no pueden pasarse del tope. Hoy el origen lo chequea en la app
(`lib/comprobantes/notas.ts:137-181`) y la base no lo impone.

**S6.** Solo se puede referenciar un comprobante **base** de venta (`FACTURA`, `BOLETA`,
`NOTA_VENTA`), del mismo dueño y del mismo `voucher_kind`: los triggers
`comprobante_validate_adjustment` y `comprobante_owner_consistency` ya lo exigen y este slice **los
usa** en vez de duplicar la regla. Sus mensajes siguen saliendo tal cual.

**S7.** El tipo y la referencia de una nota son **inmutables**: el trigger
`comprobante_validate_adjustment` ya rechaza el cambio y no hay `editar_nota` en este slice (una
nota emitida se corrige, si hace falta, con otra nota). Consecuencia escrita: el origen sí permitía
editar una nota; acá no, por la misma razón por la que el número y el tipo de un comprobante emitido
son inmutables.

**S8.** Mensajes de validación del contrato (verbatim, `packages/shared/src/lib/schemas/nota.ts`,
que ya está portado y coincide byte a byte con el origen):

```
Selecciona el tipo de comprobante
La fecha de emisión es requerida
Ingresa un total válido
El total debe ser mayor a 0
Selecciona el comprobante referenciado
El comprobante de retención no lleva motivo
Selecciona el motivo de la nota
El motivo no pertenece al catálogo de la nota
```

**S9.** Catálogo de motivos (verbatim, `packages/shared/src/lib/data/nota-options.ts`, que también
está portado). Crédito:

```
01 Anulación de la operación
02 Anulación por error en el RUC
03 Corrección por error en la descripción
04 Descuento global
05 Descuento por ítem
06 Devolución total
07 Devolución por ítem
09 Disminución en el valor
10 Otros conceptos
```

Débito:

```
01 Intereses por mora
02 Aumento en el valor
03 Penalidades / otros conceptos
```

El motivo es **obligatorio** en NC y ND (el CHECK `comprobante_ajuste_check` lo exige) y debe
pertenecer al catálogo del tipo de la nota.

**S10.** Mensajes del API (verbatim; los cuatro últimos vienen del origen
`lib/comprobantes/notas.ts:45-49`):

```
El comprobante referenciado no existe.
Solo puedes referenciar factura, boleta o nota de venta.
Ya registraste una nota con ese número de comprobante.
Los datos de la nota no son válidos.
Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.
El comprobante referenciado es de otro usuario.
```

**S11.** Pantalla: el detalle de una venta gana la solapa **Notas de crédito/débito** que el slice 1
dejó fuera, con los textos del origen (`components/comprobantes/voucher-adjustments-section.tsx`):

```
Notas de crédito/débito
Este comprobante no tiene notas de crédito ni de débito aplicadas.
Tipo
Número
Emisión
Motivo
Total
Notas de crédito
Notas de débito
```

más el alta desde ahí, con los textos del formulario del origen (`components/notas/nota-form.tsx`,
`nota-modal.tsx`):

```
Registrar una nota de crédito
Registrar una nota de débito
Completa los datos para registrar la nota.
Fecha de emisión
Nro comprobante
Motivo
Selecciona el motivo
Total
Subtotal (solo lectura)
IGV 18 % (solo lectura)
Tope disponible para este documento:
Una nota de débito aumenta el saldo del comprobante.
Cancelar
Registrar
Documento registrado
```

El número de la nota es un **preview de solo lectura** (misma regla que S11 del slice 2), y la
pantalla de series de `Configuración` pasa a ofrecer `Nota de crédito` y `Nota de débito` junto a
los tres tipos de venta.

**S12.** Verificación del slice: `pnpm --filter @gestion/api test` y
`pnpm --filter @gestion/web test` verdes con los casos nuevos; `pnpm typecheck` 4/4; `db:check-rls`
verde con la matriz de privilegios sin cambios (`comprobante` sigue sin UPDATE/DELETE para
`authenticated`); `db:dump --check` en sincronía; e2e nuevo `specs/12-notas.spec.ts` (alta de una
NC, el saldo del comprobante baja, tope excedido rechazado con su mensaje, y el listado en el
detalle) y `specs/11-series` ampliado con la serie de nota de crédito.

## Tasks

| ID | Spec | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | S3, S5, S6 | worker: migración con `crear_nota`, tope como invariante de base y `crear_serie` aceptando los tipos de nota, con tests SQL | hecho (L4) |
| T2 | S2, S9, S11 | inline: contratos en `packages/shared` (tipo de fila de nota, tipos de serie que se emiten) + tests | hecho (L5) |
| T3 | S10 | worker: módulo `notes` en `apps/api` (alta, listado por comprobante, mapa de errores) + e2e | hecho (L6) |
| T4 | S11 | worker: solapa de notas en el detalle de venta + formulario de alta + tipos de nota en la pantalla de series | hecho (L7) |
| T5 | S10, S12 | worker: allowlist del BFF, e2e `12-notas` y ampliación de `11-series` | hecho (L7) |
| T6 | S12 | parent: contadores de `.github/CI.md`, log y cierre | hecho (L8) |

## Log

**L1** (usuario, elección del slice): notas de crédito y débito, sobre las otras opciones
(compras, retenciones, cerrar deuda del vertical). Razón registrada: el comprobante emitido ya es
inmutable en número y tipo, y hoy la app no tiene forma de corregirlo.

**L2** (evidencia, explorador): la nota **ya está modelada en la base**: columnas
`referenced_comprobante_id` y `motive_code` con el CHECK `comprobante_ajuste_check`
(`20261017114635:11-32`), el trigger `comprobante_validate_adjustment` con sus mensajes
(`:39-89`), `refresh_comprobante_status` (`:93-126`) y `refresh_referenced_status` (`:130-162`). El
saldo del comprobante **ya** resta NC y suma ND vía `voucher_balance` (`:275-310`), que además
excluye las notas de su `where`. `packages/shared` ya tiene el schema y el catálogo de motivos
portados byte a byte y sin consumidores. Falta: la RPC de alta, el módulo del API, la pantalla, y
que `crear_serie` acepte los tipos de nota. El origen escribe la nota con DML directo y concentra el
tope en la app; el tipo de la nota lo elige el usuario en un formulario aparte (`/notas/credito`).

**L3** (decisiones que este documento cierra, para no re-litigarlas): (a) el número lo asigna la
base desde la serie del tipo de nota, no el usuario; (b) el tope de la NC es invariante de base, con
el comprobante referenciado bloqueado; (c) una nota no se edita (tipo y referencia ya son inmutables
por trigger); (d) `status` de la nota `PAGADO`, porque no es cobrable ni pagable; (e) la retención
queda para su propio slice aunque comparta contrato; (f) el alta se hace desde el detalle del
comprobante, no en un listado aparte como en el origen.

**L4** (evidencia, T1 cerrada): migración `20261127090000_notas_rpcs.sql` con `crear_nota`
(SECURITY DEFINER, dos locks en orden: comprobante referenciado y después la serie) y `crear_serie`
aceptando los cinco tipos emitibles. Tope verificado **bajo concurrencia**: con la primera nota
sosteniendo el lock, la segunda espera y después se rechaza sin consumir correlativo. La consulta
del correlativo inicial de `crear_serie` no necesitó cambios (las notas son `voucher_kind =
'VENTA'`). Evidencia: `notas-rpc.e2e.test.ts` 13/13, API **207/207**, `db:check-rls` 47/47 y
`dump-schema --check` en sincronía. Un chequeo diferencial contra la `crear_serie` del commit base
sobre 25 entradas dio 0 diferencias.

Dos cosas que el trabajo destapó: el test de S13.2 en `ventas-rpc.e2e.test.ts` y una aserción de
`series.e2e.test.ts` pineaban los tres tipos (mi cambio de T2 los dejó rojos: la suite del API se
tiene que correr también cuando se toca un contrato compartido); y el trigger
`comprobante_validate_adjustment` solo mira el **tipo**, no el `voucher_kind`, así que una nota sobre
una compra habría entrado en silencio: la RPC agrega esa guarda con el texto de S10.

**L5** (evidencia, T2 cerrada): `notaWriteSchema` derivado del mismo objeto que el formulario (el
número opcional, porque lo asigna la base), `voucherAdjustmentSchema` como contrato de fila, y
`ISSUED_SERIES_VOUCHER_TYPES` ampliado a los cinco tipos emitibles. `apps/web/lib/notas/contrato.test.ts`
5/5 y los contratos de serie actualizados. Un error de tipos propio (genérico sobre `voucherNumber` +
narrowing del enum dentro del `superRefine`) se corrigió con un cast comentado, no aflojando el
schema.

**L6** (evidencia, T3 cerrada): módulo `notes` con `POST /notes` y `GET /notes?voucherId=` —el
prefijo `notes` en lugar de `/vouchers/:id/notes` es deliberado: el orden de registro de `AppModule`
para `/vouchers` ya rompió una vez la ruta de cartera. El mapa traduce el `42501` de
`comprobante_owner_consistency` al texto de S10, para que un mensaje de trigger que nombra tablas no
llegue al cliente. API **224/224**.

**L7** (evidencia, T4 y T5 cerradas): `apps/web/lib/notas/**` (20 casos), el modal y la sección
"Notas de crédito/débito" en el detalle de venta, `notes` en la allowlist del puente, `specs/12-notas`
nuevo (4 casos) y `specs/11-series` ampliado (5). Web **210/210**, `typecheck` 4/4, build en 0 y
`pnpm e2e` **37/37** en 12 specs (8m36s) con los conteos del teardown intactos.

**L8** (evidencia, T6 y slice cerrados): contadores de `.github/CI.md` actualizados (API 194→**224**,
web 181→**210**, e2e 32 en 11 specs→**37 en 12 specs**) y fila `12-notas` en el catálogo.

Queda afuera del slice, anotado: `COMPROBANTE_RETENCION` (su propio slice; el tope de la pantalla
solo suma notas de crédito porque la retención aún no existe), compras, guías y CPE. Y una deuda
chica: hay **dos** mapeos Drizzle de `public.comprobante` (`vouchers/comprobante.table.ts` y
`notes/note.table.ts`, este último con las columnas de ajuste); el traspaso a
`src/db/schema/comprobante.ts` sigue pendiente y conviene hacerlo antes de compras. Publicar la rama
es decisión del humano: los commits están en `feat/vertical-ventas-notas`, colgada de
`feat/vertical-ventas-series` (PR #25).
