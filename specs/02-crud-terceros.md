# SPEC 02 — CRUD de Terceros (clientes y proveedores)

> **Estado:** Implementado
> **Fecha:** 2026-09-17
> **Objetivo:** Implementar alta, consulta, edición y desactivación de **Terceros** (clientes y proveedores) en `/terceros`, accesible desde el nuevo menú `MAESTRO`, con el formulario en modal y persistencia local tras un repositorio.

## Scope

**In:**

- Ruta `/terceros` con el listado de Terceros (clientes y proveedores juntos).
- Menú lateral: `MAESTRO` (`MenuGroup` colapsable) → `CLIENTES Y PROVEEDORES` (`MenuItem` → `/terceros`). Reemplaza el placeholder "Clientes" de `lib/menu.ts`.
- CRUD completo: alta y edición en **modal**, desactivación lógica con **modal de confirmación**, y reactivación.
- Listado con búsqueda por nombre/número de documento, filtro por rol, orden por nombre, paginación y toggle "mostrar inactivos".
- Validación de formulario: tipo de documento, formato y unicidad del número, mínimo un rol, formato de correo.
- `lib/terceros-repo.ts`: tipos, validación y repositorio sobre `localStorage`, con datos semilla.

**Out of scope (specs futuras):**

- Backend real (Supabase), autenticación, RLS y migraciones.
- Integración con Facturas: `Payment.customer` (`lib/mock-data.ts:5`) queda **intacto**; la migración a `terceroId` es su propia spec.
- Corrección de la moneda de la app a PEN (deuda anotada: hoy `mock-data.ts` usa EUR/es-ES).
- Ordenamiento por columna, exportación, importación masiva e historial de cambios.
- `Datatable` (Tabulator), `Editor` y demás plugins pesados.
- `LinkProvider` / navegación client-side del menú (los links siguen siendo anclas normales, como en la spec 01).

## Data model

```ts
// lib/terceros-repo.ts
export type TipoDocumento = "DNI" | "RUC" | "CARNET_EXTRANJERIA" | "SIN_DOCUMENTO";
export type RolTercero = "cliente" | "proveedor";

export interface Tercero {
  id: string;                    // crypto.randomUUID()
  tipoDocumento: TipoDocumento;
  numeroDocumento: string | null; // null cuando SIN_DOCUMENTO
  nombre: string;                // razón social o nombre completo
  domicilioFiscal: string;
  telefono: string;
  correo: string;
  roles: RolTercero[];           // mínimo 1
  activo: boolean;               // borrado lógico
  creadoEn: string;              // ISO 8601
  actualizadoEn: string;         // ISO 8601
}

export type CampoValidable = "tipoDocumento" | "numeroDocumento" | "nombre" | "correo" | "roles";

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; errores: Partial<Record<CampoValidable, string>> };

export interface FiltrosTerceros {
  texto?: string;          // nombre o número de documento
  rol?: RolTercero;        // sin valor = todos
  incluirInactivos?: boolean;
}
```

### Reglas de validación

| Campo | Regla |
| --- | --- |
| `tipoDocumento` | Obligatorio; uno de los cuatro valores. |
| `numeroDocumento` | Obligatorio **salvo** `SIN_DOCUMENTO`. Formato por tipo: DNI `^\d{8}$`, RUC `^\d{11}$`, Carné de extranjería `^[A-Za-z0-9]{9,12}$`. Se normaliza con `trim()` + mayúsculas. |
| `nombre` | Obligatorio, `trim()`, mínimo 2 caracteres. |
| `domicilioFiscal` | Opcional. |
| `telefono` | Opcional. |
| `correo` | Opcional; si viene, debe ser un correo válido. |
| `roles` | Obligatorio, mínimo un rol. |

**Unicidad:** `(tipoDocumento, numeroDocumento)` es único entre **todos** los Terceros, incluidos los inactivos. `SIN_DOCUMENTO` queda exento.

**Etiqueta dinámica del nombre:** `RUC` → "Razón social"; `DNI`, `CARNET_EXTRANJERIA` y `SIN_DOCUMENTO` → "Nombre completo".

**Semántica de `SIN_DOCUMENTO`:** el campo de número se deshabilita y se limpia a `null`; no se valida formato ni unicidad.

### API del repositorio

```ts
listar(filtros?: FiltrosTerceros): Tercero[]
obtener(id: string): Tercero | null
crear(datos: Omit<Tercero, "id" | "activo" | "creadoEn" | "actualizadoEn">): Resultado<Tercero>
actualizar(id: string, datos: Omit<Tercero, "id" | "creadoEn" | "actualizadoEn">): Resultado<Tercero>
desactivar(id: string): Resultado<Tercero>
reactivar(id: string): Resultado<Tercero>
```

**Persistencia:** clave `gestion-pagos:terceros:v1`. Si la clave no existe, el repositorio siembra ≥ 5 Terceros de ejemplo (mezcla de clientes, proveedores y uno con ambos roles) para que el listado no arranque vacío. Toda lectura tolera JSON corrupto o ausente devolviendo la semilla en lugar de lanzar.

## Implementation plan

1. `lib/terceros-repo.ts`: tipos, tabla de validación, normalización, chequeo de unicidad, semilla y acceso a `localStorage` (guardas para SSR, donde `window` no existe). Verificar con `npx tsc --noEmit`.
2. `lib/menu.ts`: sustituir el placeholder "Clientes" (`lib/menu.ts:16`) por `{ type: "group", text: "MAESTRO", icon: "bi-database", children: [{ type: "item", text: "CLIENTES Y PROVEEDORES", href: "/terceros", icon: "bi-people" }] }`. Ver en dev que el grupo colapsa y navega.
3. `components/terceros/terceros-lista.tsx` (`"use client"`): isla cliente con la toolbar (búsqueda, filtro por rol, toggle "mostrar inactivos"), la `Table` de AdminLTE, la `Pagination` y las acciones por fila (editar / desactivar / reactivar).
4. `components/terceros/tercero-form-modal.tsx` (`"use client"`): `Modal` de AdminLTE con `Input`, `Select` y checkboxes de rol; estado local del formulario; errores por campo; etiqueta dinámica del nombre y deshabilitado del número cuando el tipo es `SIN_DOCUMENTO`. Se abre/cierra vía la API de Bootstrap (`window.bootstrap.Modal`) sobre el `id` del modal, con guarda si el global aún no cargó.
5. `components/terceros/tercero-confirm-modal.tsx` (`"use client"`): `Modal` de confirmación reutilizable para desactivar y reactivar.
6. `app/terceros/page.tsx` (server component): `AppContent` con título "Clientes y Proveedores" y breadcrumbs `Home / Clientes y Proveedores`; monta `TercerosLista`. Añadir `metadata` con el título de la página.
7. Verificación: `npm run build`, `npm run lint`, `npx tsc --noEmit`, y un pase con Playwright (alta, edición, desactivación, filtros, persistencia tras recargar).

## Acceptance criteria

- [x] `npm run build`, `npm run lint` y `npx tsc --noEmit` terminan sin errores. — ✅ `LINT_EXIT=0`, `TSC_EXIT=0`, `BUILD_EXIT=0` (✓ Compiled successfully in 15.4s; rutas `/`, `/_not-found`, `/login`, `/terceros`).
- [x] El menú lateral muestra `MAESTRO` como grupo colapsable con `CLIENTES Y PROVEEDORES` dentro; el grupo se expande y colapsa. — ✅ Playwright: clic en `MAESTRO` → `ul.nav-treeview` con `display: none` y altura 0; segundo clic → `display: block`, altura 43.19px, link "CLIENTES Y PROVEEDORES" con `href="/terceros"` y altura 40px.
- [x] `/terceros` renderiza `AppContent` con breadcrumbs Home / Clientes y Proveedores y el listado de Terceros. — ✅ DOM: heading "Clientes y Proveedores", breadcrumbs `["Home", "Clientes y Proveedores"]`, card "Listado de Terceros" con tabla de 6 columnas.
- [x] El listado muestra ambos roles juntos y la columna de roles usa `Badge` (no texto plano). — ✅ 6 nodos `.badge` en la columna Roles: `class="badge text-bg-primary"` (Cliente) y `"badge text-bg-info"` (Proveedor). "Carlos Alberto Ríos Salazar" aparece con ambos roles en la misma fila.
- [x] Encima de la tabla hay un botón de alta que abre el modal del formulario. — ✅ Geometría: botón "Nuevo" `bottom=236px` < `table top=252px`; el clic abre el dialog "Nuevo Tercero" (`display: block`).
- [x] Alta: crear un Tercero con DNI válido y un rol lo inserta en el listado y sobrevive a un recargado de página. — ✅ Alta "A1 Verificacion Alta" (DNI `11223344`, rol cliente) → fila visible en la tabla; tras recargar sigue visible; en Supabase `id=9c1f11d1-b523-498b-896f-9af9d6f75f3a`, `document_number=11223344`.
- [x] Alta inválida: DNI de 7 dígitos, RUC duplicado y cero roles muestran error por campo y **no** insertan. — ✅ `1234567` + cero roles + correo `no-es-correo` → tres `.invalid-feedback` visibles: "El DNI debe tener 8 dígitos.", "Selecciona al menos un rol.", "Introduce un correo válido."; RUC `20123456789` duplicado → "Ya existe un Tercero con ese tipo y número de documento."; Supabase: 0 filas con los nombres usados en el intento. Captura `.playwright-mcp/verify-02-alta-invalida.png`.
- [x] `SIN_DOCUMENTO` deshabilita y limpia el número; guarda `numeroDocumento: null`. — ✅ Con tipo `SIN_DOCUMENTO` el input `numeroDocumento` queda `disabled=true` y `value=""`; el alta persiste `document_number = null` en Supabase (`id=f69b3d89-37d0-4cbe-84b4-6c43e18ddd6c`).
- [x] La etiqueta del campo nombre cambia entre "Razón social" (RUC) y "Nombre completo" (resto). — ✅ Leído del DOM del modal: con `RUC` el label es "Razón social"; con `DNI`, `SIN_DOCUMENTO` y `CARNET_EXTRANJERIA` es "Nombre completo".
- [x] Edición: cambiar el teléfono de un Tercero se refleja en la tabla. — ✅ Editar "A1 Verificacion Alta" → teléfono `+51 999 888 777` en la celda Contacto y en Supabase (`phone`), también tras recargar.
- [x] Desactivar pide confirmación en modal; tras confirmar, el Tercero desaparece del listado por defecto. — ✅ El botón Desactivar abre `#tercero-confirm-modal` con "Desactivar Tercero / ¿Confirmas desactivar a A1 Verificacion Alta?…"; al confirmar, `active=false` en Supabase y la fila desaparece del listado por defecto. Captura `.playwright-mcp/verify-02-confirm-desactivar.png`.
- [x] El toggle "mostrar inactivos" lo vuelve a mostrar, y desde ahí se puede reactivar. — ✅ Con el switch activado la fila reaparece con `Badge` "Inactivo" y botón "Reactivar A1 Verificacion Alta"; al confirmar vuelve a "Activo".
- [x] Búsqueda por nombre y por número de documento filtra el listado; el filtro por rol deja solo clientes o solo proveedores. — ✅ Búsqueda "Lucía" → 1 fila; búsqueda "45678912" → 1 fila (María Fernanda Quispe Huamán); filtro Proveedores → 4 filas, todas con rol Proveedor; filtro Clientes → 5 filas, todas con rol Cliente.
- [x] Un Tercero desactivado conserva su `id` y sus datos; reactivar no crea un duplicado. — ✅ Reactivar conserva `id=9c1f11d1-b523-498b-896f-9af9d6f75f3a`; `count(*)` de `document_number='11223344'` = 1 tras reactivar.
- [x] El formulario no cierra el modal ni pierde los datos introducidos cuando la validación falla. — ✅ Tras el envío inválido el modal sigue en `display: block` y los valores `numeroDocumento="1234567"`, `nombre="Prueba Invalida"`, `correo="no-es-correo"` permanecen.
- [x] Sin errores en consola del navegador en el flujo completo. — ✅ `playwright_browser_console_messages(all=true, level=error)` → 0 errores; los logs de la sesión (`.playwright-mcp/console-2026-09-17T19-*.log`) no contienen ninguna línea `[ERROR]`.

> Nota de verificación: la persistencia descrita en este spec (`localStorage` tras `lib/terceros-repo.ts`) fue sustituida por Supabase en SPEC 03. Los criterios de este spec siguen cumpliéndose sobre la implementación vigente (el "sobrevive a un recargado" se verifica contra `third_parties`).

## Decisions

- **Sí:** entidad única `Tercero` con roles múltiples (ver ADR-0001). `Cliente` y `Proveedor` son roles, no entidades.
- **Sí:** formulario en **modal**, tanto alta como edición. Reemplaza la propuesta inicial de rutas dedicadas `/terceros/nuevo` y `/terceros/[id]`; no hay pantalla de detalle.
- **Sí:** borrado lógico (`activo`) con desactivación y reactivación. Un borrado físico rompería la integridad en cuanto Facturas referencie Terceros.
- **Sí:** toggle "mostrar inactivos" y reactivación. Sin ellos, el borrado lógico sería una puerta de un solo sentido y el Tercero quedaría irrecuperable.
- **Sí:** unicidad de `(tipoDocumento, numeroDocumento)` **incluyendo inactivos**. Reactivar es la vía para recuperar un documento ya usado; volver a darlo de alta crearía un duplicado silencioso.
- **Sí:** persistencia en `localStorage` tras `lib/terceros-repo.ts` (ver ADR-0002).
- **Sí:** paginación client-side y orden fijo por nombre. Los datos son locales y de bajo volumen.
- **Sí:** semilla de ≥ 5 Terceros para poder evaluar el flujo sin altas manuales.
- **No:** rutas dedicadas de alta/edición ni vista de detalle (decisión revisada a favor del modal).
- **No:** `Payment.customer` no se toca; queda como deuda para la spec de Facturas.
- **No:** no se corrige EUR → PEN en esta spec; se anota como deuda.
- **No:** sin ordenamiento por columna, exportación ni importación.

## Risks

| Riesgo | Mitigación |
| --- | --- |
| El `Modal` de `@adminlte/react` es solo marcado declarativo (no tiene prop `show`); su visibilidad depende del global `window.bootstrap`, cargado por CDN con `next/script`. | Abrir y cerrar vía `window.bootstrap.Modal.getOrCreateInstance(el)` con guarda de `undefined`. Si el global resulta poco fiable, fallback: controlar visibilidad desde React con las clases `show`/`d-block` más un `.modal-backdrop` propio, sin depender del JS de Bootstrap. |
| `localStorage` no existe durante el render en servidor. | El repositorio se usa solo desde client components y todas sus lecturas comprueban `typeof window !== "undefined"`. |
| Preflight de Tailwind v4 pisando estilos de Bootstrap dentro del modal. | El modal vive dentro del árbol de AdminLTE; la skin `app/adminlte-theme.css` ya cubre los overrides base. Revisar el modal visualmente y añadir overrides puntuales si hace falta. |
| `useEffect` de siembra ejecutándose dos veces en desarrollo (Strict Mode) y duplicando la semilla. | La semilla se escribe solo si la clave no existe; el `id` de cada Tercero es estable, así que una segunda pasada es idempotente. |
| Desincronización entre el listado en memoria y `localStorage` tras varias pestañas abiertas. | Fuera de alcance: se acepta que la última escritura gana. Anotado como limitación conocida. |

## What is **not** in this spec

- Backend, autenticación, RLS y cualquier forma de persistencia remota.
- La integración con Facturas y la migración de `Payment.customer` a `terceroId`.
- La corrección de la moneda EUR → PEN.
- Ordenamiento por columna, exportación, importación masiva e historial de cambios.
- Tests automatizados: la verificación es `build` + `lint` + `tsc` + un pase manual con Playwright.
