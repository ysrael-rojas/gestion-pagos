# Enums nativos de Postgres y roles como array, no tablas de referencia

**Estado:** accepted

El esquema de Terceros usa dos tipos enum nativos de Postgres, `document_type` (`dni`, `ruc`, `foreigner_card`, `no_document`) y `third_party_role` (`customer`, `supplier`), y guarda los roles en una columna `third_party_role[]` con `CHECK (cardinality(roles) >= 1)` e índice GIN, en lugar de tablas de referencia o `text` + `CHECK`.

Son dos vocabularios fijos y pequeños, y el array refleja 1:1 el `roles: RolTercero[]` que ya existía en la app. El filtro por rol se resuelve con `roles @> array['customer']` sobre el GIN, sin necesidad de un `JOIN`. Los enums dan integridad de tipo real: Postgres rechaza cualquier valor fuera del catálogo, cosa que `text` no garantiza.

**Considered Options**

- **`text` + `CHECK ... IN (...)`**: no da un tipo reutilizable, no aparece en los tipos TS generados como unión de literales y la lista de valores vive duplicada en cada `CHECK`.
- **Tablas de referencia con FK**: más normalizado y permite roles configurables por el usuario, pero añade una tabla y un `JOIN` para un catálogo cerrado que no lo necesita.

**Consequences**

Un enum nativo es difícil de revertir: no se pueden quitar ni reordenar valores (solo añadirlos con `ALTER TYPE ... ADD VALUE`). Si en el futuro los roles o los tipos de documento deben ser configurables por el usuario, habrá que migrar a tablas de referencia.
