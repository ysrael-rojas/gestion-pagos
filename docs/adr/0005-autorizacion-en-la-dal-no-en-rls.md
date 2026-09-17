# La autorización vive en la DAL, no en RLS

**Estado:** accepted

Con la llegada de la autenticación, ADR-0004 anticipó que "las políticas de acceso se añadirán en la spec de Auth". Esta ADR revisa esa promesa: `third_parties` y `users` se quedan con RLS activo, **sin ninguna política** y con los privilegios revocados a `anon` y `authenticated`, y el acceso a datos sigue haciéndose con `service_role`. La autorización —quién puede ver y quién puede mutar— se decide en código, en una Data Access Layer que cada página y cada Server Action invocan antes de tocar el dato.

El motivo es que el modelo de acceso de esta aplicación no es por fila. Todos los Usuarios son empleados de la empresa y todos ven todos los Terceros; lo que distingue a un administrador de un operador es **qué operaciones puede ejecutar**, no qué filas puede leer. RLS expresa predicados por fila (`using ((select auth.uid()) = user_id)`), y aquí no existe tal columna. La única política honesta sería `to authenticated using (true)`, que no restringe nada y a cambio da la falsa impresión de que la base de datos está protegiendo algo. La autorización por operación es una decisión de negocio que pertenece junto al dato, no en una política.

**Considered Options**

- **Clientes con la sesión del Usuario y políticas permisivas (`to authenticated using (true)`)**: coherente con la letra de ADR-0004, pero obliga a reescribir la ruta de datos de Terceros, no aporta aislamiento real mientras todos los Usuarios sean iguales, y convierte `auth.uid()` en un requisito decorativo.
- **RLS deshabilitado**: el peor caso. Las tablas de `public` quedan alcanzables por el Data API, y sin RLS cualquier rol con privilegios ve todas las filas.
- **`service_role` + DAL**: la clave nunca llega al navegador, las tablas siguen inalcanzables por el Data API, y la decisión de autorización se concentra en un solo módulo legible y verificable.

**Consequences**

El advisor de Supabase marca `rls_enabled_no_policy` como INFO sobre estas tablas. Pasa de ser un estado transitorio a ser el estado final y deliberado, así que el aviso se ignora a conciencia y no se "arregla" añadiendo políticas vacías.

El punto de cumplimiento es un único módulo (`lib/auth/sesion.ts`). Su debilidad es también su claridad: **una Server Action que olvide llamar a `requerirPermiso` es un agujero**, porque las Server Actions son alcanzables por POST directo y el `proxy.ts` no las cubre. De ahí la regla explícita de que toda Server Action verifica por su cuenta, y de que exista un criterio de aceptación que lo comprueba invocando una acción directamente.

Si algún día aparecen datos con propiedad por Usuario o por tenant —facturas de un proveedor que entra a ver las suyas, por ejemplo—, el modelo cambia y con él esta decisión: en ese momento las políticas RLS pasan a ser el mecanismo correcto y habrá que migrar los clientes.
