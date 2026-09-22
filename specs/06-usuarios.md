# SPEC 06 — Administración de usuarios (`/usuarios`)

> **Estado:** Aprobado
> **Depende de:** SPEC 05
> **Fecha:** 2026-09-17
> **Objetivo:** Añadir la pantalla `/usuarios`, reservada al rol `administrador`, para dar de alta Usuarios, editar su nombre y su rol, y activarlos o desactivarlos, reutilizando el patrón de listado y modales de Terceros.

## Why this spec exists

SPEC 05 dejó el mecanismo de roles y permisos pero ningún modo de gestionarlos: los Usuarios solo nacen por script. Sin una pantalla, el administrador no puede dar de alta a nadie, y el criterio de aceptación de SPEC 05 sobre permisos solo es verificable con usuarios sembrados a mano.

SPEC 02 estableció el patrón de CRUD en modal (`terceros-lista`, `tercero-form-modal`, `tercero-confirm-modal` sobre `modal-bootstrap.ts`) y SPEC 05 dejó la autorización en la DAL. Esta spec aplica ambos a Usuarios.

## Scope

**In:**

- Ruta `/usuarios` en el route group `(dashboard)`, protegida por `requerirPermiso("gestionar_usuarios")`.
- Ítem de menú `ADMINISTRACIÓN` → `USUARIOS` en `lib/menu.ts`, declarado con el permiso `gestionar_usuarios`.
- Listado con las columnas **Nombre · Email · Rol · Estado · Último acceso**.
- Alta de Usuario en modal: email, nombre, rol y contraseña temporal.
- Edición en modal: nombre y rol.
- Activación y desactivación con modal de confirmación.
- Guardas contra el bloqueo total, aplicadas **en el servidor** y reflejadas en la UI.
- Validación de los datos en `lib/usuarios/dominio.ts`, con el mismo contrato `Resultado<T>` de Terceros.

**Out of scope (specs futuras):**

- Eliminar Usuarios. Solo hay borrado lógico, coherente con Tercero.
- Invitaciones por correo, enlaces de activación y cambio de contraseña. El administrador fija la contraseña inicial.
- Edición del email de un Usuario.
- Perfil propio ("mi cuenta") y cambio de contraseña por el propio Usuario.
- Auditoría de quién cambió qué y cuándo.
- Paginación del lado del servidor.
- Tests automatizados.

## Data model

Esta spec **no crea tablas**: `public.users` y el enum `user_role` llegan de SPEC 05. Lo que define es el vocabulario y las reglas de negocio en código.

### Tipo `Usuario`

`lib/usuarios/dominio.ts`:

| Campo | Tipo | Origen |
| --- | --- | --- |
| `id` | `string` | `public.users.id` |
| `nombre` | `string` | `public.users.name` |
| `correo` | `string` | `auth.users.email`, vía Admin API |
| `rol` | `RolUsuario` | `public.users.role` |
| `activo` | `boolean` | `public.users.active` |
| `ultimoAcceso` | `string \| null` | `auth.users.last_sign_in_at`, vía Admin API |
| `creadoEn` | `string` | `public.users.created_at` |

### Dos fuentes, unidas en el servidor

`listarUsuarios()` une en memoria:

1. `public.users` (nombre, rol, estado, alta) con el cliente administrativo.
2. `auth.admin.listUsers()` (email, último acceso).

Se recorre `listUsers` por páginas (`{ page, perPage }`) hasta que devuelve menos de `perPage`, para no truncar el listado en silencio. Los usuarios de Auth sin fila en `public.users` se ignoran: el trigger `handle_new_user` garantiza que no existan, y si apareciera alguno es un residuo que no debe mostrarse como si tuviera perfil.

No se duplica el email en `public.users` (decisión de SPEC 05).

### Reglas de negocio y guardas

Funciones puras en `lib/usuarios/dominio.ts`, para que las reglas sean verificables sin tocar la base de datos:

- `puedeCambiarRol(actor, objetivo)` — `false` si `actor.id === objetivo.id`.
- `puedeCambiarEstado(actor, objetivo, adminsActivos)` — `false` si `actor.id === objetivo.id`, y `false` si el objetivo es `administrador` activo y `adminsActivos === 1`.
- `esUltimoAdminActivo(objetivo, adminsActivos)` — `true` cuando desactivarlo o degradarlo dejaría el sistema sin ningún administrador activo.

**Las guardas se aplican en la Server Action, no solo en la UI.** Un POST directo a la acción con el propio `id` del llamador debe devolver error y no cambiar nada.

### Validación del alta

| Campo | Regla | Mensaje |
| --- | --- | --- |
| `correo` | Formato de correo | "Introduce un correo válido." |
| `correo` | No existir ya en Auth | "Ya existe un Usuario con ese correo." |
| `nombre` | Al menos 2 caracteres, sin espacios extremos | "El nombre debe tener al menos 2 caracteres." |
| `rol` | Uno de `administrador`, `operador` | "Selecciona un rol válido." |
| `contrasena` | Al menos 8 caracteres | "La contraseña debe tener al menos 8 caracteres." |

### Copy de la pantalla

| Ubicación | Texto |
| --- | --- |
| Título y breadcrumb | Usuarios |
| Columna | Nombre · Email · Rol · Estado · Último acceso |
| Estado | Activo · Inactivo |
| Botón de alta | Nuevo usuario |
| Modal de alta — título | Nuevo usuario |
| Modal de edición — título | Editar usuario |
| Etiquetas | EMAIL · NOMBRE · ROL · CONTRASEÑA TEMPORAL |
| Botón de guardar | Guardar |
| Modal de confirmación (desactivar) | ¿Desactivar a «{nombre}»? No podrá iniciar sesión hasta que lo reactives. |
| Modal de confirmación (activar) | ¿Reactivar a «{nombre}»? Volverá a poder iniciar sesión. |
| Guarda: fila propia | No puedes cambiar tu propio rol |
| Guarda: fila propia | No puedes desactivar tu propia cuenta |
| Guarda: último admin | Debe quedar al menos un administrador activo |

## Implementation plan

1. **Dominio.** `lib/usuarios/dominio.ts`: tipo `Usuario`, `DatosAltaUsuario`, `DatosEdicionUsuario`, `normalizarCampos`, `validarAlta`, `validarEdicion`, las tres guardas y `Resultado<T>`, replicando la forma de `lib/terceros/dominio.ts`. El catálogo de roles (`ROLES_USUARIO`, `ETIQUETAS_ROL`) se importa de `lib/auth/permisos.ts`, que SPEC 05 define como fuente única; no se duplica aquí.
2. **Acciones.** `lib/usuarios/acciones.ts` marcado `"use server"`:
   - `listarUsuarios(): Promise<Usuario[]>` — une las dos fuentes como se describe arriba.
   - `crearUsuario(datos): Promise<Resultado<Usuario>>` — valida, llama a `crearClienteAdmin().auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { name } })` y después actualiza `public.users` con nombre, rol y `active = true`. Traduce el error de correo duplicado al mensaje de campo correspondiente.
   - `actualizarUsuario(id, datos): Promise<Resultado<Usuario>>` — valida, aplica la guarda de rol propio y actualiza nombre y rol.
   - `cambiarActivoUsuario(id, activo): Promise<Resultado<Usuario>>` — valida las guardas contra el número de administradores activos y actualiza `active`.
   - **Todas** empiezan con `await requerirPermiso("gestionar_usuarios")`. `crearUsuario` y `cambiarActivoUsuario` fallan en cerrado: si algo va mal después de tocar Auth, el Usuario queda con `active = false` y no puede acceder.
3. **Listado.** `components/usuarios/usuarios-lista.tsx` como client component, con el mismo patrón que `terceros-lista.tsx`: `Table` + `Badge` + `Pagination` + `Button` de `@adminlte/react`, `useState` para los modales y las llamadas a las Server Actions. Muestra **todos** los Usuarios con la columna Estado (sin toggle "mostrar inactivos": en una lista corta de administración el estado es información, no ruido). Paginación de 10 en 10.
4. **Modales.** `components/usuarios/usuario-form-modal.tsx` (alta y edición en un solo componente, con `modo` como prop, siguiendo `tercero-form-modal.tsx`) y `components/usuarios/usuario-confirm-modal.tsx`, ambos sobre `components/terceros/modal-bootstrap.ts`. Los botones deshabilitados por guarda llevan `title` con el motivo, y el modal de edición muestra el motivo en texto cuando el rol está bloqueado.
5. **Página.** `app/(dashboard)/usuarios/page.tsx` como Server Component con `metadata.title = "Usuarios"`, `export const dynamic = "force-dynamic"`, `await requerirPermiso("gestionar_usuarios")`, `AppContent` con título y breadcrumbs, y el listado con `iniciales`.
6. **Menú.** `lib/menu.ts`: nuevo `MenuGroup` "ADMINISTRACIÓN" con el ítem `USUARIOS` → `/usuarios`, declarado con `permiso: "gestionar_usuarios"` para que `construirMenu(rol)` lo oculte al operador.
7. **Verificación.** `npm run lint`, `npx tsc --noEmit`, `npm run build`; luego `npm run dev` con Playwright para los criterios de abajo, con capturas en `.playwright-mcp/`.

## Acceptance criteria

- [ ] `npm run build`, `npm run lint` y `npx tsc --noEmit` terminan sin errores.
- [ ] Existen `app/(dashboard)/usuarios/page.tsx`, `lib/usuarios/dominio.ts`, `lib/usuarios/acciones.ts` y los tres componentes de `components/usuarios/`.
- [ ] Con el Usuario `administrador`, el menú lateral muestra `ADMINISTRACIÓN` → `USUARIOS`; con el Usuario `operador` no aparece.
- [ ] `/usuarios` lista todos los Usuarios con las cinco columnas, incluidos los inactivos.
- [ ] La columna Email muestra el correo real de cada Usuario y el "Último acceso" cambia tras un inicio de sesión.
- [ ] El administrador da de alta un Usuario nuevo desde la UI, aparece en el listado como Activo, y ese Usuario puede iniciar sesión y aterrizar en `/`.
- [ ] Un alta con correo repetido muestra "Ya existe un Usuario con ese correo." en el campo EMAIL y no crea nada: ni fila en `public.users` ni Usuario en Auth.
- [ ] Un alta con contraseña de 7 caracteres muestra "La contraseña debe tener al menos 8 caracteres." y no crea nada.
- [ ] Un alta con nombre de 1 carácter muestra el error de nombre y no crea nada.
- [ ] Editar el nombre persiste en `public.users` y en el listado tras recargar.
- [ ] Editar el rol persiste, y el menú del Usuario afectado cambia en su siguiente inicio de sesión.
- [ ] En la fila del propio administrador, el selector de rol y el botón de desactivar están deshabilitados y explican el motivo.
- [ ] El único administrador activo no puede ser degradado ni desactivado: la acción devuelve error y `public.users` no cambia.
- [ ] Invocar `cambiarActivoUsuario` por POST directo con el `id` del propio llamador devuelve error y no cambia ninguna fila.
- [ ] Invocar cualquiera de las acciones sin sesión, o con el rol `operador`, no modifica nada.
- [ ] Desactivar a un Usuario lo marca Inactivo en el listado y le impide iniciar sesión; reactivarlo se lo permite de nuevo.
- [ ] No existe ningún control de borrado de Usuarios en la pantalla.
- [ ] Los modales de alta, edición y confirmación abren y cierran, y los errores por campo se muestran junto al campo correspondiente.
- [ ] Consola del navegador sin errores en `/usuarios`.

## Decisions

- **Sí:** el alta se hace desde la UI con `auth.admin.createUser` y `service_role`. Sin alta, el administrador no puede añadir a nadie y los permisos no son verificables.
- **Sí:** el administrador escribe la contraseña temporal, mínimo 8 caracteres. Los flujos de correo están fuera de alcance, así que la alternativa era generarla y mostrarla una vez, que acaba en un chat o un post-it igualmente.
- **Sí:** `email_confirm: true` en el alta. El correo de confirmación no existe como flujo en esta app y sin confirmar el Usuario no podría entrar.
- **Sí:** el email no se edita desde la UI. Cambiarlo es una operación sobre `auth.users` con consecuencias de confirmación e identidad que no están en alcance.
- **Sí:** solo desactivación, sin eliminar. Un Usuario es un registro de auditoría de quién hizo qué, y `auth.admin.deleteUser` es irreversible.
- **Sí:** guardas de bloqueo total (rol propio, desactivación propia, último administrador activo) aplicadas en el servidor y reflejadas en la UI con el motivo visible. Sin ellas, un clic deja la app sin administrador y no hay recuperación desde la UI.
- **Sí:** un solo componente de formulario con `modo` alta/edición, como en Terceros, en lugar de dos modales casi idénticos.
- **Sí:** la lista muestra todos los Usuarios con columna Estado, sin el toggle "mostrar inactivos" de Terceros. Es una pantalla de administración con pocos registros; ocultar filas por defecto solo añade un estado que recordar.
- **Sí:** `ADMINISTRACIÓN` como grupo propio en el menú, y no dentro de `MAESTRO`. Un Usuario no es dato maestro del negocio; es administración de la aplicación.
- **Sí:** unir `public.users` con `auth.admin.listUsers()` en el servidor en lugar de duplicar el email en la tabla. El "último acceso" sale gratis de la Admin API y es la información que de verdad se usa en esta pantalla.
- **No:** eliminar Usuarios.
- **No:** invitaciones, enlaces de activación y cambio de contraseña.
- **No:** editar el email.
- **No:** auditoría de cambios y paginación en servidor.

## Risks

| Riesgo | Mitigación |
| --- | --- |
| Si la actualización del perfil falla después de `createUser`, queda un Usuario en Auth sin rol ni activación | Falla en cerrado: `active` queda en `false` y no puede acceder. El listado lo muestra como Inactivo y el administrador puede editarlo. El alta es idempotente sobre el email. |
| La UI puede crear identidades en Auth con `service_role` | Es el propósito de la pantalla y está detrás de `requerirPermiso("gestionar_usuarios")`. La clave nunca llega al navegador. |
| El administrador conoce la contraseña inicial del Usuario que crea | Consecuencia de descartar los flujos de correo. Se acepta y se documenta. |
| `auth.admin.listUsers()` está paginado y por defecto devuelve un máximo de 50 | El listado recorre páginas hasta agotarlas, en lugar de asumir que una sola llamada trae todo. |
| Un Usuario de Auth sin fila en `public.users` quedaría invisible | Se ignoran en el listado. El trigger `handle_new_user` garantiza que no existan; si apareciera uno, es un residuo que conviene no mostrar como si tuviera perfil. |
| Las guardas de último administrador se evalúan leyendo y luego escribiendo: dos degradaciones simultáneas podrían dejar cero administradores | Es una app interna con pocos administradores y la ventana es de milisegundos. Se acepta; cerrarla exigiría una transacción o un bloqueo que no se justifica aquí. |
| Desactivar no invalida el token vigente del Usuario | El bloqueo es de aplicación (`active = true` en la DAL), ya documentado en SPEC 05. |
| El nuevo grupo de menú altera el orden del sidebar | Se verifica visualmente contra la captura de SPEC 01 en el mismo pase de Playwright. |

## What is **not** in this spec

- Eliminar Usuarios.
- Invitaciones, activación por correo y cambio de contraseña.
- Edición del email.
- Perfil propio del Usuario y cambio de su propia contraseña.
- Auditoría de cambios.
- Paginación en servidor.
- Tests automatizados.

Cada uno de esos, si llega, va en su propia spec.
