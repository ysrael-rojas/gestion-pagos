// Prueba end-to-end del aislamiento por dueno: RLS + privilegios + `set local role authenticated`.
//
// Por que existe este script y no basta `db:verify-rls`: el suite de auditoria corre sobre una
// base ya sembrada y, en varios de sus bloques, su resultado esperado es `42501 permission
// denied`. Eso prueba *que el rol no tiene privilegios*, no que el aislamiento funcione: mientras
// `authenticated` no tenga GRANT, cualquier query muere antes de que se evalue una politica, y
// una tabla sin RLS se veria exactamente igual (cero filas por error, no por politica). Este
// script monta el escenario completo en una base scratch y afirma el aislamiento desde la ruta de
// la aplicacion.
//
// Lo que hace:
//   1. crea una base scratch `gestion_pagos_check_rls_<hex>` (nunca toca la base de
//      DATABASE_URL ni `db-dev`),
//   2. aplica TODAS las migraciones de `packages/db/migrations` con el runner canonico
//      (`apply-sql.mjs`), asi que la evidencia incluye que las migraciones aplican en una base
//      limpia,
//   3. siembra dos duenos con una fila de `entidad` y un `payment` cada uno, con sus cuentas,
//      metodos y categorias (como owner de las tablas, igual que los seeds),
//   4. afirma, impersonando la ruta de la aplicacion (`set local role authenticated` + GUC
//      `app.user_id`):
//        A. el dueno A ve exactamente su fila y cero filas del dueno B,
//        B. el dueno A no puede insertar una fila con el `owner_id` del dueno B, y el intento no
//           deja nada escrito,
//        C. la misma sesion, sin el GUC, ve cero filas (ni fuga del GUC entre transacciones ni
//           bypass del owner),
//        D. el rol de la aplicacion no puede escribir `public.__sql_migrations`, el libro del
//           runner: la migracion de grants se lo revoca a proposito,
//        E. el dueno A ve solo su `payment` (la tabla del modulo vertical de apps/api; su
//           politica es otra, y una lectura cruzada ahi tambien tiene que dar cero),
//        F. el dueno A no puede MODIFICAR la fila del dueno B, ni en `entidad` ni en `payment`:
//           cero filas afectadas y la fila del dueno B intacta,
//        G. el dueno A no puede BORRAR la fila del dueno B en `entidad` (0 filas: no hay politica
//           de DELETE) ni en `payment` (42501: no hay privilegio de DELETE), y la fila sobrevive
//           en los dos casos,
//        H. controles positivos: el dueno A si puede modificar sus propias filas (sin esto, F y G
//           pasarian simplemente porque todo esta denegado). Incluye el UPDATE de `payment` que
//           recorre los triggers alojados en el schema `private`, afirma que `authenticated` NO
//           tiene `usage` sobre `private` ni `execute` sobre `private.assert_owner_consistency`
//           (el trigger igual se ejecuta con los privilegios del usuario invocador porque la
//           llamada va por OID desde `pg_trigger`, no por nombre) y que el cambio de
//           `payment.amount` muere en la capa de privilegios (42501), no en el trigger; el
//           trigger de inmutabilidad se sigue comprobando, pero por la ruta del owner, donde
//           nada lo tapa,
//        I. `anon` no tiene NINGUN privilegio de tabla en `public` (las cuatro acciones sobre
//           cada tabla existente) y una lectura como `anon` muere con 42501,
//        J. `authenticated` no puede leer `auth.session` (bearer tokens) ni `auth.account`
//           (hashes de clave), ni tocar `public.__sql_migrations` con ninguna de las cuatro
//           acciones,
//        K. por cada tabla de `public` con RLS habilitado y al menos una politica: sus politicas
//           aplican a `authenticated` y mencionan `auth.uid()` en el predicado del comando que
//           gobiernan, y un dueno no ve filas ajenas ni filas con `owner_id` nulo. Asi una
//           politica aflojada en CUALQUIER tabla falla, no solo en las sembradas,
//        L. el historial financiero es append-only por PRIVILEGIO, no solo por trigger: la matriz
//           de privilegios de `payment`/`cash_close`/`payment_allocation` es la del hardening
//           `20261012221550_harden_financial_history_v1.sql` (que la migracion de grants tiene
//           que reaplicar despues de su `grant ... on all tables`), y un UPDATE real a una
//           columna no concedida muere con 42501 `permission denied`, no con el mensaje de un
//           trigger de dominio.
//   5. borra la base scratch (aunque falle) y sale 1 nombrando la asercion rota.
//
// Las aserciones no se pueden cumplir "por accidente": si falta `set local role authenticated`
// el owner ve las dos filas (A, C, E, K fallan); si faltan los GRANT, la lectura muere con
// `permission denied` (A falla, se reporta el error real); si falta la politica de INSERT, el
// insert pasa (B falla). La asercion B exige ademas el mensaje `row-level security` y no
// cualquier `42501`, para no confundir "la politica me freno" con "no tengo privilegios".
//
// `payment` merece su propio grupo porque es la tabla que ejercita los triggers de dominio: el
// dueno A asigna su entidad en su propio pago y confirma que el UPDATE pasa. El cambio de
// `amount`, en cambio, ya no llega al trigger: `authenticated` no tiene UPDATE sobre esa columna,
// asi que muere con 42501 (grupo L fija esa matriz). Sin `usage` sobre `private`, el UPDATE
// permitido solo es posible porque los triggers se invocan por OID.
//
// Transporte: la conexion sale de `DATABASE_URL` (nunca se imprime ni se escribe). Ese rol debe
// poder `create database`; en este repo es `dev_user`, superusuario del contenedor.
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const applySqlPath = join(here, "apply-sql.mjs");

const failures = [];
let checks = 0;

const label = (text) => `check-rls: ${text}`;

function ok(name, evidence) {
	checks += 1;
	console.log(`${label("ok   ")} ${name}${evidence ? ` -- ${evidence}` : ""}`);
}

function fail(name, detail) {
	checks += 1;
	failures.push(`${name}: ${detail}`);
	console.error(`${label("FALLO")} ${name} -- ${detail}`);
}

function describe(error) {
	if (error && typeof error === "object") {
		const code = typeof error.code === "string" ? `${error.code}: ` : "";
		return `${code}${error.message ?? String(error)}`;
	}
	return String(error);
}

// Identificador de base scratch; se compone de constantes + hex, pero se cita igual.
const quoteIdent = (name) => `"${name.replaceAll('"', '""')}"`;

const show = (value) => (typeof value === "string" ? value : JSON.stringify(value));

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const baseDatabaseUrl = process.env.DATABASE_URL?.trim();

if (!baseDatabaseUrl) {
	console.error(
		label(
			"falta DATABASE_URL. Este script crea y borra una base scratch; no inventa una conexion.",
		),
	);
	process.exit(1);
}

let scratchUrl;
let scratchName;
try {
	scratchName = `gestion_pagos_check_rls_${randomBytes(4).toString("hex")}`;
	scratchUrl = new URL(baseDatabaseUrl);
	scratchUrl.pathname = `/${scratchName}`;
} catch (error) {
	console.error(label(`DATABASE_URL no es una URL de conexion valida: ${describe(error)}`));
	process.exit(1);
}
const admin = new pg.Client({ connectionString: baseDatabaseUrl });
const scratch = new pg.Client({ connectionString: scratchUrl.toString() });

let scratchCreated = false;
let scratchConnected = false;

// Unicos roles que este script impersona. `set local role` no acepta parametros, asi que el
// valor va interpolado: la lista blanca es lo que evita interpolar algo que no sea un literal
// fijo del propio script.
const APPLICATION_ROLES = new Set(["authenticated", "anon"]);

/**
 * Corre `run` dentro de una transaccion con la identidad indicada y siempre hace rollback.
 *
 * - `role` ausente: se queda como owner (para probar el bypass del owner).
 * - `ownerId` ausente: no fija el GUC (para probar que sin GUC no se ve nada).
 *
 * Devuelve `{ value, error }` en vez de lanzar: casi todas las aserciones necesitan distinguir
 * "devolvio cero filas" de "murio con un error", y ese error es la evidencia.
 */
async function attempt({ role, ownerId }, run) {
	if (role !== undefined && !APPLICATION_ROLES.has(role)) {
		throw new Error(`rol no soportado por este script: ${show(role)}`);
	}

	await scratch.query("begin");
	let value = null;
	let error = null;
	try {
		// El GUC va ANTES de cambiar de rol: es el orden que documenta el shim y el que usa
		// `withOwner()` en apps/api.
		if (ownerId) {
			await scratch.query("select set_config('app.user_id', $1, true)", [ownerId]);
		}
		if (role) {
			await scratch.query(`set local role ${role}`);
		}
		value = await run();
	} catch (caught) {
		error = caught;
	} finally {
		await scratch.query("rollback");
	}
	return { value, error };
}

/** Corre `run` con la identidad del request: GUC fijado y rol de sesion `authenticated`. */
async function asApplication(ownerId, run) {
	const { value, error } = await attempt({ role: "authenticated", ownerId }, run);
	if (error) throw error;
	return value;
}

try {
	await admin.connect();
	await admin.query(`create database ${quoteIdent(scratchName)}`);
	scratchCreated = true;
	console.log(`${label("base scratch")} ${scratchName}`);

	// Las migraciones se aplican con el runner canonico: un archivo = una transaccion, en orden,
	// con su registro en `public.__sql_migrations`. Reimplementarlo aca haria que la prueba no
	// cubriera el camino real de despliegue.
	const applied = spawnSync(process.execPath, [applySqlPath], {
		env: { ...process.env, DATABASE_URL: scratchUrl.toString() },
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});

	if (applied.status !== 0) {
		throw new Error(
			`las migraciones no aplicaron sobre la base scratch (exit ${applied.status}):\n` +
				`${applied.stdout ?? ""}${applied.stderr ?? ""}`,
		);
	}

	const migrated = (applied.stdout ?? "")
		.split(/\r?\n/)
		.filter((line) => line.trim() !== "")
		.at(-1);
	console.log(`${label("migraciones")} ${migrated ?? "(sin salida)"}`);

	await scratch.connect();
	scratchConnected = true;

	// -----------------------------------------------------------------------
	// Fixtures: dos duenos, con una fila de `entidad` y un `payment` cada uno. Se siembran como
	// owner de las tablas (igual que los seeds), no por la ruta de la aplicacion. `payment`
	// necesita sus FK (cuenta, metodo, categoria) del mismo dueno: el trigger de consistencia
	// las exige y el de cuenta abierta no encuentra ningun cierre, asi que la cuenta esta
	// abierta.
	// -----------------------------------------------------------------------
	const ownerA = randomUUID();
	const ownerB = randomUUID();

	await scratch.query(
		`insert into auth.users (id, name, email, email_verified)
		 values ($1, 'Dueno A', 'dueno-a@example.com', true),
		        ($2, 'Dueno B', 'dueno-b@example.com', true)`,
		[ownerA, ownerB],
	);

	async function seedEntidad(ownerId, name, email) {
		const { rows } = await scratch.query(
			`insert into public.entidad (owner_id, name, billing_email, is_client)
			 values ($1, $2, $3, true)
			 returning id`,
			[ownerId, name, email],
		);
		return rows[0].id;
	}

	async function seedPayment(ownerId, accountName) {
		const account = await scratch.query(
			`insert into public.cash_account (owner_id, type, name)
			 values ($1, 'CASH_BOX', $2)
			 returning id`,
			[ownerId, accountName],
		);
		const method = await scratch.query(
			`insert into public.payment_method (owner_id, code, name)
			 values ($1, 'CHECK', 'Efectivo check')
			 returning id`,
			[ownerId],
		);
		const category = await scratch.query(
			`insert into public.cash_receipt_category (owner_id, direction, code, name)
			 values ($1, 'INGRESO', 'CHECK', 'Cobranza check')
			 returning id`,
			[ownerId],
		);
		const payment = await scratch.query(
			`insert into public.payment (owner_id, direction, payment_date, amount, method_id,
			                             cash_account_id, category_id)
			 values ($1, 'INGRESO', current_date, 100.00, $2, $3, $4)
			 returning id`,
			[ownerId, method.rows[0].id, account.rows[0].id, category.rows[0].id],
		);
		return payment.rows[0].id;
	}

	const entidadA = await seedEntidad(ownerA, 'Cliente del dueno A', 'cliente-a@example.com');
	const entidadB = await seedEntidad(ownerB, 'Cliente del dueno B', 'cliente-b@example.com');
	const paymentA = await seedPayment(ownerA, 'Caja del dueno A');
	const paymentB = await seedPayment(ownerB, 'Caja del dueno B');

	const seeded = await scratch.query(
		`select (select count(*) from public.entidad)::int as entidades,
		        (select count(*) from public.payment)::int as pagos`,
	);
	if (seeded.rows[0].entidades !== 2 || seeded.rows[0].pagos !== 2) {
		throw new Error(
			`el fixture debio dejar 2 filas en public.entidad y 2 en public.payment, y dejo ` +
				`${seeded.rows[0].entidades} y ${seeded.rows[0].pagos}`,
		);
	}

	// Cuenta las filas de una tabla desde la sesion de owner (el fixture, sin RLS de por medio).
	const ownerCount = async (table, column, value) => {
		const { rows } = await scratch.query(
			`select (count(*))::int as total from public.${quoteIdent(table)} where ${quoteIdent(column)} = $1`,
			[value],
		);
		return rows[0].total;
	};

	const ownerTotal = async (table) => {
		const { rows } = await scratch.query(
			`select (count(*))::int as total from public.${quoteIdent(table)}`,
		);
		return rows[0].total;
	};

	// -----------------------------------------------------------------------
	// A) El dueno A ve exactamente su fila y ninguna del dueno B.
	// -----------------------------------------------------------------------
	try {
		const observed = await asApplication(ownerA, async () => {
			const { rows } = await scratch.query(
				`select current_user as session_role,
				        (count(*))::int as total,
				        (count(*) filter (where owner_id = $1))::int as own_rows,
				        (count(*) filter (where owner_id = $2))::int as foreign_rows
				   from public.entidad`,
				[ownerA, ownerB],
			);
			return rows[0];
		});

		if (observed.session_role !== "authenticated") {
			fail(
				"A) el dueno A ve solo sus filas",
				`la sesion corrio como ${show(observed.session_role)}, no como authenticated`,
			);
		} else if (observed.total !== 1 || observed.own_rows !== 1 || observed.foreign_rows !== 0) {
			fail(
				"A) el dueno A ve solo sus filas",
				`se esperaba 1 fila propia y 0 ajenas, se observo ${observed.own_rows} propia(s), ` +
					`${observed.foreign_rows} ajena(s), ${observed.total} visible(s)`,
			);
		} else {
			ok("A) el dueno A ve solo sus filas", "1 propia, 0 ajenas, sesion authenticated");
		}
	} catch (error) {
		fail("A) el dueno A ve solo sus filas", `la lectura fallo: ${describe(error)}`);
	}

	// -----------------------------------------------------------------------
	// B) El dueno A no puede insertar una fila con el `owner_id` del dueno B.
	// -----------------------------------------------------------------------
	try {
		const { error: observed } = await attempt(
			{ role: "authenticated", ownerId: ownerA },
			async () => {
				await scratch.query(
					`insert into public.entidad (owner_id, name, billing_email, is_client)
					 values ($1, 'Intruso', 'intruso@example.com', true)`,
					[ownerB],
				);
			},
		);

		const leftovers = await ownerTotal("entidad");

		if (!observed) {
			fail(
				"B) el dueno A no puede insertar filas del dueno B",
				`el insert con owner_id ajeno se acepto (quedaron ${leftovers} filas)`,
			);
		} else if (observed.code !== "42501" || !/row-level security/i.test(observed.message)) {
			fail(
				"B) el dueno A no puede insertar filas del dueno B",
				`se esperaba 42501 con "row-level security" (la politica de INSERT), se observo ` +
					`${show(observed.code)}: ${observed.message}`,
			);
		} else if (leftovers !== 2) {
			fail(
				"B) el dueno A no puede insertar filas del dueno B",
				`el insert fue rechazado pero quedaron ${leftovers} filas (se esperaban 2)`,
			);
		} else {
			ok(
				"B) el dueno A no puede insertar filas del dueno B",
				"42501 row-level security, sin filas escritas",
			);
		}
	} catch (error) {
		fail(
			"B) el dueno A no puede insertar filas del dueno B",
			`la transaccion fallo: ${describe(error)}`,
		);
	}

	// -----------------------------------------------------------------------
	// C) La misma sesion, sin el GUC, ve cero filas. Tambien prueba que `set_config(..., true)`
	//    no se filtra fuera de su transaccion (si se filtrara, el dueno del request anterior
	//    seguiria viendose desde la misma conexion del pool).
	// -----------------------------------------------------------------------
	try {
		const { value, error } = await attempt({ role: "authenticated" }, async () => {
			const guc = await scratch.query(
				"select coalesce(nullif(current_setting('app.user_id', true), ''), '') as value",
			);
			const { rows } = await scratch.query(
				"select (count(*))::int as total from public.entidad",
			);
			return { leakedGuc: guc.rows[0].value, visible: rows[0].total };
		});

		if (error) {
			fail("C) sin el GUC la sesion ve cero filas", `la lectura fallo: ${describe(error)}`);
		} else if (value.leakedGuc !== "") {
			fail(
				"C) sin el GUC la sesion ve cero filas",
				`el GUC app.user_id se filtro fuera de su transaccion: ${show(value.leakedGuc)}`,
			);
		} else if (value.visible !== 0) {
			fail(
				"C) sin el GUC la sesion ve cero filas",
				`se esperaban 0 filas, se observaron ${value.visible}`,
			);
		} else {
			ok("C) sin el GUC la sesion ve cero filas", "0 filas visibles sin app.user_id");
		}
	} catch (error) {
		fail("C) sin el GUC la sesion ve cero filas", `la lectura fallo: ${describe(error)}`);
	}

	// -----------------------------------------------------------------------
	// D) El rol de la aplicacion no puede escribir el libro de migraciones. El grant masivo de la
	//    migracion de privilegios alcanza a todas las tablas de `public`; `__sql_migrations` no
	//    tiene RLS, asi que la unica proteccion es el `revoke` explicito. Si alguien lo borra, la
	//    aplicacion podria reescribir el registro de migraciones aplicadas.
	// -----------------------------------------------------------------------
	try {
		const { error: observed } = await attempt({ role: "authenticated" }, async () => {
			await scratch.query(
				"insert into public.__sql_migrations (name) values ('check-rls-no-debe-escribir')",
			);
		});

		if (!observed) {
			fail(
				"D) el rol de la aplicacion no puede escribir el libro de migraciones",
				"el insert en public.__sql_migrations se acepto",
			);
		} else if (observed.code !== "42501") {
			fail(
				"D) el rol de la aplicacion no puede escribir el libro de migraciones",
				`se esperaba 42501, se observo ${show(observed.code)}: ${observed.message}`,
			);
		} else {
			ok(
				"D) el rol de la aplicacion no puede escribir el libro de migraciones",
				`42501 ${observed.message}`,
			);
		}
	} catch (error) {
		fail(
			"D) el rol de la aplicacion no puede escribir el libro de migraciones",
			`la transaccion fallo: ${describe(error)}`,
		);
	}

	// -----------------------------------------------------------------------
	// E) El dueno A ve solo su `payment`. Es la tabla del modulo vertical de apps/api y su
	//    politica (`payment_select`) es independiente de la de `entidad`: sin esta asercion, una
	//    politica aflojada solo en `payment` quedaba verde.
	// -----------------------------------------------------------------------
	try {
		const observed = await asApplication(ownerA, async () => {
			const { rows } = await scratch.query(
				`select (count(*))::int as total,
				        (count(*) filter (where owner_id = $1))::int as own_rows,
				        (count(*) filter (where owner_id = $2))::int as foreign_rows
				   from public.payment`,
				[ownerA, ownerB],
			);
			return rows[0];
		});

		if (observed.total !== 1 || observed.own_rows !== 1 || observed.foreign_rows !== 0) {
			fail(
				"E) el dueno A ve solo su pago",
				`se esperaba 1 fila propia y 0 ajenas, se observo ${observed.own_rows} propia(s), ` +
					`${observed.foreign_rows} ajena(s), ${observed.total} visible(s)`,
			);
		} else {
			ok("E) el dueno A ve solo su pago", "1 propia, 0 ajenas en public.payment");
		}
	} catch (error) {
		fail("E) el dueno A ve solo su pago", `la lectura fallo: ${describe(error)}`);
	}

	// -----------------------------------------------------------------------
	// F) El dueno A no puede modificar la fila del dueno B. Un UPDATE sobre una fila que la
	//    politica de UPDATE no deja ver afecta CERO filas (no da error): hay que afirmar las dos
	//    cosas, cero filas afectadas y fila ajena intacta. Con la politica aflojada el update
	//    afectaria 1 fila (o moriria contra `WITH CHECK`/el trigger de dominio), y cualquiera de
	//    las dos cosas rompe la asercion.
	// -----------------------------------------------------------------------
	const CROSS_OWNER_UPDATES = [
		{ table: "entidad", column: "name", mutation: "name = 'Intruso'", target: entidadB, expected: "Cliente del dueno B" },
		{ table: "payment", column: "void_reason", mutation: "void_reason = 'intruso'", target: paymentB, expected: null },
	];

	for (const target of CROSS_OWNER_UPDATES) {
		const name = `F) el dueno A no puede modificar la fila del dueno B en ${target.table}`;
		try {
			const { value: affected, error } = await attempt(
				{ role: "authenticated", ownerId: ownerA },
				async () => {
					const result = await scratch.query(
						`update public.${quoteIdent(target.table)} set ${target.mutation} where id = $1`,
						[target.target],
					);
					return result.rowCount;
				},
			);

			const after = await scratch.query(
				`select ${quoteIdent(target.column)} as value from public.${quoteIdent(target.table)} where id = $1`,
				[target.target],
			);
			const observed = after.rows[0]?.value ?? null;

			if (error) {
				fail(name, `el update cruzado devolvio un error en vez de 0 filas: ${describe(error)}`);
			} else if (affected !== 0) {
				fail(name, `el update afecto ${affected} fila(s) del dueno B`);
			} else if (observed !== target.expected) {
				fail(name, `la fila del dueno B cambio de valor: ${show(observed)}`);
			} else {
				ok(name, "0 filas afectadas, fila del dueno B intacta");
			}
		} catch (error) {
			fail(name, `la verificacion fallo: ${describe(error)}`);
		}
	}

	// -----------------------------------------------------------------------
	// G) El dueno A no puede borrar la fila del dueno B, y la fila sobrevive. El motivo del
	//    rechazo no es el mismo en las dos tablas, y por eso se afirma cual es:
	//      - `entidad` conserva el privilegio de DELETE y no tiene politica de DELETE, asi que el
	//        rechazo es de RLS y afecta 0 filas;
	//      - `payment` no tiene privilegio de DELETE (hardening del historial financiero), asi que
	//        el borrado ni llega a la politica: muere con 42501. Afirmar "0 filas" ahi seria
	//        afirmar algo distinto de lo que pasa, y una prueba vacua.
	// -----------------------------------------------------------------------
	const CROSS_OWNER_DELETES = [
		{ table: "entidad", target: entidadB, refusal: "missing-policy" },
		{ table: "payment", target: paymentB, refusal: "missing-privilege" },
	];

	for (const target of CROSS_OWNER_DELETES) {
		const name = `G) el dueno A no puede borrar la fila del dueno B en ${target.table}`;
		const byMissingPrivilege = target.refusal === "missing-privilege";
		try {
			const { value: affected, error } = await attempt(
				{ role: "authenticated", ownerId: ownerA },
				async () => {
					const result = await scratch.query(
						`delete from public.${quoteIdent(target.table)} where id = $1`,
						[target.target],
					);
					return result.rowCount;
				},
			);

			const survivors = await ownerCount(target.table, "id", target.target);

			if (byMissingPrivilege) {
				if (!error) {
					fail(
						name,
						`el delete cruzado se acepto (${affected} fila(s) afectadas): el privilegio de DELETE esta concedido`,
					);
				} else if (error.code !== "42501" || !/permission denied/i.test(error.message)) {
					fail(
						name,
						`se esperaba 42501 "permission denied" (privilegio de DELETE ausente), se observo ` +
							`${show(error.code)}: ${error.message}`,
					);
				} else if (survivors !== 1) {
					fail(name, `la fila del dueno B ya no existe (quedaron ${survivors})`);
				} else {
					ok(name, `42501 ${error.message}, fila del dueno B intacta (sin privilegio de DELETE)`);
				}
			} else if (error) {
				fail(name, `el delete cruzado devolvio un error en vez de 0 filas: ${describe(error)}`);
			} else if (affected !== 0) {
				fail(name, `el delete afecto ${affected} fila(s) del dueno B`);
			} else if (survivors !== 1) {
				fail(name, `la fila del dueno B ya no existe (quedaron ${survivors})`);
			} else {
				ok(name, "0 filas borradas, fila del dueno B intacta: no hay politica de DELETE");
			}
		} catch (error) {
			fail(name, `la verificacion fallo: ${describe(error)}`);
		}
	}

	// -----------------------------------------------------------------------
	// G) Asercion invertida. Antes del hardening este grupo afirmaba lo contrario: que
	//    `authenticated` SI tenia DELETE sobre `payment` y que el rechazo venia de RLS. Con el
	//    privilegio reaplicado, el rechazo de la fila PROPIA viene de la falta de GRANT; si alguien
	//    vuelve a conceder DELETE sobre `payment`, esta asercion falla. Las dos mitades importan:
	//    el catalogo y el comportamiento tienen que decir lo mismo.
	// -----------------------------------------------------------------------
	try {
		const name = "G) en payment el rechazo del DELETE viene de un privilegio ausente, no de RLS";
		const granted = await scratch.query(
			"select has_table_privilege('authenticated', 'public.payment', 'delete') as granted",
		);
		const { value, error } = await attempt({ role: "authenticated", ownerId: ownerA }, async () => {
			const result = await scratch.query("delete from public.payment where id = $1", [paymentA]);
			return result.rowCount;
		});
		const survivors = await ownerCount("payment", "id", paymentA);

		if (granted.rows[0].granted) {
			fail(
				name,
				"authenticated SI tiene DELETE sobre public.payment: el rechazo no prueba el privilegio",
			);
		} else if (!error) {
			fail(name, `el delete de la fila propia se acepto (${value} fila(s) borradas) sin privilegio`);
		} else if (error.code !== "42501" || !/permission denied/i.test(error.message)) {
			fail(
				name,
				`se esperaba 42501 "permission denied", se observo ${show(error.code)}: ${error.message}`,
			);
		} else if (survivors !== 1) {
			fail(name, `la fila propia ya no existe (quedaron ${survivors})`);
		} else {
			ok(name, `42501 ${error.message}: no hay GRANT de DELETE, la politica ni se evalua`);
		}
	} catch (error) {
		fail(
			"G) en payment el rechazo del DELETE viene de un privilegio ausente, no de RLS",
			`la verificacion fallo: ${describe(error)}`,
		);
	}

	// -----------------------------------------------------------------------
	// H) Controles positivos: sin ellos, F y G pasarian aunque TODO estuviera denegado.
	//    - A actualiza su propia fila de `entidad` (1 fila).
	//    - A asigna su propia entidad a su propio pago: el UPDATE atraviesa los triggers de
	//      `payment`, incluidos `private.payment_guard_history_mutation` y
	//      `private.payment_freeze_amount`, que NO son SECURITY DEFINER y viven en un schema
	//      sobre el que `authenticated` no tiene `usage`. Si un trigger necesitara resolver su
	//      schema por nombre, este UPDATE fallaria con `permission denied for schema private`.
	//      Funciona porque el trigger se invoca por OID desde `pg_trigger`.
	//    - A no puede cambiar `amount` de su propio pago, pero la capa que lo rechaza cambio con el
	//      hardening: `authenticated` no tiene UPDATE sobre esa columna, asi que el UPDATE muere
	//      con 42501 `permission denied` (evidencia de PRIVILEGIO de columna). Que el mensaje NO
	//      sea `payment.amount is immutable` es justamente lo que distingue las dos capas: el
	//      trigger de dominio ya no llega a ejecutarse por esta ruta.
	//    - El trigger de inmutabilidad se sigue comprobando, por la ruta del owner (donde ningun
	//      privilegio lo tapa): 23514 `payment.amount is immutable after insert`. Sin esta
	//      asercion, borrar el trigger quedaria invisible, porque la capa de privilegios lo
	//      preempta.
	//    - El hecho que hace que lo anterior sea una prueba: `authenticated` no tiene `usage`
	//      sobre `private` ni `execute` sobre `private.assert_owner_consistency` (que igual se
	//      ejecuta y rechaza escrituras cruzadas; ver BLOQUE 2 de db:verify-rls).
	// -----------------------------------------------------------------------
	try {
		const name = "H) el dueno A si puede actualizar su propia fila de entidad";
		const { value, error } = await attempt({ role: "authenticated", ownerId: ownerA }, async () => {
			const result = await scratch.query("update public.entidad set name = $2 where id = $1", [
				entidadA,
				"Cliente del dueno A (editado)",
			]);
			return result.rowCount;
		});
		if (error) {
			fail(name, `el update propio fallo: ${describe(error)}`);
		} else if (value !== 1) {
			fail(name, `se esperaba 1 fila afectada, se observaron ${value}`);
		} else {
			ok(name, "1 fila propia actualizada");
		}
	} catch (error) {
		fail("H) el dueno A si puede actualizar su propia fila de entidad", `fallo: ${describe(error)}`);
	}

	try {
		const name = "H) el UPDATE de un pago propio atraviesa los triggers de private sin usage";
		const { value, error } = await attempt({ role: "authenticated", ownerId: ownerA }, async () => {
			const result = await scratch.query(
				"update public.payment set entity_id = $2 where id = $1",
				[paymentA, entidadA],
			);
			return result.rowCount;
		});
		if (error) {
			fail(name, `el update de la ruta de la aplicacion fallo: ${describe(error)}`);
		} else if (value !== 1) {
			fail(name, `se esperaba 1 fila afectada, se observaron ${value}`);
		} else {
			ok(name, "1 fila afectada: los triggers de private corrieron con el rol de la app");
		}
	} catch (error) {
		fail(
			"H) el UPDATE de un pago propio atraviesa los triggers de private sin usage",
			`fallo: ${describe(error)}`,
		);
	}

	try {
		const name = "H) el cambio de amount muere en el privilegio de columna (42501), no en el trigger";
		const { error } = await attempt({ role: "authenticated", ownerId: ownerA }, async () => {
			await scratch.query("update public.payment set amount = amount + 1 where id = $1", [paymentA]);
		});
		const columnGranted = await scratch.query(
			"select has_column_privilege('authenticated', 'public.payment', 'amount', 'update') as granted",
		);
		if (columnGranted.rows[0].granted) {
			fail(name, "authenticated SI tiene UPDATE sobre payment.amount: el rechazo no prueba el GRANT");
		} else if (!error) {
			fail(name, "el cambio de amount se acepto sin privilegio de columna");
		} else if (error.code !== "42501" || !/permission denied/i.test(error.message)) {
			fail(
				name,
				`se esperaba 42501 "permission denied" (privilegio de columna), se observo ` +
					`${show(error.code)}: ${error.message}`,
			);
		} else if (/amount is immutable/i.test(error.message)) {
			fail(name, `el rechazo vino del trigger de dominio, no del privilegio: ${error.message}`);
		} else {
			ok(name, `42501 ${error.message} (capa de privilegios, no del trigger)`);
		}
	} catch (error) {
		fail(
			"H) el cambio de amount muere en el privilegio de columna (42501), no en el trigger",
			`la verificacion fallo: ${describe(error)}`,
		);
	}

	// Segunda linea de defensa, por la ruta del owner: el trigger de inmutabilidad sigue ahi. Se
	// corre sin rol de aplicacion (el fixture es owner) y siempre en una transaccion con rollback.
	try {
		const name = "H) como owner el trigger de inmutabilidad sigue rechazando el cambio de amount";
		const { error } = await attempt({}, async () => {
			await scratch.query("update public.payment set amount = amount + 1 where id = $1", [paymentA]);
		});
		if (!error) {
			fail(name, "el cambio de amount se acepto como owner: no queda segunda linea de defensa");
		} else if (error.code !== "23514" || !/amount is immutable/i.test(error.message)) {
			fail(
				name,
				`se esperaba 23514 "amount is immutable", se observo ${show(error.code)}: ${error.message}`,
			);
		} else {
			ok(name, `23514 ${error.message}`);
		}
	} catch (error) {
		fail(
			"H) como owner el trigger de inmutabilidad sigue rechazando el cambio de amount",
			`la verificacion fallo: ${describe(error)}`,
		);
	}

	try {
		const name = "H) authenticated no tiene usage sobre private ni execute sobre el trigger de consistencia";
		const { rows } = await scratch.query(
			`select has_schema_privilege('authenticated', 'private', 'usage') as usage_private,
			        has_function_privilege(
			          'authenticated', 'private.assert_owner_consistency()', 'execute'
			        ) as execute_consistency`,
		);
		if (rows[0].usage_private || rows[0].execute_consistency) {
			fail(
				name,
				`se esperaba sin privilegios, se observo usage=${rows[0].usage_private}, ` +
					`execute=${rows[0].execute_consistency}`,
			);
		} else {
			ok(name, "sin usage en private y sin execute, y los triggers igual se ejecutan (por OID)");
		}
	} catch (error) {
		fail(
			"H) authenticated no tiene usage sobre private ni execute sobre el trigger de consistencia",
			`la verificacion fallo: ${describe(error)}`,
		);
	}

	// -----------------------------------------------------------------------
	// I) `anon` no tiene NINGUN privilegio de tabla en `public`. Supabase concedia DML implicito
	//    con `auto_expose_new_tables`; este port no lo copia. Se revisan las cuatro acciones sobre
	//    cada tabla existente, leyendo el catalogo, y ademas se comprueba por comportamiento que
	//    una lectura como `anon` muere con 42501.
	// -----------------------------------------------------------------------
	try {
		const name = "I) anon no tiene privilegios de tabla en public";
		const { rows } = await scratch.query(`
			select c.relname,
			       has_table_privilege('anon', c.oid, 'select') as can_select,
			       has_table_privilege('anon', c.oid, 'insert') as can_insert,
			       has_table_privilege('anon', c.oid, 'update') as can_update,
			       has_table_privilege('anon', c.oid, 'delete') as can_delete
			  from pg_class c
			  join pg_namespace n on n.oid = c.relnamespace
			 where n.nspname = 'public' and c.relkind = 'r'
			 order by c.relname`);
		const loosened = rows.filter(
			(row) => row.can_select || row.can_insert || row.can_update || row.can_delete,
		);

		if (rows.length === 0) {
			fail(name, "el catalogo no devolvio ninguna tabla de public (aserción vacia)");
		} else if (loosened.length > 0) {
			fail(
				name,
				`${loosened.length} tabla(s) con privilegios para anon: ` +
					loosened
						.map(
							(row) =>
								`${row.relname}(${[
									row.can_select && "select",
									row.can_insert && "insert",
									row.can_update && "update",
									row.can_delete && "delete",
								]
									.filter(Boolean)
									.join(",")})`,
						)
						.join(" "),
			);
		} else {
			ok(name, `${rows.length} tablas de public sin privilegios para anon`);
		}
	} catch (error) {
		fail("I) anon no tiene privilegios de tabla en public", `la lectura fallo: ${describe(error)}`);
	}

	try {
		const name = "I) una lectura como anon muere con 42501";
		const { error } = await attempt({ role: "anon" }, async () => {
			await scratch.query("select count(*) from public.entidad");
		});
		if (!error) {
			fail(name, "la lectura como anon se acepto");
		} else if (error.code !== "42501") {
			fail(name, `se esperaba 42501, se observo ${show(error.code)}: ${error.message}`);
		} else {
			ok(name, `42501 ${error.message}`);
		}
	} catch (error) {
		fail("I) una lectura como anon muere con 42501", `la verificacion fallo: ${describe(error)}`);
	}

	// -----------------------------------------------------------------------
	// J) Secretos y ledger fuera del alcance del rol de la aplicacion:
	//    - `auth.session` guarda los bearer tokens y `auth.account` el hash de la clave: la app
	//      los escribe como owner (Better Auth no pasa por `withOwner`), asi que `authenticated`
	//      no debe poder leerlos ni por error.
	//    - `public.__sql_migrations` no tiene RLS: la unica defensa es que no haya privilegios.
	//      Se prueban las cuatro acciones.
	// -----------------------------------------------------------------------
	const FORBIDDEN_READS = [
		{ table: "auth.session", statement: "select count(*) from auth.session" },
		{ table: "auth.account", statement: "select count(*) from auth.account" },
	];

	for (const target of FORBIDDEN_READS) {
		const name = `J) authenticated no puede leer ${target.table}`;
		try {
			const { error } = await attempt({ role: "authenticated", ownerId: ownerA }, async () => {
				await scratch.query(target.statement);
			});
			if (!error) {
				fail(name, "la lectura se acepto");
			} else if (error.code !== "42501") {
				fail(name, `se esperaba 42501, se observo ${show(error.code)}: ${error.message}`);
			} else {
				ok(name, `42501 ${error.message}`);
			}
		} catch (error) {
			fail(name, `la verificacion fallo: ${describe(error)}`);
		}
	}

	const LEDGER_STATEMENTS = [
		{ verb: "select", statement: "select count(*) from public.__sql_migrations" },
		{
			verb: "insert",
			statement: "insert into public.__sql_migrations (name) values ('check-rls-ledger')",
		},
		{
			verb: "update",
			statement: "update public.__sql_migrations set applied_at = applied_at",
		},
		{ verb: "delete", statement: "delete from public.__sql_migrations where false" },
	];

	for (const target of LEDGER_STATEMENTS) {
		const name = `J) authenticated no puede ${target.verb} en public.__sql_migrations`;
		try {
			const { error } = await attempt({ role: "authenticated", ownerId: ownerA }, async () => {
				await scratch.query(target.statement);
			});
			if (!error) {
				fail(name, `el ${target.verb} se acepto`);
			} else if (error.code !== "42501") {
				fail(name, `se esperaba 42501, se observo ${show(error.code)}: ${error.message}`);
			} else {
				ok(name, `42501 ${error.message}`);
			}
		} catch (error) {
			fail(name, `la verificacion fallo: ${describe(error)}`);
		}
	}

	// -----------------------------------------------------------------------
	// K) Barrido por TODAS las tablas de `public` con RLS y al menos una politica: una politica
	//    aflojada en una tabla que este script no siembra (por ejemplo `payment_method`) tambien
	//    tiene que fallar. Dos comprobaciones por tabla:
	//      1. cada politica aplica a `authenticated` (o a PUBLIC) y el predicado del comando que
	//         gobierna menciona `auth.uid()`; una politica `using (true)` no lo menciona,
	//      2. si la tabla tiene `owner_id`, el dueno A no ve filas de otro dueno ni filas con
	//         `owner_id` nulo (con filas sembradas -- `entidad` y `payment` -- esto es
	//         comportamiento real; en una tabla vacia es vacuo y la prueba es la 1).
	// -----------------------------------------------------------------------
	try {
		const { rows } = await scratch.query(`
			select c.relname as table_name,
			       c.relrowsecurity as rls_enabled,
			       exists (
			         select 1 from pg_attribute a
			          where a.attrelid = c.oid and a.attname = 'owner_id'
			            and a.attnum > 0 and not a.attisdropped
			       ) as has_owner_id,
			       coalesce(
			         json_agg(json_build_object(
			           'name', p.polname,
			           'command', p.polcmd,
			           'roles', (
			             select array_agg(case when r = 0 then 'PUBLIC' else pg_get_userbyid(r) end)
			               from unnest(p.polroles) as r
			           ),
			           'qual', pg_get_expr(p.polqual, p.polrelid),
			           'with_check', pg_get_expr(p.polwithcheck, p.polrelid)
			         ) order by p.polname)
			         filter (where p.oid is not null),
			         '[]'::json
			       ) as policies
			  from pg_class c
			  join pg_namespace n on n.oid = c.relnamespace
			  left join pg_policy p on p.polrelid = c.oid
			 where n.nspname = 'public' and c.relkind = 'r'
			 group by c.oid, c.relname, c.relrowsecurity
			 order by c.relname`);

		const guarded = rows.filter((row) => row.rls_enabled && row.policies.length > 0);

		if (guarded.length === 0) {
			throw new Error("el catalogo no devolvio ninguna tabla de public con RLS y politica");
		}

		const commandName = { r: "select", a: "insert", w: "update", d: "delete", "*": "all" };

		for (const table of guarded) {
			const name = `K) ${table.table_name}: RLS y politica por dueno`;
			const problems = [];

			for (const policy of table.policies) {
				const roles = policy.roles ?? [];
				const targetsApplication = roles.includes("authenticated") || roles.includes("PUBLIC");
				if (!targetsApplication) {
					problems.push(
						`la politica ${policy.name} no aplica a authenticated (roles: ${roles.join(",")})`,
					);
					continue;
				}

				// Predicados que el comando realmente evalua. `WITH CHECK` es lo que filtra
				// escrituras; `USING` es lo que filtra lecturas y filas visibles para UPDATE y
				// DELETE. Se exige que cada predicado requerido exista y nombre `auth.uid()`.
				const required = [];
				if (policy.command === "a") required.push(["with_check", policy.with_check]);
				else if (policy.command === "r" || policy.command === "d") required.push(["qual", policy.qual]);
				else required.push(["qual", policy.qual], ["with_check", policy.with_check]);

				for (const [kind, predicate] of required) {
					if (!predicate) {
						problems.push(
							`la politica ${policy.name} (${commandName[policy.command] ?? policy.command}) no tiene ${kind}`,
						);
					} else if (!/auth\.uid\(\)/i.test(predicate)) {
						problems.push(
							`la politica ${policy.name} (${commandName[policy.command] ?? policy.command}) no usa auth.uid() en ${kind}: ${predicate}`,
						);
					}
				}
			}

			let evidence = `${table.policies.length} politica(s) por dueno`;
			if (table.has_owner_id) {
				const { value, error } = await attempt(
					{ role: "authenticated", ownerId: ownerA },
					async () => {
						const result = await scratch.query(
							`select (count(*))::int as total,
							        (count(*) filter (where owner_id = $1))::int as own_rows,
							        (count(*) filter (where owner_id = $2))::int as foreign_rows,
							        (count(*) filter (where owner_id is null))::int as null_owner_rows
							   from public.${quoteIdent(table.table_name)}`,
							[ownerA, ownerB],
						);
						return result.rows[0];
					},
				);

				if (error) {
					fail(name, `la lectura como dueno A fallo: ${describe(error)}`);
					continue;
				}
				if (value.foreign_rows !== 0) {
					problems.push(`${value.foreign_rows} fila(s) de otro dueno visibles`);
				}
				if (value.null_owner_rows !== 0) {
					problems.push(`${value.null_owner_rows} fila(s) con owner_id nulo visibles`);
				}
				evidence += `, ${value.total} fila(s) visible(s) (0 ajenas, 0 sin dueno)`;
			} else {
				evidence += ", sin columna owner_id (la politica es la prueba)";
			}

			if (problems.length > 0) fail(name, problems.join("; "));
			else ok(name, evidence);
		}
	} catch (error) {
		fail("K) barrido de tablas con RLS y politica", `la verificacion fallo: ${describe(error)}`);
	}

	// -----------------------------------------------------------------------
	// L) El historial financiero es append-only por PRIVILEGIO, no solo por trigger.
	//
	//    `20261012221550_harden_financial_history_v1.sql` revoca UPDATE/DELETE sobre
	//    `cash_close` y `payment_allocation`, revoca UPDATE y DELETE sobre `payment`, y vuelve a
	//    concederle solo cuatro columnas (`entity_id`, `status`, `void_reason`, `voided_at`). El
	//    `grant select, insert, update, delete on all tables in schema public to authenticated` de
	//    `20261029101500_better_auth_tables_and_role_grants.sql` deshacia eso en silencio: basta
	//    un `grant` masivo posterior para que cualquier columna de `payment` vuelva a ser
	//    editable. Este grupo fija la matriz que el origen queria y que la migracion de grants
	//    reaplica despues de su propio GRANT.
	//
	//    Se afirma sobre el catalogo (`has_table_privilege` para el privilegio de tabla y
	//    `has_column_privilege` para el de columna: son entradas de ACL distintas, y `DELETE` no
	//    existe a nivel de columna) y por comportamiento, con un UPDATE real: el mensaje
	//    `42501 permission denied` -- y no `payment.amount is immutable` -- es la evidencia de que
	//    quien rechaza es la capa de privilegios.
	// -----------------------------------------------------------------------
	try {
		const name = "L) authenticated conserva el hardening del historial financiero";
		const tables = ["payment", "cash_close", "payment_allocation"];
		const problems = [];

		const { rows: tableRows } = await scratch.query(
			`select c.relname as table_name,
			        has_table_privilege('authenticated', c.oid, 'insert') as can_insert,
			        has_table_privilege('authenticated', c.oid, 'update') as can_update,
			        has_table_privilege('authenticated', c.oid, 'delete') as can_delete
			   from pg_class c
			   join pg_namespace n on n.oid = c.relnamespace
			  where n.nspname = 'public' and c.relkind = 'r'
			    and c.relname = any($1::text[])
			  order by c.relname`,
			[tables],
		);

		if (tableRows.length !== tables.length) {
			problems.push(
				`el catalogo devolvio ${tableRows.length} de ${tables.length} tabla(s) del historial financiero`,
			);
		}
		for (const row of tableRows) {
			if (row.can_update) problems.push(`authenticated SI tiene UPDATE de tabla sobre ${row.table_name}`);
			if (row.can_delete) problems.push(`authenticated SI tiene DELETE de tabla sobre ${row.table_name}`);
			// INSERT nunca fue revocado por el hardening (las escrituras del origen son INSERT +
			// trigger, y el audit S19 depende de ello): si desaparece, se rompio otra cosa.
			if (!row.can_insert) problems.push(`authenticated perdio el INSERT sobre ${row.table_name}`);
		}

		const { rows: columnRows } = await scratch.query(
			`select a.attname as column_name,
			        has_column_privilege('authenticated', 'public.payment', a.attname, 'update') as can_update
			   from pg_attribute a
			  where a.attrelid = 'public.payment'::regclass
			    and a.attnum > 0 and not a.attisdropped
			  order by a.attnum`,
		);

		const EXPECTED_UPDATABLE = ["entity_id", "status", "void_reason", "voided_at"].sort();
		const grantedColumns = columnRows
			.filter((row) => row.can_update)
			.map((row) => row.column_name)
			.sort();

		if (columnRows.length === 0) {
			problems.push("el catalogo no devolvio columnas de public.payment (aserción vacia)");
		} else if (grantedColumns.join(",") !== EXPECTED_UPDATABLE.join(",")) {
			problems.push(
				`las columnas de payment con UPDATE son ${grantedColumns.join(",") || "(ninguna)"}, ` +
					`se esperaban ${EXPECTED_UPDATABLE.join(",")}`,
			);
		}

		// Las columnas nombradas por el hardening tienen que estar, y `amount` ademas se afirma
		// explicitamente: es la que sostiene el valor del historial.
		for (const required of [...EXPECTED_UPDATABLE, "amount"]) {
			const column = columnRows.find((row) => row.column_name === required);
			if (!column) problems.push(`no existe la columna payment.${required}`);
			else if (required === "amount" && column.can_update) {
				problems.push("authenticated SI puede actualizar payment.amount");
			}
		}

		if (problems.length > 0) {
			fail(name, problems.join("; "));
		} else {
			ok(
				name,
				`payment/cash_close/payment_allocation sin UPDATE ni DELETE de tabla; ` +
					`UPDATE por columna en payment: ${grantedColumns.join(",")}; INSERT intacto`,
			);
		}
	} catch (error) {
		fail(
			"L) authenticated conserva el hardening del historial financiero",
			`la verificacion fallo: ${describe(error)}`,
		);
	}

	try {
		const name = "L) un UPDATE real a una columna no concedida de payment muere con 42501";
		const { value, error } = await attempt({ role: "authenticated", ownerId: ownerA }, async () => {
			const result = await scratch.query(
				"update public.payment set notes = 'intruso' where id = $1",
				[paymentA],
			);
			return result.rowCount;
		});
		const after = await scratch.query("select notes from public.payment where id = $1", [paymentA]);

		if (!error) {
			fail(name, `el update de notes se acepto (${value} fila(s) afectadas)`);
		} else if (error.code !== "42501" || !/permission denied/i.test(error.message)) {
			fail(
				name,
				`se esperaba 42501 "permission denied", se observo ${show(error.code)}: ${error.message}`,
			);
		} else if (after.rows[0]?.notes !== null) {
			fail(name, `payment.notes cambio de valor: ${show(after.rows[0]?.notes)}`);
		} else {
			ok(name, `42501 ${error.message}, payment.notes intacto`);
		}
	} catch (error) {
		fail(
			"L) un UPDATE real a una columna no concedida de payment muere con 42501",
			`la verificacion fallo: ${describe(error)}`,
		);
	}
} catch (error) {
	fail("setup", describe(error));
} finally {
	// El borrado va con `force` para no depender de que no queden conexiones; si el setup fallo
	// antes de crear la base, no hay nada que borrar.
	if (scratchCreated) {
		if (scratchConnected) await scratch.end().catch(() => {});
		try {
			await admin.query(`drop database if exists ${quoteIdent(scratchName)} with (force)`);
			console.log(`${label("base scratch borrada")} ${scratchName}`);
		} catch (error) {
			console.error(
				label(`no se pudo borrar la base scratch ${scratchName}: ${describe(error)}`),
			);
			failures.push(`limpieza: drop database ${scratchName} fallo (${describe(error)})`);
		}
	}
	await admin.end().catch(() => {});
}

if (failures.length > 0) {
	console.error(
		`${label(`${failures.length} de ${checks} asercion(es) fallida(s)`)}\n` +
			failures.map((failure) => `  - ${failure}`).join("\n"),
	);
	process.exit(1);
}

console.log(
	label(
		`RLS enforza el aislamiento por dueno desde la ruta de la aplicacion ` +
			`(${checks}/${checks} aserciones)`,
	),
);
