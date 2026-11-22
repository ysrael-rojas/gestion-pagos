-- Identidad de la demo.
--
-- En Supabase esta fila vivia en `auth.users` administrada por la plataforma. Aca la
-- creamos nosotros, porque 8 claves foraneas apuntan a `auth.users(id)` y `seed-demo.sql`
-- inserta con `owner_id` explicito.
--
-- Debe correr ANTES de seed-demo.sql. Es idempotente: se puede aplicar las veces que haga
-- falta sin duplicar ni pisar contrasenas (Better Auth guarda credenciales en su tabla de
-- cuentas, no en `auth.users`).
insert into auth.users (id, name, email, email_verified)
values (
  '7f9e00ea-c5a0-4ddb-b72c-4f6ad912f782',
  'Ysrael Rojas',
  'yrra_rojas@hotmail.com',
  true
)
on conflict do nothing;
