# SPEC 02 — CRUD de Terceros (clientes y proveedores)

> **Estado:** Aprobado
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

- [ ] `npm run build`, `npm run lint` y `npx tsc --noEmit` terminan sin errores.
- [ ] El menú lateral muestra `MAESTRO` como grupo colapsable con `CLIENTES Y PROVEEDORES` dentro; el grupo se expande y colapsa.
- [ ] `/terceros` renderiza `AppContent` con breadcrumbs Home / Clientes y Proveedores y el listado de Terceros.
- [ ] El listado muestra ambos roles juntos y la columna de roles usa `Badge` (no texto plano).
- [ ] Encima de la tabla hay un botón de alta que abre el modal del formulario.
- [ ] Alta: crear un Tercero con DNI válido y un rol lo inserta en el listado y sobrevive a un recargado de página.
- [ ] Alta inválida: DNI de 7 dígitos, RUC duplicado y cero roles muestran error por campo y **no** insertan.
- [ ] `SIN_DOCUMENTO` deshabilita y limpia el número; guarda `numeroDocumento: null`.
- [ ] La etiqueta del campo nombre cambia entre "Razón social" (RUC) y "Nombre completo" (resto).
- [ ] Edición: cambiar el teléfono de un Tercero se refleja en la tabla.
- [ ] Desactivar pide confirmación en modal; tras confirmar, el Tercero desaparece del listado por defecto.
- [ ] El toggle "mostrar inactivos" lo vuelve a mostrar, y desde ahí se puede reactivar.
- [ ] Búsqueda por nombre y por número de documento filtra el listado; el filtro por rol deja solo clientes o solo proveedores.
- [ ] Un Tercero desactivado conserva su `id` y sus datos; reactivar no crea un duplicado.
- [ ] El formulario no cierra el modal ni pierde los datos introducidos cuando la validación falla.
- [ ] Sin errores en consola del navegador en el flujo completo.

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
