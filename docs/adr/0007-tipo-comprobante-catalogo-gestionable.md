# Tipo de comprobante como catálogo gestionable, no enum nativo

**Estado:** accepted

El Tipo de comprobante (`Factura`, `Boleta`, `Recibo por honorarios`, `Ticket`, `Nota de crédito`) se modela como una entidad con CRUD propio, con `id`, `nombre`, `activo` y borrado lógico, en lugar del enum nativo de Postgres que ADR-0003 reserva para los vocabularios fijos de Terceros.

La diferencia con `document_type` y `third_party_role` es que esos son catálogos cerrados que la empresa no elige: un Tercero es cliente o proveedor, y su documento es DNI o RUC, sin discusión. Los tipos de comprobante, en cambio, dependen de la operación de cada empresa: quién emite recibos por honorarios y quién no, quién usa tickets, y qué régimen fiscal aplica. Un enum obligaría a una migración de esquema cada vez que la empresa empieza a recibir un documento nuevo, con el coste de revertir un enum (ADR-0003). Un catálogo gestionable resuelve eso con una pantalla.

El vocabulario del Comprobante de compra **referencia** al catálogo (`tipoComprobanteId`) en vez de duplicar el nombre, y el tipo desactivado se retira de las altas nuevas sin romper los comprobantes que ya lo usaban.

**Considered Options**

- **Enum nativo `purchase_document_type`**: coherente con ADR-0003 e integridad de tipo real, pero cierra el catálogo a los cinco valores iniciales y convierte cada tipo nuevo en una migración difícil de revertir.
- **`text` libre en el comprobante**: cero fricción, pero sin catálogo no hay `select` que unifique el vocabulario, ni unicidad de nombre, ni filtro por tipo, y los typos se acumulan.
- **Tabla de referencia sin CRUD** (solo semilla por migración): da el `JOIN` y la integridad, pero sigue dejando al usuario sin poder mantener sus propios tipos, que es justo la necesidad que motiva la desviación.

**Consequences**

Es la primera entidad de vocabulario del proyecto que **no** es un enum nativo, así que convive con ADR-0003 en lugar de sustituirlo: los enums siguen siendo la respuesta para catálogos cerrados, y este es el criterio para distinguirlos. La spec de backend de Compras deberá crear la tabla de tipos y la FK desde el comprobante, no un `ALTER TYPE`.
