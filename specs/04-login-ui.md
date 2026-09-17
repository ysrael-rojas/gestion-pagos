# SPEC 04 — Vista de inicio de sesión (`/login`)

> **Estado:** Implementado
> **Depende de:** SPEC 01
> **Fecha:** 2026-09-17
> **Objetivo:** Añadir la ruta `/login` como vista presentacional de dos paneles fuera del shell AdminLTE, reutilizando los tokens de `DESIGN.md` ya mapeados a variables `--gp-*`.

## Why this spec exists

SPEC 01 decidió explícitamente *"**No:** route group `app/(dashboard)`. Se dejaría para cuando exista login/landing sin shell."* Esa condición se cumple ahora. Además SPEC 03 dejó Auth/login fuera de alcance como *"la spec siguiente"*.

Esta spec entrega **solo la interfaz**. No hay Auth, no hay Supabase, no hay sesión. Es el andamio visual sobre el que se montará el login real.

## Scope

**In:**

- Route group `app/(dashboard)/` que aloja el shell `DashboardLayout` y las páginas actuales (`/` y `/terceros`), **sin cambiar sus URLs**.
- Route group `app/(auth)/` con `app/(auth)/login/page.tsx` y `app/(auth)/login/login.css`.
- Traslado del bloque de tokens `--gp-*` desde `app/adminlte-theme.css` a `app/globals.css` como fuente única.
- Vista de login de dos paneles: izquierdo solo con título y subtítulo, derecho con el formulario completo (sin el selector "Ingreso como").
- Tema claro forzado: `color-scheme: light` y retirada del `@media (prefers-color-scheme: dark)` de `globals.css`.
- Comportamiento responsive a un breakpoint (850px, el de `DESIGN.md`).

**Out of scope (specs futuras):**

- Auth real: Supabase Auth, sesión, cookies, `@supabase/ssr`, middleware, RLS por `auth.uid()`.
- Server Actions, validación de credenciales, mensajes de error y estados de carga del formulario.
- Redirección `/` → `/login`, protección de rutas y guardas de sesión.
- Selector "Personal"/"Familia" ("Ingreso como"): descartado de esta vista por decisión.
- Registro de cuenta, recuperación de contraseña y activación de cuenta funcionales.
- Alta de `/login` en el menú lateral.
- Tests automatizados.

## Data model

Esta spec **no introduce estructuras de dominio ni persistencia**: la vista es presentacional y no lee, guarda ni envía nada. No hay tablas, tipos ni repositorios nuevos.

Lo que sí se fija es el vocabulario visual.

### Copy de la vista

| Ubicación | Texto |
| --- | --- |
| Panel izquierdo — título | ERP GESTION COMERCIAL |
| Panel izquierdo — subtítulo | Software para control del pagos |
| Panel derecho — h1 | Iniciar sesión |
| Panel derecho — subtítulo | Ingresa para gestionar tus pagos. |
| Panel derecho — etiqueta | EMAIL |
| Panel derecho — etiqueta | CONTRASEÑA |
| Panel derecho — enlace | ¿Olvidaste tu contraseña? |
| Panel derecho — botón | Iniciar sesión |
| Panel derecho — pie | ¿Te invitó la empresa? Activa tu cuenta |

Notas: el título y el subtítulo izquierdos se transcriben **verbatim** como los pidió el usuario, incluido "del pagos". Se descarta "INGRESO COMO" con sus opciones "Personal" y "Familia".

### Tokens de `DESIGN.md` usados

| Elemento | Token |
| --- | --- |
| Panel izquierdo | `{colors.surface-soft}` + borde derecho 1px `{colors.hairline}` |
| Panel derecho y body | `{colors.canvas}` |
| Título izquierdo | `{typography.display-xl}` + `{colors.ink}` |
| Subtítulo izquierdo | `{typography.body-md}` + `{colors.body}` |
| h1 derecho | `{typography.heading-md}` + `{colors.ink}` |
| Subtítulo derecho | `{typography.body-md}` + `{colors.mute}` |
| Etiquetas de campo | `{typography.caption-md}` + `{colors.mute}` |
| Inputs | `{component.text-input}` / `{component.text-input-focused}` |
| Botón | `{component.button-primary}` / `{component.button-primary-active}` |
| Enlaces | `{component.link-inline}` |

Sin gradientes, sin sombras, radios de 4px y todo en la tipografía monoespaciada del sistema.

## Implementation plan

1. **Tokens a `globals.css`.** Mover el bloque de tokens `--gp-*` (incluida `--gp-font-mono`) de `app/adminlte-theme.css:1-21` a `app/globals.css`. Fijar `--background: #fdfcfc`, `--foreground: #201d1d` y `color-scheme: light`, y eliminar el `@media (prefers-color-scheme: dark)`. En `adminlte-theme.css` quedan solo los overrides `--bs-*` y las reglas de componentes AdminLTE. Verificar en dev que el dashboard no cambió.
2. **Layout raíz mínimo.** `app/layout.tsx` queda con `<html lang="es" data-bs-theme="light">`, las variables de `next/font` y el import de `globals.css`. Salen `DashboardLayout`, `menuItems`, los imports de `@adminlte/react/css` / `bootstrap-icons` / `adminlte-theme.css` y el `<Script>` de Bootstrap.
3. **Route group `(dashboard)`.** Crear `app/(dashboard)/layout.tsx` con el shell que hoy vive en el raíz: imports de AdminLTE/Bootstrap y `adminlte-theme.css`, `DashboardLayout` con `menuItems`, `logo`, `user`, `fixedHeader`, `fixedSidebar`, `colorModeToggle={false}`, `initialColorMode="light"`, y el `<Script>` de Bootstrap dentro del `<body>`. Mover `app/page.tsx` → `app/(dashboard)/page.tsx` y `app/terceros/` → `app/(dashboard)/terceros/`.
4. **Verificar el refactor antes de seguir.** `npx tsc --noEmit`, `npm run build` y comprobar en dev que `/` y `/terceros` siguen renderizando con sidebar, topbar y footer, y que los modales de Terceros siguen abriendo.
5. **Página de login.** `app/(auth)/login/page.tsx` (server component) con `metadata.title = "Iniciar sesión"`. Estructura: contenedor de dos paneles; izquierda `<section>` con `<h1>` y `<p>`; derecha `<section>` con `<form>` **sin `action`**, `<label>` + `<input type="email" autoComplete="email">`, `<label>` + `<input type="password" autoComplete="current-password">`, enlace, `<button type="button">` y pie con enlace. Todos los enlaces con `href="#"`.
6. **Estilos.** `app/(auth)/login/login.css` con grid 50/50 a `min-height: 100vh` / `100dvh`, consumiendo únicamente `var(--gp-*)`. A ≤850px el grid colapsa a una columna con el panel izquierdo como banda superior compacta.
7. **Verificación.** `npm run lint`, `npx tsc --noEmit`, `npm run build`; luego `npm run dev` con Playwright: captura de `/login` en `.playwright-mcp/`, consola sin errores, y re-verificación de `/` y `/terceros`.

## Acceptance criteria

- [x] `npm run build`, `npm run lint` y `npx tsc --noEmit` terminan sin errores. — ✅ `LINT_EXIT=0`, `TSC_EXIT=0`, `BUILD_EXIT=0`; el build lista `/login` como ruta estática (`○`).
- [x] `/login` renderiza sin sidebar, sin topbar y sin footer de AdminLTE. — ✅ DOM de `/login`: no existen `.app-sidebar`, `.app-header` ni `.app-footer`; el árbol es `<main class="login">` con dos `<section>`.
- [x] `/` y `/terceros` siguen renderizando con el shell completo y conservan sus URLs. — ✅ `location.pathname` = `/` y `/terceros`; ambos con `.app-sidebar`, `.app-header`, `.app-footer` y `.app-content`, y los modales de Terceros siguen abriendo. Captura `.playwright-mcp/verify-04-home-shell.png`.
- [x] Existen `app/(dashboard)/layout.tsx`, `app/(auth)/login/page.tsx` y `app/(auth)/login/login.css`. — ✅ Los tres archivos existen en disco.
- [x] `app/layout.tsx` no importa `@adminlte/react` ni contiene `DashboardLayout`. — ✅ `app/layout.tsx` solo importa `next`, `next/font/google` y `./globals.css`; no menciona `@adminlte` ni `DashboardLayout`.
- [x] El panel izquierdo contiene únicamente "ERP GESTION COMERCIAL" y "Software para control del pagos"; no hay logo, ni pie, ni selector. — ✅ Snapshot de accesibilidad del panel izquierdo: solo `<h1>ERP GESTION COMERCIAL</h1>` y `<p>Software para control del pagos</p>`.
- [x] El panel derecho no contiene "INGRESO COMO" ni las opciones "Personal"/"Familia". — ✅ El texto completo de la página no contiene "INGRESO COMO", "Personal" ni "Familia".
- [x] El panel derecho muestra h1 "Iniciar sesión", subtítulo "Ingresa para gestionar tus pagos.", etiquetas EMAIL y CONTRASEÑA, enlace "¿Olvidaste tu contraseña?", botón "Iniciar sesión" y pie "¿Te invitó la empresa? Activa tu cuenta". — ✅ Snapshot de accesibilidad: los seis textos coinciden carácter a carácter con el copy del spec.
- [x] El campo EMAIL está vacío y usa `placeholder="tu@empresa.com"`; el campo CONTRASEÑA es `type="password"`. — ✅ `#email`: `value=""`, `placeholder="tu@empresa.com"`, `type="email"`; `#password`: `type="password"`.
- [x] El formulario no envía nada: sin `action`, sin `onSubmit`, sin Server Action; el botón es `type="button"` y los enlaces apuntan a `#`. — ✅ `<form>` sin atributo `action` (`getAttribute('action')` → `null`), `form.onsubmit === null`; el botón es `type="button"`; los dos `<a>` tienen `href="#"`.
- [x] Computed styles verificados (no a ojo): fondo del panel izquierdo `rgb(248, 247, 247)`, fondo del derecho `rgb(253, 252, 252)`, botón sin `box-shadow` y con radio 4px, y `font-family` resolviendo a `--font-geist-mono`. — ✅ `getComputedStyle`: `.login-brand` → `rgb(248, 247, 247)`; `.login-form-panel` → `rgb(253, 252, 252)`; `.login-button` → `boxShadow: "none"`, `borderRadius: "4px"`; botón e input → `"Geist Mono", "Geist Mono Fallback", ui-monospace, …`, que es exactamente el valor de `--font-geist-mono`.
- [x] Ningún elemento de `/login` tiene gradiente ni sombra. — ✅ Barrido de todos los elementos de la página: 0 con `background-image` de tipo gradiente, 0 con `box-shadow ≠ none`, 0 con `text-shadow ≠ none`.
- [x] A ≤850px el layout colapsa a una columna sin solapamientos ni scroll horizontal. — ✅ A 850px: `grid-template-columns: 850px`, brand `bottom=296` = panel `top=296` (sin solape), `scrollWidth=850=innerWidth`. A 851px vuelve a `425.5px 425.5px`; a 375px y 320px una columna, sin solape ni scroll horizontal. Capturas `.playwright-mcp/verify-04-login-850.png`, `verify-04-login-375.png`.
- [x] `/login` no se oscurece cuando el sistema operativo está en modo oscuro. — ✅ Con `prefers-color-scheme: dark` emulado (`matchMedia('(prefers-color-scheme: dark)').matches === true`), el `color-scheme` calculado es `light` y los fondos siguen en `rgb(248, 247, 247)` / `rgb(253, 252, 252)`. Captura `.playwright-mcp/verify-04-login-dark-os.png`.
- [x] Sin errores en la consola del navegador. — ✅ `playwright_browser_console_messages(all=true, level=error)` → 0 errores en `/login`.

## Decisions

- **Sí:** route group `app/(dashboard)` para el shell y `app/(auth)` para el login. Es la opción que SPEC 01 dejó anotada y la única que saca `/login` del shell sin render condicional por `pathname`.
- **Sí:** `app/layout.tsx` queda como layout raíz puro (`<html>`/`<body>`/fuentes). Al ser `(dashboard)` y `(auth)` layouts anidados bajo el raíz —y no múltiples root layouts— no hay recarga completa al navegar entre grupos.
- **Sí:** aplicar `DESIGN.md` de forma estricta aunque la captura de referencia use coral, gradientes, radios grandes y tipografía proporcional. `AGENTS.md` lo exige y `DESIGN.md` prohíbe explícitamente gradientes, sombras, radios mayores a 4px y fuentes no monoespaciadas.
- **Sí:** panel izquierdo en `{colors.surface-soft}` con borde hairline, no en `{colors.surface-dark}`. `DESIGN.md` reserva la superficie oscura para el mockup TUI del hero y prohíbe usarla en contenido de cuerpo.
- **Sí:** el panel izquierdo contiene solo título y subtítulo; se descartan el logo, el pie "Guardería Sala Soles" y el selector "Ingreso como" con sus opciones "Personal"/"Familia".
- **Sí:** copy adaptado al dominio de pagos con tuteo neutro ("Ingresa para gestionar tus pagos.", "¿Te invitó la empresa? Activa tu cuenta") en lugar del copy de guardería de la captura, que además mezclaba voseo ("Ingresá") y tuteo ("¿Olvidaste…?"). La empresa es peruana (ver `CONTEXT.md`).
- **Sí:** "ERP GESTION COMERCIAL" y "Software para control del pagos" se transcriben verbatim, sin corregir "del pagos".
- **Sí:** campo EMAIL vacío con `placeholder="tu@empresa.com"`; se descarta precargar `caro@opendaycare.com`, que además es de otro dominio.
- **Sí:** el hero `{typography.display-xl}` es el título del panel izquierdo; "Iniciar sesión" usa `{typography.heading-md}`. `DESIGN.md` reserva `display-xl` para un único titular de página y no hay token intermedio.
- **Sí:** tokens `--gp-*` promovidos a `globals.css` como fuente única; `adminlte-theme.css` conserva solo los overrides `--bs-*` y las reglas de componentes AdminLTE.
- **Sí:** `color-scheme: light` y retirada del `@media (prefers-color-scheme: dark)` de `globals.css`. `DESIGN.md` define una sola superficie clara y SPEC 01 ya decidió solo light.
- **Sí:** vista presentacional pura: sin Auth, sin Supabase, sin Server Actions, sin redirección y sin protección de rutas.
- **Sí:** a ≤850px el grid colapsa a una columna con el panel izquierdo como banda superior compacta (título + subtítulo), en lugar de ocultarlo. Conserva el copy y no requiere pantallas nuevas.
- **No:** render condicional del shell por `pathname`. Requiere un client component en el raíz y ensucia la separación entre grupos.
- **No:** Auth real, sesión, middleware y RLS. Spec propia.
- **No:** corregir la moneda EUR → PEN ni tocar `Payment.customer` (deuda heredada de SPEC 02/03).

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Mover `app/page.tsx` y `app/terceros/` rompe imports | El alias `@/*` apunta a la raíz del repo, no a `app/`, así que los imports `@/components/...` y `@/lib/...` no cambian. Verificar con `npx tsc --noEmit` tras mover. |
| `app/terceros/page.tsx` declara `dynamic = "force-dynamic"` y usa Server Actions | Mover el archivo no altera el segmento de ruta ni el comportamiento dinámico. Se re-verifica el CRUD con Playwright. |
| El `<Script>` de Bootstrap deja de vivir en el layout raíz | Se coloca dentro del `<body>` de `app/(dashboard)/layout.tsx`; el login no lo necesita. Verificar que los modales de Terceros siguen abriendo. |
| Promover los tokens a `globals.css` altera el orden de cascada del skin | `globals.css` se importa en el raíz (antes que `adminlte-theme.css` en el layout del dashboard), así que los overrides `--bs-*` siguen ganando. Verificar el dashboard visualmente. |
| Tailwind v4 preflight dentro de `globals.css` pisa los estilos del login | `login.css` se importa después y define sus reglas sobre `var(--gp-*)`. Se verifica con computed styles, no a ojo. |
| `/login` queda alcanzable pero desconectado de `/` | Es intencional en esta spec: la navegación y la guarda de sesión llegan con Auth. |
| `100dvh` en navegadores antiguos | Declarar `min-height: 100vh` antes de `min-height: 100dvh` como fallback. |

## What is **not** in this spec

- Auth/login real, Supabase Auth, sesión, cookies, `@supabase/ssr`, middleware y políticas RLS por `auth.uid()`.
- Server Actions, validación de credenciales, mensajes de error y estados de carga del formulario.
- Redirección `/` → `/login`, protección de rutas y guardas de sesión.
- Registro, recuperación de contraseña y activación de cuenta funcionales.
- Alta de `/login` en el menú lateral.
- Tests automatizados: la verificación es `build` + `lint` + `tsc` + un pase con Playwright.

Cada uno de esos, si llega, va en su propia spec.
