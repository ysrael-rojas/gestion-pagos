// Better Auth sobre el esquema portado (S5, S6, S15).
//
// - Adapter: `better-auth/adapters/drizzle`. El adaptador `@auth/*` que nombra S1 pertenece a
//   Auth.js/NextAuth y no esta instalado ni aparece en el arbol de dependencias.
// - Modelo `user` -> `auth.users`, la tabla canonica de identidad del monorepo. No hay espejo
//   en `public.*`: las 8 FK heredadas apuntan ahi.
// - Ids generados por la app como UUID (`advanced.database.generateId`), porque las FK
//   heredadas son uuid; el default `gen_random_uuid()` de la tabla queda como respaldo.
//
// Variables de entorno que lee Better Auth (ninguna se escribe aca):
//   BETTER_AUTH_SECRET   firma de cookies/sesiones.
//   BETTER_AUTH_URL      origen publico del API (p. ej. http://localhost:3001).
//   DATABASE_URL         cadena de conexion (ver db.provider.ts).
import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Database } from "../db/db.provider";
import { accounts, sessions, users, verifications } from "../db/schema";
import { AUTH_BASE_PATH } from "./auth.token";

export function createAuth(db: Database) {
	return betterAuth({
		basePath: AUTH_BASE_PATH,
		database: drizzleAdapter(db, {
			provider: "pg",
			// `schemaName` solo lo usa el CLI de Better Auth para generar el esquema; el mapeo
			// real son los handles de abajo, que ya viven en el esquema `auth`.
			schemaName: "auth",
			usePlural: false,
			schema: {
				user: users,
				session: sessions,
				account: accounts,
				verification: verifications,
			},
		}),
		advanced: {
			database: {
				// UUID en la app, no serial: `auth.users.id` es uuid y 8 FK dependen de eso.
				generateId: () => randomUUID(),
			},
		},
		// Email + contrasena: es el unico metodo que el monorepo usa hoy (Supabase Auth no se
		// porta, S4). Sin esto Better Auth responde `EMAIL_PASSWORD_DISABLED` y no hay forma
		// de iniciar sesion, ni desde la UI ni desde un test.
		emailAndPassword: { enabled: true },
	});
}

export type Auth = ReturnType<typeof createAuth>;
