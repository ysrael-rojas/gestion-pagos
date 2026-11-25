// Pruebas de `packages/db/migrations/20261128090000_compras_rpcs.sql` (T1 del port del vertical
// compras, S3/S4/S5/S8 de `odd/tasks/port-vertical-compras.md`) contra una base viva con las
// migraciones aplicadas.
//
// Que prueba, en una frase: que una COMPRA se da de alta y se edita por RPC `SECURITY DEFINER`
// igual que una venta, con la diferencia deliberada de S2/L3(a) —el numero lo pone el proveedor, lo
// tipea el usuario y se puede corregir mientras el comprobante no tenga pagos—.
//
// Por que llama a las RPC y no a una ruta HTTP: el modulo `purchases` de `apps/api` es T3 y todavia
// no existe. El camino que si existe es el de `withOwner` (`src/db/with-owner.ts`): una transaccion
// con `app.user_id` fijado y `set local role authenticated`, y despues `select public.crear_compra`
// / `public.editar_compra`. Es el mismo `asOwner` de `ventas-rpc.e2e.test.ts`.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL   la base con las migraciones aplicadas (`node packages/db/scripts/apply-sql.mjs`).
//                  No hace falta sembrarla: los duenos de este archivo son propios.
//
// Aislamiento entre pruebas: cada prueba se crea su PROPIO dueno (`freshOwner`), asi su resultado no
// depende del orden de ejecucion ni de una serie por defecto ajena. El teardown borra todo lo que
// creo, en orden de FK.
//
// Lo que este archivo NO prueba, a proposito: la derivacion de los montos (`saleAmounts`, S5). Vive
// en `packages/shared` y la base solo exige que los tres importes lleguen; recalcularla aca seria una
// segunda formula de la misma regla. Y la direccion del pago de una compra (S6): eso vive en
// `validate_allocation`, que ya la exige y no cambia con esta migracion.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { Pool, type PoolClient } from "pg";

/** Textos de S8, verbatim. Los compara el test contra lo que devuelve la base. */
const PROVEEDOR_INEXISTENTE = "El proveedor seleccionado no existe.";
const COMPRA_DUPLICADA = "Ya registraste una compra con ese número de comprobante.";
const DATOS_INVALIDOS = "Los datos del comprobante no son válidos.";
const COMPROBANTE_INEXISTENTE = "El comprobante no existe.";

/** El mensaje del trigger ya portado (`private.protect_paid_comprobante`), textual de spec 36. */
const COMPROBANTE_CON_PAGOS =
	"No se puede modificar un comprobante con pagos registrados: anula los pagos antes de cambiar importe, numero, cliente o fecha";

const DATABASE_URL = process.env.DATABASE_URL?.trim();

if (!DATABASE_URL) {
	throw new Error(
		"Falta DATABASE_URL: estas pruebas corren contra una base con las migraciones aplicadas (no hay valor por defecto).",
	);
}

const pool = new Pool({ connectionString: DATABASE_URL });

/** Dueno de las compras que se crean y editan, con lo que necesita una compra y un egreso. */
interface SeededOwner {
	id: string;
	supplierId: string;
	clientId: string;
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
 * `auth.uid()` nulo.
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

/** Corre `run` con la identidad del dueno y CONFIRMA. */
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

interface CompraInput {
	entityId: string;
	voucherNumber: string;
	voucherType?: string;
	issueDate?: string;
	subtotal: string;
	igv: string;
	total: string;
	paymentType?: string;
	creditDays?: number | null;
}

/**
 * `select public.crear_compra(...)`.
 *
 * NUEVE argumentos, con `p_voucher_number` en la firma (S3): es la diferencia deliberada con
 * `crear_venta`, que lo asigna desde la serie por defecto del tipo. Si esta firma se rompe, el test
 * falla con "function does not exist", que es exactamente lo que se quiere pinar.
 */
async function crearCompra(client: PoolClient, input: CompraInput): Promise<string> {
	// `undefined` usa el default del fixture; `null` viaja como NULL, no como default (mismo criterio
	// que `crearSerie` en `ventas-rpc.e2e.test.ts`).
	const voucherType = input.voucherType === undefined ? "FACTURA" : input.voucherType;

	const result = await client.query<{ id: string }>(
		`select public.crear_compra(
			$1::uuid, $2::public.voucher_type, $3::text, $4::date,
			$5::numeric, $6::numeric, $7::numeric, $8::public.payment_type, $9::integer
		) as id`,
		[
			input.entityId,
			voucherType,
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

	assert.ok(id, "crear_compra deberia devolver el id del comprobante creado");

	return id;
}

/** `select public.editar_compra(...)` para una compra ya existente (diez argumentos, S3). */
async function editarCompra(
	client: PoolClient,
	comprobanteId: string,
	input: CompraInput,
): Promise<string> {
	const voucherType = input.voucherType === undefined ? "FACTURA" : input.voucherType;

	const result = await client.query<{ id: string }>(
		`select public.editar_compra(
			$1::uuid, $2::uuid, $3::public.voucher_type, $4::text, $5::date,
			$6::numeric, $7::numeric, $8::numeric, $9::public.payment_type, $10::integer
		) as id`,
		[
			comprobanteId,
			input.entityId,
			voucherType,
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

	assert.ok(id, "editar_compra deberia devolver el id del comprobante editado");

	return id;
}

/** `select public.crear_serie(...)`: solo lo usa el caso de S2 que necesita una VENTA real. */
async function crearSerie(client: PoolClient, code: string, voucherType = "FACTURA"): Promise<void> {
	await client.query(`select public.crear_serie($1::public.voucher_type, $2::text, true)`, [
		voucherType,
		code,
	]);
}

/** `select public.crear_venta(...)`: ocho argumentos, sin numero (S2 del port de series). */
async function crearVenta(client: PoolClient, entityId: string, total: string): Promise<string> {
	const result = await client.query<{ id: string }>(
		`select public.crear_venta(
			$1::uuid, 'FACTURA'::public.voucher_type, '2026-11-24'::date,
			$2::numeric, $3::numeric, $4::numeric, 'CONTADO'::public.payment_type, null::integer
		) as id`,
		[entityId, total, "0.00", total],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "crear_venta deberia devolver el id del comprobante creado");

	return id;
}

/** La fila cruda del comprobante, en texto para comparar sin ruido de tipos. */
async function storedComprobante(id: string): Promise<Record<string, string | number | null>> {
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

/** Cantidad de comprobantes del dueno: para afirmar que un rechazo no escribio NADA. */
async function totalComprobantes(ownerId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.comprobante where owner_id = $1",
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

/** Cantidad de compras (no ventas) del dueno. */
async function totalCompras(ownerId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.comprobante where owner_id = $1 and voucher_kind = 'COMPRA'",
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

/** Series del dueno: una compra no crea ni avanza ninguna (S2/L3(a)). */
async function totalSeries(ownerId: string): Promise<number> {
	const result = await pool.query<{ n: number }>(
		"select count(*)::int as n from public.voucher_series where owner_id = $1",
		[ownerId],
	);

	return result.rows[0]?.n ?? 0;
}

/**
 * Siembra un dueno con un proveedor (`is_supplier`) y un cliente (`is_client`), mas el metodo, la
 * caja y la categoria de EGRESO que necesita un pago de compra, con SQL directo como `dev_user`.
 *
 * Las dos entidades existen para probar S4: la RPC no exige `is_supplier` (es un filtro de
 * pantalla), asi que una compra a un cliente es un dato raro pero posible y el test lo deja escrito.
 */
async function freshOwner(tag: string): Promise<SeededOwner> {
	const id = randomUUID();
	const ids: SeededOwner = {
		id,
		supplierId: randomUUID(),
		clientId: randomUUID(),
		methodId: randomUUID(),
		cashAccountId: randomUUID(),
		categoryId: randomUUID(),
	};

	await pool.query(
		`insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, true)`,
		[id, `E2E compras ${tag}`, `e2e-compras-${tag}-${id}@example.test`],
	);

	await pool.query(
		`insert into public.entidad
		   (id, document_type, document_number, name, billing_email, is_client, is_supplier, owner_id)
		 values ($1, 'SIN_DOCUMENTO', '', $2, $3, false, true, $4)`,
		[ids.supplierId, `Proveedor ${tag}`, `proveedor-${tag}-${id}@example.test`, id],
	);

	await pool.query(
		`insert into public.entidad
		   (id, document_type, document_number, name, billing_email, is_client, is_supplier, owner_id)
		 values ($1, 'SIN_DOCUMENTO', '', $2, $3, true, false, $4)`,
		[ids.clientId, `Cliente ${tag}`, `cliente-${tag}-${id}@example.test`, id],
	);

	await pool.query(
		`insert into public.cash_account
		   (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'CASH_BOX', $2, 'PEN', 0, current_date - 30, $3)`,
		[ids.cashAccountId, `Caja ${tag}`, id],
	);

	await pool.query(
		`insert into public.payment_method (id, code, name, owner_id) values ($1, $2, $3, $4)`,
		[ids.methodId, `COMPRAS_${tag}`.toUpperCase(), "Efectivo", id],
	);

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'EGRESO', $2, $3, $4)`,
		[ids.categoryId, `Pago ${tag}`, `COMPRAS_${tag}`.toUpperCase(), id],
	);

	createdOwners.push(ids);

	return ids;
}

/**
 * Asigna un EGRESO a la compra, que es lo que la deja "con pagos registrados" y dispara
 * `comprobante_protect_paid`.
 *
 * Se inserta como `dev_user` (owner de las tablas), igual que los fixtures del resto del API: lo que
 * se prueba es la EDICION de la compra, no el alta del pago (que ya tiene sus e2e). La direccion es
 * EGRESO porque `validate_allocation` la exige para una COMPRA (S6) y `payment_allocation` la
 * valida al insertar.
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
		 values ($1, $2, $3, 'EGRESO', current_date, $4, $5, $6, $7, 'e2e', 'fixture compras')`,
		[
			paymentId,
			target.id,
			target.supplierId,
			amount,
			target.methodId,
			target.cashAccountId,
			target.categoryId,
		],
	);

	await pool.query(
		`insert into public.payment_allocation (owner_id, payment_id, comprobante_id, amount)
		 values ($1, $2, $3, $4)`,
		[target.id, paymentId, comprobanteId, amount],
	);
}

/** Borra un dueno completo, en orden de FK (mismo orden que `ventas-rpc.e2e.test.ts`). */
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
	// Un dueno base para las pruebas de privilegios, que no necesitan identidad propia.
	owner = await freshOwner("base");
});

after(async () => {
	for (const target of createdOwners) {
		await deleteOwner(target);
	}

	await pool.end();
});

// ---------------------------------------------------------------------------
// Alta (S3, S4).
// ---------------------------------------------------------------------------

test("crear_compra registra la compra con el numero del proveedor, voucher_kind COMPRA y status derivado (S3)", async () => {
	const dueno = await freshOwner("alta");

	const id = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000123",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const stored = await storedComprobante(id);

	assert.equal(stored.owner_id, dueno.id, "el dueno sale de auth.uid(), no del payload");
	assert.equal(stored.entity_id, dueno.supplierId);
	assert.equal(stored.voucher_kind, "COMPRA", "voucher_kind es 'COMPRA' por construccion");
	assert.equal(stored.voucher_type, "FACTURA");
	assert.equal(stored.voucher_number, "F001-000123", "el numero es el que emitio el proveedor");
	assert.equal(stored.issue_date, "2026-11-24");
	assert.equal(stored.subtotal, "100.00");
	assert.equal(stored.igv, "18.00");
	assert.equal(stored.total, "118.00");
	assert.equal(stored.payment_type, "CONTADO");
	assert.equal(stored.credit_days, null);
	assert.equal(stored.due_date, null, "due_date es generada: en CONTADO queda nula");
	assert.equal(stored.status, "PENDIENTE", "el status lo deriva la tabla");
	assert.ok(stored.registration_date, "registration_date la pone la tabla por default");

	// El numero se normaliza con `btrim` antes de validar y de guardar: `' F001-000124 '` no puede
	// crear una fila que el indice unico considere distinta de `F001-000124`.
	const trimmedId = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "  F001-000124  ",
			subtotal: "50.00",
			igv: "9.00",
			total: "59.00",
		}),
	);

	assert.equal((await storedComprobante(trimmedId)).voucher_number, "F001-000124");

	// CREDITO: `due_date` sigue siendo columna generada (`issue_date + credit_days`) y la RPC no la
	// escribe. Si la escribiera, este INSERT fallaria (no es una columna escribible).
	const creditoId = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000125",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
			paymentType: "CREDITO",
			creditDays: 30,
		}),
	);

	const credito = await storedComprobante(creditoId);

	assert.equal(credito.payment_type, "CREDITO");
	assert.equal(credito.credit_days, 30);
	assert.equal(credito.due_date, "2026-12-24", "due_date = issue_date + credit_days");

	// S2/L3(a): la compra NO tiene serie. Las tres altas de arriba funcionaron sin ninguna, y la RPC
	// no creo ni avanzo ninguna: no hay bloque de serie que espejar.
	assert.equal(await totalSeries(dueno.id), 0, "una compra no crea series");

	// S4: `is_supplier` es filtro de pantalla, no invariante de la base. Una compra a un cliente es
	// un dato raro pero posible, y la RPC no lo impide.
	const aUnCliente = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.clientId,
			voucherNumber: "B001-000007",
			voucherType: "BOLETA",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	assert.equal((await storedComprobante(aUnCliente)).entity_id, dueno.clientId);
	assert.equal((await storedComprobante(aUnCliente)).voucher_kind, "COMPRA");
});

test("el mismo numero puede existir como VENTA y como COMPRA: la unicidad es por kind (S2)", async () => {
	const dueno = await freshOwner("mismo-numero");

	// Una venta REAL, por su RPC: la serie por defecto le asigna `F001-000001`.
	await asOwner(dueno.id, (client) => crearSerie(client, "F001"));

	const ventaId = await asOwner(dueno.id, (client) => crearVenta(client, dueno.clientId, "118.00"));

	assert.equal((await storedComprobante(ventaId)).voucher_number, "F001-000001");

	// La compra con el MISMO numero no choca: `comprobante_owner_kind_number_key` es
	// `(owner_id, voucher_kind, voucher_number)`, y son documentos distintos (S2).
	const compraId = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const venta = await storedComprobante(ventaId);
	const compra = await storedComprobante(compraId);

	assert.equal(venta.voucher_number, "F001-000001");
	assert.equal(compra.voucher_number, "F001-000001");
	assert.equal(venta.voucher_kind, "VENTA");
	assert.equal(compra.voucher_kind, "COMPRA");
	assert.equal(await totalComprobantes(dueno.id), 2);
});

test("dos compras con el mismo numero responden el mensaje de S8 y no escriben (S8)", async () => {
	const dueno = await freshOwner("duplicada");

	await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const duplicated = await rejectionOf(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	// La RPC no consulta duplicados antes de escribir: traduce el 23505 del indice unico y conserva
	// la familia.
	assert.equal(duplicated.message, COMPRA_DUPLICADA);
	assert.equal(duplicated.code, "23505", "se conserva la familia: el API elige el status por ella");
	assert.equal(await totalCompras(dueno.id), 1, "quedo una sola compra");

	// Y el juez es el INDICE: el mismo INSERT directo (como owner de las tablas, sin RPC de por
	// medio) lo rechaza el indice con su nombre. Sin esta mitad, el test solo probaria que la RPC
	// traduce, no cual es la regla.
	const direct = await pool
		.query(
			`insert into public.comprobante
			   (owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
			    issue_date, subtotal, igv, total, payment_type)
			 values ($1, $2, 'COMPRA', 'FACTURA', 'F001-000001', '2026-11-24', 100, 18, 118, 'CONTADO')`,
			[dueno.id, dueno.supplierId],
		)
		.then(
			() => null,
			(error: unknown) => toFailure(error),
		);

	assert.ok(direct, "el INSERT directo con el mismo numero debio ser rechazado");
	assert.equal(direct.code, "23505");
	assert.equal(direct.constraint, "comprobante_owner_kind_number_key");

	// Pero el mismo numero como VENTA sigue entrando: la unicidad es por kind (S2).
	await pool.query(
		`insert into public.comprobante
		   (owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
		    issue_date, subtotal, igv, total, payment_type)
		 values ($1, $2, 'VENTA', 'FACTURA', 'F001-000001', '2026-11-24', 100, 18, 118, 'CONTADO')`,
		[dueno.id, dueno.supplierId],
	);

	assert.equal(await totalComprobantes(dueno.id), 2, "una compra y una venta con el mismo numero");
});

test("el numero mal formado y el tipo que no es base responden el mensaje de S8 y no escriben (S3, S8)", async () => {
	const dueno = await freshOwner("invalido");

	// El patron es `^[A-Za-z0-9]{1,4}-[0-9]{1,8}$`, el mismo que ya declara el contrato compartido.
	for (const badNumber of [
		"F001", // sin correlativo
		"F0011-000001", // 5 caracteres de serie
		"F001-123456789", // 9 digitos de correlativo
		"F001-0001A", // correlativo no numerico
		"-000001", // serie vacia
		"   ", // solo espacios: se recorta y queda vacio
	]) {
		const rejection = await rejectionOf(dueno.id, (client) =>
			crearCompra(client, {
				entityId: dueno.supplierId,
				voucherNumber: badNumber,
				subtotal: "100.00",
				igv: "18.00",
				total: "118.00",
			}),
		);

		assert.equal(rejection.message, DATOS_INVALIDOS, `el numero ${JSON.stringify(badNumber)} es invalido`);
		assert.equal(rejection.code, "23514", "el payload invalido conserva la familia del CHECK");
	}

	// Solo los tres tipos base: una nota o una retencion no se dan de alta por aca (S3).
	for (const badType of ["NOTA_CREDITO", "NOTA_DEBITO", "COMPROBANTE_RETENCION"]) {
		const rejection = await rejectionOf(dueno.id, (client) =>
			crearCompra(client, {
				entityId: dueno.supplierId,
				voucherNumber: "F001-000001",
				voucherType: badType,
				subtotal: "100.00",
				igv: "18.00",
				total: "118.00",
			}),
		);

		assert.equal(rejection.message, DATOS_INVALIDOS, `${badType} no es un tipo base`);
	}

	// Un tipo nulo es una peticion incompleta, no un comprobante base.
	const noType = await rejectionOf(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			voucherType: null as unknown as string,
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(noType.message, DATOS_INVALIDOS);

	assert.equal(await totalComprobantes(dueno.id), 0, "ninguno de los rechazos escribio");
	assert.equal(await totalSeries(dueno.id), 0);
});

test("un proveedor inexistente y un proveedor de otro dueno responden el mensaje de S8 y no escriben (S4, S8)", async () => {
	const dueno = await freshOwner("proveedor");
	const ajeno = await freshOwner("proveedor-ajeno");

	const missing = await rejectionOf(dueno.id, (client) =>
		crearCompra(client, {
			entityId: randomUUID(),
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(missing.message, PROVEEDOR_INEXISTENTE);

	// Mismo texto para "es de otro dueno": la RPC no filtra la existencia de entidades ajenas.
	const foreign = await rejectionOf(dueno.id, (client) =>
		crearCompra(client, {
			entityId: ajeno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(foreign.message, PROVEEDOR_INEXISTENTE);

	assert.equal(await totalCompras(dueno.id), 0, "ninguno de los dos rechazos escribio");
	assert.equal(await totalComprobantes(ajeno.id), 0, "la entidad ajena tampoco se toco");
});

// ---------------------------------------------------------------------------
// Edicion (S2/L3(a): el numero SI se corrige mientras no haya pagos).
// ---------------------------------------------------------------------------

test("editar_compra cambia el numero y los importes de una compra sin pagos (S2, S3)", async () => {
	const dueno = await freshOwner("edicion");

	const id = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	// El numero del proveedor es un dato que el usuario corrige: a diferencia de la venta, la firma
	// lo recibe y la fila lo reescribe (L3(a)).
	const editedId = await asOwner(dueno.id, (client) =>
		editarCompra(client, id, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000042",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	assert.equal(editedId, id, "editar_compra devuelve el id del mismo comprobante");

	const stored = await storedComprobante(id);

	assert.equal(stored.voucher_number, "F001-000042", "el numero de una compra SI se corrige");
	assert.equal(stored.voucher_kind, "COMPRA", "la edicion no cambia el kind");
	assert.equal(stored.voucher_type, "FACTURA");
	assert.equal(stored.subtotal, "200.00");
	assert.equal(stored.igv, "36.00");
	assert.equal(stored.total, "236.00");

	// La firma SI recibe el numero: es la diferencia deliberada con `editar_venta`.
	const args = await pool.query<{ args: string }>(
		`select pg_get_function_arguments(
		   'public.editar_compra(uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer)'::regprocedure
		 ) as args`,
	);

	assert.equal((args.rows[0]?.args ?? "").includes("p_voucher_number"), true);

	// Corregir el numero a uno que ya existe como compra choca con el indice unico, con el mensaje
	// de S8 y sin tocar la fila.
	await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000043",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	const duplicated = await rejectionOf(dueno.id, (client) =>
		editarCompra(client, id, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000043",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	assert.equal(duplicated.message, COMPRA_DUPLICADA);
	assert.equal(duplicated.code, "23505");
	assert.equal((await storedComprobante(id)).voucher_number, "F001-000042", "el rechazo no escribio");
});

test("editar_compra permite corregir el tipo: es dato del proveedor, como el numero (S2)", async () => {
	const dueno = await freshOwner("tipo-corregible");

	const id = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	// FACTURA -> BOLETA es transcripcion equivocada, no un cambio de especie: el documento lo emitio
	// el proveedor y el usuario tiene que poder arreglarlo mientras no haya pagos (el candado por
	// pagos lo congela igual, y eso lo pina el caso siguiente).
	await asOwner(dueno.id, (client) =>
		editarCompra(client, id, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000002",
			voucherType: "BOLETA",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const despues = await storedComprobante(id);

	assert.equal(despues.voucher_type, "BOLETA");
	assert.equal(despues.voucher_number, "F001-000002");

	// Sigue acotado a los tipos base: una nota no se registra como compra.
	const rechazo = await rejectionOf(dueno.id, (client) =>
		editarCompra(client, id, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000003",
			voucherType: "NOTA_CREDITO",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	assert.equal(rechazo.message, DATOS_INVALIDOS);
	assert.equal((await storedComprobante(id)).voucher_type, "BOLETA", "el rechazo no escribio");
});

test("con un pago registrado la edicion de la compra la rechaza el trigger de pagos y no queda nada escrito (S2, S8)", async () => {
	const dueno = await freshOwner("pagos");

	const id = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	await assignPayment(dueno, id, 50);

	const blocked = await rejectionOf(dueno.id, (client) =>
		editarCompra(client, id, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000002",
			subtotal: "200.00",
			igv: "36.00",
			total: "236.00",
		}),
	);

	// Textual de `private.protect_paid_comprobante`: es el trigger, no una regla nueva de la RPC, el
	// que congela numero, importe, entidad y fecha cuando la compra ya tiene pagos. La excepcion de
	// dominio (P0001) pasa tal cual, sin el generico.
	assert.equal(blocked.code, "P0001");
	assert.equal(blocked.message, COMPROBANTE_CON_PAGOS);

	const stored = await storedComprobante(id);

	assert.equal(stored.voucher_number, "F001-000001", "el numero no cambio");
	assert.equal(stored.total, "118.00", "el importe no cambio");
	assert.equal(stored.status, "PENDIENTE", "un pago parcial no borra el saldo");

	// Y la regla sigue viviendo en el TRIGGER: el mismo UPDATE directo (como owner de las tablas, sin
	// RPC de por medio) lo rechaza con el mismo texto. Sin esta mitad, el test solo probaria que la
	// RPC rechaza.
	const direct = await pool
		.query(`update public.comprobante set voucher_number = 'F001-000003' where id = $1`, [id])
		.then(
			() => null,
			(error: unknown) => toFailure(error),
		);

	assert.ok(direct, "el UPDATE directo del numero debio ser rechazado");
	assert.equal(direct.code, "P0001");
	assert.equal(direct.message, COMPROBANTE_CON_PAGOS);
});

test("editar_compra sobre una VENTA responde `El comprobante no existe.` y no toca la venta (S8)", async () => {
	const dueno = await freshOwner("sobre-venta");

	await asOwner(dueno.id, (client) => crearSerie(client, "F001"));

	const ventaId = await asOwner(dueno.id, (client) => crearVenta(client, dueno.clientId, "118.00"));
	const antes = await storedComprobante(ventaId);

	// Mismo texto para "no existe", "es de otro dueno" y "es del otro vertical": la RPC de compras no
	// revela la existencia de comprobantes que este vertical no edita.
	const attempt = await rejectionOf(dueno.id, (client) =>
		editarCompra(client, ventaId, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "1.00",
			igv: "0.18",
			total: "1.18",
		}),
	);

	assert.equal(attempt.message, COMPROBANTE_INEXISTENTE);

	// Un id inventado y el comprobante de otro dueno comparten el mismo texto.
	const invented = await rejectionOf(dueno.id, (client) =>
		editarCompra(client, randomUUID(), {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "1.00",
			igv: "0.18",
			total: "1.18",
		}),
	);

	assert.equal(invented.message, COMPROBANTE_INEXISTENTE);

	assert.deepEqual(await storedComprobante(ventaId), antes, "la venta quedo intacta");
});

test("editar_compra no toca la compra de otro dueno y responde el mensaje de la RPC (S8)", async () => {
	const dueno = await freshOwner("propio");
	const ajeno = await freshOwner("ajeno");

	const foreignId = await asOwner(ajeno.id, (client) =>
		crearCompra(client, {
			entityId: ajeno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const attempt = await rejectionOf(dueno.id, (client) =>
		editarCompra(client, foreignId, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000999",
			subtotal: "1.00",
			igv: "0.18",
			total: "1.18",
		}),
	);

	assert.equal(attempt.message, COMPROBANTE_INEXISTENTE);

	const stored = await storedComprobante(foreignId);

	assert.equal(stored.owner_id, ajeno.id);
	assert.equal(stored.voucher_number, "F001-000001", "la fila ajena quedo intacta");
	assert.equal(stored.total, "118.00");
});

// ---------------------------------------------------------------------------
// La tabla sigue siendo la duena de sus CHECK.
// ---------------------------------------------------------------------------

test("una compra CONTADO con dias de credito la rechaza el CHECK comprobante_credit_days, no una regla nueva de la RPC", async () => {
	const dueno = await freshOwner("check");

	const rejected = await rejectionOf(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000001",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
			paymentType: "CONTADO",
			creditDays: 30,
		}),
	);

	assert.equal(rejected.message, DATOS_INVALIDOS, "el CHECK se traduce al mensaje de S8");
	assert.equal(rejected.code, "23514", "la familia del CHECK se conserva al traducir el mensaje");
	assert.equal(await totalCompras(dueno.id), 0, "no quedo ninguna fila");

	// Y la misma edicion tampoco pasa: el CHECK se aplica al UPDATE igual que al INSERT.
	const id = await asOwner(dueno.id, (client) =>
		crearCompra(client, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000002",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
		}),
	);

	const editRejected = await rejectionOf(dueno.id, (client) =>
		editarCompra(client, id, {
			entityId: dueno.supplierId,
			voucherNumber: "F001-000002",
			subtotal: "100.00",
			igv: "18.00",
			total: "118.00",
			paymentType: "CONTADO",
			creditDays: 30,
		}),
	);

	assert.equal(editRejected.message, DATOS_INVALIDOS);
	assert.equal(editRejected.code, "23514");
	assert.equal((await storedComprobante(id)).credit_days, null, "la fila no cambio");

	// La regla sigue viviendo en la TABLA: el INSERT directo (como owner de las tablas, sin RPC de
	// por medio) lo rechaza el CHECK con su nombre.
	const direct = await pool
		.query(
			`insert into public.comprobante
			   (owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
			    issue_date, subtotal, igv, total, payment_type, credit_days)
			 values ($1, $2, 'COMPRA', 'FACTURA', 'F001-000099', '2026-11-24', 100, 18, 118, 'CONTADO', 30)`,
			[dueno.id, dueno.supplierId],
		)
		.then(
			() => null,
			(error: unknown) => toFailure(error),
		);

	assert.ok(direct, "el INSERT directo con CONTADO y credit_days debio ser rechazado");
	assert.equal(direct.code, "23514");
	assert.equal(direct.constraint, "comprobante_credit_days");
});

// ---------------------------------------------------------------------------
// Grants: `authenticated` ejecuta las dos RPC y no recupera el DML de `comprobante`.
// ---------------------------------------------------------------------------

test("S3: authenticated ejecuta las dos RPC de compra, anon no, y comprobante sigue sin UPDATE ni DELETE", async () => {
	const crearCompraFn =
		"public.crear_compra(uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer)";
	const editarCompraFn =
		"public.editar_compra(uuid, uuid, public.voucher_type, text, date, numeric, numeric, numeric, public.payment_type, integer)";

	const grants = await pool.query<Record<string, boolean>>(
		`select has_function_privilege('authenticated', $1, 'execute') as authenticated_crear,
		        has_function_privilege('authenticated', $2, 'execute') as authenticated_editar,
		        has_function_privilege('service_role', $1, 'execute') as service_crear,
		        has_function_privilege('service_role', $2, 'execute') as service_editar,
		        has_function_privilege('anon', $1, 'execute') as anon_crear,
		        has_function_privilege('anon', $2, 'execute') as anon_editar,
		        has_function_privilege('public', $1, 'execute') as public_crear,
		        has_table_privilege('authenticated', 'public.comprobante', 'select') as comprobante_select,
		        has_table_privilege('authenticated', 'public.comprobante', 'insert') as comprobante_insert,
		        has_table_privilege('authenticated', 'public.comprobante', 'update') as comprobante_update,
		        has_table_privilege('authenticated', 'public.comprobante', 'delete') as comprobante_delete`,
		[crearCompraFn, editarCompraFn],
	);

	const row = grants.rows[0];

	assert.ok(row, "el catalogo deberia devolver los privilegios");
	assert.equal(row.authenticated_crear, true);
	assert.equal(row.authenticated_editar, true);
	assert.equal(row.service_crear, true, "service_role conserva la via administrativa");
	assert.equal(row.service_editar, true);
	assert.equal(row.anon_crear, false, "anon no ejecuta las RPC de compra");
	assert.equal(row.anon_editar, false);
	assert.equal(row.public_crear, false, "public tampoco");

	// El estado que fijo `20261124090000` no cambia: las RPC de compra no se pagan con DML
	// re-otorgado.
	assert.equal(row.comprobante_update, false, "UPDATE de comprobante sigue revocado");
	assert.equal(row.comprobante_delete, false, "DELETE de comprobante sigue revocado");
	assert.equal(row.comprobante_select, true);
	assert.equal(row.comprobante_insert, true);

	// Y por comportamiento: el mismo rol que ejecuta las RPC no puede escribir la tabla.
	const id = await asOwner(owner.id, (client) =>
		crearCompra(client, {
			entityId: owner.supplierId,
			voucherNumber: "F001-000777",
			subtotal: "10.00",
			igv: "1.80",
			total: "11.80",
		}),
	);

	for (const statement of [
		"update public.comprobante set total = total + 1",
		"delete from public.comprobante",
	]) {
		const failure = await rejectionOf(owner.id, (client) => client.query(statement));

		assert.equal(failure.code, "42501", `${statement} deberia morir por privilegios`);
	}

	assert.equal((await storedComprobante(id)).total, "11.80", "la fila quedo intacta");
	assert.equal((await storedComprobante(id)).voucher_number, "F001-000777");
});
