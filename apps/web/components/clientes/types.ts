// Re-export, not a copy: the shape lives in `@gestion/shared` (S6 of the clientes feature doc).
//
// Before T5c this file duplicated `packages/shared/src/components/clientes/types.ts` byte for
// byte, so the two could drift silently. The path stays because the pagos vertical, the
// clientes provider and the data layer all already import `@/components/clientes/types`.
export type { Client, DocumentType } from "@gestion/shared/components/clientes/types.ts";
