# Gestión de Pagos

Aplicación interna para gestionar las relaciones comerciales y los pagos de una empresa peruana. Este contexto cubre a las personas y organizaciones con las que la empresa opera.

## Language

**Tercero**:
Persona natural o jurídica con la que la empresa se relaciona comercialmente, sea como cliente, como proveedor o como ambos.
_Avoid_: Cliente, Proveedor, Contraparte, Entidad, Contacto

**Rol de tercero**:
Papel que un Tercero cumple frente a la empresa. Un Tercero tiene al menos un rol.
_Avoid_: Tipo, categoría, condición

**Cliente**:
Rol de un Tercero al que la empresa le vende.
_Avoid_: Comprador, cuenta

**Proveedor**:
Rol de un Tercero al que la empresa le compra.
_Avoid_: Vendedor, suministrador

**Tipo de documento**:
Clasificación del documento de identificación fiscal de un Tercero: DNI, RUC, Carné de extranjería o Sin documento.
_Avoid_: Tipo de identificación, documento

**Número de documento**:
Identificador fiscal de un Tercero, único dentro de su tipo de documento. No existe cuando el tipo es Sin documento.
_Avoid_: Código, ID fiscal

**Razón social**:
Nombre legal de un Tercero persona jurídica, identificada por RUC.
_Avoid_: Nombre de empresa

**Domicilio fiscal**:
Dirección registrada de un Tercero ante la administración tributaria.
_Avoid_: Dirección, domicilio

**Tercero activo**:
Tercero que mantiene vigente su relación comercial con la empresa. La desactivación es un borrado lógico: el Tercero deja de estar disponible para nuevas operaciones pero conserva su historial.
_Avoid_: Habilitado, vigente
