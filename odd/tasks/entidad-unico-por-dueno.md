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
  Specs: S1, S2, S4. Ruta: inline. Commit: _(pendiente)_.
- L2 — Migración nueva + `apps/api/src/db/schema/entidad.ts`. Specs: S1, S3. Ruta: inline.
  Commit: _(pendiente)_.
- L3 — Regenerar `packages/db/scripts/schema-snapshot.sql` y correr drift guard + e2e de entidades.
  Specs: S4. Ruta: inline. Commit: _(pendiente)_.
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
