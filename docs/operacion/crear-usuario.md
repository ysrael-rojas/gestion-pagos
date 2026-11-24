# Crear y administrar usuarios

La aplicación es de **una sola empresa** y **solo el dueño crea cuentas**. Lo que cambió respecto
del proyecto de origen: no hay panel de Supabase Auth, ni `signup_disabled`, ni configuración del
proveedor de identidad. La identidad vive en `auth.users` (la tabla canónica del monorepo, S15) y
las credenciales en `auth.account`; con el alta cerrada, esas dos filas se escriben por SQL (más
abajo) y Better Auth, que corre dentro de `apps/api` montado en `/api/auth/*`, las lee, escribe
`auth.session` al iniciar sesión y atiende el resto de `/api/auth/*`.

## Estado real de la regla "no hay registro público"

Sin adornos, porque una regla que no existe no se documenta como si existiera:

| | Realidad |
| --- | --- |
| web | **no hay pantalla de registro**: `/login` es la única ruta de autenticación y el formulario solo inicia sesión |
| API | `POST /api/auth/sign-up/email` está **deshabilitado**: `emailAndPassword: { enabled: true, disableSignUp: true }` en `apps/api/src/auth/auth.ts` |
| respuesta del alta | `400` con `{"message":"Email and password sign up is not enabled","code":"EMAIL_PASSWORD_SIGN_UP_DISABLED"}`, y **ninguna** fila nueva en `auth.users` |
| quién puede darse de alta | nadie por HTTP: crear un usuario es el procedimiento SQL de más abajo |
| entrar | `POST /api/auth/sign-in/email` sigue igual: es la única vía de entrada, y la que usa el formulario de `/login` |

La restricción es del servidor, no de la interfaz, así que acá ya no hay nada pendiente de decidir:
quien alcance el puerto del API (`:3001` por default), mande la cabecera `Origin` que mande, recibe
un `400` y la base queda intacta. Crear cuentas volvió a ser una operación de dueño, a mano, por
SQL.

Las suites dejaron de usar el endpoint por eso: `apps/api/test/support/fixtures.ts`
(`createSecondOwner`) inserta `auth.users` + `auth.account` con `hashPassword` de Better Auth y
después entra por `signInEmail`, y `apps/web/e2e/support/owner.ts` (`createOwner`) inserta las mismas
dos filas por el transporte `psql` y deja que el spec inicie sesión por el formulario.

## Contraseñas

- Mínimo **8** caracteres: es el default de Better Auth y el monorepo **no lo cambia**. La
  validación vive en el handler de alta, que ahora está cerrado (`400 Password too short` solo se
  vería si volvieras a abrirlo); el insert SQL de más abajo no pasa por ahí, así que el mínimo lo
  respetás vos al elegir la contraseña.
- Máximo **128** (`maxPasswordLength`, default), con el mismo alcance que el mínimo.
- La regla de la casa es **12** (la del proyecto de origen). Se aplica agregando
  `minPasswordLength: 12` a `emailAndPassword` en `apps/api/src/auth/auth.ts`; mientras no esté ahí,
  la única contraseña que el servidor rechaza por corta es la de menos de 8 (y hoy solo la validaría
  el alta, que está cerrada: es una regla para vos).
- **No hay verificación por correo** ni transporte de correo en el monorepo: `emailVerification` no
  está configurado y no hay proveedor de mail. Un usuario creado por SQL queda con el
  `email_verified` que le pongas (`true` en la receta de abajo) y la app nunca lo bloquea por eso.
- **No hay protección de contraseñas filtradas**: no existe consulta a un directorio de claves
  comprometidas. En el origen era una opción del panel con plan pago; acá no hay equivalente.
- **No hay flujo "olvidé mi contraseña"**: `sendResetPassword` no está configurado, así que Better
  Auth no tiene cómo mandar el correo. La recuperación es la de más abajo (SQL).

## Crear un usuario (el único camino es SQL)

Son dos filas: una en `auth.users` y una en `auth.account` con `provider_id = 'credential'` y la
contraseña hasheada. Es la misma forma que escribía el alta por HTTP y la que usan los fixtures de
las dos suites, así que el usuario que creás vos y el de los tests son el mismo tipo de fila. No hay
otra vía: el alta por HTTP está cerrada (arriba) y `apps/api` no expone un endpoint de usuarios.

Las credenciales tienen que estar en `auth.account`: un usuario insertado sin esa fila no puede
iniciar sesión (es exactamente el caso del usuario demo). La forma de las dos tablas:

| `auth.users` | tipo | notas |
| --- | --- | --- |
| `id` | `uuid` pk | default `gen_random_uuid()`; el alta lo generaba en la app como UUID, acá lo elegís vos |
| `name` | `text` | nullable en la tabla; el alta por HTTP lo exigía, el SQL no |
| `email` | `text` not null | índice único sobre `lower(email)`: el correo es único sin importar mayúsculas |
| `email_verified` | `boolean` not null | default `false`; la app no lo exige |
| `image` | `text` | nullable |
| `created_at`, `updated_at` | `timestamptz` not null | default `now()` |

| `auth.account` | tipo | notas |
| --- | --- | --- |
| `id` | `text` pk | lo generaba Better Auth; acá alcanza un uuid en texto |
| `user_id` | `uuid` not null → `auth.users(id)` **on delete cascade** | |
| `account_id` | `text` not null | para `credential` es el mismo `user_id` |
| `provider_id` | `text` not null | `'credential'` para correo + contraseña |
| `password` | `text` | el hash, nunca la contraseña |

El hash es el de Better Auth: `scrypt` de Node con `N=16384, r=16, p=1, dkLen=64`, contraseña
normalizada a NFKC, guardado como `<salt hex de 16 bytes>:<clave hex de 64 bytes>`. Para generarlo
sin depender de nada:

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

Es exactamente lo que devuelve `hashPassword` de `better-auth/crypto`, que es lo que usan los
fixtures. Si preferís no armarlo a mano, desde `apps/api` (que sí tiene la dependencia) da el mismo
formato:

```bash
node --input-type=module -e '
import { hashPassword } from "better-auth/crypto";
console.log(await hashPassword(process.argv[1]));
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

- El usuario nuevo **no queda con sesión abierta** (la creaba el alta por HTTP): entra por `/login`,
  que es el formulario real, o por `POST /api/auth/sign-in/email`. Los dos siguen funcionando igual.
- El dueño nuevo arranca con la base vacía (RLS aísla por `owner_id = auth.uid()`) y **sin
  catálogos**: `POST /catalogs/ensure` (con la cookie de sesión) los crea —los mismos 3 métodos de
  pago y 13 categorías que siembra `seed-demo.sql`— y es idempotente: la segunda llamada devuelve
  `0/0`.
- No hay ningún archivo del repo con credenciales: la contraseña en claro solo existe donde vos la
  guardes.

No hay endpoint de administración: Better Auth no tiene el plugin `admin` instalado, así que
`apps/api` no expone "crear usuario" ni "cambiar la contraseña de otro". Crear un usuario es este
SQL.

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
`owner_id`, no para iniciar sesión: un login con cualquier contraseña falla, y un alta con ese
correo tampoco lo crearía (el alta está cerrada para todos y, además, el email ya existe y es
único). Si necesitás entrar como la demo, insertá su `auth.account` como en "Restablecer la
contraseña".

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

# el API ya no da de alta a nadie: 400 con el código, y ninguna fila nueva en auth.users
curl -s -X POST http://127.0.0.1:3001/api/auth/sign-up/email \
  -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3000' \
  -d '{"name":"Prueba","email":"prueba@example.test","password":"<12 caracteres o mas>"}'
# {"message":"Email and password sign up is not enabled","code":"EMAIL_PASSWORD_SIGN_UP_DISABLED"}

# entrar sigue siendo solo el login
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:3001/api/auth/sign-in/email \
  -H 'content-type: application/json' -H 'origin: http://127.0.0.1:3000' \
  -d '{"email":"dueno@example.test","password":"<la tuya>"}'                          # 200

# quiénes existen (psql local, o dentro del contenedor)
psql "$DATABASE_URL" -c 'select id, email, email_verified, created_at from auth.users order by created_at;'
docker exec -it gestion-pagos-db-dev psql -U <usuario> -d <base> \
  -c 'select id, email, email_verified, created_at from auth.users order by created_at;'
```
