# SPEC 01 — Integración del shell AdminLTE y dashboard de ejemplo

> **Estado:** Aprobado
> **Fecha:** 2026-09-09
> **Objetivo:** Integrar la librería oficial AdminLTE React (`@adminlte/react`) como shell global de la app y convertir la home en un dashboard de ejemplo de gestión de pagos, re-skinneado por completo con los tokens de `DESIGN.md`.

## Scope

**In:**

- Instalar `@adminlte/react` (versión exacta) y `bootstrap-icons` vía npm; Bootstrap JS cargado por CDN con `next/script`.
- `app/layout.tsx`: shell `DashboardLayout` global (sidebar + topbar + footer) con menú lateral, `lang="es"`, sin toggle de color.
- `app/page.tsx`: reemplazar el boilerplate por el dashboard de pagos (KPIs + tabla de pagos recientes con datos mock estáticos).
- Skin total: hoja CSS que mapea las CSS variables de Bootstrap/AdminLTE y sus componentes a los tokens de `DESIGN.md`.
- Eliminar el contenido boilerplate de create-next-app.

**Out of scope (specs futuras):**

- Dark mode / toggle de color (decisión: solo light).
- Datos reales, backend, autenticación ni layout `AuthLayout`.
- Páginas reales del menú (clientes, facturas…) y sus rutas.
- Plugins pesados de AdminLTE: `ApexChart`, `Datatable` (Tabulator), `Editor`, etc.
- Empaquetar/licenciar la fuente Berkeley Mono.
- Suite de tests automatizados.

## Data model

```ts
// lib/mock-data.ts
export type PaymentStatus = "paid" | "pending" | "overdue";

export interface Payment {
  id: string;
  customer: string;
  amount: number;      // en la moneda de la app
  currency: "EUR";
  dueDate: string;     // ISO yyyy-mm-dd
  status: PaymentStatus;
}

export interface Kpi {
  label: string;
  value: string;
}

export const kpis: Kpi[];          // Ingresos del mes, Pagos pendientes, Pagos vencidos
export const recentPayments: Payment[]; // >= 5 filas estáticas
```

Convenciones: los datos son mock, tipados y viven en `lib/mock-data.ts`; no hay persistencia ni backend. El skin mapea los estados así: `paid` → token semántico `success`, `overdue` → `danger`, `pending` → texto `mute` (los semánticos solo en badges de estado; el chrome queda monocromo).

## Implementation plan

1. `npm install @adminlte/react bootstrap-icons` (fijar versión exacta de `@adminlte/react`).
2. En `app/layout.tsx` importar los CSS (`@adminlte/react/css`, `bootstrap-icons/...css`) y añadir `<Script>` del bundle de Bootstrap 5.3 desde CDN. Comprobar `npm run dev` sin errores.
3. Crear `lib/menu.ts` con `MenuNode[]`: item activo "Dashboard" (`/`) y placeholders de sección (Clientes, Facturas, Conciliación) con `href: "#"`, marcados para specs futuras.
4. Reescribir `app/layout.tsx`: `metadata`, `lang="es"`, envolver `children` en `DashboardLayout` (`fixedHeader`, `fixedSidebar`, `menuItems`, `colorModeToggle={false}`) manteniendo las variables de fuente de `next/font`. Ver en dev: sidebar + topbar renderizan.
5. Crear `lib/mock-data.ts` con `kpis` y `recentPayments` (paso 0 del modelo anterior).
6. Reescribir `app/page.tsx` (server component): `AppContent` con título/breadcrumbs, fila de KPIs y una `Card` con tabla de pagos. Verificar en dev que '/' muestra el dashboard.
7. Crear `app/adminlte-theme.css` (skin) e importarla al final en el layout: sobreescribir `--bs-*` con tokens de DESIGN.md (body `canvas` `#fdfcfc`, texto `ink`/`body`, `--bs-primary` → `ink`, radio 4px en interactivos, quitar sombras de `.card`/`.btn`, tipografía monoespaciada vía `var(--font-geist-mono)`) y ajustar `.small-box`/`.card`/`.table`/`.btn` al vocabulario de DESIGN.md.
8. Verificación final con `npm run build` y `npm run lint`.

## Acceptance criteria

- [ ] `npm run build` y `npm run lint` terminan sin errores.
- [ ] `@adminlte/react` y `bootstrap-icons` figuran en `package.json`.
- [ ] `app/layout.tsx` renderiza `DashboardLayout` con sidebar (Dashboard activo + placeholders), topbar con botón de colapso y footer.
- [ ] El toggle de colapso del sidebar funciona y el contenido responde.
- [ ] `'/'` ya no muestra la landing de create-next-app; muestra `AppContent` con breadcrumbs Home/Dashboard.
- [ ] La página muestra al menos 3 KPIs y una tabla con ≥5 pagos con columna de estado.
- [ ] No existe control de dark mode visible y `<html>` lleva `data-bs-theme="light"`.
- [ ] Computed styles verificados (no a ojo): fondo del body `rgb(253, 252, 252)` (canvas), tarjetas sin `box-shadow`, radios de 4px en botones/inputs, y `font-family` de AdminLTE incluye la variable `--font-geist-mono`.
- [ ] `<html lang="es">`.

## Decisions

- **Sí:** `@adminlte/react`. Es el paquete oficial para React/App Router; `adminlte-react` está retirado de npm.
- **Sí:** shell `DashboardLayout` global en `app/layout.tsx` y `'/'` como dashboard. Coincide con el flujo de AdminLTE y con la petición; sin landing pública aún.
- **No:** route group `app/(dashboard)`. Se dejaría para cuando exista login/landing sin shell.
- **Sí:** solo tema light, `colorModeToggle={false}`. DESIGN.md define una única superficie clara; el dark mode sería spec aparte.
- **Sí:** Bootstrap JS por CDN (`next/script`), tal y como documenta la librería; iconos y CSS vía npm para no depender de red en build.
- **Sí:** fuente monoespaciada ya cargada (`--font-geist-mono`) como sustituto documentado de Berkeley Mono en `DESIGN.md`. No se licencia Berkeley Mono ahora.
- **Sí:** skin total vía overrides de `--bs-*` y clases, no skin superficial (solo paleta).
- **No:** Tailwind como base de estilos del dashboard (mantiene preflight/`@theme` en `globals.css`); los componentes AdminLTE usan Bootstrap + skin.
- **No:** gráficas ni datatable con plugins en este spec.

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Conflicto de resets: preflight de Tailwind v4 vs Bootstrap/AdminLTE | Orden de importación controlado en `layout.tsx` (librería → iconos → `globals.css`/skin al final); overrides puntuales en la skin si un componente depende de estilos base pisados. |
| `@adminlte/react` v0.6.x es early release con API cambiante | Fijar versión exacta en `package.json`; validar props/componentes contra el README del paquete al implementar. |
| Compatibilidad Next 16 / React 19 fuera del rango "probado" (badge Next 14+) | Verificar con `npm run build` en el paso 1; si hay APIs rotas, ajustar a la versión instalada o reportar. |
| Widgets interactivos de la librería requieren client components | La página dashboard se mantiene como server component usando solo componentes RSC; cualquier parte interactiva se aísla en un client component bajo `use client`. |

## What is **not** in this spec

- Dark mode, autenticación/login, rutas y páginas de gestión reales, datos de backend.
- Plugins de gráficas y datatables, tests automatizados, y la fuente Berkeley Mono licenciada.
- Cada uno de esos, si llega, va en su propia spec.
