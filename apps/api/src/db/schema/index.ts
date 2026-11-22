// Schema Drizzle tipado de apps/api.
//
// Fuente de verdad del esquema: las 49 migraciones SQL de `packages/db` (S7). Estos tipos se
// derivaron leyendo la base YA migrada (`gestion_verify`, PostgreSQL 18.7) con `\d` y `\dT+`
// por psql dentro del contenedor; no se tradujeron a mano ni se adivinaron. Lo que Drizzle
// declara aca son tipos para el cliente, no DDL: `drizzle-kit` no genera migraciones en este
// monorepo (`apps/api` no tiene script `db:pull`/`db:migrate`).
export * from "./auth";
export * from "./cash-account";
export * from "./cash-receipt-category";
export * from "./entidad";
export * from "./enums";
export * from "./payment";
export * from "./payment-allocation";
export * from "./payment-balance";
export * from "./payment-method";
export * from "./voucher-balance";
