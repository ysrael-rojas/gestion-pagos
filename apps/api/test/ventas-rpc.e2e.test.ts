// Pruebas de la migracion `20261124120000_ventas_rpcs.sql` (T2 del port del vertical ventas,
// S6-S8 de `odd/tasks/port-vertical-ventas.md`) contra una base viva con las migraciones
// aplicadas.
//
// Que prueba, en una frase: que el alta y la edicion de un comprobante de VENTA y el avance del
// correlativo de su serie son UNA transaccion de la BASE, no dos llamadas de Node (S8), y que las
// reglas de S6/S7 se cumplen por el camino que va a usar el API.
//
// Por que llama a las RPC y no a una ruta HTTP: el modulo `apps/api/src/vouchers` todavia no
// existe (lo crea T3). El camino que SI existe hoy es el que usa `withOwner`
// (`src/db/with-owner.ts`): una transaccion con `app.user_id` fijado y `set local role
// authenticated`, y despues `select public.crear_venta(...)`. Eso es exactamente lo que arma
// `asOwner` aca, copiando `closeViaRpc` de `cash-closes.e2e.test.ts`. Cuando T3 agregue el
// controller, sus e2e cubriran la capa HTTP; este archivo cubre el SQL, que es donde vive la
// garantia.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL   la base con las migraciones aplicadas (`node packages/db/scripts/apply-sql.mjs`).
//                  No hace falta sembrarla: los duenos de este archivo son propios, para no
//                  depender del dueno demo ni pisarlo.
//
// Identidad: los dos duenos se crean por SQL (`auth.users` + sus filas de dominio), igual que
// `packages/db/scripts/check-rls-enforcement.mjs` y que el alta documentada en
// `docs/operacion/crear-usuario.md`. No se inventa ninguna sesion de Better Auth porque este
// archivo no ejercita la sesion: el GUC que lee `auth.uid()` lo fija el test dentro de la
// transaccion, que es el mismo contrato que usa el API. La sesion HTTP la prueban los e2e de T3.
//
// Aislamiento entre pruebas: cada prueba usa su propio codigo de serie (`F001`...`F007`), asi su
// resultado no depende del orden de ejecucion. El teardown borra todo lo que creo, en orden de FK.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";

/** Textos de S6, verbatim. Los compara el test contra lo que devuelve la base. */
const CLIENTE_INEXISTENTE = "El cliente seleccionado no existe.";
const VENTA_DUPLICADA = "Ya registraste una venta con ese número de comprobante.";
const DATOS_INVALIDOS = "Los datos del comprobante no son válidos.";

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

let owner: SeededOwner;
let intruder: SeededOwner;

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
	voucherNumber: string;
	issueDate?: string;
	subtotal: string;
	igv: string;
	total: string;
	paymentType?: string;
	creditDays?: number | null;
}

/** `select public.crear_venta(...)`, con los tipos del esquema dichos como en la firma. */
async function crearVenta(client: PoolClient, input: VentaInput): Promise<string> {
	const result = await client.query<{ id: string }>(
		`select public.crear_venta(
			$1::uuid, $2::public.voucher_type, $3, $4::date,
			$5::numeric, $6::numeric, $7::numeric, $8::public.payment_type, $9::integer
		) as id`,
		[
			input.entityId,
			input.voucherType ?? "FACTURA",
			input.voucherNumber,
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

/** `select public.editar_venta(...)` para un comprobante ya existente. */
async function editarVenta(
	client: PoolClient,
	comprobanteId: string,
	input: VentaInput,
): Promise<string> {
	const result = await client.query<{ id: string }>(
		`select public.editar_venta(
			$1::uuid, $2::uuid, $3::public.voucher_type, $4, $5::date,
			$6::numeric, $7::numeric, $8::numeric, $9::public.payment_type, $10::integer
		) as id`,
		[
			comprobanteId,
			input.entityId,
			input.voucherType ?? "FACTURA",
			input.voucherNumber,
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

/** Filas de un codigo de serie, para afirmar que un rechazo no creo ni cambio nada. */
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
 * Siembra un dueno con su entidad, una serie por tipo/codigo y los catalogos que necesita un pago
 * (metodo, caja y categoria de cobranza), con SQL directo como `dev_user`, igual que los seeds.
 */
async function seedOwner(
	tag: string,
	series: Array<{ voucherType: string; code: string; lastNumber: number }>,
): Promise<SeededOwner> {
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

	for (const row of series) {
		await pool.query(
			`insert into public.voucher_series (owner_id, voucher_type, code, last_number)
			 values ($1, $2::public.voucher_type, $3, $4)`,
			[id, row.voucherType, row.code, row.lastNumber],
		);
	}

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

before(async () => {
	// Una serie por prueba, con su codigo propio: el resultado de una no depende del orden de las
	// demas. `F009` no existe a proposito, para probar que un codigo sin serie se registra igual.
	owner = await seedOwner("propio", [
		{ voucherType: "FACTURA", code: "F001", lastNumber: 0 },
		{ voucherType: "FACTURA", code: "F002", lastNumber: 5 },
		{ voucherType: "FACTURA", code: "F003", lastNumber: 0 },
		{ voucherType: "FACTURA", code: "F004", lastNumber: 0 },
		{ voucherType: "FACTURA", code: "F005", lastNumber: 0 },
		{ voucherType: "FACTURA", code: "F006", lastNumber: 0 },
		{ voucherType: "FACTURA", code: "F007", lastNumber: 0 },
		{ voucherType: "BOLETA", code: "B001", lastNumber: 0 },
	]);

	intruder = await seedOwner("ajeno", []);
});

after(async () => {
	if (owner) {
		await pool.query("delete from public.payment_allocation where owner_id = $1", [owner.id]);
		await pool.query("delete from public.payment where owner_id = $1", [owner.id]);
		await pool.query("delete from public.comprobante where owner_id = $1", [owner.id]);
		await pool.query("delete from public.entidad where owner_id = $1", [owner.id]);
		await pool.query("delete from public.voucher_series where owner_id = $1", [owner.id]);
		await pool.query("delete from public.cash_account where owner_id = $1", [owner.id]);
		await pool.query("delete from public.payment_method where owner_id = $1", [owner.id]);
		await pool.query("delete from public.cash_receipt_category where owner_id = $1", [owner.id]);
		await pool.query("delete from auth.users where id = $1", [owner.id]);
	}

	if (intruder) {
		await pool.query("delete from public.comprobante where owner_id = $1", [intruder.id]);
		await pool.query("delete from public.entidad where owner_id = $1", [intruder.id]);
		await pool.query("delete from public.voucher_series where owner_id = $1", [intruder.id]);
		await pool.query("delete from public.cash_account where owner_id = $1", [intruder.id]);
		await pool.query("delete from public.payment_method where owner_id = $1", [intruder.id]);
		await pool.query("delete from public.cash_receipt_category where owner_id = $1", [intruder.id]);
		await pool.query("delete from auth.users where id = $1", [intruder.id]);
	}

	await pool.end();
});

test("crear_venta registra la VENTA del dueno de la sesion y avanza su serie, todo en una transaccion (S8)", async () => {
	const id = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F001-1",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const stored = await storedVenta(id);

	assert.equal(stored.owner_id, owner.id, "el dueno sale de auth.uid(), no del payload");
	assert.equal(stored.entity_id, owner.entityId);
	assert.equal(stored.voucher_kind, "VENTA", "la RPC solo produce comprobantes de VENTA");
	assert.equal(stored.voucher_type, "FACTURA");
	assert.equal(stored.voucher_number, "F001-1");
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
		await lastNumberOf(owner.id, "F001"),
		1,
		"la serie avanzo en la MISMA transaccion que el alta",
	);

	// CREDITO: `due_date` sigue siendo columna generada (`issue_date + credit_days`) y la RPC no la
	// escribe. Si la escribiera, este INSERT fallaria (no es una columna escribible).
	const creditoId = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F001-2",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
			paymentType: "CREDITO",
			creditDays: 30,
		}),
	);

	const credito = await storedVenta(creditoId);

	assert.equal(credito.payment_type, "CREDITO");
	assert.equal(credito.credit_days, 30);
	assert.equal(credito.due_date, "2026-12-24", "due_date = issue_date + credit_days");
	assert.equal(await lastNumberOf(owner.id, "F001"), 2);

	// Un codigo sin serie configurada no es un error: el correlativo sugerido es una ayuda, no una
	// condicion (S7), y la RPC no inventa filas de `voucher_series`.
	const sinSerieId = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherType: "BOLETA",
			voucherNumber: "Z999-1",
			subtotal: "50.00",
			igv: "9.00",
			total: "59.00",
		}),
	);

	assert.equal((await storedVenta(sinSerieId)).voucher_number, "Z999-1");
	assert.equal(await lastNumberOf(owner.id, "Z999", "BOLETA"), null, "no se creo la serie");
});

test("editar_venta actualiza el comprobante y avanza la serie en la misma transaccion, sin retroceder (S7, S8)", async () => {
	const id = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F003-1",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const editedId = await asOwner(owner.id, (client) =>
		editarVenta(client, id, {
			entityId: owner.entityId,
			voucherNumber: "F003-7",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	assert.equal(editedId, id, "editar_venta devuelve el id del mismo comprobante");

	const stored = await storedVenta(id);

	assert.equal(stored.voucher_number, "F003-7");
	assert.equal(stored.subtotal, "200.00");
	assert.equal(stored.igv, "36.00");
	assert.equal(stored.total, "236.00");
	assert.equal(await lastNumberOf(owner.id, "F003"), 7, "la serie avanzo con la edicion");

	// Monotonia tambien en la edicion: bajar el correlativo cambia el numero del comprobante pero
	// NO hace retroceder `last_number` (los huecos son de diseno, L5).
	await asOwner(owner.id, (client) =>
		editarVenta(client, id, {
			entityId: owner.entityId,
			voucherNumber: "F003-2",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	assert.equal((await storedVenta(id)).voucher_number, "F003-2");
	assert.equal(await lastNumberOf(owner.id, "F003"), 7, "la serie nunca retrocede");
});

test("el avance del correlativo es monotono: un numero que no supera last_number no cambia la serie ni falla (S7)", async () => {
	// La serie F002 arranca en 5 (fixture). Un correlativo menor se registra igual y no la mueve.
	const below = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F002-3",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedVenta(below)).voucher_number, "F002-3");
	assert.equal(await lastNumberOf(owner.id, "F002"), 5, "no retrocede y no es un error");

	const above = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F002-9",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedVenta(above)).voucher_number, "F002-9");
	assert.equal(await lastNumberOf(owner.id, "F002"), 9, "si lo supera, avanza");
});

test("la unicidad es el indice unico y es textual: F004-1 y F004-000001 son filas distintas, y la colision responde el mensaje de S6 (S7)", async () => {
	const first = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F004-1",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal((await storedVenta(first)).voucher_number, "F004-1");
	assert.equal(await lastNumberOf(owner.id, "F004"), 1);

	// Misma fila exacta: la rechaza el indice unico `comprobante_owner_kind_number_key`, y la RPC
	// traduce el 23505 al mensaje de S6 (no al de pagos, no a un texto de PostgreSQL).
	const duplicate = await rejectionOf(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F004-1",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(duplicate.message, VENTA_DUPLICADA);
	assert.equal(duplicate.code, "23505", "se conserva la familia: el API lo mapea a conflicto");
	assert.deepEqual(await ventasOf(owner.id, "F004"), ["F004-1"], "el rechazo no escribio nada");

	// Textual: el mismo correlativo con otro relleno es otra fila para el indice. Y no avanza la
	// serie (1 no supera 1).
	const padded = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F004-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal((await storedVenta(padded)).voucher_number, "F004-000001");
	assert.deepEqual(await ventasOf(owner.id, "F004"), ["F004-000001", "F004-1"]);
	assert.equal(await lastNumberOf(owner.id, "F004"), 1, "el relleno no mueve last_number");
});

test("con un pago registrado la edicion la rechaza el trigger de S6 y no queda nada escrito", async () => {
	const id = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F005-1",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	await assignPayment(owner, id, 50);

	const blocked = await rejectionOf(owner.id, (client) =>
		editarVenta(client, id, {
			entityId: owner.entityId,
			voucherNumber: "F005-1",
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
	assert.equal(stored.voucher_number, "F005-1");
	assert.equal(await lastNumberOf(owner.id, "F005"), 1, "la serie no avanzo con el rechazo");
});

test("un CONTADO con dias de credito lo rechaza el CHECK comprobante_credit_days, no una regla nueva de la RPC", async () => {
	const rejected = await rejectionOf(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F006-1",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
			paymentType: "CONTADO",
			creditDays: 30,
		}),
	);

	assert.equal(rejected.message, DATOS_INVALIDOS);
	assert.equal(rejected.code, "23514", "la familia del CHECK se conserva al traducir el mensaje");
	assert.deepEqual(await ventasOf(owner.id, "F006"), [], "no quedo ninguna fila");
	assert.equal(await lastNumberOf(owner.id, "F006"), 0, "la serie no avanzo con el rechazo");

	// Y la regla sigue viviendo en la TABLA: el mismo INSERT directo (como dueno de las tablas, sin
	// RPC de por medio) lo rechaza el CHECK con su nombre. Sin esta mitad, el test solo probaria
	// que la RPC rechaza, no que el invariante sea del CHECK.
	const direct = await pool
		.query(
			`insert into public.comprobante
			   (owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
			    issue_date, subtotal, igv, total, payment_type, credit_days)
			 values ($1, $2, 'VENTA', 'FACTURA', 'F006-000099', '2026-11-24', 100, 18, 118, 'CONTADO', 30)`,
			[owner.id, owner.entityId],
		)
		.then(
			() => null,
			(error: unknown) => toFailure(error),
		);

	assert.ok(direct, "el INSERT directo con CONTADO y credit_days debio ser rechazado");
	assert.equal(direct.code, "23514");
	assert.equal(direct.constraint, "comprobante_credit_days");
});

test("los datos invalidos y el cliente inexistente responden el mensaje de S6 y no escriben nada", async () => {
	const badNumber = await rejectionOf(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "F0070001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(badNumber.message, DATOS_INVALIDOS, "el numero no cumple ^[A-Za-z0-9]{1,4}-\\d{1,8}$");

	const badType = await rejectionOf(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherType: "NOTA_CREDITO",
			voucherNumber: "F007-1",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(badType.message, DATOS_INVALIDOS, "el slice 1 solo da de alta comprobantes base");

	const foreignClient = await rejectionOf(owner.id, (client) =>
		crearVenta(client, {
			entityId: intruder.entityId,
			voucherNumber: "F007-2",
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

	const missingClient = await rejectionOf(owner.id, (client) =>
		crearVenta(client, {
			entityId: randomUUID(),
			voucherNumber: "F007-3",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(missingClient.message, CLIENTE_INEXISTENTE);

	assert.deepEqual(await ventasOf(owner.id, "F007"), [], "ninguno de los cuatro rechazos escribio");
	assert.equal(await lastNumberOf(owner.id, "F007"), 0);
	assert.deepEqual(await ventasOf(intruder.id, "F007"), [], "tampoco en el dueno ajeno");
});

test("editar_venta no toca el comprobante de otro dueno y responde el mensaje de la RPC", async () => {
	const foreignId = await asOwner(intruder.id, (client) =>
		crearVenta(client, {
			entityId: intruder.entityId,
			voucherNumber: "F008-9",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const attempt = await rejectionOf(owner.id, (client) =>
		editarVenta(client, foreignId, {
			entityId: owner.entityId,
			voucherNumber: "F008-8",
			subtotal: "1.00",
			igv: "0.18",
			total: "1.18",
		}),
	);

	assert.equal(attempt.message, "El comprobante no existe.");

	const stored = await storedVenta(foreignId);

	assert.equal(stored.owner_id, intruder.id);
	assert.equal(stored.voucher_number, "F008-9", "la fila ajena quedo intacta");
	assert.equal(stored.total, "118.00");
});

test("S8: authenticated ejecuta las dos RPC y NO conserva UPDATE ni DELETE directo sobre comprobante ni voucher_series", async () => {
	const creada = "public.crear_venta(uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer)";
	const editada =
		"public.editar_venta(uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer)";

	const grants = await pool.query<Record<string, boolean>>(
		`select has_function_privilege('authenticated', $1, 'execute') as puede_crear,
		        has_function_privilege('authenticated', $2, 'execute') as puede_editar,
		        has_function_privilege('anon', $1, 'execute') as anon_crear,
		        has_function_privilege('anon', $2, 'execute') as anon_editar,
		        has_table_privilege('authenticated', 'public.comprobante', 'select') as comprobante_select,
		        has_table_privilege('authenticated', 'public.comprobante', 'insert') as comprobante_insert,
		        has_table_privilege('authenticated', 'public.comprobante', 'update') as comprobante_update,
		        has_table_privilege('authenticated', 'public.comprobante', 'delete') as comprobante_delete,
		        has_table_privilege('authenticated', 'public.voucher_series', 'select') as serie_select,
		        has_table_privilege('authenticated', 'public.voucher_series', 'insert') as serie_insert,
		        has_table_privilege('authenticated', 'public.voucher_series', 'update') as serie_update,
		        has_table_privilege('authenticated', 'public.voucher_series', 'delete') as serie_delete`,
		[creada, editada],
	);

	const row = grants.rows[0];

	assert.ok(row, "el catalogo deberia devolver los privilegios");
	assert.equal(row.puede_crear, true, "authenticated ejecuta crear_venta");
	assert.equal(row.puede_editar, true, "authenticated ejecuta editar_venta");
	assert.equal(row.anon_crear, false, "anon no ejecuta la RPC");
	assert.equal(row.anon_editar, false);

	// El estado que fijo `20261124090000` no cambia con esta migracion (S8).
	assert.equal(row.comprobante_update, false, "UPDATE de comprobante sigue revocado");
	assert.equal(row.comprobante_delete, false, "DELETE de comprobante sigue revocado");
	assert.equal(row.serie_update, false, "UPDATE de voucher_series sigue revocado");
	assert.equal(row.serie_delete, false, "DELETE de voucher_series sigue revocado");

	// INSERT/SELECT quedan como estaban: no son parte de esta deuda.
	assert.equal(row.comprobante_select, true);
	assert.equal(row.comprobante_insert, true);
	assert.equal(row.serie_select, true);
	assert.equal(row.serie_insert, true);

	// Y por comportamiento: el mismo rol que puede llamar a la RPC no puede escribir las tablas.
	const id = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherType: "BOLETA",
			voucherNumber: "B001-1",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

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
	assert.equal(await lastNumberOf(owner.id, "B001", "BOLETA"), 1);
});

// ---------------------------------------------------------------------------
// S8: la atomicidad NO se prueba con el camino feliz.
//
// Los casos de arriba afirman que el comprobante y el avance de la serie pasan JUNTOS, pero
// ninguno fuerza un fallo en el medio: sin eso, "una transaccion" podria estar sostenido solo por
// el orden en que corren dos sentencias sueltas. Estos dos inyectan el fallo DENTRO del avance (un
// trigger que revienta con 22000 sobre `voucher_series`) y exigen que el comprobante no quede
// escrito y que la serie no avance. Salen de las sondas del verificador independiente de T2.
// ---------------------------------------------------------------------------

/** El mensaje generico de S6, textual: el que sale cuando el fallo no es de dominio. */
const ERROR_GENERICO =
	"No se pudo completar la operación con la base de datos. Intenta nuevamente.";

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

test("si el avance de la serie falla, el alta no deja el comprobante escrito (S8)", async () => {
	await pool.query(
		`insert into public.voucher_series (owner_id, voucher_type, code, last_number)
		 values ($1, 'FACTURA', 'A001', 1)`,
		[owner.id],
	);

	try {
		const failure = await withFailingSeriesAdvance(() =>
			rejectionOf(owner.id, (client) =>
				crearVenta(client, {
					entityId: owner.entityId,
					voucherNumber: "A001-7",
					subtotal: "100.00",
					igv: "18.00",
					total: "118.00",
				}),
			),
		);

		assert.equal(failure.code, "XX000", "un fallo de la base sin dominio sale como generico");
		assert.equal(failure.message, ERROR_GENERICO);
		assert.deepEqual(await ventasOf(owner.id, "A001"), [], "la fila del comprobante no sobrevive");
		assert.equal(await lastNumberOf(owner.id, "A001"), 1, "la serie tampoco avanzo");
	} finally {
		await pool.query("delete from public.voucher_series where owner_id = $1 and code = 'A001'", [
			owner.id,
		]);
	}
});

test("si el avance de la serie falla, la edicion deja el comprobante intacto (S8)", async () => {
	const id = await asOwner(owner.id, (client) =>
		crearVenta(client, {
			entityId: owner.entityId,
			voucherNumber: "A002-1",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	await pool.query(
		`insert into public.voucher_series (owner_id, voucher_type, code, last_number)
		 values ($1, 'FACTURA', 'A002', 0)`,
		[owner.id],
	);

	try {
		const failure = await withFailingSeriesAdvance(() =>
			rejectionOf(owner.id, (client) =>
				editarVenta(client, id, {
					entityId: owner.entityId,
					voucherNumber: "A002-5",
					subtotal: "1000.00",
					igv: "180.00",
					total: "1180.00",
				}),
			),
		);

		assert.equal(failure.code, "XX000");
		assert.equal(failure.message, ERROR_GENERICO);

		const stored = await storedVenta(id);

		assert.equal(stored.voucher_number, "A002-1", "el numero no cambio");
		assert.equal(stored.total, "11.80", "el importe no cambio");
		assert.equal(await lastNumberOf(owner.id, "A002"), 0);
	} finally {
		await pool.query(
			"delete from public.comprobante where owner_id = $1 and voucher_number like 'A002-%'",
			[owner.id],
		);
		await pool.query("delete from public.voucher_series where owner_id = $1 and code = 'A002'", [
			owner.id,
		]);
	}
});
