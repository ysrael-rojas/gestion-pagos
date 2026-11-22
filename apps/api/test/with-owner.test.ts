// Prueba de comportamiento de `withOwner()` (S2): las dos sentencias, su orden y su alcance.
//
// Por que importa el orden y no solo la presencia: si `set local role authenticated` se emitiera
// antes de `set_config('app.user_id', ...)`, el GUC se fijaria ya como el rol de la aplicacion y
// el propio `set local role` quedaria fuera de las garantias de la transaccion; si se emitieran
// en transacciones distintas, `set_config(..., true)` (LOCAL) moriria al terminar la primera y la
// politica RLS veria `auth.uid()` nulo. Por eso el test afirma la secuencia exacta de eventos
// dentro de UNA transaccion y no solo el texto de las sentencias.
//
// El fake de Drizzle solo implementa lo que `withOwner` usa (`transaction` y `execute`) y traduce
// cada `SQL` con el dialecto real de `drizzle-orm/pg-core`, asi que lo verificado es la sentencia
// que se enviaria a PostgreSQL, no una copia escrita a mano en el test.
import assert from "node:assert/strict";
import test from "node:test";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../src/db/db.provider.ts";
import { withOwner } from "../src/db/with-owner.ts";

const OWNER_ID = "7f9e00ea-c5a0-4ddb-b72c-4f6ad912f782";

const dialect = new PgDialect();

interface Issued {
	sql: string;
	params: unknown[];
}

interface FakeDatabase {
	db: Database;
	tx: Transaction;
	issued: Issued[];
	/** Secuencia observada: `begin`, `execute:<n>`, `run`, `commit` / `rollback`. */
	events: string[];
	stats: { transactions: number; commits: number; rollbacks: number };
}

function createFakeDatabase(): FakeDatabase {
	const issued: Issued[] = [];
	const events: string[] = [];
	const stats = { transactions: 0, commits: 0, rollbacks: 0 };

	const tx = {
		execute(statement: SQL | string) {
			if (typeof statement === "string") {
				issued.push({ sql: statement, params: [] });
			} else {
				const query = dialect.sqlToQuery(statement);
				issued.push({ sql: query.sql, params: query.params as unknown[] });
			}
			events.push(`execute:${issued.length - 1}`);
			return Promise.resolve({ rows: [], rowCount: 0, command: "", fields: [] });
		},
	} as unknown as Transaction;

	const db = {
		transaction: async (run: (transaction: Transaction) => Promise<unknown>) => {
			stats.transactions += 1;
			events.push("begin");
			try {
				const value = await run(tx);
				stats.commits += 1;
				events.push("commit");
				return value;
			} catch (error) {
				stats.rollbacks += 1;
				events.push("rollback");
				throw error;
			}
		},
	} as unknown as Database;

	return { db, tx, issued, events, stats };
}

const statementText = (issued: Issued) => issued.sql.replace(/\s+/g, " ").trim();

test("withOwner fija app.user_id y despues cambia el rol, en una sola transaccion", async () => {
	const fake = createFakeDatabase();

	const result = await withOwner(fake.db, OWNER_ID, async (tx) => {
		assert.equal(tx, fake.tx, "el callback debe recibir la transaccion abierta por withOwner");
		fake.events.push("run");
		return "valor-del-callback";
	});

	assert.equal(result, "valor-del-callback");
	assert.equal(fake.issued.length, 2, `se esperaban 2 sentencias, se emitieron ${fake.issued.length}`);

	assert.equal(statementText(fake.issued[0]), "select set_config('app.user_id', $1, true)");
	assert.deepEqual(fake.issued[0].params, [OWNER_ID], "el GUC debe llevar el uuid del dueno");
	assert.equal(statementText(fake.issued[1]), "set local role authenticated");
	assert.deepEqual(fake.issued[1].params, []);

	assert.deepEqual(
		fake.events,
		["begin", "execute:0", "execute:1", "run", "commit"],
		"el GUC y el cambio de rol van antes del callback y dentro de la misma transaccion",
	);
	assert.equal(fake.stats.transactions, 1, "todo debe ocurrir dentro de UNA transaccion");
	assert.equal(fake.stats.commits, 1);
	assert.equal(fake.stats.rollbacks, 0);
});

test("withOwner no usa la variante no local de set_config", async () => {
	const fake = createFakeDatabase();

	await withOwner(fake.db, OWNER_ID, async () => undefined);

	const setConfig = fake.issued.filter((issued) => /set_config/i.test(issued.sql));
	assert.equal(setConfig.length, 1, "withOwner emite exactamente un set_config");
	assert.match(
		statementText(setConfig[0]),
		/,\s*true\)$/,
		"set_config debe ser local a la transaccion (is_local = true)",
	);

	for (const issued of fake.issued) {
		assert.doesNotMatch(
			statementText(issued),
			/,\s*false\s*\)/,
			`set_config(..., false) filtraria la identidad entre requests del pool: ${statementText(issued)}`,
		);
	}
});
