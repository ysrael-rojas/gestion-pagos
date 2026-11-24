// Pruebas de `packages/db/migrations/20261127090000_notas_rpcs.sql` (T1 del port del vertical notas,
// S3/S5/S6 de `odd/tasks/port-vertical-notas.md`) contra una base viva con las migraciones
// aplicadas.
//
// Que prueba, en una frase: que emitir una nota de credito o de debito es UNA transaccion de la
// base —numero de la serie por defecto del tipo, tope de credito verificado bajo el lock del
// comprobante referenciado— y que el saldo del referenciado lo mueven los triggers que ya existian,
// no la RPC.
//
// Por que llama a la RPC y no a una ruta HTTP: el modulo `notes` del API es T3 y todavia no existe.
// El camino que si existe es el de `withOwner` (`src/db/with-owner.ts`): una transaccion con
// `app.user_id` fijado y `set local role authenticated`, y despues `select public.crear_nota(...)`.
// Eso es exactamente lo que arma `asOwner` aca, igual que `ventas-rpc.e2e.test.ts`.
//
// Precondiciones de entorno (no se leen de ningun archivo del repo):
//   DATABASE_URL   la base con las migraciones aplicadas (`node packages/db/scripts/apply-sql.mjs`).
//                  No hace falta sembrarla: los duenos de este archivo son propios.
//
// Identidad y series: los duenos se crean por SQL (`auth.users` + su `entidad`), igual que
// `docs/operacion/crear-usuario.md`; las series se siembran por SQL para que cada prueba de nota no
// dependa de `crear_serie` (que tiene su propia prueba al final, y es la que pina S3). Cada prueba
// usa su PROPIO dueno: el `is_default` es unico por `(dueno, tipo)`, asi que compartir dueno haria
// que el resultado dependiera del orden de ejecucion.
//
// Lo que este archivo NO prueba, a proposito: el catalogo de motivos (S9). Vive en el contrato de
// `packages/shared/src/lib/data/nota-options.ts` y la base solo exige que el motivo venga (CHECK
// `comprobante_ajuste_check`); inventar un catalogo en SQL seria una segunda fuente de la misma
// regla.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { Pool, type PoolClient } from "pg";

/** Textos de S10, verbatim. Los compara el test contra lo que devuelve la base. */
const REFERENCIADO_INEXISTENTE = "El comprobante referenciado no existe.";
const SOLO_BASE_DE_VENTA = "Solo puedes referenciar factura, boleta o nota de venta.";
const NOTA_DUPLICADA = "Ya registraste una nota con ese número de comprobante.";
const DATOS_NOTA_INVALIDOS = "Los datos de la nota no son válidos.";
const TOPE_CREDITO =
	"Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.";

/** Textos de S3 (la serie) y de S6 (`port-vertical-series.md`), verbatim. */
const SIN_SERIE_POR_DEFECTO =
	"No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.";
const DATOS_SERIE_INVALIDOS = "Los datos de la serie no son válidos.";

/**
 * Mensaje del trigger `comprobante_owner_consistency` (`20261028194204`), textual. La RPC NO lo
 * reescribe: una referencia ajena muere en el trigger, con su 42501.
 */
const REFERENCIA_AJENA =
	"El comprobante referencia una entidad o comprobante de otro usuario";

const DATABASE_URL = process.env.DATABASE_URL?.trim();

if (!DATABASE_URL) {
	throw new Error(
		"Falta DATABASE_URL: estas pruebas corren contra una base con las migraciones aplicadas (no hay valor por defecto).",
	);
}

const pool = new Pool({ connectionString: DATABASE_URL });

/** Dueno de las notas, con la unica fila de dominio que una nota necesita: su entidad. */
interface SeededOwner {
	id: string;
	entityId: string;
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
 * Arma la transaccion de la ruta de la aplicacion y corre `run` ADENTRO (mismo contrato que
 * `withOwner`: el GUC primero, el rol despues, o las politicas RLS verian `auth.uid()` nulo).
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

/** `select public.crear_venta(...)`: el comprobante que las notas corrigen. */
async function crearVenta(
	client: PoolClient,
	input: { entityId: string; total?: string },
): Promise<string> {
	const total = input.total ?? "118.00";
	const subtotal = (Number(total) / 1.18).toFixed(2);
	const igv = (Number(total) - Number(subtotal)).toFixed(2);

	const result = await client.query<{ id: string }>(
		`select public.crear_venta(
			$1::uuid, $2::public.voucher_type, $3::date,
			$4::numeric, $5::numeric, $6::numeric, $7::public.payment_type, $8::integer
		) as id`,
		[input.entityId, "FACTURA", "2026-11-27", subtotal, igv, total, "CONTADO", null],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "crear_venta deberia devolver el id del comprobante creado");

	return id;
}

interface NotaInput {
	referenciadoId: string;
	voucherType?: string;
	issueDate?: string;
	subtotal: string;
	igv: string;
	total: string;
	motiveCode?: string | null;
}

/**
 * `select public.crear_nota(...)`.
 *
 * SIETE argumentos: el numero no viaja (lo asigna la base desde la serie por defecto del tipo de la
 * nota, S3), y el dueno tampoco (sale de `auth.uid()`). Si esta firma se rompe, el test falla con
 * "function does not exist", que es exactamente lo que se quiere pinar.
 */
async function crearNota(client: PoolClient, input: NotaInput): Promise<string> {
	const result = await client.query<{ id: string }>(
		`select public.crear_nota(
			$1::uuid, $2::public.voucher_type, $3::date,
			$4::numeric, $5::numeric, $6::numeric, $7::text
		) as id`,
		[
			input.referenciadoId,
			input.voucherType ?? "NOTA_CREDITO",
			input.issueDate ?? "2026-11-27",
			input.subtotal,
			input.igv,
			input.total,
			input.motiveCode === undefined ? "01" : input.motiveCode,
		],
	);

	const id = result.rows[0]?.id;

	assert.ok(id, "crear_nota deberia devolver el id de la nota creada");

	return id;
}

/** Una nota de credito de un total, con el desglose que produce el 18 % del contrato compartido. */
function notaCredito(referenciadoId: string, total: string): NotaInput {
	const subtotal = (Number(total) / 1.18).toFixed(2);

	return {
		referenciadoId,
		voucherType: "NOTA_CREDITO",
		subtotal,
		igv: (Number(total) - Number(subtotal)).toFixed(2),
		total,
	};
}

/** Una nota de debito de un total, mismo desglose. */
function notaDebito(referenciadoId: string, total: string): NotaInput {
	return { ...notaCredito(referenciadoId, total), voucherType: "NOTA_DEBITO", motiveCode: "02" };
}

/** La fila cruda del comprobante, en texto para comparar sin ruido de tipos. */
async function storedComprobante(id: string): Promise<Record<string, string | number | null>> {
	const result = await pool.query<Record<string, string | number | null>>(
		`select owner_id::text, entity_id::text, voucher_kind::text, voucher_type::text,
		        voucher_number, issue_date::text, subtotal::text, igv::text, total::text,
		        payment_type::text, credit_days, due_date::text, status::text,
		        referenced_comprobante_id::text, motive_code
		   from public.comprobante
		  where id = $1`,
		[id],
	);

	const row = result.rows[0];

	assert.ok(row, `deberia existir el comprobante ${id}`);

	return row;
}

/**
 * Las partes del saldo del comprobante referenciado, tal como las expone `voucher_balance`
 * (`20261017114635:275-310`): `balance = total - pagado - creditos + debitos`.
 */
async function balanceOf(comprobanteId: string): Promise<Record<string, string>> {
	const result = await pool.query<Record<string, string>>(
		`select total::text, paid_amount::text, credit_amount::text, debit_amount::text,
		        balance::text
		   from public.voucher_balance
		  where comprobante_id = $1`,
		[comprobanteId],
	);

	const row = result.rows[0];

	assert.ok(row, `el comprobante ${comprobanteId} deberia estar en voucher_balance`);

	return row;
}

/** Las notas del dueno (cualquier tipo de ajuste), ordenadas por numero. */
async function notasOf(ownerId: string): Promise<Array<Record<string, string>>> {
	const result = await pool.query<Record<string, string>>(
		`select voucher_number, voucher_type::text, total::text, status::text,
		        referenced_comprobante_id::text
		   from public.comprobante
		  where owner_id = $1
		    and voucher_type in ('NOTA_CREDITO', 'NOTA_DEBITO', 'COMPROBANTE_RETENCION')
		  order by voucher_number`,
		[ownerId],
	);

	return result.rows;
}

/** `last_number` de la serie de un tipo y codigo, o `null` si no existe. */
async function lastNumberOf(
	ownerId: string,
	voucherType: string,
	code: string,
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

interface SerieSeed {
	voucherType: string;
	code: string;
	lastNumber?: number;
	isDefault?: boolean;
}

/**
 * Siembra una serie por SQL directo (dueño de las tablas), que es lo que el alta de notas necesita:
 * la nota toma la serie por defecto de su tipo y lee/avanza `last_number`. Sembrarla asi mantiene
 * estas pruebas independientes de `crear_serie` (que tiene su propia prueba de S3 al final).
 */
async function seedSeries(ownerId: string, seed: SerieSeed): Promise<string> {
	const id = randomUUID();

	await pool.query(
		`insert into public.voucher_series (id, owner_id, voucher_type, code, last_number, is_default)
		 values ($1, $2, $3::public.voucher_type, $4, $5, $6)`,
		[id, ownerId, seed.voucherType, seed.code, seed.lastNumber ?? 0, seed.isDefault ?? true],
	);

	return id;
}

/** Siembra un comprobante de COMPRA por SQL: no hay RPC de compras en este vertical. */
async function seedCompra(ownerId: string, entityId: string): Promise<string> {
	const id = randomUUID();

	await pool.query(
		`insert into public.comprobante
		   (id, owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
		    issue_date, subtotal, igv, total, payment_type, credit_days)
		 values ($1, $2, $3, 'COMPRA', 'FACTURA', 'C001-000001', '2026-11-27', 100, 18, 118, 'CONTADO', null)`,
		[id, ownerId, entityId],
	);

	return id;
}

/** Siembra un dueno con su entidad. Los numeros de serie y comprobante los asigna cada prueba. */
async function freshOwner(tag: string): Promise<SeededOwner> {
	const id = randomUUID();
	const entityId = randomUUID();

	await pool.query(
		`insert into auth.users (id, name, email, email_verified) values ($1, $2, $3, true)`,
		[id, `E2E notas ${tag}`, `e2e-notas-${tag}-${id}@example.test`],
	);

	await pool.query(
		`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, owner_id)
		 values ($1, 'SIN_DOCUMENTO', '', $2, $3, true, $4)`,
		[entityId, `Cliente ${tag}`, `cliente-${tag}-${id}@example.test`, id],
	);

	const owner = { id, entityId };

	createdOwners.push(owner);

	return owner;
}

/** Borra un dueno completo, en orden de FK. */
async function deleteOwner(target: SeededOwner): Promise<void> {
	await pool.query("delete from public.comprobante where owner_id = $1", [target.id]);
	await pool.query("delete from public.voucher_series where owner_id = $1", [target.id]);
	await pool.query("delete from public.entidad where owner_id = $1", [target.id]);
	await pool.query("delete from auth.users where id = $1", [target.id]);
}

interface VentaFixture {
	owner: SeededOwner;
	ventaId: string;
}

/**
 * Un dueno con la venta a corregir y sus tres series por defecto (factura, nota de credito y nota
 * de debito). La mayoria de las pruebas siguientes arrancan de aca.
 */
async function freshSala(tag: string): Promise<VentaFixture> {
	const owner = await freshOwner(tag);

	await seedSeries(owner.id, { voucherType: "FACTURA", code: "F001" });
	await seedSeries(owner.id, { voucherType: "NOTA_CREDITO", code: "FC01" });
	await seedSeries(owner.id, { voucherType: "NOTA_DEBITO", code: "FD01" });

	const ventaId = await asOwner(owner.id, (client) =>
		crearVenta(client, { entityId: owner.entityId }),
	);

	return { owner, ventaId };
}

/**
 * Abre una transaccion con la identidad del dueno y la deja abierta: la usa la prueba de
 * concurrencia, que necesita DOS transacciones vivas al mismo tiempo.
 */
async function openOwnerTransaction(ownerId: string): Promise<PoolClient> {
	const client = await pool.connect();

	await client.query("begin");
	await client.query("select set_config('app.user_id', $1, true)", [ownerId]);
	await client.query("set local role authenticated");

	return client;
}

after(async () => {
	for (const target of createdOwners) {
		await deleteOwner(target);
	}

	await pool.end();
});

test("una nota de credito toma el siguiente numero de su serie y baja el saldo del referenciado (S3, S5)", async () => {
	const { owner, ventaId } = await freshSala("credito");

	const primera = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "18.00")),
	);

	const stored = await storedComprobante(primera);

	// S3: `code || '-' || lpad(last_number + 1, 6, '0')` de la serie por defecto del TIPO DE LA NOTA,
	// no de la serie de la factura.
	assert.equal(stored.voucher_number, "FC01-000001");
	assert.equal(stored.voucher_type, "NOTA_CREDITO");
	assert.equal(stored.voucher_kind, "VENTA", "una nota de venta hereda el kind del referenciado");
	assert.equal(stored.owner_id, owner.id, "el dueno sale de auth.uid(), no del payload");
	assert.equal(stored.entity_id, owner.entityId, "la entidad se hereda del referenciado (S4)");
	assert.equal(stored.payment_type, "CONTADO", "S4: una nota es CONTADO");
	assert.equal(stored.credit_days, null, "S4: una nota no tiene dias de credito");
	assert.equal(stored.due_date, null, "due_date es generada: en CONTADO queda nula");
	assert.equal(stored.status, "PAGADO", "S4: una nota no es cobrable ni pagable");
	assert.equal(stored.referenced_comprobante_id, ventaId);
	assert.equal(stored.motive_code, "01");
	assert.equal(stored.issue_date, "2026-11-27");
	assert.equal(stored.subtotal, "15.25");
	assert.equal(stored.igv, "2.75");
	assert.equal(stored.total, "18.00");

	assert.equal(
		await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"),
		1,
		"la serie de la nota avanzo en la MISMA transaccion que el alta",
	);

	// El saldo del referenciado lo ajustan los triggers existentes (`voucher_balance` resta NC).
	assert.deepEqual(await balanceOf(ventaId), {
		total: "118.00",
		paid_amount: "0.00",
		credit_amount: "18.00",
		debit_amount: "0.00",
		balance: "100.00",
	});

	// La segunda nota continua la numeracion de la MISMA serie: sin huecos y sin repetir.
	const segunda = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "18.00")),
	);

	assert.equal((await storedComprobante(segunda)).voucher_number, "FC01-000002");
	assert.equal(await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"), 2);

	const saldo = await balanceOf(ventaId);

	assert.equal(saldo.credit_amount, "36.00");
	assert.equal(saldo.balance, "82.00");

	// La factura no se reescribio: el comprobante se corrige con notas, no editandolo (S2).
	const factura = await storedComprobante(ventaId);

	assert.equal(factura.total, "118.00");
	assert.equal(factura.voucher_number, "F001-000001");
	assert.equal(factura.status, "PENDIENTE", "118 - 36 sigue pendiente de cobro");
});

test("una nota de debito sube el saldo del referenciado y no consume el tope de S5", async () => {
	const { owner, ventaId } = await freshSala("debito");

	const credito = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "18.00")),
	);

	assert.equal((await storedComprobante(credito)).voucher_number, "FC01-000001");

	// 100 de debito sobre una factura de 118: si el tope de S5 se aplicara a las notas de debito,
	// esta rechazaria (18 + 100 > 118). No lo hace porque una ND AUMENTA el saldo.
	const debito = await asOwner(owner.id, (client) =>
		crearNota(client, notaDebito(ventaId, "100.00")),
	);

	const stored = await storedComprobante(debito);

	assert.equal(stored.voucher_number, "FD01-000001", "usa la serie del TIPO de la nota");
	assert.equal(stored.voucher_type, "NOTA_DEBITO");
	assert.equal(stored.status, "PAGADO");
	assert.equal(await lastNumberOf(owner.id, "NOTA_DEBITO", "FD01"), 1);

	assert.deepEqual(await balanceOf(ventaId), {
		total: "118.00",
		paid_amount: "0.00",
		credit_amount: "18.00",
		debit_amount: "100.00",
		balance: "200.00",
	});
});

test("dos notas de credito que juntas superan el total responden el mensaje de S5 y no escriben nada", async () => {
	const { owner, ventaId } = await freshSala("tope");

	await asOwner(owner.id, (client) => crearNota(client, notaCredito(ventaId, "60.00")));

	const rechazo = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "60.00")),
	);

	// Textual de S5: el tope es una invariante de base, no de pantalla.
	assert.equal(rechazo.message, TOPE_CREDITO);

	const notas = await notasOf(owner.id);

	assert.equal(notas.length, 1, "la segunda nota no quedo escrita");
	assert.equal(notas[0]?.total, "60.00");
	assert.equal(
		await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"),
		1,
		"el rechazo no consumio un correlativo",
	);
	assert.equal((await balanceOf(ventaId)).credit_amount, "60.00");
});

test("una nota de credito exactamente igual al total se acepta, y un centavo mas ya no (S5)", async () => {
	const { owner, ventaId } = await freshSala("tope-exacto");

	const exacta = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "118.00")),
	);

	assert.equal((await storedComprobante(exacta)).voucher_number, "FC01-000001");
	assert.equal((await balanceOf(ventaId)).balance, "0.00");

	// El tope se compara contra el total del referenciado, no contra el saldo: con la factura ya
	// cubierta, cualquier credito adicional lo supera.
	const unaMas = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "1.00")),
	);

	assert.equal(unaMas.message, TOPE_CREDITO);
	assert.equal((await notasOf(owner.id)).length, 1);
	assert.equal(await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"), 1);
});

test("sin serie por defecto del tipo de la nota responde el mensaje de S3 y no escribe nada (S3)", async () => {
	const owner = await freshOwner("sin-serie-nota");

	await seedSeries(owner.id, { voucherType: "FACTURA", code: "F001" });
	// La serie de nota de credito existe pero NO es la que se usa: el alta no tiene fallback.
	await seedSeries(owner.id, { voucherType: "NOTA_CREDITO", code: "FC01", isDefault: false });

	const ventaId = await asOwner(owner.id, (client) =>
		crearVenta(client, { entityId: owner.entityId }),
	);

	const rechazo = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "18.00")),
	);

	assert.equal(rechazo.message, SIN_SERIE_POR_DEFECTO);
	assert.equal((await notasOf(owner.id)).length, 0, "no se registro ninguna nota");
	assert.equal(await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"), 0, "la serie no avanzo");

	// Y una serie por defecto de OTRO tipo no sirve como fallback.
	const otroTipo = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaDebito(ventaId, "10.00")),
	);

	assert.equal(otroTipo.message, SIN_SERIE_POR_DEFECTO);
	assert.equal((await notasOf(owner.id)).length, 0);
	assert.equal((await balanceOf(ventaId)).balance, "118.00", "el saldo no se movio");
});

test("referenciar una compra o una nota responde el mensaje de S10 y no escribe (S6)", async () => {
	const { owner, ventaId } = await freshSala("referencia-invalida");
	const compraId = await seedCompra(owner.id, owner.entityId);

	// Una COMPRA tiene el mismo TIPO que su par de venta (una compra es `FACTURA`), asi que el tipo
	// solo no alcanza: la RPC valida el `voucher_kind` con el texto de S10.
	const compra = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(compraId, "10.00")),
	);

	assert.equal(compra.message, SOLO_BASE_DE_VENTA);

	// Una nota no se corrige con otra nota (`comprobante_validate_adjustment` ya lo exige por tipo).
	const credito = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "18.00")),
	);
	const sobreNota = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(credito, "1.00")),
	);

	assert.equal(sobreNota.message, SOLO_BASE_DE_VENTA);
	assert.equal((await notasOf(owner.id)).length, 1, "solo quedo la nota valida");
	assert.equal(await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"), 1);

	// Un id inventado tampoco: el texto de S10 para "no existe".
	const inexistente = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(randomUUID(), "10.00")),
	);

	assert.equal(inexistente.message, REFERENCIADO_INEXISTENTE);
});

test("referenciar el comprobante de otro dueno lo rechaza el trigger y no escribe nada (S6)", async () => {
	const { owner } = await freshSala("propio");
	const ajeno = await freshSala("ajeno");

	// El dueno tiene su serie de nota: el rechazo no puede confundirse con "sin serie".
	const rechazo = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(ajeno.ventaId, "10.00")),
	);

	// Textual del trigger `comprobante_owner_consistency`: la RPC no lo reescribe.
	assert.equal(rechazo.code, "42501");
	assert.equal(rechazo.message, REFERENCIA_AJENA);

	assert.equal((await notasOf(owner.id)).length, 0, "no quedo nota en el dueno de la sesion");
	assert.equal(await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"), 0, "la serie no avanzo");
	assert.equal((await balanceOf(ajeno.ventaId)).balance, "118.00", "la venta ajena quedo intacta");
});

test("el mismo numero dos veces responde el mensaje de nota duplicada y el juez es el indice unico", async () => {
	const { owner, ventaId } = await freshSala("duplicada");

	// Una fila escrita por fuera de la RPC con el correlativo adelantado: es el unico camino por el
	// que el numero asignado por la base puede chocar (mismo escenario que `crear_venta`).
	await pool.query(
		`insert into public.comprobante
		   (owner_id, entity_id, voucher_kind, voucher_type, voucher_number,
		    issue_date, subtotal, igv, total, payment_type, credit_days, status,
		    referenced_comprobante_id, motive_code)
		 values ($1, $2, 'VENTA', 'NOTA_CREDITO', 'FC01-000001',
		         '2026-11-27', 15.25, 2.75, 18, 'CONTADO', null, 'PAGADO', $3, '01')`,
		[owner.id, owner.entityId, ventaId],
	);

	const rechazo = await rejectionOf(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "18.00")),
	);

	assert.equal(rechazo.code, "23505", "la familia es la del indice unico");
	assert.equal(rechazo.message, NOTA_DUPLICADA);

	assert.equal((await notasOf(owner.id)).length, 1, "no se agrego una segunda fila");
	assert.equal(
		await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"),
		0,
		"la serie no avanzo: el correlativo no se consumio",
	);
});

test("los datos invalidos de la nota responden el mensaje de S10 y no escriben (S10)", async () => {
	const { owner, ventaId } = await freshSala("datos-invalidos");

	// Un comprobante base no se da de alta como nota: la nota corrige, no crea.
	const base = await rejectionOf(owner.id, (client) =>
		crearNota(client, { ...notaCredito(ventaId, "10.00"), voucherType: "FACTURA" }),
	);

	assert.equal(base.message, DATOS_NOTA_INVALIDOS);
	assert.equal(base.code, "23514");

	// La retencion tampoco: tiene su propio slice (L3.e), con su propio mensaje.
	const retencion = await rejectionOf(owner.id, (client) =>
		crearNota(client, { ...notaCredito(ventaId, "10.00"), voucherType: "COMPROBANTE_RETENCION" }),
	);

	assert.equal(retencion.message, DATOS_NOTA_INVALIDOS);

	// El motivo es obligatorio en una nota: vacio no es "sin motivo".
	const sinMotivo = await rejectionOf(owner.id, (client) =>
		crearNota(client, { ...notaCredito(ventaId, "10.00"), motiveCode: "   " }),
	);

	assert.equal(sinMotivo.message, DATOS_NOTA_INVALIDOS);

	// El importe lo valida el CHECK `total > 0` de la tabla; la RPC solo traduce el rechazo.
	const cero = await rejectionOf(owner.id, (client) =>
		crearNota(client, { ...notaCredito(ventaId, "10.00"), subtotal: "0.00", igv: "0.00", total: "0.00" }),
	);

	assert.equal(cero.message, DATOS_NOTA_INVALIDOS);
	assert.equal(cero.code, "23514");

	assert.equal((await notasOf(owner.id)).length, 0, "ninguno de los cuatro rechazos escribio");
	assert.equal(await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"), 0);
	assert.equal((await balanceOf(ventaId)).balance, "118.00");
});

test("dos notas de credito simultaneas no pueden superar el tope (S5, concurrencia)", async () => {
	const { owner, ventaId } = await freshSala("tope-carrera");

	const primera = await openOwnerTransaction(owner.id);
	const segunda = await openOwnerTransaction(owner.id);
	let pendiente: Promise<string> | undefined;

	try {
		// La primera toma el lock del comprobante referenciado y lo RETIENE hasta su commit.
		const primeraNota = await crearNota(primera, notaCredito(ventaId, "60.00"));

		// La segunda se lanza mientras la primera sigue sin confirmar. Si el `for update` del
		// referenciado no serializara, las dos leerian la misma suma (0) y las dos pasarian.
		pendiente = crearNota(segunda, notaCredito(ventaId, "60.00"));

		const estado = await Promise.race([
			pendiente.then(
				() => "respondio",
				() => "respondio",
			),
			new Promise<string>((resolve) => setTimeout(() => resolve("esperando"), 300)),
		]);

		assert.equal(estado, "esperando", "la segunda espera el lock del referenciado");

		await primera.query("commit");

		// Cuando la primera confirma, la segunda ve la suma ya aplicada y no puede pasarse del tope.
		const rechazo = await pendiente.then(
			() => {
				throw new Error("la segunda nota debio ser rechazada por el tope");
			},
			(error: unknown) => toFailure(error),
		);

		assert.equal(rechazo.message, TOPE_CREDITO);

		await segunda.query("rollback");

		assert.equal((await storedComprobante(primeraNota)).voucher_number, "FC01-000001");
		assert.equal((await notasOf(owner.id)).length, 1, "quedo una sola nota");
		assert.equal(
			await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"),
			1,
			"la nota rechazada no consumio correlativo",
		);
		assert.equal((await balanceOf(ventaId)).credit_amount, "60.00");
	} finally {
		await pendiente?.catch(() => undefined);
		await primera.query("rollback").catch(() => undefined);
		await segunda.query("rollback").catch(() => undefined);
		primera.release();
		segunda.release();
	}
});

test("crear_serie acepta los dos tipos de nota y sigue rechazando la retencion (S3)", async () => {
	const owner = await freshOwner("series-nota");

	const credito = await asOwner(owner.id, (client) =>
		client.query<{ id: string }>(
			"select public.crear_serie('NOTA_CREDITO'::public.voucher_type, 'FC01'::text, true) as id",
		),
	);
	const debito = await asOwner(owner.id, (client) =>
		client.query<{ id: string }>(
			"select public.crear_serie('NOTA_DEBITO'::public.voucher_type, 'FD01'::text, true) as id",
		),
	);

	assert.ok(credito.rows[0]?.id, "la serie de nota de credito se crea");
	assert.ok(debito.rows[0]?.id, "la serie de nota de debito se crea");

	// La retencion sigue afuera hasta que exista su flujo (L3.e), con el mismo mensaje de siempre.
	const retencion = await rejectionOf(owner.id, (client) =>
		client.query(
			"select public.crear_serie('COMPROBANTE_RETENCION'::public.voucher_type, 'RT01'::text, true)",
		),
	);

	assert.equal(retencion.message, DATOS_SERIE_INVALIDOS);
	assert.equal(retencion.code, "23514");

	const series = await pool.query<{ voucher_type: string }>(
		"select voucher_type::text from public.voucher_series where owner_id = $1 order by voucher_type",
		[owner.id],
	);

	assert.deepEqual(
		series.rows.map((row) => row.voucher_type),
		["NOTA_CREDITO", "NOTA_DEBITO"],
		"ninguna fila de retencion",
	);

	// Y la serie que creo la RPC es la que usa el alta de la nota: S3 cerrado de punta a punta.
	await seedSeries(owner.id, { voucherType: "FACTURA", code: "F001" });

	const ventaId = await asOwner(owner.id, (client) =>
		crearVenta(client, { entityId: owner.entityId }),
	);

	const notaId = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "10.00")),
	);

	assert.equal((await storedComprobante(notaId)).voucher_number, "FC01-000001");
});

test("recrear una serie de nota dada de baja arranca en la ultima nota emitida, no en 0 (S3)", async () => {
	const owner = await freshOwner("serie-nota-recreada");

	await seedSeries(owner.id, { voucherType: "FACTURA", code: "F001" });

	const ventaId = await asOwner(owner.id, (client) =>
		crearVenta(client, { entityId: owner.entityId }),
	);

	const serieId = await asOwner(owner.id, (client) =>
		client
			.query<{ id: string }>(
				"select public.crear_serie('NOTA_CREDITO'::public.voucher_type, 'FC01'::text, true) as id",
			)
			.then((result) => result.rows[0]?.id ?? ""),
	);

	assert.ok(serieId);

	await asOwner(owner.id, (client) => crearNota(client, notaCredito(ventaId, "10.00")));
	await asOwner(owner.id, (client) => crearNota(client, notaCredito(ventaId, "10.00")));

	assert.equal(await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"), 2);

	// La serie se da de baja y se vuelve a crear con el mismo codigo. El calculo del correlativo
	// inicial de `crear_serie` filtra por `voucher_kind = 'VENTA'` y por el tipo pedido: las notas
	// son `VENTA`, asi que las encuentra y arranca en 2 (no en 0, que volveria a FC01-000001).
	await asOwner(owner.id, (client) =>
		client.query("select public.eliminar_serie($1::uuid)", [serieId]),
	);

	await asOwner(owner.id, (client) =>
		client.query(
			"select public.crear_serie('NOTA_CREDITO'::public.voucher_type, 'FC01'::text, true)",
		),
	);

	assert.equal(
		await lastNumberOf(owner.id, "NOTA_CREDITO", "FC01"),
		2,
		"el correlativo inicial sale de las notas ya emitidas con ese (dueno, tipo, codigo)",
	);

	const siguiente = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "10.00")),
	);

	assert.equal((await storedComprobante(siguiente)).voucher_number, "FC01-000003");
});

test("S3/S5: authenticated ejecuta crear_nota y NO conserva DML directo sobre comprobante ni voucher_series", async () => {
	const grants = await pool.query<Record<string, boolean>>(
		`select has_function_privilege('authenticated',
		         'public.crear_nota(uuid, public.voucher_type, date, numeric, numeric, numeric, text)',
		         'execute') as authenticated_crear_nota,
		        has_function_privilege('service_role',
		         'public.crear_nota(uuid, public.voucher_type, date, numeric, numeric, numeric, text)',
		         'execute') as service_role_crear_nota,
		        has_function_privilege('anon',
		         'public.crear_nota(uuid, public.voucher_type, date, numeric, numeric, numeric, text)',
		         'execute') as anon_crear_nota,
		        has_table_privilege('authenticated', 'public.comprobante', 'update') as comprobante_update,
		        has_table_privilege('authenticated', 'public.comprobante', 'delete') as comprobante_delete,
		        has_table_privilege('authenticated', 'public.voucher_series', 'update') as serie_update,
		        has_table_privilege('authenticated', 'public.voucher_series', 'delete') as serie_delete`,
	);

	const row = grants.rows[0];

	assert.ok(row, "el catalogo deberia devolver los privilegios");
	assert.equal(row.authenticated_crear_nota, true);
	assert.equal(row.service_role_crear_nota, true, "service_role conserva la via administrativa");
	assert.equal(row.anon_crear_nota, false, "anon no ejecuta la RPC de notas");
	assert.equal(row.comprobante_update, false, "UPDATE de comprobante sigue revocado");
	assert.equal(row.comprobante_delete, false, "DELETE de comprobante sigue revocado");
	assert.equal(row.serie_update, false, "UPDATE de voucher_series sigue revocado");
	assert.equal(row.serie_delete, false, "DELETE de voucher_series sigue revocado");

	// Y por comportamiento: la nota del rol de la sesion se escribe por la RPC (que corre como el
	// dueno de las tablas) y recibe el numero de su serie, sin DML nuevo de por medio.
	const { owner, ventaId } = await freshSala("grants");

	const notaId = await asOwner(owner.id, (client) =>
		crearNota(client, notaCredito(ventaId, "10.00")),
	);

	assert.equal((await storedComprobante(notaId)).voucher_number, "FC01-000001");
});
