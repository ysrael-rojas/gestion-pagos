# SPEC 07 — Comprobantes de compra y catálogo de Tipos de comprobante

> **Estado:** Aprobado
> **Depende de:** SPEC 02, SPEC 05
> **Fecha:** 2026-09-22
> **Objetivo:** Añadir el registro de Comprobantes de compra (documentos que emite un Proveedor) en `/comprobantes` y el catálogo gestionable de Tipos de comprobante en `/tipos-comprobante`, con CRUD completo en modales y datos ficticios persistidos en `localStorage`, sin Supabase.

## Why this spec exists

El dashboard y el menú arrastran desde SPEC 01 un placeholder `Facturas` sin ruta. El modelo de dominio ya tiene **Terceros** (clientes y proveedores) y **Usuarios**, pero no existe ningún registro de lo que la empresa **compra**: sin comprobantes de compra no hay nada que pagar, y la spec de pagos que vendrá después no tendría sobre qué operar.

Esta spec entrega la primera mitad de esa cadena: el documento de compra y su catálogo de tipos. Sigue el patrón de CRUD en modal de SPEC 02 (Terceros) y la autorización de SPEC 05, y aparca el backend reutilizando la decisión de ADR-0002 (persistencia mock en `localStorage` tras un repositorio) hasta que exista la spec de integración con Supabase para Compras.

Además, **modifica deliberadamente el vocabulario**: el catálogo de tipos de comprobante es gestionable por el usuario, así que **no** es un enum nativo como los de ADR-0003. Esa desviación se registra en ADR-0007.

## Scope

**In:**

- Catálogo `Tipo de comprobante` con CRUD propio en `/tipos-comprobante`, dentro del grupo de menú `MAESTRO`.
- Semilla del catálogo con los cinco tipos: `Factura`, `Boleta`, `Recibo por honorarios`, `Ticket`, `Nota de crédito`.
- Ruta `/comprobantes` en el route group `(dashboard)`, en un grupo de menú nuevo `COMPRAS`, protegida por `requerirPermiso("gestionar_compras")`.
- Listado de Comprobantes de compra con las columnas **Fecha emisión · Tipo · Nro · Proveedor · Subtotal · IGV · Total · Condición · Vencimiento · Estado**.
- Filtros: búsqueda por Proveedor o Nro, Tipo de comprobante, Condición de pago, **rango de fechas de emisión** y "mostrar inactivos".
- Alta y edición en modal, y desactivación/reactivación con modal de confirmación.
- Cálculo del IGV a partir de Subtotal y Total, y validación de vencimiento condicionada a la Condición de pago.
- Persistencia mock en `localStorage` tras sendos repositorios, con semilla de datos ficticios.
- Permiso nuevo `gestionar_compras` para los roles `administrador` y `operador`.

**Out of scope (specs futuras):**

- Persistencia en Supabase y migraciones. Va en la spec de integración de Compras.
- El **pago** de los comprobantes: medio de pago (efectivo, transferencia, depósito…), parciales, saldos y conciliación. Spec propia.
- Estado de pago del comprobante (pendiente/pagado/vencido) y su reflejo en el dashboard.
- Vincular el Proveedor con un Tercero: aquí es texto libre; la spec de backend lo convierte en referencia.
- Notas de crédito como ajuste que resta de una factura; aquí `Nota de crédito` es solo un tipo más del catálogo.
- Series/correlativos automáticos y validación de formato del Nro por tipo.
- Edición del Nro de un comprobante ya registrado más allá de lo que permita el formulario de edición.
- Adjuntar el archivo del comprobante (PDF/imagen).
- Tests automatizados: la verificación es `build` + `lint` + `tsc` + un pase con Playwright.

## Data model

Esta spec **no crea tablas**: define el vocabulario y las reglas de negocio en código, con persistencia mock en `localStorage`.

### Catálogo `TipoComprobante`

`lib/tipos-comprobante/dominio.ts`:

| Campo | Tipo | Notas |
| --- | --- | --- |
| `id` | `string` | Identificador propio del mock |
| `nombre` | `string` | Visible en el `select` y en el listado. Al menos 2 caracteres |
| `activo` | `boolean` | Borrado lógico. Un tipo inactivo no se ofrece en altas nuevas |
| `creadoEn` | `string` | ISO |

Semilla: `Factura`, `Boleta`, `Recibo por honorarios`, `Ticket`, `Nota de crédito`, todos activos.

### Entidad `ComprobanteCompra`

`lib/comprobantes/dominio.ts`:

| Campo | Tipo | Origen / Notas |
| --- | --- | --- |
| `id` | `string` | Identificador propio del mock |
| `fechaEmision` | `string` | Fecha ISO (`YYYY-MM-DD`). Obligatoria |
| `tipoComprobanteId` | `string` | Referencia al catálogo |
| `numero` | `string` | Nro de documento, texto libre de 1–20 caracteres |
| `proveedor` | `string` | Texto libre, ≥ 2 caracteres. En el backend será una referencia a Tercero |
| `subtotal` | `number` | ≥ 0 |
| `igv` | `number` | **Calculado**: `total − subtotal`. No editable |
| `total` | `number` | ≥ `subtotal` |
| `condicionPago` | `"contado" \| "credito"` | Obligatoria |
| `fechaVencimiento` | `string \| null` | Obligatoria solo si `credito`; `>= fechaEmision` |
| `activo` | `boolean` | Borrado lógico |
| `creadoEn` | `string` | ISO |

### Reglas de negocio

- **IGV derivado.** El IGV es la diferencia entre Total y Subtotal: `igv = total − subtotal`. Al editar Subtotal o Total en el formulario, el IGV se recalcula. El IGV nunca se escribe a mano y el Total nunca se deriva del IGV.
- **Vencimiento condicional.** Si `condicionPago === "credito"`, `fechaVencimiento` es obligatoria y debe ser `>= fechaEmision`. Si es `contado`, se guarda `null` y el campo se oculta.
- **Unicidad.** No puede existir otro Comprobante de compra activo o inactivo con la misma terna `(tipoComprobanteId, proveedor, numero)`.
- **Borrado lógico.** No hay borrado físico: desactivar y reactivar, como Tercero y Usuario.

### Validación

`validar(datos, comprobantes, tipos, idExcluido?)` en `lib/comprobantes/dominio.ts`, función pura:

| Campo | Regla | Mensaje |
| --- | --- | --- |
| `fechaEmision` | Fecha válida | "Selecciona una fecha de emisión válida." |
| `tipoComprobanteId` | Debe existir en el catálogo | "Selecciona un tipo de comprobante válido." |
| `numero` | 1–20 caracteres | "El número de documento es obligatorio." |
| `proveedor` | ≥ 2 caracteres, sin espacios extremos | "El proveedor debe tener al menos 2 caracteres." |
| `subtotal` | Número ≥ 0 | "El subtotal debe ser un número mayor o igual a 0." |
| `total` | Número ≥ `subtotal` | "El total no puede ser menor que el subtotal." |
| `condicionPago` | `contado` o `credito` | "Selecciona una condición de pago válida." |
| `fechaVencimiento` | Obligatoria y `>= fechaEmision` si es crédito | "La fecha de vencimiento es obligatoria para comprobantes a crédito." / "El vencimiento no puede ser anterior a la emisión." |
| terna | No repetida | "Ya existe un comprobante con ese tipo, proveedor y número." |

`lib/tipos-comprobante/dominio.ts` valida el catálogo:

| Campo | Regla | Mensaje |
| --- | --- | --- |
| `nombre` | ≥ 2 caracteres, sin espacios extremos | "El nombre debe tener al menos 2 caracteres." |
| `nombre` | No repetido (ignorando mayúsculas) | "Ya existe un tipo de comprobante con ese nombre." |

### Copy de la pantalla

| Ubicación | Texto |
| --- | --- |
| Página y breadcrumb (comprobantes) | Comprobantes de compra |
| Grupo de menú | COMPRAS |
| Ítem de menú | COMPROBANTES DE COMPRA |
| Columnas | Fecha emisión · Tipo · Nro · Proveedor · Subtotal · IGV · Total · Condición · Vencimiento · Estado |
| Condición | Contado · Crédito |
| Estado | Activo · Inactivo |
| Botón de alta | Nuevo comprobante |
| Modal de alta / edición | Nuevo comprobante / Editar comprobante |
| Etiquetas | FECHA DE EMISIÓN · TIPO DE COMPROBANTE · NRO DE DOCUMENTO · PROVEEDOR · SUBTOTAL · IGV · TOTAL · CONDICIÓN DE PAGO · FECHA DE VENCIMIENTO |
| Botón de guardar | Guardar |
| Confirmación (desactivar) | ¿Desactivar el comprobante «{numero}» de «{proveedor}»? Dejará de estar disponible pero conservará su historial. |
| Confirmación (reactivar) | ¿Reactivar el comprobante «{numero}» de «{proveedor}»? |
| Página y breadcrumb (catálogo) | Tipos de comprobante |
| Ítem de menú (catálogo) | TIPOS DE COMPROBANTE |
| Modal del catálogo | Nuevo tipo / Editar tipo |
| Etiqueta del catálogo | NOMBRE |
| Confirmación (catálogo) | ¿Desactivar el tipo «{nombre}»? No aparecerá en nuevos comprobantes. |

### Persistencia mock

- Claves: `gestion-pagos:tipos-comprobante:v1` y `gestion-pagos:comprobantes:v1`.
- Si la clave no existe, el repositorio siembra: 5 tipos y 8 comprobantes ficticios (proveedores peruanos, mezcla de los 5 tipos, mayoría `contado` y 2–3 `credito` con vencimiento, fechas de 2026, **1 inactivo**).
- Toda lectura tolera JSON corrupto o ausente devolviendo la semilla en lugar de lanzar (precedente de SPEC 02).
- El repositorio expone una API de dominio (`listar` / `obtener` / `crear` / `actualizar` / `desactivar` / `reactivar`) y no deja escapar el detalle de `localStorage` hacia la UI (ADR-0002).

## Implementation plan

1. **Documentación de dominio.** Añadir a `CONTEXT.md` los términos `Comprobante de compra`, `Tipo de comprobante`, `Condición de pago`, `IGV` y `Comprobante de compra activo`. Escribir `docs/adr/0007-tipo-comprobante-catalogo-gestionable.md`, que registra que el catálogo de tipos es gestionable por el usuario y por eso no se modela como enum nativo (desviación de ADR-0003).
2. **Permisos.** `lib/auth/permisos.ts`: añadir `"gestionar_compras"` a `PERMISOS` y a `PERMISOS_POR_ROL` para `administrador` y `operador`.
3. **Dominio del catálogo.** `lib/tipos-comprobante/dominio.ts`: tipo `TipoComprobante`, `DatosTipoComprobante`, `normalizarCampos`, `validar` y `Resultado<T>`, replicando la forma de `lib/terceros/dominio.ts`.
4. **Dominio de comprobantes.** `lib/comprobantes/dominio.ts`: tipo `ComprobanteCompra`, `DatosComprobanteCompra`, `CondicionPago`, `normalizarCampos`, `calcularIgv`, `validar`, etiquetas (`ETIQUETAS_CONDICION`) y `Resultado<T>`.
5. **Repos mock.** `lib/tipos-comprobante/repo.ts` y `lib/comprobantes/repo.ts` sobre `localStorage`, con semilla, tolerancia a datos corruptos y API de dominio. El repo de comprobantes recibe el catálogo (o lo lee) para resolver el nombre del tipo.
6. **Catálogo — componentes.** `components/tipos-comprobante/tipos-comprobante-lista.tsx` (client, carga del repo en `useEffect`, `Table` + `Badge` + `Pagination` + `Button`, columnas Nombre · Estado · Acciones), `tipo-comprobante-form-modal.tsx` (campo NOMBRE) y `tipo-comprobante-confirm-modal.tsx`, sobre `components/terceros/modal-bootstrap.ts`.
7. **Catálogo — página.** `app/(dashboard)/tipos-comprobante/page.tsx`: Server Component con `metadata.title = "Tipos de comprobante"`, `force-dynamic`, `await requerirPermiso("gestionar_compras")`, `AppContent` con breadcrumbs y el listado.
8. **Comprobantes — componentes.** `components/comprobantes/comprobantes-lista.tsx`: filtros (búsqueda, tipo, condición, rango de emisión, mostrar inactivos), columnas del copy, paginación de 10 y acciones Editar / Desactivar / Reactivar. `comprobante-form-modal.tsx`: `select` de tipos activos (más el actual en edición), Nro, Proveedor, Fecha de emisión, Subtotal/IGV/Total con el cálculo acordado, Condición y Vencimiento condicional, con errores por campo. `comprobante-confirm-modal.tsx`.
9. **Comprobantes — página.** `app/(dashboard)/comprobantes/page.tsx`: Server Component con `metadata.title = "Comprobantes de compra"`, `force-dynamic`, `await requerirPermiso("gestionar_compras")`, `AppContent` y el listado.
10. **Menú.** `lib/menu.ts`: nuevo `MenuGroup` `COMPRAS` con el ítem `COMPROBANTES DE COMPRA` → `/comprobantes`, y en `MAESTRO` el ítem `TIPOS DE COMPROBANTE` → `/tipos-comprobante`, ambos con `permiso: "gestionar_compras"`.
11. **Verificación.** `npm run lint`, `npx tsc --noEmit`, `npm run build`; luego `npm run dev` con Playwright para los criterios de abajo, con capturas en `.playwright-mcp/`.

## Acceptance criteria

- [ ] `npm run build`, `npm run lint` y `npx tsc --noEmit` terminan sin errores.
- [ ] Existen `app/(dashboard)/comprobantes/page.tsx`, `app/(dashboard)/tipos-comprobante/page.tsx`, los cuatro ficheros de `lib/{comprobantes,tipos-comprobante}/` y los seis componentes de `components/{comprobantes,tipos-comprobante}/`.
- [ ] El menú muestra `COMPRAS` → `COMPROBANTES DE COMPRA` y `MAESTRO` → `TIPOS DE COMPROBANTE` con el Usuario `administrador`, y con el `operador` también (tiene el permiso); el ítem `Facturas` sigue intacto.
- [ ] `/tipos-comprobante` lista los cinco tipos sembrados con columna Estado.
- [ ] El administrador da de alta un tipo nuevo, aparece en el listado y queda disponible en el `select` del formulario de comprobante sin recargar.
- [ ] Un tipo con nombre repetido muestra el error de campo y no crea nada.
- [ ] Desactivar un tipo lo marca Inactivo y lo retira del `select` de altas nuevas, sin romper los comprobantes que ya lo usaban.
- [ ] `/comprobantes` lista los ocho comprobantes sembrados con las diez columnas, incluido el inactivo.
- [ ] Los cinco filtros funcionan: búsqueda por Proveedor y por Nro, Tipo, Condición, rango de fechas de emisión y "mostrar inactivos".
- [ ] Alta de un comprobante desde la UI: aparece en el listado y **persiste tras recargar la página**.
- [ ] Editar un comprobante persiste en `localStorage` y se refleja en el listado tras recargar.
- [ ] Al escribir Subtotal y Total, el IGV se muestra como la diferencia y se recalcula al cambiar cualquiera de los dos.
- [ ] Un Total menor que el Subtotal muestra "El total no puede ser menor que el subtotal." y no guarda.
- [ ] Con Condición `contado` el campo Vencimiento no aparece; con `credito` es obligatorio y una fecha anterior a la emisión da error.
- [ ] Un Nro repetido para el mismo tipo y proveedor muestra el error de terna y no crea nada.
- [ ] Desactivar un comprobante lo marca Inactivo; reactivarlo lo devuelve a Activo.
- [ ] No existe ningún control de borrado físico, ni en comprobantes ni en el catálogo.
- [ ] Los modales de alta, edición y confirmación de ambas pantallas abren y cierran, y los errores por campo se muestran junto al campo correspondiente.
- [ ] Consola del navegador sin errores en `/comprobantes` y `/tipos-comprobante`.

## Decisions

- **Sí:** el IGV es `total − subtotal`, y no un 18 % fijo. Se permite registrar comprobantes exonerados o con otra tasa; el usuario escribe Subtotal y Total y la app deriva el IGV.
- **Sí:** Tipo de comprobante como **catálogo gestionable** con CRUD propio, no como enum nativo. El usuario necesita mantener sus propios tipos, lo que un enum de Postgres no permite (ver ADR-0007, que desvía de ADR-0003).
- **Sí:** el catálogo vive en `MAESTRO`, junto a Terceros, porque es dato de referencia; los comprobantes viven en un grupo `COMPRAS` propio porque son operación, no maestro.
- **Sí:** `Condición de pago` (`contado` | `credito`) en el comprobante, y no `Tipo de pago`. El medio de pago (efectivo, transferencia, depósito) es un eje distinto que pertenece a la spec de pagos.
- **Sí:** Proveedor como texto libre por ahora. Sin Supabase no hay Terceros que ofrecer; la spec de backend lo convierte en referencia a un Tercero con rol `proveedor`.
- **Sí:** persistencia en `localStorage` tras repositorio, siguiendo ADR-0002. El CRUD es cliente; la UI no conoce el almacenamiento y podrá cambiar a Supabase sin tocarse.
- **Sí:** moneda PEN y formato `es-PE` (`S/`), coherente con la empresa peruana y con el IGV. El mock del dashboard en EUR es de SPEC 01 y se alineará cuando se toque el dashboard.
- **Sí:** borrado lógico en ambas entidades, sin borrado físico, coherente con Tercero y Usuario.
- **Sí:** el rango de fechas filtra por **fecha de emisión**; el vencimiento se consulta en la columna.
- **Sí:** `gestionar_compras` para `administrador` y `operador`. Quien registra compras es habitualmente el operador; un permiso más granular no aporta aquí.
- **Sí:** la unicidad es por `(tipo, proveedor, número)`. Un mismo correlativo puede repetirse entre proveedores distintos, como en la realidad fiscal.
- **No:** estado de pago, pagos parciales, medios de pago y conciliación. Spec de pagos.
- **No:** Supabase, migraciones ni RLS para Compras en esta spec.
- **No:** vínculo Proveedor ↔ Tercero, adjuntos, series/correlativos automáticos y validación de formato del Nro.
- **No:** tests automatizados.

## Risks

| Riesgo | Mitigación |
| --- | --- |
| El listado arranca vacío porque `localStorage` no existe en el servidor | El listado carga del repo en `useEffect` tras montar; no hay datos en el HTML inicial y no se produce desajuste de hidratación |
| El CRUD cliente diverge del patrón Server Actions de Terceros y Usuarios | Es deliberado (ADR-0002): sin Supabase no hay servidor donde persistir. La UI queda aislada tras `repo.ts` para migrar sin cambios |
| Dos pestañas abiertas pueden pisarse los datos de `localStorage` | Es un mock de desarrollo; se asume y se documenta. El backend elimina el problema |
| Desactivar un tipo usado por comprobantes deja referencias a un tipo inactivo | El comprobante guarda `tipoComprobanteId` y muestra el nombre resuelto aunque el tipo esté inactivo; solo se retira de las altas nuevas |
| `Resultado<T>` se duplica por tercera vez | Se replica el patrón actual por consistencia; extraerlo a un módulo común es una refactorización aparte |
| El IGV derivado permite valores incoherentes (por ejemplo, Total igual a Subtotal con IGV 0 en una factura gravada) | Es una decisión explícita para admitir exonerados; la validación solo exige `Total ≥ Subtotal`. Una validación por tipo de comprobante queda para más adelante |
| El nuevo grupo de menú altera el orden del sidebar | Se verifica visualmente en el pase de Playwright contra el orden actual |

## What is **not** in this spec

- Persistencia en Supabase, migraciones y RLS para Compras.
- Pagos de comprobantes, medios de pago, parciales, saldos y conciliación.
- Estado de pago del comprobante y su reflejo en el dashboard.
- Vínculo entre Proveedor y Tercero.
- Notas de crédito como ajuste de facturas.
- Series/correlativos automáticos, adjuntos y validación de formato del Nro.
- Tests automatizados.

Cada uno de esos, si llega, va en su propia spec.
