# Gestión de Pagos

Aplicación interna para gestionar las relaciones comerciales y los pagos de una empresa peruana. Este contexto cubre a las organizaciones y personas con las que la empresa opera, y a las personas de la empresa que acceden al sistema.

## Language

### Terceros

**Tercero**:
Persona natural o jurídica con la que la empresa se relaciona comercialmente, sea como cliente, como proveedor o como ambos.
_Avoid_: Cliente, Proveedor, Contraparte, Entidad, Contacto

**Rol de tercero**:
Papel que un Tercero cumple frente a la empresa. Un Tercero tiene al menos un rol.
_Avoid_: Tipo, categoría, condición, Rol de usuario

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

### Usuarios

**Usuario**:
Persona que accede al sistema con credenciales propias. No es un Tercero.
_Avoid_: Cuenta, Empleado, Login, Perfil, Operador

**Rol de usuario**:
Conjunto fijo de Permisos que un Usuario tiene en el sistema. Cada Usuario tiene exactamente uno.
_Avoid_: Rol, perfil, nivel, Rol de tercero

**Permiso**:
Facultad concreta sobre una parte del sistema: ver el dashboard, gestionar Terceros, gestionar Usuarios o gestionar Compras.
_Avoid_: Privilegio, acceso

### Compras

**Comprobante de compra**:
Documento que emite un Proveedor y que la empresa registra como origen de una obligación de pago. Es el hecho que la spec de pagos consumirá después.
_Avoid_: Factura, documento, gasto, compra

**Tipo de comprobante**:
Clasificación del Comprobante de compra según el documento emitido: Factura, Boleta, Recibo por honorarios, Ticket o Nota de crédito. Es un catálogo gestionable por el usuario, no un enum nativo (ver ADR-0007).
_Avoid_: Clase, categoría, tipo de documento

**Condición de pago**:
Forma acordada de saldar un Comprobante de compra: Contado o Crédito. Con Crédito el Comprobante exige una Fecha de vencimiento; con Contado no la tiene.
_Avoid_: Tipo de pago, modalidad, plazo

**IGV**:
Impuesto General a las Ventas incluido en un Comprobante de compra, derivado como la diferencia entre Total y Subtotal. No se escribe a mano ni se calcula como una tasa fija.
_Avoid_: Impuesto, IVA

**Comprobante de compra activo**:
Comprobante de compra que sigue vigente para la operación. La desactivación es un borrado lógico: deja de estar disponible para nuevas operaciones pero conserva su historial.
_Avoid_: Habilitado, vigente
