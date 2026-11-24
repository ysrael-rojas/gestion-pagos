// Pruebas de `packages/db/migrations/20261125090000_series_rpcs.sql` (T1 del port del vertical
// series, S2/S3/S5/S6 de `odd/tasks/port-vertical-series.md`) contra una base viva con las
// migraciones aplicadas.
//
// Que prueba, en una frase: que el correlativo lo asigna la BASE dentro de la transaccion que
// escribe el comprobante, tomandolo de la serie por defecto de su tipo, y que el CRUD de series
// pasa por tres RPC `SECURITY DEFINER` porque `authenticated` no tiene UPDATE ni DELETE sobre
// `public.voucher_series` (`20261124090000_revoke_payments_writes.sql:133`).
//
// Por que llama a las RPC y no a una ruta HTTP: las series todavia no tienen modulo en `apps/api`
// (eso es T3) y el alta de venta ya se prueba por HTTP en `vouchers.e2e.test.ts`. El camino que si
// existe es el de `withOwner` (`src/db/with-owner.ts`): una transaccion con `app.user_id` fijado y
// `set local role authenticated`, y despues `select public.crear_venta(...)`. Eso es exactamente lo
// que arma `asOwner` aca, copiando `closeViaRpc` de `cash-closes.e2e.test.ts`.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL   la base con las migraciones aplicadas (`node packages/db/scripts/apply-sql.mjs`).
//                  No hace falta sembrarla: los duenos de este archivo son propios, para no
//                  depender del dueno demo ni pisarlo.
//
// Identidad: los duenos se crean por SQL (`auth.users` + sus filas de dominio), igual que
// `packages/db/scripts/check-rls-enforcement.mjs` y que el alta documentada en
// `docs/operacion/crear-usuario.md`. No se inventa ninguna sesion de Better Auth porque este
// archivo no ejercita la sesion: el GUC que lee `auth.uid()` lo fija el test dentro de la
// transaccion, que es el mismo contrato que usa el API.
//
// Aislamiento entre pruebas: cada prueba se crea su PROPIO dueno (`freshOwner`), asi su resultado
// no depende del orden de ejecucion ni del `is_default` de otra prueba (el indice parcial
// `voucher_series_default_per_type_idx` permite una sola serie por defecto por tipo y dueno). El
// teardown borra todo lo que creo, en orden de FK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";

/** Textos de S6, verbatim. Los compara el test contra lo que devuelve la base. */
const CLIENTE_INEXISTENTE = "El cliente seleccionado no existe.";
const VENTA_DUPLICADA = "Ya registraste una venta con ese número de comprobante.";
const DATOS_INVALIDOS = "Los datos del comprobante no son válidos.";
const SIN_SERIE_POR_DEFECTO =
	"No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.";
const SERIE_DUPLICADA = "Ya existe una serie con ese código para ese tipo.";
const DATOS_SERIE_INVALIDOS = "Los datos de la serie no son válidos.";
const SERIE_INEXISTENTE = "La serie no existe.";
const ERROR_GENERICO = "No se pudo completar la operación con la base de datos. Intenta nuevamente.";
/**
 * S13.3: el tipo de un comprobante emitido es inmutable, como su numero. La RPC lo levanta como
 * excepcion de dominio (P0001) y el mapeador del API la convierte en 409.
 */
const TIPO_INMUTABLE = "El tipo de un comprobante emitido no se puede cambiar.";

/** El mensaje del trigger ya portado (`private.protect_paid_comprobante`), textual de S6. */
const COMPROBANTE_CON_PAGOS =
	"No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha";

const DATABASE_URL = process.env.DATABASE_URL?.trim();

if (!DATABASE_URL) {
	throw new Error(
		"Falta DATABASE_URL: estas pruebas corren contra una base con las migraciones aplicadas (no hay valor por defecto).",
	);
}

const pool = new Pool({ connectionString: DATABASE_URL });

/** Dueno de las ventas que se crean y editan, con todo lo que necesita una venta y un pago. */
interface SeededOwner {
	id: string;
	entityId: string;
	methodId: string;
	cashAccountId: string;
	categoryId: string;
}

/** Duenos creados por este archivo, para el teardown. */
const createdOwners: SeededOwner[] = [];

interface PgFailure {
	code: string | null;
	message: string;
	constraint: string | null;
}

/** Normaliza el error de `pg` a lo que afirman estas pruebas. */
function toFailure(error: unknown): PgFailure {
	const candidate = (error ?? {}) as { code?: unknown; message?: unknown; constraint?: unknown };

	return {
		code: typeof candidate.code === "string" ? candidate.code : null,
		message: typeof candidate.message === "string" ? candidate.message : String(error),
		constraint: typeof candidate.constraint === "string" ? candidate.constraint : null,
	};
}

/**
 * Arma la transaccion de la ruta de la aplicacion y corre `run` ADENTRO.
 *
 * Es el contrato de `withOwner`: el GUC primero y el rol despues, o las politicas RLS verian
 * `auth.uid()` nulo. No se importa `withOwner` porque recibe un `Database` de Drizzle y esta
 * prueba no tiene (ni necesita) el harness de Nest: `closeViaRpc` de `cash-closes.e2e.test.ts`
 * hace lo mismo con el pool pelado.
 */
async function runAsOwner<T>(
	ownerId: string,
	run: (client: PoolClient) => Promise<T>,
	commit: boolean,
): Promise<T> {
	const client = await pool.connect();
	let settled = false;

	try {
		await client.query("begin");
		await client.query("select set_config('app.user_id', $1, true)", [ownerId]);
		await client.query("set local role authenticated");

		const value = await run(client);

		if (commit) {
			await client.query("commit");
			settled = true;
		}

		return value;
	} finally {
		// Una transaccion rechazada no se confirma NUNCA: media prueba de la atomicidad es que no
		// quede nada escrito cuando la base dice que no.
		if (!settled) {
			await client.query("rollback").catch(() => undefined);
		}

		client.release();
	}
}

/**
 * Corre `run` con la identidad del dueno y CONFIRMA. Las filas tienen que sobrevivir a la conexion
 * para que las afirmaciones se hagan por fuera de la transaccion (como `dev_user`).
 */
async function asOwner<T>(ownerId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
	return runAsOwner(ownerId, run, true);
}

/** Corre `run` con la identidad del dueno y SIEMPRE revierte. */
async function onOwnerTransaction<T>(
	ownerId: string,
	run: (client: PoolClient) => Promise<T>,
): Promise<T> {
	return runAsOwner(ownerId, run, false);
}

/** Corre `run` con la identidad del dueno y devuelve el rechazo en vez de lanzarlo. */
async function rejectionOf(
	ownerId: string,
	run: (client: PoolClient) => Promise<unknown>,
): Promise<PgFailure> {
	try {
		await onOwnerTransaction(ownerId, run);

		throw new Error("la operacion debio ser rechazada por la base y no lo fue");
	} catch (error) {
		if (error instanceof Error && error.message.startsWith("la operacion debio")) {
			throw error;
		}

		return toFailure(error);
	}
}

interface VentaInput {
	entityId: string;
	voucherType?: string;
	issueDate?: string;
	subtotal: string;
	igv: string;
	total: string;
	paymentType?: string;
	creditDays?: number | null;
}

/**
 * `select public.crear_venta(...)`.
 *
 * OCHO argumentos desde S2: el numero ya no viaja (lo asigna la base desde la serie por defecto del
 * tipo). Si esta firma se rompe, el test falla con "function does not exist", que es exactamente lo
 * que se quiere pinar.
 */
async function crearVenta(client: PoolClient, input: VentaInput): Promise<string> {
	const result = await client.query<{ id: string }>(
		`select public.crear_venta(
			$1::uuid, $2::public.voucher_type, $3::date,
			$4::numeric, $5::numeric, $6::numeric, $7::public.payment_type, $8::integer
		) as id`,
		[
			input.entityId,
			input.voucherType ?? "FACTURA",
			input.issueDate ?? "2026-11-24",
			input.subtotal,
			input.igv,
			input.total,
			input.paymentType ?? "CONTADO",
			input.creditDays ?? null,
		],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "crear_venta deberia devolver el id del comprobante creado");

	return id;
}

/** `select public.editar_venta(...)` para un comprobante ya existente (nueve argumentos, S2). */
async function editarVenta(
	client: PoolClient,
	comprobanteId: string,
	input: VentaInput,
): Promise<string> {
	const result = await client.query<{ id: string }>(
		`select public.editar_venta(
			$1::uuid, $2::uuid, $3::public.voucher_type, $4::date,
			$5::numeric, $6::numeric, $7::numeric, $8::public.payment_type, $9::integer
		) as id`,
		[
			comprobanteId,
			input.entityId,
			input.voucherType ?? "FACTURA",
			input.issueDate ?? "2026-11-24",
			input.subtotal,
			input.igv,
			input.total,
			input.paymentType ?? "CONTADO",
			input.creditDays ?? null,
		],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "editar_venta deberia devolver el id del comprobante editado");

	return id;
}

interface SerieInput {
	voucherType?: string | null;
	code: string;
	isDefault?: boolean;
}

/** `select public.crear_serie(...)` (S5). Un `voucherType` nulo viaja como NULL, no como default. */
async function crearSerie(client: PoolClient, input: SerieInput): Promise<string> {
	const voucherType = input.voucherType === undefined ? "FACTURA" : input.voucherType;

	const result = await client.query<{ id: string }>(
		`select public.crear_serie($1::public.voucher_type, $2::text, $3::boolean) as id`,
		[voucherType, input.code, input.isDefault ?? false],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "crear_serie deberia devolver el id de la serie creada");

	return id;
}

/** `select public.editar_serie(...)` (S5): el tipo NO se recibe, no se edita. */
async function editarSerie(
	client: PoolClient,
	serieId: string,
	input: { code: string; isDefault?: boolean },
): Promise<string> {
	const result = await client.query<{ id: string }>(
		`select public.editar_serie($1::uuid, $2::text, $3::boolean) as id`,
		[serieId, input.code, input.isDefault ?? false],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "editar_serie deberia devolver el id de la serie editada");

	return id;
}

/** `select public.eliminar_serie(...)` (S5): baja logica. */
async function eliminarSerie(client: PoolClient, serieId: string): Promise<string> {
	const result = await client.query<{ id: string }>(
		"select public.eliminar_serie($1::uuid) as id",
		[serieId],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "eliminar_serie deberia devolver el id de la serie dada de baja");

	return id;
}

/** La fila cruda del comprobante, en texto para comparar sin ruido de tipos. */
async function storedVenta(id: string): Promise<Record<string, string | number | null>> {
	const result = await pool.query<Record<string, string | number | null>>(
		`select owner_id::text, entity_id::text, voucher_kind::text, voucher_type::text,
		        voucher_number, issue_date::text, registration_date::text,
		        subtotal::text, igv::text, total::text, payment_type::text,
		        credit_days, due_date::text, status::text
		   from public.comprobante
		  where id = $1`,
		[id],
	);

	const row = result.rows[0];

	assert.ok(row, `deberia existir el comprobante ${id}`);

	return row;
}

/** Numeros de comprobante de un codigo de serie, ordenados, para afirmar altas y rechazos. */
async function ventasOf(ownerId: string, prefix: string): Promise<string[]> {
	const result = await pool.query<{ voucher_number: string }>(
		`select voucher_number
		   from public.comprobante
		  where owner_id = $1 and voucher_number like $2 || '-%'
		  order by voucher_number`,
		[ownerId, prefix],
	);

	return result.rows.map((row) => row.voucher_number);
}

/** Todos los numeros del dueno, ordenados: para afirmar que un rechazo no escribio NADA. */
async function totalVentas(ownerId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.comprobante where owner_id = $1",
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

interface SerieRow {
	id: string;
	voucher_type: string;
	code: string;
	last_number: number;
	is_default: boolean;
	deleted_at: Date | null;
}

/** Las series vivas del dueno, por tipo y codigo. */
async function seriesOf(ownerId: string): Promise<SerieRow[]> {
	const result = await pool.query<SerieRow>(
		`select id, voucher_type::text, code, last_number, is_default, deleted_at
		   from public.voucher_series
		  where owner_id = $1
		  order by voucher_type, code`,
		[ownerId],
	);

	return result.rows;
}

/** `last_number` de la serie de un codigo, o `null` si la serie no existe. */
async function lastNumberOf(
	ownerId: string,
	code: string,
	voucherType = "FACTURA",
): Promise<number | null> {
	const result = await pool.query<{ last_number: number }>(
		`select last_number
		   from public.voucher_series
		  where owner_id = $1 and voucher_type = $2::public.voucher_type
		    and code = $3 and deleted_at is null`,
		[ownerId, voucherType, code],
	);

	return result.rows[0]?.last_number ?? null;
}

/**
 * Siembra un dueno con su entidad y los catalogos que necesita un pago (metodo, caja y categoria de
 * cobranza), con SQL directo como `dev_user`, igual que los seeds. Las series NO se siembran aca:
 * cada prueba crea las suyas por `crear_serie`, que es el camino de S5.
 */
async function freshOwner(tag: string): Promise<SeededOwner> {
	const id = randomUUID();
	const entityId = randomUUID();
	const ids: SeededOwner = {
		id,
		entityId,
		methodId: randomUUID(),
		cashAccountId: randomUUID(),
		categoryId: randomUUID(),
	};

	await pool.query(
		`insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, true)`,
		[id, `E2E ventas ${tag}`, `e2e-ventas-${tag}-${id}@example.test`],
	);

	await pool.query(
		`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, owner_id)
		 values ($1, 'SIN_DOCUMENTO', '', $2, $3, true, $4)`,
		[entityId, `Cliente ${tag}`, `cliente-${tag}-${id}@example.test`, id],
	);

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'CASH_BOX', $2, 'PEN', 0, current_date - 30, $3)`,
		[ids.cashAccountId, `Caja ${tag}`, id],
	);

	await pool.query(
		`insert into public.payment_method (id, code, name, owner_id) values ($1, $2, $3, $4)`,
		[ids.methodId, `VENTAS_${tag}`.toUpperCase(), "Efectivo", id],
	);

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'INGRESO', $2, $3, $4)`,
		[ids.categoryId, `Cobranza ${tag}`, `VENTAS_${tag}`.toUpperCase(), id],
	);

	createdOwners.push(ids);

	return ids;
}

/**
 * Asigna un pago al comprobante, que es lo que deja el comprobante "con pagos registrados" y
 * dispara `comprobante_protect_paid`.
 *
 * Se inserta como `dev_user` (owner de las tablas), igual que los fixtures del resto del API: lo
 * que se prueba es la EDICION del comprobante, no el alta del pago (que ya tiene sus e2e).
 */
async function assignPayment(
	target: SeededOwner,
	comprobanteId: string,
	amount: number,
): Promise<void> {
	const paymentId = randomUUID();

	await pool.query(
		`insert into public.payment
		   (id, owner_id, entity_id, direction, payment_date, amount,
		    method_id, cash_account_id, category_id, reference, notes)
		 values ($1, $2, $3, 'INGRESO', current_date, $4, $5, $6, $7, 'e2e', 'fixture ventas')`,
		[paymentId, target.id, target.entityId, amount, target.methodId, target.cashAccountId, target.categoryId],
	);

	await pool.query(
		`insert into public.payment_allocation (owner_id, payment_id, comprobante_id, amount)
		 values ($1, $2, $3, $4)`,
		[target.id, paymentId, comprobanteId, amount],
	);
}

/** Borra un dueno completo, en orden de FK (mismo orden que `deleteOwnerFixtures`). */
async function deleteOwner(target: SeededOwner): Promise<void> {
	await pool.query("delete from public.payment_allocation where owner_id = $1", [target.id]);
	await pool.query("delete from public.payment where owner_id = $1", [target.id]);
	await pool.query("delete from public.comprobante where owner_id = $1", [target.id]);
	await pool.query("delete from public.voucher_series where owner_id = $1", [target.id]);
	await pool.query("delete from public.entidad where owner_id = $1", [target.id]);
	await pool.query("delete from public.cash_account where owner_id = $1", [target.id]);
	await pool.query("delete from public.payment_method where owner_id = $1", [target.id]);
	await pool.query("delete from public.cash_receipt_category where owner_id = $1", [target.id]);
	await pool.query("delete from auth.users where id = $1", [target.id]);
}

let owner: SeededOwner;

before(async () => {
	// Un dueno base para las pruebas de catalogo y de atomicidad, que no necesitan identidad propia.
	owner = await freshOwner("base");
});

after(async () => {
	for (const target of createdOwners) {
		await deleteOwner(target);
	}

	await pool.end();
});

test("crear_venta asigna el numero desde la serie por defecto del tipo y avanza last_number en la misma transaccion (S2)", async () => {
	const dueno = await freshOwner("alta");

	const serieId = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const id = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const stored = await storedVenta(id);

	assert.equal(stored.owner_id, dueno.id, "el dueno sale de auth.uid(), no del payload");
	assert.equal(stored.entity_id, dueno.entityId);
	assert.equal(stored.voucher_kind, "VENTA", "la RPC solo produce comprobantes de VENTA");
	assert.equal(stored.voucher_type, "FACTURA");
	// S2: `code || '-' || lpad(last_number + 1, 6, '0')`, con la serie por defecto del tipo.
	assert.equal(stored.voucher_number, "F001-000001");
	assert.equal(stored.issue_date, "2026-11-24");
	assert.equal(stored.subtotal, "100.00");
	assert.equal(stored.igv, "18.00");
	assert.equal(stored.total, "118.00");
	assert.equal(stored.payment_type, "CONTADO");
	assert.equal(stored.credit_days, null);
	assert.equal(stored.due_date, null, "due_date es generada: en CONTADO queda nula");
	assert.equal(stored.status, "PENDIENTE", "el status lo deriva la tabla");
	assert.ok(stored.registration_date, "registration_date la pone la tabla por default");

	assert.equal(
		await lastNumberOf(dueno.id, "F001"),
		1,
		"la serie avanzo en la MISMA transaccion que el alta",
	);

	// La segunda alta sale del `last_number` que dejo la primera: sin huecos y sin repetir.
	const second = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal((await storedVenta(second)).voucher_number, "F001-000002");
	assert.equal(await lastNumberOf(dueno.id, "F001"), 2);

	// CREDITO: `due_date` sigue siendo columna generada (`issue_date + credit_days`) y la RPC no la
	// escribe. Si la escribiera, este INSERT fallaria (no es una columna escribible).
	const creditoId = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
			paymentType: "CREDITO",
			creditDays: 30,
		}),
	);

	const credito = await storedVenta(creditoId);

	assert.equal(credito.voucher_number, "F001-000003");
	assert.equal(credito.payment_type, "CREDITO");
	assert.equal(credito.credit_days, 30);
	assert.equal(credito.due_date, "2026-12-24", "due_date = issue_date + credit_days");
	assert.equal(await lastNumberOf(dueno.id, "F001"), 3);

	// La serie que se uso es la que devolvio `crear_serie`, no una inventada por la RPC.
	const series = await seriesOf(dueno.id);

	assert.deepEqual(
		series.map((row) => ({ id: row.id, code: row.code, last: row.last_number, def: row.is_default })),
		[{ id: serieId, code: "F001", last: 3, def: true }],
		"la RPC no crea ni clona series",
	);
});

test("sin serie por defecto para el tipo el alta falla con el mensaje de S6 y no escribe nada (S2)", async () => {
	const dueno = await freshOwner("sin-serie");

	// Una serie NO por defecto: existe, pero no es la que se usa.
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "BOLETA", code: "B001", isDefault: false }),
	);

	const rejection = await rejectionOf(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			voucherType: "BOLETA",
			subtotal: "50.00",
			igv: "9.00",
			total: "59.00",
		}),
	);

	assert.equal(rejection.message, SIN_SERIE_POR_DEFECTO);
	assert.equal(
		await totalVentas(dueno.id),
		0,
		"sin serie por defecto no se registra: no hay fallback silencioso (L4c)",
	);
	assert.equal(await lastNumberOf(dueno.id, "B001", "BOLETA"), 0, "la serie no avanzo");

	// Y una serie por defecto de OTRO tipo no sirve como fallback.
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const otherType = await rejectionOf(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			voucherType: "BOLETA",
			subtotal: "50.00",
			igv: "9.00",
			total: "59.00",
		}),
	);

	assert.equal(otherType.message, SIN_SERIE_POR_DEFECTO);
	assert.equal(await totalVentas(dueno.id), 0);
});

test("dos altas simultaneas de dos conexiones no repiten ni saltean el correlativo (S2)", async () => {
	const dueno = await freshOwner("carrera");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	// Dos transacciones abiertas a la vez, las dos con la identidad del dueno: es la situacion real
	// de dos ventas simultaneas, no una llamada detras de otra.
	const first = await openOwnerTransaction(dueno.id);
	const second = await openOwnerTransaction(dueno.id);

	try {
		// La primera toma el lock de la serie (`for update`) y lo RETIENE hasta su commit.
		const firstId = await crearVenta(first, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		});

		// La segunda se lanza mientras la primera sigue sin confirmar: si el `for update` no
		// serializara, las dos leerian `last_number = 0` y la segunda chocaria contra el indice
		// unico (o se saltearia un numero).
		const pendingSecond = crearVenta(second, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		});

		await first.query("commit");

		const secondId = await pendingSecond;

		await second.query("commit");

		assert.equal((await storedVenta(firstId)).voucher_number, "F001-000001");
		assert.equal((await storedVenta(secondId)).voucher_number, "F001-000002");

		// Ni repetido ni salteado: los dos numeros exactos, en ese orden, y `last_number` en 2.
		assert.deepEqual(await ventasOf(dueno.id, "F001"), ["F001-000001", "F001-000002"]);
		assert.equal(await lastNumberOf(dueno.id, "F001"), 2);
	} finally {
		await first.query("rollback").catch(() => undefined);
		await second.query("rollback").catch(() => undefined);
		first.release();
		second.release();
	}
});

test("editar_venta no cambia el numero del comprobante emitido (S2)", async () => {
	const dueno = await freshOwner("edicion");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const id = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const editedId = await asOwner(dueno.id, (client) =>
		editarVenta(client, id, {
			entityId: dueno.entityId,
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	assert.equal(editedId, id, "editar_venta devuelve el id del mismo comprobante");

	const stored = await storedVenta(id);

	assert.equal(stored.voucher_number, "F001-000001", "el numero de un emitido es inmutable (L4b)");
	assert.equal(stored.subtotal, "200.00");
	assert.equal(stored.igv, "36.00");
	assert.equal(stored.total, "236.00");
	assert.equal(
		await lastNumberOf(dueno.id, "F001"),
		1,
		"la edicion no avanza la serie: no hay numero nuevo que avanzar",
	);

	// La inmutabilidad no depende del codigo de la RPC: la firma no recibe el numero, asi que no
	// hay forma de pedir otro.
	const args = await pool.query<{ args: string }>(
		`select pg_get_function_arguments('public.editar_venta(uuid, uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer)'::regprocedure) as args`,
	);

	assert.equal((args.rows[0]?.args ?? "").includes("voucher_number"), false);
});

test("con un pago registrado la edicion la rechaza el trigger de S6 y no queda nada escrito", async () => {
	const dueno = await freshOwner("pagos");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const id = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	await assignPayment(dueno, id, 50);

	const blocked = await rejectionOf(dueno.id, (client) =>
		editarVenta(client, id, {
			entityId: dueno.entityId,
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	// Textual de `private.protect_paid_comprobante` (`20261017114635`). La RPC NO lo reemplaza por
	// su mensaje generico: la excepcion de dominio de un trigger pasa tal cual.
	assert.equal(blocked.code, "P0001");
	assert.equal(blocked.message, COMPROBANTE_CON_PAGOS);

	const stored = await storedVenta(id);

	assert.equal(stored.total, "118.00", "el importe no cambio");
	assert.equal(stored.subtotal, "100.00");
	assert.equal(stored.voucher_number, "F001-000001", "el numero tampoco");
	assert.equal(await lastNumberOf(dueno.id, "F001"), 1, "la serie no avanzo con el rechazo");
});

test("un CONTADO con dias de credito lo rechaza el CHECK comprobante_credit_days, no una regla nueva de la RPC", async () => {
	const dueno = await freshOwner("check");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const rejected = await rejectionOf(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
			paymentType: "CONTADO",
			creditDays: 30,
		}),
	);

	assert.equal(rejected.message, DATOS_INVALIDOS);
	assert.equal(rejected.code, "23514", "la familia del CHECK se conserva al traducir el mensaje");
	assert.equal(await totalVentas(dueno.id), 0, "no quedo ninguna fila");
	assert.equal(await lastNumberOf(dueno.id, "F001"), 0, "la serie no avanzo con el rechazo");

	// Y la regla sigue viviendo en la TABLA: el mismo INSERT directo (como dueno de las tablas, sin
	// RPC de por medio) lo rechaza el CHECK con su nombre. Sin esta mitad, el test solo probaria
	// que la RPC rechaza, no que el invariante sea del CHECK.
	const direct = await pool
		.query(
			`insert into public.comprobante
			   (owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
			    issue_date, subtotal, igv, total, payment_type, credit_days)
			 values ($1, $2, 'VENTA', 'FACTURA', 'F001-000099', '2026-11-24', 100, 18, 118, 'CONTADO', 30)`,
			[dueno.id, dueno.entityId],
		)
		.then(
			() => null,
			(error: unknown) => toFailure(error),
		);

	assert.ok(direct, "el INSERT directo con CONTADO y credit_days debio ser rechazado");
	assert.equal(direct.code, "23514");
	assert.equal(direct.constraint, "comprobante_credit_days");
});

test("el tipo invalido y el cliente ajeno responden el mensaje de S6 y no escriben nada", async () => {
	const dueno = await freshOwner("invalido");
	const ajeno = await freshOwner("ajeno");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const badType = await rejectionOf(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			voucherType: "NOTA_CREDITO",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(badType.message, DATOS_INVALIDOS, "el slice 1 solo da de alta comprobantes base");

	const foreignClient = await rejectionOf(dueno.id, (client) =>
		crearVenta(client, {
			entityId: ajeno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(
		foreignClient.message,
		CLIENTE_INEXISTENTE,
		"un cliente de otro dueno es indistinguible de uno inexistente",
	);

	const missingClient = await rejectionOf(dueno.id, (client) =>
		crearVenta(client, {
			entityId: randomUUID(),
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(missingClient.message, CLIENTE_INEXISTENTE);

	assert.equal(await totalVentas(dueno.id), 0, "ninguno de los tres rechazos escribio");
	assert.equal(await totalVentas(ajeno.id), 0);
	assert.equal(await lastNumberOf(dueno.id, "F001"), 0);
});

test("editar_venta no toca el comprobante de otro dueno y responde el mensaje de la RPC", async () => {
	const dueno = await freshOwner("propio");
	const ajeno = await freshOwner("ajeno-edicion");

	await asOwner(ajeno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const foreignId = await asOwner(ajeno.id, (client) =>
		crearVenta(client, {
			entityId: ajeno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const attempt = await rejectionOf(dueno.id, (client) =>
		editarVenta(client, foreignId, {
			entityId: dueno.entityId,
			subtotal: "1.00",
			igv: "0.18",
			total: "1.18",
		}),
	);

	assert.equal(attempt.message, "El comprobante no existe.");

	const stored = await storedVenta(foreignId);

	assert.equal(stored.owner_id, ajeno.id);
	assert.equal(stored.voucher_number, "F001-000001", "la fila ajena quedo intacta");
	assert.equal(stored.total, "118.00");
});

// ---------------------------------------------------------------------------
// Las tres RPC de serie (S5).
// ---------------------------------------------------------------------------

test("crear_serie con is_default limpia el default anterior del mismo tipo en la misma transaccion (S5)", async () => {
	const dueno = await freshOwner("crear-serie");

	const first = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);
	const second = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F002", isDefault: true }),
	);

	const series = await seriesOf(dueno.id);

	assert.deepEqual(
		series.map((row) => ({ id: row.id, code: row.code, def: row.is_default })),
		[
			{ id: first, code: "F001", def: false },
			{ id: second, code: "F002", def: true },
		],
		"una sola por defecto por tipo: el indice parcial queda satisfecho",
	);

	// El default nuevo es el que usa el alta desde ese momento.
	const id = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedVenta(id)).voucher_number, "F002-000001");

	// Los tipos son independientes: una serie por defecto de BOLETA no toca la de FACTURA.
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "BOLETA", code: "B001", isDefault: true }),
	);

	const after = await seriesOf(dueno.id);

	assert.equal(after.find((row) => row.code === "F002")?.is_default, true);
	assert.equal(after.find((row) => row.code === "B001")?.is_default, true);
});

test("crear_serie con un codigo repetido responde el mensaje de S6 y no escribe (S5, S6)", async () => {
	const dueno = await freshOwner("codigo-repetido");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const duplicate = await rejectionOf(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: false }),
	);

	assert.equal(duplicate.message, SERIE_DUPLICADA);
	assert.equal(duplicate.code, "23505", "se conserva la familia: el API elige el status por ella");

	const series = await seriesOf(dueno.id);

	assert.equal(series.length, 1, "quedo una sola fila");
	assert.equal(series[0]?.is_default, true, "el default existente no se toco");

	// El mismo codigo en otro tipo NO es duplicado: el indice es por (dueno, tipo, codigo).
	const otherType = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "BOLETA", code: "F001", isDefault: false }),
	);

	assert.ok(otherType);
	assert.equal((await seriesOf(dueno.id)).length, 2);
});

test("los datos invalidos de una serie responden el mensaje de S6 y no limpian el default anterior (S5, S6)", async () => {
	const dueno = await freshOwner("serie-invalida");

	const original = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	// 5 caracteres: el CHECK `code ~ '^[A-Za-z0-9]{1,4}$'` de la tabla lo rechaza y la RPC traduce
	// el 23514 al mensaje de S6.
	const tooLong = await rejectionOf(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F0011", isDefault: true }),
	);

	assert.equal(tooLong.message, DATOS_SERIE_INVALIDOS);
	assert.equal(tooLong.code, "23514");

	// Atomicidad del "limpia el default anterior + inserta": el rechazo NO puede dejar el tipo sin
	// default. Es la razon de la transaccion de la funcion, no un detalle de estilo.
	const series = await seriesOf(dueno.id);

	assert.deepEqual(
		series.map((row) => ({ id: row.id, code: row.code, def: row.is_default })),
		[{ id: original, code: "F001", def: true }],
	);

	// Un tipo nulo tampoco entra por una regla nueva de la RPC: es el NOT NULL de la tabla.
	const noType = await rejectionOf(dueno.id, (client) =>
		crearSerie(client, { voucherType: null, code: "F003", isDefault: false }),
	);

	assert.equal(noType.message, DATOS_SERIE_INVALIDOS);
	assert.equal((await seriesOf(dueno.id)).length, 1);
});

test("editar_serie cambia el codigo y el default, y nunca el tipo (S5)", async () => {
	const dueno = await freshOwner("editar-serie");

	const factura = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);
	const boleta = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "BOLETA", code: "B001", isDefault: true }),
	);

	const edited = await asOwner(dueno.id, (client) =>
		editarSerie(client, factura, { code: "F009", isDefault: true }),
	);

	assert.equal(edited, factura);

	const series = await seriesOf(dueno.id);

	assert.deepEqual(
		series.map((row) => ({ id: row.id, code: row.code, type: row.voucher_type, def: row.is_default })),
		[
			{ id: boleta, code: "B001", type: "BOLETA", def: true },
			{ id: factura, code: "F009", type: "FACTURA", def: true },
		],
		"el tipo de la fila editada sigue siendo FACTURA",
	);

	// La firma no recibe el tipo: cambiarlo reescribiria la numeracion ya emitida (L4a).
	const args = await pool.query<{ args: string }>(
		`select pg_get_function_arguments('public.editar_serie(uuid, text, boolean)'::regprocedure) as args`,
	);

	assert.equal(
		(args.rows[0]?.args ?? "").includes("voucher_type"),
		false,
		"editar_serie no acepta el tipo",
	);

	// El codigo nuevo es el que usa el alta.
	const id = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedVenta(id)).voucher_number, "F009-000001");
});

test("editar_serie mueve el default al mismo tipo y responde los errores de S6 (S5, S6)", async () => {
	const dueno = await freshOwner("editar-default");

	const first = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);
	const second = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F002", isDefault: false }),
	);

	await asOwner(dueno.id, (client) =>
		editarSerie(client, second, { code: "F002", isDefault: true }),
	);

	const series = await seriesOf(dueno.id);

	assert.equal(series.find((row) => row.id === first)?.is_default, false);
	assert.equal(series.find((row) => row.id === second)?.is_default, true);

	// Cambiar el codigo a uno ya usado por el mismo tipo choca con el indice unico.
	const duplicate = await rejectionOf(dueno.id, (client) =>
		editarSerie(client, second, { code: "F001", isDefault: true }),
	);

	assert.equal(duplicate.message, SERIE_DUPLICADA);
	assert.equal(duplicate.code, "23505");

	const after = await seriesOf(dueno.id);

	assert.equal(after.find((row) => row.id === second)?.code, "F002", "el rechazo no cambio el codigo");
	assert.equal(await lastNumberOf(dueno.id, "F001"), 0);
});

test("eliminar_serie es baja logica: deja de usarse, respeta el default de su tipo y conserva los comprobantes (S5)", async () => {
	const dueno = await freshOwner("eliminar-serie");

	const serieId = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const ventaId = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedVenta(ventaId)).voucher_number, "F001-000001");

	const deleted = await asOwner(dueno.id, (client) => eliminarSerie(client, serieId));

	assert.equal(deleted, serieId);

	// Baja LOGICA: la fila sigue, con `deleted_at`.
	const rows = await seriesOf(dueno.id);

	assert.equal(rows.length, 1);
	assert.ok(rows[0]?.deleted_at, "la serie quedo con deleted_at");

	// Los comprobantes ya registrados no cambian (S8 del doc: el dialogo lo promete).
	const stored = await storedVenta(ventaId);

	assert.equal(stored.voucher_number, "F001-000001");
	assert.equal(stored.total, "11.80");

	// Y deja de usarse: sin default vivo, el alta responde el mensaje de S6.
	const rejection = await rejectionOf(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal(rejection.message, SIN_SERIE_POR_DEFECTO);
	assert.equal(await totalVentas(dueno.id), 1, "no se escribio otra venta");

	// Una serie borrada ya no existe para las otras dos RPC.
	const gone = await rejectionOf(dueno.id, (client) =>
		editarSerie(client, serieId, { code: "F001", isDefault: true }),
	);

	assert.equal(gone.message, SERIE_INEXISTENTE);

	const goneAgain = await rejectionOf(dueno.id, (client) => eliminarSerie(client, serieId));

	assert.equal(goneAgain.message, SERIE_INEXISTENTE);
});

test("editar_serie y eliminar_serie responden `La serie no existe.` para un id de otro dueno (S5, S6)", async () => {
	const dueno = await freshOwner("serie-propia");
	const ajeno = await freshOwner("serie-ajena");

	const foreign = await asOwner(ajeno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const editAttempt = await rejectionOf(dueno.id, (client) =>
		editarSerie(client, foreign, { code: "F999", isDefault: true }),
	);

	assert.equal(editAttempt.message, SERIE_INEXISTENTE);

	const deleteAttempt = await rejectionOf(dueno.id, (client) => eliminarSerie(client, foreign));

	assert.equal(deleteAttempt.message, SERIE_INEXISTENTE);

	// El mismo texto para un id inventado: no se filtra la existencia de series ajenas.
	const invented = await rejectionOf(dueno.id, (client) => eliminarSerie(client, randomUUID()));

	assert.equal(invented.message, SERIE_INEXISTENTE);

	const ajenas = await seriesOf(ajeno.id);

	assert.equal(ajenas.length, 1);
	assert.equal(ajenas[0]?.code, "F001", "la serie ajena quedo intacta");
	assert.equal(ajenas[0]?.is_default, true);
	assert.equal(ajenas[0]?.deleted_at, null);
});

// ---------------------------------------------------------------------------
// S13 (T3b): los tres huecos que dejo abierto el correlativo asignado por la base.
// ---------------------------------------------------------------------------

test("recrear una serie dada de baja arranca en el maximo ya emitido con ese codigo, no en 0 (S13.1)", async () => {
	const dueno = await freshOwner("recrear-serie");
	const ajeno = await freshOwner("recrear-ajeno");

	// Numeracion de OTRO dueno con el mismo codigo: no puede bleeding hacia este dueno (el
	// `(dueno, tipo, codigo)` es la clave del calculo, no el codigo suelto).
	await asOwner(ajeno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	for (let index = 0; index < 3; index += 1) {
		await asOwner(ajeno.id, (client) =>
			crearVenta(client, {
				entityId: ajeno.entityId,
				subtotal: "10.00",
				igv: "1.80",
				total: "11.80",
			}),
		);
	}

	const serieId = await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const emitidas: string[] = [];

	for (let index = 0; index < 2; index += 1) {
		emitidas.push(
			await asOwner(dueno.id, (client) =>
				crearVenta(client, {
					entityId: dueno.entityId,
					subtotal: "10.00",
					igv: "1.80",
					total: "11.80",
				}),
			),
		);
	}

	assert.deepEqual(
		await Promise.all(emitidas.map(async (id) => (await storedVenta(id)).voucher_number)),
		["F001-000001", "F001-000002"],
	);

	// Una COMPRA con un numero alto en el MISMO prefijo: no es una venta emitida con esa serie, y
	// el indice unico que el alta de venta puede violar es por `voucher_kind`, asi que tampoco
	// compite. Si el calculo no filtrara el tipo de comprobante, la serie recreada arrancaria en 42.
	await pool.query(
		`insert into public.comprobante
		   (owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
		    issue_date, subtotal, igv, total, payment_type)
		 values ($1, $2, 'COMPRA', 'FACTURA', 'F001-000042', '2026-11-24', 10, 1.8, 11.8, 'CONTADO')`,
		[dueno.id, dueno.entityId],
	);

	// La serie se da de baja: es el caso del origen que hacia chocar la primera venta siguiente.
	await asOwner(dueno.id, (client) => eliminarSerie(client, serieId));

	// Otro codigo del mismo dueno y tipo emite con su propia numeracion.
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F002", isDefault: true }),
	);

	const otra = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedVenta(otra)).voucher_number, "F002-000001");

	// El codigo F001 vuelve, no por defecto: tiene que arrancar en el maximo ya emitido con
	// `(este dueno, FACTURA, F001)`, que es 2 y no 0 (ni 1 de F002, ni 3 del otro dueno, ni 42 de
	// la compra).
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: false }),
	);

	assert.equal(
		await lastNumberOf(dueno.id, "F001"),
		2,
		"la serie recreada arranca en el maximo ya emitido, no en 0",
	);
	assert.equal(await lastNumberOf(dueno.id, "F002"), 1, "el otro codigo no se movio");

	// Y la primera venta de la serie recreada continua la numeracion: sin esto, seria
	// `F001-000001` y chocaria contra `comprobante_owner_kind_number_key` con el mensaje
	// `Ya registraste una venta con ese número de comprobante.`
	const f001 = await seriesOf(dueno.id).then((rows) =>
		rows.find((row) => row.code === "F001" && row.deleted_at === null),
	);

	assert.ok(f001, "la serie F001 recreada deberia existir");

	await asOwner(dueno.id, (client) => editarSerie(client, f001.id, { code: "F001", isDefault: true }));

	const siguiente = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedVenta(siguiente)).voucher_number, "F001-000003");
	assert.equal(await lastNumberOf(dueno.id, "F001"), 3);

	// Los numeros del otro dueno y los de la compra quedaron como estaban.
	assert.deepEqual(await ventasOf(ajeno.id, "F001"), [
		"F001-000001",
		"F001-000002",
		"F001-000003",
	]);
});

test("crear_serie acepta los tipos de nota y solo la retencion queda afuera (S13.2, S3 del port de notas)", async () => {
	const dueno = await freshOwner("tipo-serie");

	// El port de notas (S3 de `port-vertical-notas.md`) abrio los dos tipos de nota: ahora hay un
	// flujo que los emite y sin serie propia no tienen correlativo. La retencion sigue afuera hasta
	// que exista el suyo, con el mismo mensaje y sin escribir nada.
	const rechazo = await rejectionOf(dueno.id, (client) =>
		crearSerie(client, { voucherType: "COMPROBANTE_RETENCION", code: "F001", isDefault: true }),
	);

	assert.equal(rechazo.message, DATOS_SERIE_INVALIDOS, "el tipo COMPROBANTE_RETENCION no se emite");
	assert.equal(rechazo.code, "23514", "la familia es la de los datos invalidos, no el generico");

	assert.equal(
		(await seriesOf(dueno.id)).length,
		0,
		"el tipo que no se emite no dejo fila, y el default anterior no se limpio",
	);

	// Los cinco que si se emiten siguen entrando, y con sus reglas de siempre.
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "BOLETA", code: "B001", isDefault: true }),
	);
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "NOTA_VENTA", code: "NV01", isDefault: true }),
	);
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "NOTA_CREDITO", code: "FC01", isDefault: true }),
	);
	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "NOTA_DEBITO", code: "FD01", isDefault: true }),
	);

	assert.deepEqual(
		(await seriesOf(dueno.id)).map((row) => row.voucher_type),
		["BOLETA", "FACTURA", "NOTA_CREDITO", "NOTA_DEBITO", "NOTA_VENTA"],
	);
});

test("editar_venta rechaza cambiar el tipo de un comprobante emitido y no escribe nada (S13.3)", async () => {
	const dueno = await freshOwner("tipo-inmutable");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "F001", isDefault: true }),
	);

	const id = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal((await storedVenta(id)).voucher_number, "F001-000001");

	const antes = await storedVenta(id);

	// El numero lo asigno la serie de FACTURA: publicarlo bajo BOLETA dejaria un correlativo de
	// factura emitido como boleta. El comprobante se corrige con NC/ND, no cambiando de tipo.
	const rechazo = await rejectionOf(dueno.id, (client) =>
		editarVenta(client, id, {
			entityId: dueno.entityId,
			voucherType: "BOLETA",
			issueDate: "2027-01-05",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	assert.equal(rechazo.message, TIPO_INMUTABLE);
	assert.equal(rechazo.code, "P0001", "es una excepcion de dominio: el API la mapea a 409");

	// Nada mas de la fila cambio: ni el tipo, ni el numero, ni el importe, ni la fecha.
	assert.deepEqual(await storedVenta(id), antes);
	assert.equal(await lastNumberOf(dueno.id, "F001"), 1, "la serie no avanzo con el rechazo");

	// Control positivo: la misma edicion con el MISMO tipo si escribe (el rechazo de arriba es por
	// el tipo, no porque la edicion este rota).
	const edited = await asOwner(dueno.id, (client) =>
		editarVenta(client, id, {
			entityId: dueno.entityId,
			voucherType: "FACTURA",
			issueDate: "2027-01-05",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	assert.equal(edited, id);

	const despues = await storedVenta(id);

	assert.equal(despues.voucher_type, "FACTURA");
	assert.equal(despues.voucher_number, "F001-000001", "el numero sigue siendo el del alta");
	assert.equal(despues.issue_date, "2027-01-05");
	assert.equal(despues.total, "236.00");
});

// ---------------------------------------------------------------------------
// Grants y atomicidad.
// ---------------------------------------------------------------------------

test("S5: authenticated ejecuta las cinco RPC y NO conserva UPDATE ni DELETE directo sobre comprobante ni voucher_series", async () => {
	const crearVentaFn =
		"public.crear_venta(uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer)";
	const editarVentaFn =
		"public.editar_venta(uuid, uuid, public.voucher_type, date, numeric, numeric, numeric, public.payment_type, integer)";
	const crearSerieFn = "public.crear_serie(public.voucher_type, text, boolean)";
	const editarSerieFn = "public.editar_serie(uuid, text, boolean)";
	const eliminarSerieFn = "public.eliminar_serie(uuid)";

	const grants = await pool.query<Record<string, boolean>>(
		`select has_function_privilege('authenticated', $1, 'execute') as puede_crear_venta,
		        has_function_privilege('authenticated', $2, 'execute') as puede_editar_venta,
		        has_function_privilege('authenticated', $3, 'execute') as puede_crear_serie,
		        has_function_privilege('authenticated', $4, 'execute') as puede_editar_serie,
		        has_function_privilege('authenticated', $5, 'execute') as puede_eliminar_serie,
		        has_function_privilege('anon', $3, 'execute') as anon_crear_serie,
		        has_function_privilege('anon', $4, 'execute') as anon_editar_serie,
		        has_function_privilege('anon', $5, 'execute') as anon_eliminar_serie,
		        has_table_privilege('authenticated', 'public.comprobante', 'select') as comprobante_select,
		        has_table_privilege('authenticated', 'public.comprobante', 'insert') as comprobante_insert,
		        has_table_privilege('authenticated', 'public.comprobante', 'update') as comprobante_update,
		        has_table_privilege('authenticated', 'public.comprobante', 'delete') as comprobante_delete,
		        has_table_privilege('authenticated', 'public.voucher_series', 'select') as serie_select,
		        has_table_privilege('authenticated', 'public.voucher_series', 'insert') as serie_insert,
		        has_table_privilege('authenticated', 'public.voucher_series', 'update') as serie_update,
		        has_table_privilege('authenticated', 'public.voucher_series', 'delete') as serie_delete`,
		[crearVentaFn, editarVentaFn, crearSerieFn, editarSerieFn, eliminarSerieFn],
	);

	const row = grants.rows[0];

	assert.ok(row, "el catalogo deberia devolver los privilegios");
	assert.equal(row.puede_crear_venta, true);
	assert.equal(row.puede_editar_venta, true);
	assert.equal(row.puede_crear_serie, true, "authenticated ejecuta crear_serie");
	assert.equal(row.puede_editar_serie, true);
	assert.equal(row.puede_eliminar_serie, true);
	assert.equal(row.anon_crear_serie, false, "anon no ejecuta ninguna RPC de serie");
	assert.equal(row.anon_editar_serie, false);
	assert.equal(row.anon_eliminar_serie, false);

	// El estado que fijo `20261124090000` no cambia con esta migracion: las RPC de serie no se
	// pagan con DML re-otorgado.
	assert.equal(row.comprobante_update, false, "UPDATE de comprobante sigue revocado");
	assert.equal(row.comprobante_delete, false, "DELETE de comprobante sigue revocado");
	assert.equal(row.serie_update, false, "UPDATE de voucher_series sigue revocado");
	assert.equal(row.serie_delete, false, "DELETE de voucher_series sigue revocado");

	// INSERT/SELECT quedan como estaban: no son parte de esta deuda.
	assert.equal(row.comprobante_select, true);
	assert.equal(row.comprobante_insert, true);
	assert.equal(row.serie_select, true);
	assert.equal(row.serie_insert, true);

	// Las firmas viejas (con el numero) y el helper del "maximo visto" ya no existen.
	const gone = await pool.query<Record<string, string | null>>(
		`select to_regprocedure('public.crear_venta(uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer)')::text as crear_vieja,
		        to_regprocedure('public.editar_venta(uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer)')::text as editar_vieja,
		        to_regprocedure('private.advance_series_number(uuid, public.voucher_type, text)')::text as avance`,
	);

	assert.equal(gone.rows[0]?.crear_vieja, null, "la firma con p_voucher_number se fue");
	assert.equal(gone.rows[0]?.editar_vieja, null);
	assert.equal(gone.rows[0]?.avance, null, "el avance por 'maximo visto' ya no existe");

	// Y por comportamiento: el mismo rol que puede llamar a las RPC no puede escribir las tablas.
	const id = await asOwner(owner.id, async (client) => {
		await crearSerie(client, { voucherType: "BOLETA", code: "B001", isDefault: true });

		return crearVenta(client, {
			entityId: owner.entityId,
			voucherType: "BOLETA",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		});
	});

	for (const statement of [
		"update public.comprobante set total = total + 1",
		"delete from public.comprobante",
		"update public.voucher_series set last_number = 0",
		"delete from public.voucher_series",
	]) {
		const failure = await rejectionOf(owner.id, (client) => client.query(statement));

		assert.equal(failure.code, "42501", `${statement} deberia morir por privilegios`);
	}

	assert.equal((await storedVenta(id)).total, "11.80", "las filas quedaron intactas");
	assert.equal((await storedVenta(id)).voucher_number, "B001-000001");
	assert.equal(await lastNumberOf(owner.id, "B001", "BOLETA"), 1);
});

/** Corre `run` con un trigger que hace fallar CUALQUIER avance de serie, y lo desarma al salir. */
async function withFailingSeriesAdvance<T>(run: () => Promise<T>): Promise<T> {
	await pool.query(
		`create or replace function public.e2e_fail_series() returns trigger language plpgsql as $$
		 begin raise exception 'fallo inyectado' using errcode = '22000'; end $$`,
	);
	await pool.query(
		"create trigger e2e_fail_series before update on public.voucher_series for each row execute function public.e2e_fail_series()",
	);

	try {
		return await run();
	} finally {
		await pool.query("drop trigger if exists e2e_fail_series on public.voucher_series");
		await pool.query("drop function if exists public.e2e_fail_series()");
	}
}

test("si el avance de la serie falla, el alta no deja el comprobante escrito (S2)", async () => {
	const dueno = await freshOwner("atomico");

	await asOwner(dueno.id, (client) =>
		crearSerie(client, { voucherType: "FACTURA", code: "A001", isDefault: true }),
	);

	const failure = await withFailingSeriesAdvance(() =>
		rejectionOf(dueno.id, (client) =>
			crearVenta(client, {
				entityId: dueno.entityId,
				subtotal: "100.00",
				igv: "18.00",
				total: "118.00",
			}),
		),
	);

	assert.equal(failure.code, "XX000", "un fallo de la base sin dominio sale como generico");
	assert.equal(failure.message, ERROR_GENERICO);
	assert.equal(await totalVentas(dueno.id), 0, "la fila del comprobante no sobrevive");
	assert.equal(await lastNumberOf(dueno.id, "A001"), 0, "la serie tampoco avanzo");

	// Y sin la inyeccion, el mismo alta si escribe: el rechazo de arriba es del trigger, no del
	// caso. (Sin esta mitad, un error de fixture haria pasar el test por el motivo equivocado.)
	const ok = await asOwner(dueno.id, (client) =>
		crearVenta(client, {
			entityId: dueno.entityId,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal((await storedVenta(ok)).voucher_number, "A001-000001");
	assert.equal(await lastNumberOf(dueno.id, "A001"), 1);
});

/**
 * Abre una transaccion con la identidad del dueno y la deja abierta: la usa la prueba de
 * concurrencia, que necesita DOS transacciones vivas al mismo tiempo (no dos llamadas seguidas).
 */
async function openOwnerTransaction(ownerId: string): Promise<PoolClient> {
	const client = await pool.connect();

	await client.query("begin");
	await client.query("select set_config('app.user_id', $1, true)", [ownerId]);
	await client.query("set local role authenticated");

	return client;
}
