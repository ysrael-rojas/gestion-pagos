# Crear y administrar usuarios

La aplicación es de **una sola empresa** y **solo el dueño crea cuentas**. Lo que cambió respecto
del proyecto de origen: no hay panel de Supabase Auth, ni `signup_disabled`, ni configuración del
proveedor de identidad. La identidad vive en `auth.users` (la tabla canónica del monorepo, S15) y
las credenciales en `auth.account`; las dos las escribe Better Auth, que corre dentro de `apps/api`
montado en `/api/auth/*`.

## Estado real de la regla "no hay registro público"

Sin adornos, porque una regla que no existe no se documenta como si existiera:

| | Realidad |
| --- | --- |
| web | **no hay pantalla de registro**: `/login` es la única ruta de autenticación y el formulario solo inicia sesión |
| API | `POST /api/auth/sign-up/email` está **habilitado** (`emailAndPassword: { enabled: true }` en `apps/api/src/auth/auth.ts`, sin `disableSignUp`) |
| quién puede darse de alta | cualquiera que alcance el puerto del API (`:3001` por default) |

O sea: la restricción es de interfaz, no de servidor. Mientras el API escuche solo en tu máquina la
diferencia es menor; el día que se exponga, "solo el dueño crea cuentas" no se cumple. Cerrarlo es
una línea (`emailAndPassword.disableSignUp: true` en `apps/api/src/auth/auth.ts`), y tiene un costo
que hay que decidir antes: `apps/web/e2e/` da de alta un dueño desechable por spec (10 specs) y
`apps/api/test/support/fixtures.ts` (`signUpSecondOwner`) hace lo mismo, los dos por ese endpoint.
Deshabilitarlo rompe las dos suites tal como están escritas hoy.

## Contraseñas

- Mínimo **8** caracteres: es el default de Better Auth y el monorepo **no lo cambia**. Por debajo,
  el alta responde `400` con `Password too short`.
- Máximo **128** (`maxPasswordLength`, default).
- La regla de la casa es **12** (la del proyecto de origen). Se aplica agregando
  `minPasswordLength: 12` a `emailAndPassword` en `apps/api/src/auth/auth.ts`; mientras no esté ahí,
  la única contraseña que se rechaza por corta es la de menos de 8.
- **No hay verificación por correo** ni transporte de correo en el monorepo: `emailVerification` no
  está configurado y no hay proveedor de mail. Un usuario creado por el endpoint queda con
  `email_verified = false`, y la app nunca lo bloquea por eso.
- **No hay protección de contraseñas filtradas**: no existe consulta a un directorio de claves
  comprometidas. En el origen era una opción del panel con plan pago; acá no hay equivalente.
- **No hay flujo "olvidé mi contraseña"**: `sendResetPassword` no está configurado, así que Better
  Auth no tiene cómo mandar el correo. La recuperación es la de más abajo (SQL).

## Crear un usuario (camino recomendado)

Un POST al handler de Better Auth. Exige la cabecera `Origin` (protección CSRF): sin ella responde
`403 Missing or null Origin`, y con un origen que no esté en `BETTER_AUTH_TRUSTED_ORIGINS`, `403`.

```bash
curl -i -X POST http://127.0.0.1:3001/api/auth/sign-up/email \
  -H 'content-type: application/json' \
  -H 'origin: http://127.0.0.1:3000' \
  -d '{"name":"Nombre del dueño","email":"dueno@example.test","password":"<12 caracteres o mas>"}'
```

- `name`, `email` y `password` son obligatorios para este endpoint (`email` tiene que ser válido).
- Efecto: una fila en `auth.users`, una en `auth.account` (`provider_id = 'credential'`, con el hash
  de la contraseña) y una sesión en `auth.session` — el alta inicia sesión. La respuesta trae
  `user.id`, que es el `owner_id` de todo lo que ese dueño cree después.
- El dueño nuevo arranca con la base vacía (RLS aísla por `owner_id = auth.uid()`) y **sin
  catálogos**: `POST /catalogs/ensure` (con la cookie de sesión) los crea —los mismos 3 métodos de
  pago y 13 categorías que siembra `seed-demo.sql`— y es idempotente: la segunda llamada devuelve
  `0/0`.
- La contraseña en claro solo viaja en el request; no hay ningún archivo del repo con credenciales.

## Crear un usuario por SQL

Posible, y es el camino que usan los seeds, pero **las credenciales las escribe Better Auth**: un
usuario insertado sin `auth.account` no puede iniciar sesión (es exactamente el caso del usuario
demo). La forma de las dos tablas:

| `auth.users` | tipo | notas |
| --- | --- | --- |
| `id` | `uuid` pk | default `gen_random_uuid()`; Better Auth lo genera en la app como UUID |
| `name` | `text` | nullable en la tabla, obligatorio en el endpoint |
| `email` | `text` not null | índice único sobre `lower(email)`: el correo es único sin importar mayúsculas |
| `email_verified` | `boolean` not null | default `false`; la app no lo exige |
| `image` | `text` | nullable |
| `created_at`, `updated_at` | `timestamptz` not null | default `now()` |

| `auth.account` | tipo | notas |
| --- | --- | --- |
| `id` | `text` pk | lo genera Better Auth |
| `user_id` | `uuid` not null → `auth.users(id)` **on delete cascade** | |
| `account_id` | `text` not null | para `credential` es el mismo `user_id` |
| `provider_id` | `text` not null | `'credential'` para correo + contraseña |
| `password` | `text` | el hash, nunca la contraseña |

El hash es `scrypt` de Node con `N=16384, r=16, p=1, dkLen=64`, contraseña normalizada a NFKC,
guardado como `<salt hex de 16 bytes>:<clave hex de 64 bytes>`. Para generarlo:

```bash
node --input-type=module -e '
import { randomBytes, scryptSync } from "node:crypto";
const pwd = process.argv[1];
const salt = randomBytes(16).toString("hex");
const key = scryptSync(pwd.normalize("NFKC"), salt, 64,
  { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 }).toString("hex");
console.log(`${salt}:${key}`);
' '<contraseña>'
```

y después, con ese valor (el mismo uuid en los tres lugares):

```sql
begin;
insert into auth.users (id, name, email, email_verified)
values ('<uuid>', 'Nombre del dueño', 'dueno@example.test', true);

insert into auth.account (id, account_id, provider_id, user_id, password)
values (gen_random_uuid()::text, '<uuid>', 'credential', '<uuid>', '<salt:clave>');
commit;
```

No hay endpoint de administración: Better Auth no tiene el plugin `admin` instalado, así que
`apps/api` no expone "crear usuario" ni "cambiar la contraseña de otro". Los caminos son estos dos.

## Restablecer la contraseña

1. Generá el hash con el comando de arriba.
2. `update auth.account set password = '<salt:clave>', updated_at = now() where provider_id = 'credential' and user_id = '<uuid>';`
3. Opcional y recomendable: `delete from auth.session where user_id = '<uuid>';` para que las
   sesiones abiertas con la clave vieja dejen de valer.

Si el usuario no tiene fila en `auth.account` (el demo, por ejemplo), el `update` no hace nada: hay
que insertarla como en la sección anterior.

## Borrar un usuario

No hay botón ni endpoint: es SQL, y la cascada **no alcanza para todo**. De `auth.users` cuelgan
siete `owner_id` con `on delete cascade` (`bank_reconciliation`, `cash_account`, `comprobante`,
`entidad`, `payment`, `payment_allocation`, `voucher_series`) y arrastra `auth.session` y
`auth.account`. Pero:

| tabla | `owner_id` | efecto de borrar `auth.users` |
| --- | --- | --- |
| las siete de arriba | FK con cascade | se borran |
| `cash_count` | FK **sin** cascade | **el delete falla**: `violates foreign key constraint "cash_count_owner_id_fkey"` |
| `cash_close`, `cash_transfer`, `petty_cash_vale` | sin FK a `auth.users`; referencian `cash_account` sin cascade | **el delete falla**: la cascada intenta borrar la cuenta y choca con ellas |
| `app_setting`, `cash_receipt_category`, `payment_method` | sin FK | **quedan huérfanas** (el `owner_id` apunta a un usuario que ya no existe), sin error |

El orden que funciona es el que usa el teardown del e2e (`apps/web/e2e/support/owner.ts`,
`deleteOwnerFixtures`), de hijos a padres:

```sql
-- confirmá el uuid primero
select id, email, created_at from auth.users order by created_at;

begin;
delete from public.payment_allocation    where owner_id = '<uuid>';
delete from public.petty_cash_vale       where owner_id = '<uuid>';
delete from public.payment               where owner_id = '<uuid>';   -- RESTRICT desde allocation
delete from public.comprobante           where owner_id = '<uuid>';
delete from public.entidad               where owner_id = '<uuid>';
delete from public.cash_count            where owner_id = '<uuid>';   -- FK sin cascade
delete from public.cash_close            where owner_id = '<uuid>';   -- bloquea cash_account
delete from public.cash_transfer         where owner_id = '<uuid>';
delete from public.cash_account          where owner_id = '<uuid>';
delete from public.payment_method        where owner_id = '<uuid>';   -- sin FK: no cascadea
delete from public.cash_receipt_category where owner_id = '<uuid>';   -- sin FK: no cascadea
delete from public.app_setting           where owner_id = '<uuid>';   -- sin FK: no cascadea
delete from public.bank_reconciliation   where owner_id = '<uuid>';
delete from auth.users                   where id = '<uuid>';         -- arrastra sesiones y cuenta
commit;
```

Corré el `begin`/`commit` completo: un delete a medias deja al dueño sin datos y con cuenta.

## Aviso: el usuario demo no tiene contraseña, a propósito

`packages/db/seeds/00-demo-user.sql` inserta `yrra_rojas@hotmail.com` en `auth.users` con UUID fijo
y **sin fila en `auth.account`**. Existe para que los seeds y las ocho claves foráneas tengan un
`owner_id`, no para iniciar sesión: un login con cualquier contraseña falla, y un sign-up con ese
correo también (el email ya existe y es único). Si necesitás entrar como la demo, insertá su
`auth.account` como en "Restablecer la contraseña".

## Regla importante: no crear un segundo usuario todavía

El aislamiento es `owner_id = auth.uid()`: **cada usuario ve su propio conjunto de datos**. Un
segundo usuario (cajero, socio) no verá las ventas, compras ni cajas del dueño; va a ver un sistema
vacío. Antes de crear el segundo usuario hace falta la spec de **empresa + roles** (`company_id`
compartido, roles admin/cajero). Hoy el único uso legítimo de un segundo usuario es un dueño
desechable en tests y en el e2e.

## Verificación rápida

```bash
# la web no tiene registro: solo /login
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/registro          # 404

# el API sí acepta el alta con Origin; sin Origin responde 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3001/api/auth/sign-up/email \
  -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3000' \
  -d '{"name":"Prueba","email":"prueba@example.test","password":"<12 caracteres o mas>"}'

# quiénes existen (psql local, o dentro del contenedor)
psql "$DATABASE_URL" -c 'select id, email, email_verified, created_at from auth.users order by created_at;'
docker exec -it gestion-pagos-db-dev psql -U <usuario> -d <base> \
  -c 'select id, email, email_verified, created_at from auth.users order by created_at;'
```
