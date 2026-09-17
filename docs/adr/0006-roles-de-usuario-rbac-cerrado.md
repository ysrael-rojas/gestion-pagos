# RBAC cerrado con un rol por Usuario

**Estado:** accepted

El catálogo de roles de usuario es un enum nativo de Postgres, `user_role` (`administrador`, `operador`), y cada Usuario tiene **exactamente uno**. Los Permisos no son una tabla ni una columna: se derivan del rol en un mapa fijo en código (`lib/auth/permisos.ts`). `administrador` tiene `ver_dashboard`, `gestionar_terceros` y `gestionar_usuarios`; `operador` tiene los dos primeros.

El array de roles funciona para Terceros (ADR-0003) porque un Tercero puede ser cliente *y* proveedor, y esos dos roles son independientes y acumulables. En un Usuario no ocurre lo mismo: los roles son jerárquicos, y permitir `['administrador', 'operador']` obliga a responder una pregunta que nadie sabe contestar —si el administrador ya incluye lo del operador, el array es redundante; si no lo incluye, hay que explicar en qué se diferencian—. Con un rol por Usuario esa ambigüedad no existe.

**Considered Options**

- **Roles en array (`user_role[]`)**: consistente con `third_parties.roles` y con índice GIN, pero introduce la ambigüedad de la acumulación jerárquica sin que ningún caso de uso la pida.
- **Permisos por Usuario (tabla o `text[]`)**: máxima flexibilidad, a costa de una pantalla de asignación, validación de valores y un join en cada comprobación. Es la respuesta correcta a "cada Usuario tiene permisos distintos", que no es este caso.

**Consequences**

Un enum nativo es difícil de revertir: solo admite `ALTER TYPE ... ADD VALUE`. Añadir un rol es barato; quitarlo o reordenarlo no lo es. Por eso el catálogo arranca corto (`administrador`, `operador`) en lugar de incluir conjeturas como un rol de solo lectura.

Como los Permisos viven en código, no son consultables desde SQL. Cualquier informe futuro del tipo "qué puede hacer cada rol" se lee en `lib/auth/permisos.ts`, no en la base de datos. Es el precio de no necesitar una tabla para un mapa de tres entradas.
