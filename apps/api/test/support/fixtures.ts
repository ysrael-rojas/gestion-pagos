// Fixtures del e2e de pagos.
//
// Regla de identidad: NINGUNA sesion se inventa. Las dos sesiones salen de la API server-side
// de Better Auth (`auth.api.signInEmail` / `auth.api.signUpEmail`), que es exactamente lo que
// ejecuta el handler HTTP de `/api/auth/*`. El GUC `app.user_id` lo sigue fijando `withOwner`
// a partir de la sesion resuelta por el API; el test no lo toca en la ruta de dominio.
//
// El dueno demo (`seed-demo.sql`) no tiene credencial: solo existe en `auth.users`. Para poder
// iniciar sesion como el se le inserta una fila `auth.account` con una contrasena hasheada por
// `hashPassword` de Better Auth (su propio formato scrypt), y se borra en el teardown. Nada de
// esto bypassea `withOwner`: la sesion se valida contra `auth.session` como en produccion.
//
// El segundo dueno se crea con `signUpEmail`, es decir por el camino real de alta. Sus filas de
// dominio se siembran con SQL directo como `dev_user` (owner de las tablas), igual que los
// seeds; el teardown las borra en orden de FK y termina borrando su `auth.users`, que arrastra
// sesiones y cuentas por cascada.
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Pool } from "pg";
import type { Auth } from "../../src/auth/auth.ts";

/** Contrasena de los usuarios de prueba. Vive solo en memoria del test, nunca en el repo. */
export const TEST_PASSWORD = "e2e-fixture-passw0rd";

/**
 * "Hoy" para las fixtures, en la zona de la APP y no la del contenedor.
 *
 * Mismo criterio (y mismo bug) que `apps/web/e2e/support/owner.ts`: los tests arman el
 * `paymentDate` con `getTodayLocalDate()` (America/Lima), mientras Postgres del compose corre en
 * UTC. Entre las 19:00 y las 24:00 de Lima UTC ya es el dia siguiente, asi que una cuenta
 * "abierta hoy" por SQL nacia con fecha futura y `private.assert_account_open_for` rechazaba el
 * pago con "La fecha del recibo (...) es anterior al saldo inicial de la cuenta (...)".
 */
export const APP_TODAY = "(now() at time zone 'America/Lima')::date";

export interface OwnerSession {
	ownerId: string;
	email: string;
	/** Valor listo para `headers.cookie`. */
	cookie: string;
	/** Tokens de `auth.session` creados por el test, para borrarlos en el teardown. */
	sessionTokens: string[];
}

export interface AccountIds {
	cashAccountId: string;
	methodId: string;
	categoryId: string;
	entityId: string;
}

export interface SeededSecondOwner {
	session: OwnerSession;
	ids: AccountIds;
	/** Comprobante VENTA de 1000 con 400 ya asignados: saldo abierto 600. */
	openVoucherId: string;
	/** Comprobante VENTA de 300 sin asignar: saldo abierto 300. */
	freeVoucherId: string;
	/** Pago de 400 totalmente asignado al comprobante abierto. */
	assignedPaymentId: string;
	/** Pago de 800 sin asignaciones: saldo pendiente 800. */
	unassignedPaymentId: string;
}

/**
 * Extrae la cookie de sesion de Better Auth de las cabeceras de una respuesta suya.
 *
 * `getSetCookie()` devuelve una entrada por `Set-Cookie`; sin el, el `get()` de fetch une todo
 * con comas y partir por comas rompe en el `Expires`. Solo interesan las cookies que llevan
 * `session_token` (la de sesion, con su firma); la de "no recordar" es un marcador.
 */
export function sessionCookieFrom(headers: Headers): string {
	const setCookies =
		typeof headers.getSetCookie === "function"
			? headers.getSetCookie()
			: [headers.get("set-cookie") ?? ""];

	const pairs = setCookies
		.filter(Boolean)
		.map((entry) => entry.split(";")[0]?.trim() ?? "")
		.filter((pair) => pair.includes("session_token"));

	if (pairs.length === 0) {
		throw new Error("Better Auth no emitio la cookie de sesion (session_token).");
	}

	return pairs.join("; ");
}

/** Inicia sesion con el camino real de Better Auth y devuelve la cookie + el token emitido. */
export async function signIn(auth: Auth, email: string, password: string): Promise<OwnerSession> {
	const { headers, response } = await auth.api.signInEmail({
		body: { email, password, rememberMe: false },
		returnHeaders: true,
	});

	const cookie = sessionCookieFrom(headers);
	// La cookie emitida se reenvia como cabecera de request: es el mismo camino que usa el
	// handler HTTP para resolver la sesion.
	const session = await auth.api.getSession({ headers: new Headers({ cookie }) });

	if (!session) {
		throw new Error(`Better Auth no reconocio la sesion recien creada para ${email}.`);
	}

	return {
		ownerId: session.user.id,
		email,
		cookie,
		sessionTokens: [response.token],
	};
}

/**
 * Da credencial al dueno demo para poder iniciar sesion como el.
 *
 * `signUpEmail` no sirve: el email ya existe en `auth.users` (lo creo `00-demo-user.sql`). Se
 * inserta la fila `auth.account` con `provider_id = 'credential'` y el hash en el formato de
 * Better Auth, que es lo unico que `signInEmail` busca.
 */
export async function grantDemoCredential(pool: Pool, ownerId: string): Promise<string> {
	const email = await demoOwnerEmail(pool, ownerId);
	const accountId = randomUUID();
	const password = TEST_PASSWORD;
	const hashed = await hashPassword(password);

	await pool.query(
		`insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
		 values ($1, $2, 'credential', $3, $4, now(), now())`,
		[accountId, ownerId, ownerId, hashed],
	);

	return email;
}

/** Email real del dueno demo, leido de `auth.users` (el seed no se duplica en el test). */
export async function demoOwnerEmail(pool: Pool, ownerId: string): Promise<string> {
	const result = await pool.query<{ email: string }>(
		"select email from auth.users where id = $1",
		[ownerId],
	);

	const email = result.rows[0]?.email;

	if (!email) {
		throw new Error(`No existe auth.users con id ${ownerId}: falta el seed de la demo.`);
	}

	return email;
}

/** Dueno con mas pagos sembrados: el demo de `seed-demo.sql`, sin hardcodear su uuid ni email. */
export async function findSeededOwnerId(pool: Pool): Promise<string> {
	const result = await pool.query<{ owner_id: string }>(
		"select owner_id from public.payment group by owner_id order by count(*) desc limit 1",
	);

	const ownerId = result.rows[0]?.owner_id;

	if (!ownerId) {
		throw new Error("No hay pagos sembrados: los e2e necesitan la demo de seed-demo.sql.");
	}

	return ownerId;
}

/** Alta del segundo dueno por el camino real (`signUpEmail`), con su sesion. */
export async function signUpSecondOwner(auth: Auth): Promise<OwnerSession> {
	const email = `e2e-pagos-${randomUUID()}@example.test`;

	const { headers, response } = await auth.api.signUpEmail({
		body: { email, password: TEST_PASSWORD, name: "E2E segundo dueno" },
		returnHeaders: true,
	});

	return {
		ownerId: response.user.id,
		email,
		cookie: sessionCookieFrom(headers),
		sessionTokens: response.token ? [response.token] : [],
	};
}

/**
 * Siembra las filas de dominio del segundo dueno con SQL directo como `dev_user`.
 *
 * Es la misma ruta que usan los seeds: el owner de las tablas escribe con `owner_id` explicito.
 * Los pagos NO se insertan a mano: se crean despues por la RPC desde la sesion del dueno, que es
 * la ruta real de alta.
 */
export async function seedSecondOwnerDomain(pool: Pool, ownerId: string): Promise<{
	ids: AccountIds;
	openVoucherId: string;
	freeVoucherId: string;
}> {
	const ids: AccountIds = {
		entityId: randomUUID(),
		cashAccountId: randomUUID(),
		methodId: randomUUID(),
		categoryId: randomUUID(),
	};
	const openVoucherId = randomUUID();
	const freeVoucherId = randomUUID();
	const tag = ownerId.slice(0, 8);

	await pool.query(
		`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, owner_id)
		 values ($1, 'SIN_DOCUMENTO', '', $2, $3, true, $4)`,
		[ids.entityId, `E2E entidad ${tag}`, `e2e-${tag}@example.test`, ownerId],
	);

	await pool.query(
		`insert into public.cash_account (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
		 values ($1, 'CASH_BOX', $2, 'PEN', 0, ${APP_TODAY}, $3)`,
		[ids.cashAccountId, `E2E caja ${tag}`, ownerId],
	);

	await pool.query(
		`insert into public.payment_method (id, code, name, owner_id) values ($1, $2, $3, $4)`,
		[ids.methodId, `E2E_${tag}`.toUpperCase(), "E2E efectivo", ownerId],
	);

	await pool.query(
		`insert into public.cash_receipt_category (id, direction, name, code, owner_id)
		 values ($1, 'INGRESO', $2, $3, $4)`,
		[ids.categoryId, `E2E cobranza ${tag}`, `E2E_${tag}`.toUpperCase(), ownerId],
	);

	// Comprobante con saldo abierto (1000) y comprobante libre (300).
	await pool.query(
		`insert into public.comprobante
		   (id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, owner_id)
		 values ($1, $2, 'VENTA', 'FACTURA', $3, ${APP_TODAY}, 1000, 0, 1000, 'CONTADO', $4),
		        ($5, $2, 'VENTA', 'FACTURA', $6, ${APP_TODAY}, 300, 0, 300, 'CONTADO', $4)`,
		[
			openVoucherId,
			ids.entityId,
			`E2E-0001-${tag}`.toUpperCase(),
			ownerId,
			freeVoucherId,
			`E2E-0002-${tag}`.toUpperCase(),
		],
	);

	return { ids, openVoucherId, freeVoucherId };
}

/**
 * Comprobante propio de un test concreto, para que dos pruebas no se peleen por el mismo saldo.
 *
 * Los comprobantes compartidos del fixture ("abierto" y "libre") son de solo lectura: cada test
 * que asigna crea el suyo. Sin esto, el orden de ejecucion cambiaria el resultado de otra prueba.
 */
export async function insertVoucher(
	pool: Pool,
	input: { ownerId: string; entityId: string; total: number; voucherNumber: string },
): Promise<string> {
	const id = randomUUID();

	await pool.query(
		`insert into public.comprobante
		   (id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, owner_id)
		 values ($1, $2, 'VENTA', 'FACTURA', $3, ${APP_TODAY}, $4, 0, $4, 'CONTADO', $5)`,
		[id, input.entityId, input.voucherNumber, input.total, input.ownerId],
	);

	return id;
}

/** Inserta un pago del segundo dueno con SQL directo y, opcionalmente, una asignacion. */
export async function insertPayment(
	pool: Pool,
	input: {
		ownerId: string;
		ids: AccountIds;
		amount: number;
		paymentDate?: string;
		allocation?: { comprobanteId: string; amount: number };
	},
): Promise<string> {
	const result = await pool.query<{ id: string }>(
		`insert into public.payment
		   (owner_id, entity_id, direction, payment_date, amount, method_id, cash_account_id, category_id, reference, notes)
		 values ($1, $2, 'INGRESO', coalesce($3::date, ${APP_TODAY}), $4, $5, $6, $7, 'e2e', 'fixture e2e')
		 returning id`,
		[
			input.ownerId,
			input.ids.entityId,
			input.paymentDate ?? null,
			input.amount,
			input.ids.methodId,
			input.ids.cashAccountId,
			input.ids.categoryId,
		],
	);

	const paymentId = result.rows[0]?.id;

	if (!paymentId) {
		throw new Error("La insercion del pago de fixture no devolvio id.");
	}

	if (input.allocation) {
		await pool.query(
			`insert into public.payment_allocation (owner_id, payment_id, comprobante_id, amount)
			 values ($1, $2, $3, $4)`,
			[input.ownerId, paymentId, input.allocation.comprobanteId, input.allocation.amount],
		);
	}

	return paymentId;
}

/**
 * Borra todo lo que creo el test para un dueno, en orden de FK.
 *
 * `payment_allocation` -> `payment` es RESTRICT, asi que las asignaciones van primero; despues
 * los pagos y comprobantes (ambos referencian `entidad`), y al final `auth.users`, que arrastra
 * `auth.session` y `auth.account` por cascada.
 */
export async function deleteOwnerFixtures(pool: Pool, ownerId: string): Promise<void> {
	await pool.query("delete from public.payment_allocation where owner_id = $1", [ownerId]);
	await pool.query("delete from public.petty_cash_vale where owner_id = $1", [ownerId]);
	await pool.query("delete from public.payment where owner_id = $1", [ownerId]);
	await pool.query("delete from public.comprobante where owner_id = $1", [ownerId]);
	await pool.query("delete from public.entidad where owner_id = $1", [ownerId]);
	await pool.query("delete from public.cash_close where owner_id = $1", [ownerId]);
	await pool.query("delete from public.cash_account where owner_id = $1", [ownerId]);
	await pool.query("delete from public.payment_method where owner_id = $1", [ownerId]);
	await pool.query("delete from public.cash_receipt_category where owner_id = $1", [ownerId]);
	await pool.query("delete from auth.users where id = $1", [ownerId]);
}

/** Deshace la credencial del dueno demo (la cuenta y las sesiones que emitio el test). */
export async function revokeDemoCredential(
	pool: Pool,
	ownerId: string,
	sessionTokens: string[],
): Promise<void> {
	if (sessionTokens.length > 0) {
		await pool.query("delete from auth.session where token = any($1::text[])", [sessionTokens]);
	}

	await pool.query(
		"delete from auth.account where user_id = $1 and provider_id = 'credential'",
		[ownerId],
	);
}

/** Valor de una columna uuid de una fila cualquiera del dueno demo, para armar payloads. */
export async function pickDemoIds(pool: Pool, ownerId: string): Promise<AccountIds> {
	const cash = await pool.query<{ id: string }>(
		"select id from public.cash_account where owner_id = $1 order by name limit 1",
		[ownerId],
	);
	const method = await pool.query<{ id: string }>(
		"select id from public.payment_method where owner_id = $1 order by code limit 1",
		[ownerId],
	);
	const category = await pool.query<{ id: string }>(
		"select id from public.cash_receipt_category where owner_id = $1 and direction = 'INGRESO' order by code limit 1",
		[ownerId],
	);
	const entity = await pool.query<{ id: string }>(
		"select id from public.entidad where owner_id = $1 and is_client order by name limit 1",
		[ownerId],
	);

	const ids = {
		cashAccountId: cash.rows[0]?.id,
		methodId: method.rows[0]?.id,
		categoryId: category.rows[0]?.id,
		entityId: entity.rows[0]?.id,
	};

	if (!ids.cashAccountId || !ids.methodId || !ids.categoryId || !ids.entityId) {
		throw new Error("Faltan catalogos del dueno demo (cuenta, metodo, categoria o entidad).");
	}

	return ids as AccountIds;
}
