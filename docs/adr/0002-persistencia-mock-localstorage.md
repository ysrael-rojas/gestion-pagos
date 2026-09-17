# Persistencia mock en localStorage tras un repositorio

**Estado:** accepted

Esta spec no introduce backend. Los Terceros se persisten en el `localStorage` del navegador, siempre a través de `lib/terceros-repo.ts`, que expone una API de dominio (`listar` / `obtener` / `crear` / `actualizar` / `desactivar` / `reactivar`) y no deja escapar el detalle de almacenamiento hacia la UI.

**Considered Options**

- **Mock en memoria**: el CRUD pierde todo al recargar, lo que hace imposible evaluar el flujo real de alta y edición.
- **Supabase ya**: mete credenciales, migraciones y RLS en una spec de UI. El MCP está disponible, pero no hay proyecto ni `.env` en el repo.
- **API routes + fichero**: el mismo coste que Supabase sin ninguna ventaja en este punto.

**Consequences**

Cuando llegue la spec de backend se reescribe el interior de `terceros-repo.ts` (o se sustituye por un cliente de Supabase manteniendo la firma). La UI no cambia.
