---
description: Verifica y marca los criterios de aceptación de un spec, arreglando lo que falle y re-verificando.
agent: spec-verifier
subtask: true
---

Verifica los criterios de aceptación del spec indicado: `$ARGUMENTS`.

Si el argumento viene vacío, lista los archivos de `specs/` y pregunta cuál verificar antes de continuar.

Sigue tu flujo completo:

1. Localiza y lee el spec en `specs/` (acepta nombre completo, `NN` o slug).
2. Extrae y numera los criterios de aceptación.
3. Verifica cada uno con evidencia real: Context7 para convenciones de Next.js/React, Playwright + visión para las pantallas, y computed styles en lugar de apreciación visual.
4. Arregla el código cuando un criterio falle y re-verifica (nunca reescribas el criterio para que pase).
5. Marca los checks inline en el spec con su evidencia.
6. Entrega el reporte final con la tabla de criterios, los cambios realizados y lo que quede pendiente.

No hagas commit y no toques `.env`.
