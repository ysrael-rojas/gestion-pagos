# SPEC 05 — Autenticación, sesión y roles

> **Estado:** Aprobado
> **Depende de:** SPEC 03, SPEC 04
> **Fecha:** 2026-09-17
> **Objetivo:** Sustituir el formulario presentacional de `/login` por autenticación real con Supabase Auth sobre cookies de servidor, proteger `(dashboard)` y establecer el mecanismo de roles y permisos, con la autorización viviendo en una Data Access Layer y no en RLS.

## Why this spec exists

SPEC 04 entregó `/login` como vista presentacional y dejó fuera, verbatim, *"Auth real: Supabase Auth, sesión, cookies, `@supabase/ssr`, middleware, RLS por `auth.uid()`"* y *"Redirección `/` → `/login`, protección de rutas y guardas de sesión"*. SPEC 03 había dejado Auth/login como *"la spec siguiente"*. ADR-0004 prometió que *"las políticas de acceso se añadirán en la spec de Auth"*.

Esta spec cierra las tres deudas. La decisión de fondo —que la autorización vive en la DAL y no en RLS— se registra en ADR-0005, y el modelo de roles en ADR-0006.

Además, esta spec **modifica deliberadamente el entregable de SPEC 04**: el botón deja de ser `type="button"` y el `<form>` gana una Server Action. No es una regresión silenciosa; es el punto de esta spec.

## Scope

**In:**

- Instalar `@supabase/ssr` en versión exacta y crear los tres clientes: navegador, servidor con sesión y servidor administrativo.
- Server Action de inicio de sesión en `/login` con mensaje de error inline y estado pendiente.
- Server Action de cierre de sesión, invocada desde la topbar del dashboard.
- Sesión persistente en cookies, refrescada en cada request.
- Protección de todo el route group `(dashboard)`: sin sesión, redirect a `/login`.
- `/login` con sesión activa redirige a `/`.
- Tabla `public.users` con el perfil del Usuario (nombre, rol, estado) y enum nativo `user_role`.
- Trigger `handle_new_user` que garantiza que ningún Usuario de Auth existe sin perfil.
- Mecanismo de roles y permisos: RBAC cerrado, un rol por Usuario, mapa rol → permisos en código.
- DAL: `obtenerUsuarioActual()`, `requerirUsuario()`, `requerirPermiso()`, invocada en páginas **y** en cada Server Action.
- Identidad del Usuario en la topbar (nombre, rol, imagen) y botón de cierre de sesión.
- Menú lateral filtrado por permiso.
- Página `/sin-permiso` para el acceso por URL directa sin permiso.
- Script de bootstrap de los usuarios de prueba.

**Out of scope (specs futuras):**

- Recuperación de contraseña, activación de cuenta y registro. Los enlaces `¿Olvidaste tu contraseña?` y `Activa tu cuenta` siguen con `href="#"`.
- Cualquier flujo de correo saliente (invitaciones, confirmación, magic links).
- OAuth, MFA, SSO.
- La UI de administración de usuarios: va en SPEC 06.
- Revocación explícita de sesiones y acortado de la vida del JWT.
- Permisos por usuario, roles configurables y roles múltiples.
- Vínculo entre Usuario y Tercero.
- Tests automatizados: la verificación es `build` + `lint` + `tsc` + un pase con Playwright.

## Data model

### Enum `user_role`

Enum nativo, siguiendo el precedente de ADR-0003 para los catálogos cerrados del dominio. Dos valores: `administrador`, `operador`. Los permisos **no** son una tabla: se derivan del rol en código.

### Tabla `public.users`

Perfil del Usuario. `id` es el mismo de `auth.users`, no un identificador propio.

| Columna | Tipo | Notas |
| --- | --- | --- |
| `id` | `uuid` | PK, `references auth.users (id) on delete cascade` |
| `name` | `text` | Nombre visible en la topbar. `check (char_length(btrim(name)) >= 2)` |
| `role` | `user_role` | Exactamente un rol |
| `active` | `boolean` | **`default false`**. La activación es explícita |
| `created_at` | `timestamptz` | `default now()` |
| `updated_at` | `timestamptz` | `default now()`, mantenido por `public.set_updated_at()` |

**El email no se duplica.** Vive solo en `auth.users` y llega en los claims de la sesión. Duplicarlo crearía dos fuentes que se desincronizan cuando alguien cambia su correo en Auth.

Migración: `supabase/migrations/20260917000003_create_users.sql`, con el mismo estilo que `20260917000001_create_third_parties.sql` (constraints nombradas, `comment on` en español, `set_updated_at()` reutilizado).

### Trigger `handle_new_user`

`after insert on auth.users`, función `security definer` con `set search_path = ''`.

Crea el perfil con **valores fijos**: `name = coalesce(nullif(btrim(raw_app_meta_data ->> 'name'), ''), 'Sin nombre')`, `role = 'operador'`, `active = false`.

Dos razones, ambas de seguridad:

1. **Nunca lee el rol de `raw_user_meta_data`.** Ese campo es editable por el usuario; la guía de seguridad de Supabase lo marca como no apto para decisiones de autorización. Un trigger que copiara el rol desde ahí convertiría el registro abierto en una escalada de privilegios.
2. **`active = false` por defecto.** Si el registro quedara abierto en el dashboard, una cuenta autocreada no podría acceder a nada hasta que un administrador la active.

Es `security definer` porque GoTrue inserta en `auth.users` con un rol que no tiene privilegios sobre `public.users`. Para que no quede expuesta como RPC, se revoca su `execute`:

```sql
revoke execute on function public.handle_new_user() from public, anon, authenticated;
```

### Permisos (código, no base de datos)

`lib/auth/permisos.ts` es la fuente única. Exporta `RolUsuario`, `Permiso`, `ROLES_USUARIO`, `PERMISOS`, `ETIQUETAS_ROL` (`Administrador`, `Operador`), el mapa `PERMISOS_POR_ROL` y `tienePermiso(rol, permiso)`.

| Permiso | `administrador` | `operador` |
| --- | --- | --- |
| `ver_dashboard` | sí | sí |
| `gestionar_terceros` | sí | sí |
| `gestionar_usuarios` | sí | no |

### Contrato de la DAL

`lib/auth/sesion.ts`, marcado `server-only`:

- `obtenerUsuarioActual(): Promise<UsuarioSesion | null>` — envuelta en `cache()` de React. Valida el JWT con `getClaims()`, carga el perfil con el cliente administrativo y devuelve `{ id, correo, nombre, rol }`. Devuelve `null` si no hay sesión, si no hay perfil o si `active` es `false`.
- `requerirUsuario(): Promise<UsuarioSesion>` — `redirect("/login")` si `obtenerUsuarioActual()` es `null`.
- `requerirPermiso(permiso: Permiso): Promise<UsuarioSesion>` — `redirect("/sin-permiso")` si el rol no tiene el permiso.

Se usa `getClaims()` y no `getSession()`, porque el segundo lee el token del almacenamiento sin revalidarlo y la propia documentación de Supabase prohíbe confiar en él en servidor.

## Implementation plan

1. **Instalar `@supabase/ssr`** en versión exacta (`0.12.7`, sin `^`/`~`) y verificar el lockfile. Comprobar con `npx tsc --noEmit` que nada se rompe.
2. **Variables de entorno.** Añadir `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` a `.env` y a `.env.template` (esta última vacía). Consolidar la URL en una sola variable: `lib/supabase/server.ts` pasa a leer `NEXT_PUBLIC_SUPABASE_URL` y se retira `SUPABASE_URL` de ambos ficheros. La publishable key es pública por diseño; la `service_role` sigue sin prefijo `NEXT_PUBLIC_` y sin salir del servidor.
3. **Clientes.** `lib/supabase/client.ts` con `createBrowserClient`. En `lib/supabase/server.ts`, renombrar `crearClienteSupabase` a `crearClienteAdmin` (actualizando las cinco llamadas de `lib/terceros/acciones.ts`) y añadir `crearClienteSesion()` con `createServerClient` + `cookies()` de `next/headers`, con `getAll`/`setAll` y el `catch` vacío documentado para el caso de Server Component.
4. **Migración.** Escribir `20260917000003_create_users.sql`, aplicarla con `apply_migration` y verificar con `execute_sql` que el enum, la tabla, el trigger y los privilegios quedaron como se describe. Correr los advisors de seguridad y rendimiento.
5. **Tipos.** Regenerar `lib/database.types.ts` con el MCP.
6. **Permisos y DAL.** `lib/auth/permisos.ts` y `lib/auth/sesion.ts` como se describe arriba. Resolver el tipado de los claims (`sub` y `email` son opcionales en el JWT) sin `as` inseguros.
7. **Refresco de sesión.** `lib/supabase/proxy.ts` con `updateSession(request)` siguiendo la guía de Supabase (crear el cliente sobre `request.cookies`, llamar a `getClaims()` sin código intermedio, devolver el `supabaseResponse` con sus cookies) y `proxy.ts` en la raíz con el matcher que excluye `_next/static`, `_next/image`, `favicon.ico` y las extensiones de imagen. `updateSession` redirige a `/login` si no hay usuario y la ruta no es `/login`, y a `/` si hay usuario y la ruta es `/login`. **No** consulta la base de datos: es un chequeo optimista de sesión.
8. **Inicio de sesión.** `app/(auth)/login/actions.ts` con la Server Action `iniciarSesion`, que valida presencia de campos, llama a `signInWithPassword` y devuelve un mensaje genérico ante cualquier fallo de credenciales. El `redirect("/")` va **fuera** de cualquier `try/catch`. `app/(auth)/login/login-form.tsx` como client component con `useActionState` y `useFormStatus`; el mensaje se renderiza con `role="alert"` y `--gp-danger`. `page.tsx` sigue siendo Server Component y solo monta el formulario.
9. **Cierre de sesión.** `lib/auth/acciones.ts` con la Server Action `cerrarSesion`, que llama a `signOut()`, revalida el layout y redirige a `/login`.
10. **Shell del dashboard.** `app/(dashboard)/layout.tsx` pasa a `async`: llama a `requerirUsuario()`, pasa `user={{ name, role, image }}` a `DashboardLayout` y un `<form action={cerrarSesion}>` con el botón "Cerrar sesión" en `topbarEnd`, con las clases de botón que ya usa el shell. Se conserva el data-URI transparente como imagen.
11. **Menú por permiso.** `lib/menu.ts`: cada `MenuItem` declara su `permiso` y se exporta `construirMenu(rol)`. El layout consume `construirMenu(usuario.rol)`.
12. **Página `/sin-permiso`.** `app/(dashboard)/sin-permiso/page.tsx`, dentro del shell, con el copy "No tienes permiso para ver esta sección." y un enlace a `/`.
13. **Guardas en las Server Actions existentes.** Añadir `await requerirPermiso("gestionar_terceros")` al inicio de cada acción de `lib/terceros/acciones.ts` y `await requerirUsuario()` en `listarTerceros`. La lección de Next 16: una Server Action es alcanzable por POST directo y el proxy no la cubre.
14. **Script de bootstrap.** `scripts/crear-usuarios-prueba.mjs`, ejecutado con `node --env-file=.env`, que crea por la Admin API los dos usuarios de prueba con `email_confirm: true` y luego actualiza `public.users` con su nombre, rol y `active = true`. Idempotente: si el correo ya existe, actualiza el perfil en vez de fallar.
15. **Verificación.** `npm run lint`, `npx tsc --noEmit`, `npm run build`; luego `npm run dev` con Playwright para los diez criterios de abajo, con capturas en `.playwright-mcp/`.

## Acceptance criteria

- [ ] `npm run build`, `npm run lint` y `npx tsc --noEmit` terminan sin errores.
- [ ] `@supabase/ssr` figura en `package.json` con versión fija, sin rango `^`/`~`.
- [ ] Existen en la base de datos el enum `public.user_role` con `administrador` y `operador`, la tabla `public.users` con sus cinco constraints y el trigger `handle_new_user` sobre `auth.users`.
- [ ] `public.users` tiene RLS activo, cero políticas y `anon`/`authenticated` sin privilegios; la función `handle_new_user` no es ejecutable por `public`, `anon` ni `authenticated`.
- [ ] `lib/database.types.ts` incluye `public.users` y `public.user_role`.
- [ ] Con la `publishable key` y sin sesión, `GET /` responde redirigiendo a `/login`.
- [ ] Con la `publishable key` y sin sesión, `GET /terceros` responde redirigiendo a `/login`.
- [ ] Credenciales incorrectas en `/login` muestran "Correo o contraseña incorrectos." con `role="alert"`, sin insertar sesión y sin revelar si el correo existe.
- [ ] El botón de `/login` muestra estado pendiente y queda deshabilitado mientras la Server Action está en vuelo.
- [ ] Iniciar sesión con `ysrael@google.com` aterriza en `/`, y `location.pathname` es exactamente `/`.
- [ ] Con sesión activa, `GET /login` redirige a `/`.
- [ ] La topbar muestra "Ysrael Rojas" y "Administrador"; el usuario anónimo por defecto de AdminLTE ("Alexander Pierce") no aparece en ninguna página.
- [ ] El botón "Cerrar sesión" de la topbar cierra la sesión, aterriza en `/login` y a partir de ahí `/` vuelve a redirigir a `/login`.
- [ ] Con el usuario `operador@google.com`, el menú lateral no contiene "USUARIOS" y `GET /usuarios` renderiza `/sin-permiso`.
- [ ] Un Usuario con `active = false` y cookie de sesión vigente no accede: `GET /` redirige a `/login`.
- [ ] Las Server Actions de Terceros rechazan a un llamador sin sesión aunque se invoquen por POST directo, sin depender del proxy.
- [ ] La cadena de `SUPABASE_SERVICE_ROLE_KEY` no aparece en `.next/static`.
- [ ] Consola del navegador sin errores en `/login`, `/`, `/terceros` y `/sin-permiso`.
- [ ] El panel de dos columnas de `/login` a 850px sigue colapsando a una columna, sin scroll horizontal (no regresa SPEC 04).

## Decisions

- **Sí:** sesión real con `@supabase/ssr` sobre cookies, y no un token en `localStorage`. Permite que el servidor conozca la identidad en el primer render y que las Server Actions verifiquen al llamador.
- **Sí:** `getClaims()` y no `getSession()`. `getSession()` lee el token del almacenamiento sin revalidarlo; la documentación de Supabase prohíbe confiar en él en servidor.
- **Sí:** `proxy.ts` (no `middleware.ts`). Next 16 deprecó el nombre `middleware` y lo renombró a `proxy`; el runtime es Node.js y no es configurable.
- **Sí:** el proxy hace **solo** el chequeo optimista de sesión, sin tocar la base de datos. La comprobación real va en la DAL, junto al dato, como recomienda la guía de autenticación de Next 16.
- **Sí:** la DAL se invoca en cada página **y** en cada Server Action. Una Server Action es alcanzable por POST directo y el matcher del proxy no la cubre.
- **Sí:** la autorización vive en código con `service_role`, y no en políticas RLS. Ver ADR-0005.
- **Sí:** RBAC cerrado con un rol por Usuario y permisos derivados en código. Ver ADR-0006.
- **Sí:** `public.users` sin columna `email`. El correo vive en `auth.users` y llega en los claims; duplicarlo crearía dos fuentes que se desincronizan.
- **Sí:** `handle_new_user` con `security definer`, `set search_path = ''`, `execute` revocado y valores fijos (`role = 'operador'`, `active = false`). Garantiza que no hay Usuario sin perfil sin abrir una escalada de privilegios.
- **Sí:** `active = false` por defecto, y activación explícita en el alta. Es defensa en profundidad por si el registro queda abierto en el dashboard.
- **Sí:** mensaje de error genérico único para credenciales inválidas. Propagar el error de Supabase revelaría si un correo existe.
- **Sí:** `/sin-permiso` como página propia en lugar de `forbidden()` de Next, que exige activar `experimental.authInterrupts`.
- **Sí:** cookie de sesión persistente con el valor por defecto de Supabase, sin "recordarme". Es un ERP interno de uso diario.
- **Sí:** consolidar la URL de Supabase en `NEXT_PUBLIC_SUPABASE_URL` y retirar `SUPABASE_URL`. Dos nombres para el mismo valor invitan a que se desincronicen.
- **Sí:** modificar el formulario de SPEC 04 (botón `submit` y `<form>` con action). Es el punto de esta spec; se registra aquí en lugar de dejarlo como regresión silenciosa.
- **No:** registro, recuperación de contraseña, activación de cuenta y cualquier flujo de correo. Specs propias.
- **No:** `ban_duration` de la Admin API para desactivar Usuarios. La desactivación se aplica en la DAL.
- **No:** UI de administración de usuarios. SPEC 06.
- **No:** vínculo Usuario ↔ Tercero, roles múltiples y permisos por usuario.

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Un Usuario desactivado conserva su token vigente hasta que expira | El bloqueo es de aplicación: `obtenerUsuarioActual()` exige `active = true` en cada request. Se acepta y se documenta; revocar sesiones exigiría `auth.admin.signOut` o acortar el JWT. |
| El registro podría estar abierto en el dashboard, y no hay herramienta MCP para leer ese ajuste | `handle_new_user` crea el perfil con `active = false` y `role = 'operador'` fijos, así que una cuenta autocreada no accede a nada. Cerrar el registro es un paso humano y va como checklist en la spec. |
| `security definer` en `public` es alcanzable por defecto | `revoke execute ... from public, anon, authenticated`, `set search_path = ''` y valores fijos: la función no lee nada controlado por el usuario. |
| La autorización no está en RLS | Decisión explícita (ADR-0005). El acceso directo a PostgREST con la publishable key falla igual porque los privilegios están revocados. |
| `service_role` sigue en el servidor y omite RLS | Ya era así desde SPEC 03; `import "server-only"`, variable sin prefijo `NEXT_PUBLIC_` y `.env` ignorado por git. |
| El proxy no cubre las Server Actions | La DAL se invoca dentro de cada Server Action, no solo en la página. Criterio de aceptación explícito. |
| Esta spec modifica el entregable congelado de SPEC 04 | Anotado en el scope y en las decisiones; los criterios de aceptación de SPEC 04 sobre el layout responsive se re-verifican. |
| `@supabase/ssr` 0.12.7 es una versión joven y su API cambió respecto a la documentación más difundida | Versión fijada y lockfile commiteado; el patrón `getAll`/`setAll` con `next/headers` es el vigente para Next.js según la guía oficial de Supabase. |
| `getClaims()` con claves simétricas delega en `getUser()` y añade una llamada de red | Es el comportamiento documentado y la única validación fiable en servidor; se asume el coste por request. |
| El layout de `(dashboard)` pasa a `async` y lee cookies, volviendo dinámicas las rutas | Es el coste de tener sesión. `app/(dashboard)/terceros/page.tsx` ya declara `force-dynamic`. |
| Un fallo en `setAll` desde un Server Component rompe el refresco de sesión | El `catch` vacío documentado del patrón oficial; el refresco real ocurre en `proxy.ts`. |

## What is **not** in this spec

- Registro, recuperación de contraseña, activación de cuenta, invitaciones y cualquier correo saliente.
- OAuth, MFA y SSO.
- La pantalla de administración de usuarios (SPEC 06).
- Revocación de sesiones y acortado de la vida del JWT.
- Permisos por usuario, roles configurables y roles múltiples.
- Vínculo entre Usuario y Tercero.
- Tests automatizados.

Cada uno de esos, si llega, va en su propia spec.
