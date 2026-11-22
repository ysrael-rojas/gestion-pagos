/** Token de inyeccion de la instancia de Better Auth. */
export const AUTH = Symbol("AUTH");

/**
 * Base path del handler de Better Auth. Es el mismo valor que se le pasa a `betterAuth`
 * (`basePath`) y el que excluye `main.ts` del body parser de Nest (S6).
 */
export const AUTH_BASE_PATH = "/api/auth";
