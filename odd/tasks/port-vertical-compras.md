# Port del vertical compras

Origen: `C:/Users/Lenovo/Desktop/devtalles/OpenCode/gestion-app` (solo lectura). Monorepo destino:
`apps/api`, `apps/web`, `packages/{shared,db}`. Los slices de ventas (comprobantes, series, notas) y
el aseo de los mapeos Drizzle ya están en `main`. Este slice trae el otro lado del mostrador.

## Specs

**S1.** Alcance: comprobantes de **COMPRA** — alta, edición, listado y detalle — con su
contraparte (proveedor), su número y sus pagos por egreso. Quedan fuera: notas **recibidas** sobre
una compra, retención del IGV al proveedor, liquidación de compra, guías y CPE.

**S2.** **El número lo pone el proveedor, no nosotros.** La compra lleva el `voucher_number` del
comprobante que emitió el proveedor, así que lo tipea el usuario y **no** lo asigna una serie: la
serie es solo de lo que emitimos (S3 del slice 2). Consecuencias:

- No hay serie por defecto ni preview para compras; el campo es editable (el origen hace lo mismo,
  `voucher-form.tsx:315-346` apaga la sugerencia para compras).
- El número de una compra **sí se puede corregir** al editar mientras el comprobante no tenga pagos
  ni ajustes: el trigger `protect_paid_comprobante` ya lo congela en ese caso. Es la diferencia
  deliberada con la venta, donde el número lo asignó la base y es inmutable.
- La unicidad es por `(owner_id, voucher_kind, voucher_number)`: `F001-000001` puede existir como
  venta y como compra al mismo tiempo, y eso es **intencional** (son documentos distintos).

**S3.** Escritura por RPC `SECURITY DEFINER`, una transacción por operación, igual que la venta:
`crear_compra` y `editar_compra`, con `p_voucher_number` en la firma (a diferencia de
`crear_venta`). El `owner_id` sale de `auth.uid()` y `voucher_kind` es `COMPRA` por construcción: no
viajan en el body. `status` lo deriva la tabla y lo recalcula `refresh_comprobante_status`; `due_date`
es generada y no se escribe.

**S4.** El proveedor se elige por `entity_id` y la RPC exige que la entidad sea **del dueño de la
sesión** (mismo criterio que la venta). `entidad.is_supplier` es un filtro de pantalla y **no** una
invariante de base: el modelo permite una entidad cliente y proveedor a la vez
(`constraint entidad_some_role`), y una compra a un cliente es un dato raro pero no imposible.

**S5.** Montos: `subtotal` e `igv` se derivan del total con `saleAmounts` (la única fórmula del
18 %). No hay exoneración, inafecto ni retención en este slice: el origen tampoco los modela
(`lib/comprobantes/compras.ts:40`), y la skill pide no implementar regímenes "por si acaso".

**S6.** La compra **es pagable**: `validate_allocation` ya exige que una `COMPRA` se pague con
`EGRESO` (`El tipo de comprobante no corresponde a la dirección del pago`), y `voucher_balance` y la
cartera ya la incluyen como cuenta por pagar. Ojo: la **retención** no se modela (el origen tampoco),
así que el total es el del comprobante del proveedor.

**S7.** El formulario se reusa: `apps/web/components/ventas/voucher-form.tsx` ya toma
`voucherKind="COMPRA"` y tiene las ramas de compra (etiquetas `Proveedor`, `Buscar proveedor...`,
selector de proveedores, tipo nunca deshabilitado, y la regla FACTURA/RUC **no** aplica). Lo que
falta es la fuente de datos: `VOUCHER_SOURCES.COMPRA` hoy rechaza con
`El vertical de compras todavía no está portado: apps/api no expone sus rutas.`

**S8.** Mensajes del API (verbatim, del origen `lib/comprobantes/compras.ts:87-108`):

```
El proveedor seleccionado no existe.
Ya registraste una compra con ese número de comprobante.
Los datos del comprobante no son válidos.
No se pudo completar la operación con la base de datos. Intenta nuevamente.
El comprobante no existe.
```

El último es el mismo que ya usa la venta para "no existe / es de otro / es del otro vertical".

**S9.** Mensajes de validación del contrato (verbatim de `purchase.ts:42-66`; el slice usa
`voucherFormSchema`, que ya los cubre para venta y compra: `Selecciona el cliente o proveedor` en
lugar de `Selecciona un proveedor`, decisión L6 del slice 1). Los del número y los de crédito son los
mismos que la venta.

**S10.** Listado: las columnas de S10 del slice 1 con `Proveedor` en lugar de `Cliente`, título
`Compras`, subtítulo `Registra y administra tus compras`, botón `Registrar compra`, búsqueda
`Buscar compras...`, vacío `No hay compras registradas`, y las acciones `Ver` / `Editar` /
`Registrar pago` — la última solo con `status === 'PENDIENTE'` y apuntando a
`/pagos/egresos/nuevo?entityId=..&comprobanteId=..`.

**S11.** Rutas: `/compras`, `/compras/nuevo`, `/compras/[id]`, `/compras/[id]/editar`, y la entrada
`Compras` del navbar (hoy pendiente, como estaba `Ventas` antes). El BFF suma el prefijo `purchases`
con GET/POST/PATCH.

**S12.** Verificación: `pnpm --filter @gestion/api test` y `pnpm --filter @gestion/web test` verdes
con los casos nuevos; `pnpm typecheck` 4/4; `db:check-rls` verde con la matriz sin cambios;
`db:dump --check` en sincronía; e2e nuevo `specs/13-compras.spec.ts` (alta con número del proveedor,
listado, detalle con saldo por pagar, y edición bloqueada por pagos); y `specs/10-ventas` sigue
verde (la venta no cambia).

## Tasks

| ID | Spec | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | S3, S4, S5, S8 | worker: migración con `crear_compra`/`editar_compra` (número tipado) + tests SQL | pendiente |
| T2 | S2, S9 | inline: contrato de escritura de compra en `packages/shared` (número **requerido**) + tests | pendiente |
| T3 | S6, S8, S10 | worker: módulo `purchases` en `apps/api` (listado, detalle con saldo, alta, edición) + e2e | pendiente |
| T4 | S7, S10 | worker: `apps/web/lib/compras`, `VOUCHER_SOURCES.COMPRA` y el listado de compras | pendiente |
| T5 | S11, S12 | worker: rutas `/compras/**`, navbar, allowlist del BFF y `specs/13-compras` | pendiente |
| T6 | S12 | parent: contadores de `.github/CI.md`, log y cierre | pendiente |

## Log

**L1** (usuario): "vamos por el paso 1 primero" y, cerrado el aseo de los mapeos Drizzle, seguir con
compras — el slice que quedaba tercero en el orden recomendado (después de series y notas).

**L2** (evidencia, explorador): el origen tipea el número de la compra
(`voucher-form.tsx:499-508`, sin sugerencia en `:315-346`) y duplica el contrato (`purchase.ts`
propio, con `Selecciona un proveedor`) en vez de reusar `saleSchema`; el destino ya tiene el
formulario preparado para compra (número tipado en `voucher-form.tsx:468-480`, `voucherCopy("COMPRA")`
completo) y la única pieza que falta es la fuente de datos (`VOUCHER_SOURCES.COMPRA` rechaza). En la
base, `voucher_kind` es solo un enum: los triggers de ajuste, de protección por pagos y de estado son
agnósticos, `validate_allocation` ya exige `EGRESO` para una compra, y la unicidad del número es por
kind. Nada exige `is_supplier` en la base.

**L3** (decisiones que este documento cierra): (a) la compra conserva el número del proveedor,
tipeado y corregible mientras no tenga pagos ni ajustes; (b) `crear_compra`/`editar_compra` llevan
`p_voucher_number` en la firma, a diferencia de la venta; (c) una compra **es** pagable por egreso y
la retención no se modela; (d) `is_supplier` queda como filtro de pantalla, no como invariante;
(e) las notas **recibidas** sobre una compra quedan fuera: `crear_nota` hoy solo acepta referenciar
comprobantes de venta, y habilitarlas invierte el sentido del tope (una NC recibida reduce lo que se
debe), así que es su propio slice; (f) el contrato es `voucherFormSchema` + `supplierId` mapeado a
`entityId`; `purchase.ts` y `shared/components/compras/types.ts` quedan sin consumidores y se anotan
como deuda de limpieza, no se borran acá; (g) el **tipo** de una compra también es corregible, por
la misma razón que el número: una `FACTURA` transcripta como `BOLETA` es un error de tipeo sobre un
documento ajeno, no un cambio de especie, y el candado por pagos congela igual los dos. La venta es
el caso contrario porque ahí el número lo publicó una serie nuestra.

**L4** (evidencia, T1 cerrada): migración `20261128090000_compras_rpcs.sql` con `crear_compra` y
`editar_compra` (calco de las de venta, con `p_voucher_number` en la firma y sin bloque de serie).
12 casos SQL en `apps/api/test/compras-rpc.e2e.test.ts`, entre ellos el que justifica S2 (el mismo
número existe como VENTA y como COMPRA) y el candado por pagos. La suite del API quedó en **236/236**
en la corrida del worker; después ajusté la guarda de tipo (L3g) y volví a medir: 12/12 en el archivo,
`dump-schema --check` en sincronía (1165 líneas) y `db:check-rls` 47/47.
