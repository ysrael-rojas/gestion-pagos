# RLS deny-by-default hasta que exista autenticación

**Estado:** accepted

La tabla `third_parties` nace con Row Level Security **habilitado y sin ninguna política**, y con los privilegios revocados a `anon` y `authenticated`. El resultado es que nadie accede a la tabla por el Data API (PostgREST): solo `service_role` y las herramientas administrativas (MCP) pueden leer y escribir. Las políticas de acceso se añadirán en la spec de Auth, cuando se sepa quién es el usuario y qué puede ver.

La alternativa —RLS con políticas permisivas para `anon`/`authenticated`— dejaría la tabla abierta a cualquiera que tenga la publishable key, que es pública por diseño. En un proyecto de gestión de pagos con datos fiscales, exponer escritura anónima en desarrollo es un riesgo que no compensa, sobre todo cuando esta iteración todavía no conecta la app a Supabase.

**Considered Options**

- **RLS con políticas permisivas (`using (true)` para `anon`)**: cómodo para probar el Data API desde ya, pero convierte la publishable key en una credencial de escritura total.
- **RLS deshabilitado**: el peor caso; en Supabase las tablas de `public` quedan alcanzables por el Data API, y sin RLS cualquier rol con privilegios ve todas las filas.

**Consequences**

El advisor de Supabase marca `rls_enabled_no_policy` como INFO sobre esta tabla. Es intencional y esperado: se mantiene como estado final, no transitorio (ver ADR-0005). Cualquier acceso desde el frontend falla, lo cual es el comportamiento deseado.

**Nota (2026-09-17):** la promesa de "añadir las políticas de acceso en la spec de Auth" queda revisada por [ADR-0005](./0005-autorizacion-en-la-dal-no-en-rls.md). La decisión de esta ADR —RLS activo y sin políticas hasta que exista autenticación— se cumplió y se conserva; lo que cambia es lo que viene después.
