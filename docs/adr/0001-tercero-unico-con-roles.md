# Tercero único con roles, no tablas separadas de Cliente y Proveedor

**Estado:** accepted

Clientes y proveedores comparten exactamente los mismos datos fiscales (tipo y número de documento, nombre o razón social, domicilio fiscal, contacto), y una misma empresa puede ser ambas cosas a la vez. Modelamos una sola entidad, **Tercero**, con un conjunto de roles (`cliente`, `proveedor`) del que debe tener al menos uno, en lugar de dos entidades separadas.

**Considered Options**

- **Dos entidades separadas** (`Cliente`, `Proveedor`): obliga a duplicar el registro de quien es ambas cosas y a aplicar dos veces cualquier cambio de sus datos fiscales.
- **Una entidad con un único rol** (`tipo: cliente | proveedor`): duplica igual y pierde el caso real de la empresa que a la vez te vende y te compra.
