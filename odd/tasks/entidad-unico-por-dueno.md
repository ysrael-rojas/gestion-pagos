# L7 — El documento de una entidad es único por dueño

Cierra la deuda L7 de `port-vertical-clientes.md`: `entidad_document_unique` era
`(document_type, document_number)` sin `owner_id`, así que en un esquema multi-tenant (RLS por
`owner_id`) dos negocios no podían registrar el mismo RUC/DNI, y el 409 le confirmaba al segundo
que el documento existía en otro lado.

## Specs

- **S1 — Decisión del usuario: unicidad por dueño.** Opción elegida textualmente: "Por dueño (lo
  que hoy impide el índice)". El índice pasa a
  `(owner_id, document_type, document_number)` y **conserva** el predicado parcial
  `deleted_at is null and document_number <> ''`. Dentro de un mismo dueño el duplicado sigue
  siendo 409 con el mensaje del vertical ("Ya existe un cliente con ese tipo y número de documento.").
- **S2 — El contrato no cambia.** Ningún status, cuerpo ni mensaje de las rutas existentes se
  modifica. Lo único que cambia es el resultado de un alta que hoy choca contra la fila de **otro**
  dueño: 409 → 201.
- **S3 — No se toca ningún dato.** La migración es solo índice (drop + create); no reescribe filas,
  no agrega columnas y corre dentro de la transacción única del runner (`apply-sql.mjs`).
- **S4 — Verificación.** El test que hoy fija la unicidad global pasa a fijar la de dueño (201 entre
  dueños, 409 dentro del mismo). El drift guard (`db:dump --check`) queda verde con el snapshot
  regenerado, y el slice lleva verificación independiente por ser cambio de índice.

## Tasks

- L1 — Invertir el test de unicidad en `apps/api/test/entities.e2e.test.ts` y observar RED.
  Specs: S1, S2, S4. Ruta: inline. **Hecho**: RED con `actual: 409, expected: 201` (L4), commit
  `aef8ec4`.
- L2 — Migración nueva + `apps/api/src/db/schema/entidad.ts`. Specs: S1, S3. Ruta: inline.
  **Hecho**: aplicada con `db:verify`, índice confirmado en `pg_indexes`, commit `aef8ec4`.
- L3 — Regenerar `packages/db/scripts/schema-snapshot.sql` y correr drift guard + e2e de entidades.
  Specs: S4. Ruta: inline. **Hecho**: `db:dump --check` verde (`el esquema coincide ... 1153
  lineas`), e2e 11/11, commit `aef8ec4`.
- L4 — Cerrar L7 en el doc del vertical, handoff y verificación independiente. Specs: S4.
  Ruta: inline. Commit: _(pendiente)_.

## Log

- **L1 (usuario, verbatim).** "apruebo has el merge, pero no convendria ver la revision independiente
  de los riesgos 2 y 3 y sobre L7 que sigue abierto? antes de ir a cajas y bancos?"
- **L2 — Decisión del usuario (L7).** "Por dueño (lo que hoy impide el índice)": dos negocios pueden
  registrar el mismo documento; dentro de un dueño el duplicado sigue rechazado.
- **L3 — Análisis previo (verificación independiente del PR #3).** El cambio es estrictamente más
  débil y `owner_id` es `NOT NULL`, así que no puede fallar ni perder datos con las filas que
  existen. Tres piezas tienen que cambiar juntas: la migración, `schema/entidad.ts` y el snapshot
  commiteado. El único consumidor que asume lo viejo es el test del e2e.
- **L4 — Evidencia RED->GREEN.** Antes de la migración, el caso nuevo fallaba con
  `actual: 409, expected: 201` (alta del mismo RUC por otro dueno) y los otros 10 seguian verdes.
  Despues de `db:verify`: 11/11 y el mismo caso verde. `db:dump --check` verde con el snapshot
  regenerado (el diff del snapshot es una sola linea, la del índice). El índice en la base, leído de
  `pg_indexes`:
  `CREATE UNIQUE INDEX entidad_document_unique ON public.entidad USING btree (owner_id, document_type, document_number) WHERE ((deleted_at IS NULL) AND (document_number <> ''::text))`.
- **L5 — Detalle operativo.** El snapshot NO se regenera con `pnpm db:dump`: el script imprime el
  esquema a stdout y el archivo se escribe con redirect
  (`node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql`). Con
  `db:dump --check` solo se compara, y devuelve 1 si hay drift.
- **L6 — Verificación independiente (resultado, sin shell).** Verificado: la migración hace lo que
  S1 pide y el archivo es atómico en el runner (no hay estado a medio aplicar); ninguna fila
  existente puede violarla; `schema/entidad.ts`, la migración y el snapshot coinciden en columnas y
  predicado (**mantenidos a mano**: nada lo chequea mecánicamente, `drizzle-kit` no genera DDL
  acá); ningún lector del repo busca una entidad solo por documento. Tres hallazgos, los tres
  cerrados en este mismo slice: comentarios obsoletos en `apps/web/e2e/support/clientes-fixtures.ts`
  que seguían diciendo que el índice era global; **ningún test cubría que `document_type` sea parte
  de la clave** (agregado: mismo número con RUC y con carnet, ambos 201); y este registro, que
  estaba incompleto.
