# SPEC 03 — Integración de Terceros con Supabase

> **Estado:** Implementado
> **Depende de:** SPEC 02
> **Fecha:** 2026-09-17
> **Objetivo:** Sustituir la persistencia local de Terceros por la tabla `third_parties` de Supabase, con acceso server-side vía `service_role`, sin cambiar la UI ni el contrato de validación.

## Why this spec exists

SPEC 02 dejó Supabase explícitamente fuera de alcance y ADR-0002 anticipó el plan: *"se reescribe el interior de `terceros-repo.ts` (o se sustituye por un cliente de Supabase manteniendo la firma). La UI no cambia."* La tabla `third_parties` ya existe con sus enums, constraints, trigger y 10 filas de prueba (ADR-0003), y nace con RLS deny-by-default (ADR-0004).

Esta spec es la de integración. La firma **no** se puede mantener tal cual porque pasa a haber red: las operaciones dejan de ser síncronas. El contrato que sí se conserva es el de la UI y el de `Resultado<T>` / `CampoError` que ya consumen los modales.

## Scope

**In:**

- Instalar `@supabase/supabase-js` (versión exacta) y crear `lib/supabase/server.ts` marcado `server-only`, con el cliente admin (`service_role`) y `auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }`.
- Variables `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en `.env` y en `.env.template` (sin valores en la plantilla). La `service_role` key la pega el humano desde el dashboard; el MCP no puede leerla.
- Partir `lib/terceros-repo.ts` en:
  - `lib/terceros/dominio.ts` — dominio puro y client-safe: tipos, `TIPOS_DOCUMENTO`, `ROLES`, etiquetas, `etiquetaNombre`, `normalizar`, `validar`, `Resultado`, `CampoError`, `DatosTercero`, `DatosActualizacion`, `FiltrosTerceros`.
  - `lib/terceros/mapeo.ts` — traducción `third_parties` ↔ `Tercero` y error de PostgREST → `errores` por campo.
  - `lib/terceros/acciones.ts` — Server Actions (`"use server"`) con el acceso a Supabase.
- `app/terceros/page.tsx` (server component) carga la lista con la acción y se la pasa a `TercerosLista`.
- `components/terceros/terceros-lista.tsx` y `tercero-form-modal.tsx`: consumen la lista inicial por props y llaman a las acciones de forma asíncrona, con estado de carga y banner de error general.
- Mapeo de errores de constraint de Postgres (`23505`, `23514`) a errores por campo.
- Eliminar de `terceros-repo.ts` la clave `gestion-pagos:terceros:v1`, `crearSemilla`, `leer`, `escribir`, `leerAlmacen` y `hayStorage`.

**Out of scope (specs futuras):**

- Auth/login de Supabase, sesión, cookies, middleware, `@supabase/ssr` y políticas RLS por `auth.uid()`. Es la spec siguiente.
- Filtros, búsqueda y paginación en el servidor. Siguen en el cliente.
- Realtime, suscripciones y multiusuario concurrente.
- Migración de los datos que hoy viven en `localStorage` del navegador.
- Otras entidades (Facturas) y la migración de `Payment.customer` a `terceroId`.
- Corrección de la moneda EUR → PEN.
- Tests automatizados.

## Data model

El tipo de dominio `Tercero` **no cambia** (vive ahora en `lib/terceros/dominio.ts`). La tabla `third_parties` se tipa con `Database` de `lib/database.types.ts`.

```ts
// lib/terceros/dominio.ts — sin cambios de forma respecto a SPEC 02
export type TipoDocumento = "DNI" | "RUC" | "CARNET_EXTRANJERIA" | "SIN_DOCUMENTO";
export type RolTercero = "cliente" | "proveedor";

export interface Tercero {
  id: string;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string | null;
  nombre: string;
  domicilioFiscal: string;
  telefono: string;
  correo: string;
  roles: RolTercero[];
  activo: boolean;
  creadoEn: string;      // ISO 8601
  actualizadoEn: string; // ISO 8601
}

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; errores: Partial<Record<CampoError, string>> };
```

Mapeo de idioma entre dominio (español) y base (inglés snake_case):

| Dominio (`Tercero`) | Base (`third_parties`) | Conversión |
| --- | --- | --- |
| `tipoDocumento` | `document_type` | `DNI`↔`dni`, `RUC`↔`ruc`, `CARNET_EXTRANJERIA`↔`foreigner_card`, `SIN_DOCUMENTO`↔`no_document` |
| `numeroDocumento` | `document_number` | `null` ↔ `null` |
| `nombre` | `name` | directo |
| `domicilioFiscal` | `fiscal_address` | `""` ↔ `null` |
| `telefono` | `phone` | `""` ↔ `null` |
| `correo` | `email` | `""` ↔ `null` |
| `roles` | `roles` | `cliente`↔`customer`, `proveedor`↔`supplier` |
| `activo` | `active` | directo |
| `creadoEn` | `created_at` | ISO 8601 ↔ `timestamptz` |
| `actualizadoEn` | `updated_at` | ISO 8601 ↔ `timestamptz` |

Contrato de las acciones (todas `async`, server-only):

```ts
// lib/terceros/acciones.ts
listarTerceros(): Promise<Tercero[]>
crearTercero(datos: DatosTercero): Promise<Resultado<Tercero>>
actualizarTercero(id: string, datos: DatosActualizacion): Promise<Resultado<Tercero>>
desactivarTercero(id: string): Promise<Resultado<Tercero>>
reactivarTercero(id: string): Promise<Resultado<Tercero>>
```

Mapeo de errores de PostgREST (`{ code, message, details, hint }`) a `errores` por campo:

| `code` | Constraint (en `message`) | Campo |
| --- | --- | --- |
| `23505` | `third_parties_document_unique` | `numeroDocumento` — "Ya existe un Tercero con ese tipo y número de documento." |
| `23514` | `third_parties_document_format` | `numeroDocumento` |
| `23514` | `third_parties_email_format` | `correo` |
| `23514` | `third_parties_name_min_length` | `nombre` |
| `23514` | `third_parties_roles_not_empty`, `third_parties_roles_no_nulls` | `roles` |
| otro | — | `general` — "No se pudo completar la operación." |

La validación de `lib/terceros/dominio.ts` sigue ejecutándose en el cliente **antes** de llamar a la acción (UX inmediata). El mapeo de errores de constraint es la red de seguridad por si una regla se salta o diverge.

## Implementation plan

1. `npm install @supabase/supabase-js` fijando la versión exacta. Verificar `npx tsc --noEmit` y `npm run build` sin cambios de comportamiento.
2. Añadir `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` a `.env.template` (vacías) y a `.env` (la key real la pega el humano). Confirmar que `.env` está ignorado por git.
3. Crear `lib/supabase/server.ts`: `import "server-only"`, factory cacheada que lee las dos variables, falla con un error claro si faltan y devuelve `createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })`.
4. Extraer el dominio puro de `lib/terceros-repo.ts` a `lib/terceros/dominio.ts` (tipos, constantes, etiquetas, `etiquetaNombre`, `normalizarCampos`, `validar`, `Resultado`, `CampoError`) y actualizar los imports de los dos componentes. `lib/terceros-repo.ts` desaparece. Verificar `npx tsc --noEmit`.
5. Crear `lib/terceros/mapeo.ts`: `aTercero(fila)` y `aFila(datos)`, más `erroresDesdePostgrest(error)`. Verificar con `npx tsc --noEmit`.
6. Crear `lib/terceros/acciones.ts` (`"use server"`) con las cinco acciones: `select` de todas las filas para `listarTerceros`, `insert`/`update` para el resto, y `cambiarActivo` para desactivar/reactivar. Cada una normaliza con el dominio, valida, traduce errores y devuelve `Resultado<Tercero>`. `listarTerceros` ordena por `name` en la consulta.
7. `app/terceros/page.tsx`: convertir el componente a `async`, llamar `listarTerceros()` y pasar el resultado a `<TercerosLista iniciales={terceros} />`.
8. Refactor de `components/terceros/terceros-lista.tsx`: recibir `iniciales` por props y guardarlos en estado; mantener búsqueda, filtro por rol, toggle de inactivos, orden y paginación **en cliente**; sustituir `useSyncExternalStore` por estado local; mutaciones `async` con estado `procesando` (deshabilitar acciones) y banner de error general; actualizar el estado con el `valor` devuelto por la acción.
9. Refactor de `components/terceros/tercero-form-modal.tsx`: `enviar` pasa a `async`, llama a `crearTercero`/`actualizarTercero`, muestra estado de guardado en el botón y pinta `errores` por campo devueltos por la acción (incluidos los mapeados desde Postgres).
10. Borrar todo el código de `localStorage` (ya sin uso tras el paso 4) y verificar de punta a punta: `npm run build`, `npm run lint`, `npx tsc --noEmit` y un pase con Playwright (listar, alta, edición, desactivar, reactivar, filtros, persistencia tras recargar y en ventana de incógnito).

## Acceptance criteria

- [x] `npm run build`, `npm run lint` y `npx tsc --noEmit` terminan sin errores. — ✅ `LINT_EXIT=0`, `TSC_EXIT=0`, `BUILD_EXIT=0` (✓ Compiled successfully in 15.4s; `/terceros` marcada `ƒ` dinámica).
- [x] `@supabase/supabase-js` figura en `package.json` con versión fija. — ✅ `"@supabase/supabase-js": "2.116.0"`, sin rango `^`/`~`.
- [x] `/terceros` muestra los 10 Terceros de prueba que ya viven en Supabase. — ✅ Los 10 de la semilla se localizan por búsqueda en la UI (`20123456789`, `20556677889`, `45678912`, `12345678`, `XA1234567`, "Taller Los Andes", `20987654321`, `70123456`, `20445566778`, `08765432`) y corresponden a los ids `a0000000-…-0001`…`0010` de `third_parties`. Observación: la tabla contiene además una fila ajena a la semilla ("YSRAEL", `id=74bb2b9a-791d-4cb6-8bf3-0b5538089e8f`, creada el 2026-09-17), por lo que el listado muestra 11 activos.
- [x] El alta de un Tercero con DNI válido y un rol lo inserta en Supabase y sobrevive a un recargado de página. — ✅ Alta "A1 Verificacion Alta" (DNI `11223344`, rol cliente): fila visible, presente tras recargar y en Supabase (`document_number=11223344`, `id=9c1f11d1-b523-498b-896f-9af9d6f75f3a`).
- [x] La edición del teléfono se refleja en la tabla y persiste tras recargar. — ✅ Teléfono → `+51 999 888 777`: reflejado en la celda Contacto, en Supabase (`phone`) y tras recargar.
- [x] Desactivar cambia `active` a `false` y el Tercero desaparece del listado por defecto; el toggle "mostrar inactivos" lo vuelve a mostrar y desde ahí se reactiva. — ✅ Desactivar → `active=false` en Supabase y la fila desaparece del listado por defecto; con el toggle reaparece como "Inactivo" con botón Reactivar; al confirmar vuelve a "Activo" (`active=true`).
- [x] Un DNI de 7 dígitos, un RUC duplicado, cero roles y un correo inválido muestran error por campo y **no** insertan. — ✅ `1234567` → "El DNI debe tener 8 dígitos."; RUC `20123456789` duplicado → "Ya existe un Tercero con ese tipo y número de documento."; cero roles → "Selecciona al menos un rol."; `no-es-correo` → "Introduce un correo válido."; Supabase: 0 filas insertadas por esos intentos.
- [x] Si se fuerza un duplicado saltándose la validación de cliente, el error `23505` de Postgres se muestra como error en `numeroDocumento`. — ✅ El envío llega a Postgres (el cliente no valida unicidad) y el `23505` de `third_parties_document_unique` se pinta como `.invalid-feedback` sobre el input `numeroDocumento`: "Ya existe un Tercero con ese tipo y número de documento."; sin fila nueva.
- [x] `SIN_DOCUMENTO` guarda `document_number` como `null`. — ✅ Alta con `SIN_DOCUMENTO` → `document_number = null` en Supabase (`id=f69b3d89-37d0-4cbe-84b4-6c43e18ddd6c`).
- [x] Un Tercero desactivado conserva su `id`; reactivar no crea un duplicado. — ✅ Reactivar conserva `id=9c1f11d1-b523-498b-896f-9af9d6f75f3a`; `count(*)` de `document_number='11223344'` = 1 (sin duplicado).
- [x] La cadena de `SUPABASE_SERVICE_ROLE_KEY` no aparece en el bundle cliente (`.next/static`). La caché local de build de Turbopack (`.next/cache/turbopack`) puede contenerla troceada: no se despliega, `.next` está en `.gitignore` y la clave nunca llega al navegador. — ✅ Búsqueda literal de la clave completa (219 chars) sobre todos los archivos de `.next/static` → 0 coincidencias; tampoco aparece la cadena `service_role` en ningún chunk. `.env` ignorado por git (`git check-ignore -v .env` → `.gitignore:34:.env*`).
- [x] Los datos se ven desde una ventana de incógnito distinta (prueba de que la persistencia es remota y no local). — ✅ `browser.newContext()` (contexto aislado, sin storage compartido) carga `/terceros` con los datos; el `localStorage` de esa pestaña solo contiene `lte-theme`, ninguna clave de terceros. Captura `.playwright-mcp/verify-03-incognito.png`.
- [x] Sin errores en la consola del navegador en el flujo completo. — ✅ 0 mensajes de error en toda la sesión de Playwright (listar, alta, alta inválida, `SIN_DOCUMENTO`, edición, desactivar, mostrar inactivos, reactivar, búsqueda y filtro por rol).

## Decisions

- **Sí:** acceso server-side con `service_role` vía Server Components y Server Actions, sin Auth. Mantiene RLS deny-by-default (ADR-0004), la clave nunca toca el navegador y difiere el login a su propia spec.
- **Sí:** Server Component carga la lista y las mutaciones van por Server Actions. Es el idioma de Next 16, no añade superficie de API y conserva el tipado `Resultado<T>`.
- **Sí:** partir `lib/terceros-repo.ts` en dominio puro (`lib/terceros/dominio.ts`) + datos server-only (`lib/terceros/`). La isla cliente necesita tipos, etiquetas y validación en el navegador, y eso no puede vivir en un módulo `server-only`.
- **Sí:** mapear los errores de constraint de Postgres a errores por campo. La base ya valida; perder ese detalle sería tirar integridad.
- **Sí:** filtros, búsqueda y paginación siguen en cliente. El volumen es bajo y preserva el comportamiento actual.
- **Sí:** descartar `localStorage` sin migrar. La base ya tiene semilla y una migración por navegador no aporta.
- **Sí:** estado de carga y banner de error general en la UI. Con red, la UI no puede mentir sobre el resultado.
- **No:** Route Handlers. Añaden superficie de API y trabajo manual de tipado y errores.
- **No:** `@supabase/ssr`. No hay Auth ni cookies en esta spec.
- **No:** Auth/login, RLS y políticas por `auth.uid()`. Spec propia.
- **No:** filtros y paginación en el servidor. Spec futura, si el volumen lo pide.
- **No:** migrar los datos de `localStorage`.
- **Sí:** aceptar que la caché de build de Turbopack (`.next/cache/turbopack`, activada por defecto en Next 16.3) guarde la `service_role` key troceada. No se despliega, `.next` está en `.gitignore` y el bundle cliente queda limpio; el criterio se mide sobre `.next/static`. La alternativa sería `experimental.turbopackFileSystemCacheForBuild: false`, a costa de builds más lentos.

## Risks

| Riesgo | Mitigación |
| --- | --- |
| La `service_role` key se filtra al bundle del cliente | `import "server-only"` en `lib/supabase/server.ts`, variable sin prefijo `NEXT_PUBLIC_`, `.env` en `.gitignore` y verificación con búsqueda en `.next`. |
| Sin Auth, cualquiera que alcance la app puede hacer CRUD | Aceptado de forma temporal; el login es la spec siguiente. Es paridad con el estado actual (localStorage tampoco tenía control de acceso). |
| Un error de constraint no mapeado se muestra mal | Fallback a `errores.general` y log del objeto completo de error (`code`, `message`, `details`, `hint`). |
| `useSyncExternalStore` no soporta operaciones asíncronas | Se sustituye por estado local hidratado desde el servidor; el patrón de store en módulo desaparece. |
| Cambios de breaking en Next 16 / React 19 en Server Actions | Leer `node_modules/next/dist/docs/` antes de implementar y validar con `npm run build`. |
| Traer todas las filas deja de escalar | Anotado: mover filtros y paginación a la base (ya existe el índice GIN de roles) en una spec futura. |
| La tabla tiene RLS sin políticas: cualquier consulta con clave publishable fallará | Es intencional. Esta spec usa `service_role`, que omite RLS; las políticas llegan con Auth. |

## What is **not** in this spec

- Auth/login, sesión, cookies, middleware, `@supabase/ssr` y políticas RLS.
- Filtros, búsqueda y paginación en el servidor.
- Realtime y concurrencia multiusuario.
- Migración de los datos de `localStorage`.
- Otras entidades (Facturas) y la migración de `Payment.customer`.
- La corrección de la moneda EUR → PEN.
- Tests automatizados: la verificación es `build` + `lint` + `tsc` + un pase con Playwright.

Cada uno de esos, si llega, va en su propia spec.
