# Documentación de Dominio

Cómo deben consumir las skills de ingeniería la documentación de dominio de este repo al explorar el código.

## Antes de explorar, lee esto

- **`CONTEXT.md`** en la raíz del repo, o
- **`CONTEXT-MAP.md`** en la raíz del repo si existe: apunta a un `CONTEXT.md` por contexto. Lee cada uno que sea relevante al tema.
- **`docs/adr/`**: lee los ADRs que toquen el área en la que estás por trabajar. En repos multi-contexto, revisa también `src/<context>/docs/adr/` por decisiones acotadas al contexto.

Si alguno de estos archivos no existe, **sigue en silencio**. No marques su ausencia; no sugieras crearlos de entrada. La skill `/domain-modeling` (a la que se llega vía `/grill-with-docs` e `/improve-codebase-architecture`) los crea de forma perezosa cuando términos o decisiones realmente se resuelven.

## Estructura de archivos

Repo de contexto único (la mayoría de los repos):

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

Repo multi-contexto (presencia de `CONTEXT-MAP.md` en la raíz):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← decisiones de todo el sistema
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← decisiones específicas del contexto
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## Usa el vocabulario del glosario

Cuando tu salida nombra un concepto de dominio (en el título de un issue, una propuesta de refactor, una hipótesis, el nombre de un test), usa el término tal como está definido en `CONTEXT.md`. No te desvíes hacia sinónimos que el glosario evita explícitamente.

Si el concepto que necesitas todavía no está en el glosario, eso es una señal: o estás inventando lenguaje que el proyecto no usa (reconsidéralo) o hay un vacío real (anótalo para `/domain-modeling`).

## Marca los conflictos de ADR

Si tu salida contradice un ADR existente, sácalo a la superficie explícitamente en lugar de sobreescribirlo en silencio:

> _Contradice el ADR-0007 (event-sourced orders), pero vale la pena reabrirlo porque…_
