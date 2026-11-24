// `grantDemoCredential` es idempotente: da igual cuantas credenciales haya para el dueno demo,
// despues de llamarlo queda UNA sola fila.
//
// El bug que fija este test: la funcion insertaba siempre una fila nueva en `auth.account`. Si el
// dueno demo ya tenia credencial —por ejemplo, la que usa cualquiera que levanta la app para mirarla—
// quedaban dos filas para el mismo email, Better Auth resolvia la equivocada y `signIn` fallaba con
// "Invalid password". El sintoma aparecia como fallo de `cash-settings.e2e` y parecia un bug de
// producto: era el fixture peleando con el entorno.

import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";

import {
	findSeededOwnerId,
	grantDemoCredential,
	revokeDemoCredential,
} from "./support/fixtures.ts";

function poolOrFail(): Pool {
	const connectionString = process.env.DATABASE_URL?.trim();

	if (!connectionString) {
		throw new Error("Falta DATABASE_URL: este test corre contra la base sembrada.");
	}

	return new Pool({ connectionString });
}

test("grantDemoCredential converge a una sola credencial aunque ya exista una", async () => {
	const pool = poolOrFail();

	try {
		const ownerId = await findSeededOwnerId(pool);

		// Una credencial preexistente con otra clave: es el estado que rompia la suite.
		await pool.query(
			`insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
			 values (gen_random_uuid(), $1, 'credential', $2, 'stale-hash', now(), now())`,
			[ownerId, ownerId],
		);

		const email = await grantDemoCredential(pool, ownerId);
		const after = await pool.query<{ count: number }>(
			`select count(*)::int as count from auth.account
			  where user_id = $1 and provider_id = 'credential'`,
			[ownerId],
		);

		assert.equal(after.rows[0]?.count, 1, "el dueno demo tiene que quedar con UNA credencial");
		assert.ok(email.length > 0);

		// Y sigue siendo idempotente si se lo llama otra vez.
		await grantDemoCredential(pool, ownerId);
		const twice = await pool.query<{ count: number }>(
			`select count(*)::int as count from auth.account
			  where user_id = $1 and provider_id = 'credential'`,
			[ownerId],
		);

		assert.equal(twice.rows[0]?.count, 1, "llamarlo dos veces no puede agregar filas");
	} finally {
		// Solo se revoca la credencial que creo este test. NUNCA `deleteOwnerFixtures` aca: el dueno
		// demo es el seed de la app, y borrar sus fixtures vaciaria la base con la que se revisa.
		const ownerId = await findSeededOwnerId(pool);

		await revokeDemoCredential(pool, ownerId, []);
		await pool.end();
	}
});
