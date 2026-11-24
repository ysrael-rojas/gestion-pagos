// Usuario desechable por spec y sus fixtures, con borrado en orden de FK.
//
// Reglas:
//
// 1. El usuario se crea por SQL, que es el procedimiento de alta que documenta
//    `docs/operacion/crear-usuario.md`: `auth.users` + `auth.account` con la contrasena hasheada por
//    `hashPassword` de Better Auth. Desde L77 el API tiene `disableSignUp`, asi que
//    `POST /api/auth/sign-up/email` ya no existe como via de alta —ni para el suite—. La ENTRADA
//    sigue siendo la real: el formulario de `/login` manda al handler de Better Auth.
// 2. La contrasena se genera en runtime (`randomUUID`): no hay ninguna credencial en un archivo
//    del repo, y cada corrida usa una distinta.
// 3. Las fixtures de dominio (entidad, cuenta de caja, cuenta bancaria, caja chica, metodo,
//    categoria, comprobante) se insertan por SQL como dueno de las tablas, igual que los seeds,
//    SIEMPRE con `owner_id` explicito. No hay otra via: `apps/api` no expone escritura de cuentas
//    ni de comprobantes.
// 4. El teardown borra todo lo del dueno en orden de FK y termina en `auth.users`, que arrastra
//    `auth.session` y `auth.account` por cascada. El dueno demo (`seed-demo.sql`) no se toca
//    nunca: todas las clausulas son `owner_id = <uuid del usuario desechable>`.
import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

import { psqlLines, psqlValue, sqlText } from "./psql";

/**
 * "Hoy" para las fixtures, en la zona de la APP, no la del contenedor.
 *
 * Por que no `current_date`: Postgres del compose corre en UTC y la app calcula sus fechas con
 * `getTodayLocalDate()` sobre `America/Lima` (`playwright.config.ts` fija `timezoneId`). Entre
 * las 19:00 y las 24:00 de Lima, UTC ya es el dia siguiente, asi que una caja "abierta hoy" por la
 * base nacia con fecha futura y `crear_payment` la rechazaba con "La fecha del recibo (...) es
 * anterior al saldo inicial de la cuenta (...)": los specs que crean un pago fallaban por un
 * desfase de reloj, no por el producto.
 *
 * El sintoma aparecia solo en esa franja horaria, que es justo lo que un bug asi necesita para
 * pasar desapercibido en un CI que corre a cualquier hora.
 */
const APP_TIME_ZONE = "America/Lima";
/**
 * "Hoy" en la zona del negocio, como expresion SQL. Lo comparten las fixtures de este archivo y
 * las del vertical de ventas (`ventas-fixtures.ts`), que siembran comprobantes del mismo dia.
 */
export const APP_TODAY = `(now() at time zone '${APP_TIME_ZONE}')::date`;

/** Dueno desechable de un spec. `password` vive solo en memoria del test. */
export interface Owner {
	id: string;
	email: string;
	password: string;
	/** Prefijo corto para nombres visibles en la UI (caja, entidad, comprobante). */
	tag: string;
}

/**
 * Alta de un dueno desechable por SQL (L77: el API ya no acepta el alta publica).
 *
 * Inserta las dos filas que el alta escribia —`auth.users` y `auth.account` con `provider_id =
 * 'credential'`— y devuelve la contrasena para que el spec entre por el formulario, que es lo que
 * ejercita de verdad `BETTER_AUTH_TRUSTED_ORIGINS` y el handler HTTP del API.
 *
 * Ya no emite ninguna sesion, asi que el `delete from auth.session` que hacia el alta por endpoint
 * desaparece: el dueno nace "con cuenta, sin sesiones", que es lo que el spec de cerrar sesion
 * necesita comparar.
 */
export async function createOwner(): Promise<Owner> {
	const id = randomUUID();
	const email = `e2e-${randomUUID()}@example.test`;
	const password = randomUUID();
	const hashed = await hashPassword(password);

	psqlLines(
		`begin;
insert into auth.users (id, name, email, email_verified)
	values (${sqlText(id)}, 'E2E desechable', ${sqlText(email)}, true);
insert into auth.account (id, account_id, provider_id, user_id, password, created_at, updated_at)
	values (${sqlText(randomUUID())}, ${sqlText(id)}, 'credential', ${sqlText(id)}, ${sqlText(hashed)}, now(), now());
commit;\n`,
	);

	return { id, email, password, tag: id.slice(0, 8) };
}

/** Fixtures de dominio que un spec puede pedir. */
export interface ProvisionOptions {
	entity?: boolean;
	cashAccount?: boolean;
	/**
	 * Cuenta BANCARIA (`BANK_ACCOUNT`), la que exigen la transferencia y la conciliacion. Nace con
	 * `bank_name` porque el CHECK `cash_account_bank_requires_name` lo pide para ese tipo.
	 *
	 * `bankOpeningBalance` fija su saldo inicial: mientras no haya movimientos es exactamente lo
	 * que devuelve `GET /cash-accounts/:id/position` (S2), asi que el spec puede afirmar un saldo
	 * sin calcularlo.
	 */
	bankAccount?: boolean;
	/** Importe del saldo inicial de `bankAccount`. Default 0. */
	bankOpeningBalance?: number;
	/**
	 * Caja chica: caja de efectivo con `is_petty_cash`, fondo de cambio, limite por vale y custodio
	 * (SPEC 32). Es la unica cuenta que ofrece el panel de vales.
	 */
	pettyCashAccount?: boolean;
	/**
	 * Metodo de pago. `true` genera un codigo propio (`E2E_<tag>`); con un objeto se fija el codigo,
	 * que es lo que necesita el vale de caja chica: `create_petty_cash_vale` busca el metodo
	 * `EFECTIVO` del dueno y no lo crea.
	 */
	paymentMethod?: boolean | { code?: string };
	/**
	 * Categoria de recibo. `true` crea una de INGRESO; el vale de caja chica exige una de EGRESO
	 * (`create_petty_cash_vale` valida la direccion).
	 */
	receiptCategory?: boolean | { direction?: ReceiptDirection };
	voucher?: boolean;
	/** Importe del comprobante de venta. Default 1000. */
	voucherTotal?: number;
}

/** Direccion de una categoria de recibo: espejo local del enum `payment_direction` (no importa la app). */
export type ReceiptDirection = "INGRESO" | "EGRESO";

export interface OwnerFixtures {
	entity?: { id: string; name: string };
	cashAccount?: { id: string; name: string };
	bankAccount?: { id: string; name: string };
	pettyCashAccount?: { id: string; name: string };
	paymentMethod?: { id: string; name: string; code: string };
	receiptCategory?: { id: string; name: string };
	voucher?: { id: string; number: string; total: number };
}

/** Opciones del tipo `boolean | { ... }`: `true` es el default, el objeto trae los valores. */
function optionObject<T extends object>(value: boolean | T | undefined): T | null {
	return typeof value === "object" ? value : null;
}

/**
 * Crea las fixtures pedidas y devuelve sus ids y sus etiquetas visibles.
 *
 * El comprobante necesita una entidad, asi que pedirlo implica crearla: un comprobante sin
 * entidad no existe en este esquema (`entity_id` es NOT NULL).
 */
export function provisionFixtures(owner: Owner, options: ProvisionOptions): OwnerFixtures {
	const fixtures: OwnerFixtures = {};
	const statements: string[] = [];
	const ownerId = sqlText(owner.id);
	const tag = owner.tag;

	if (options.entity || options.voucher) {
		const id = randomUUID();
		const name = `E2E entidad ${tag}`;

		statements.push(
			`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, owner_id)
			 values ('${id}', 'SIN_DOCUMENTO', '', ${sqlText(name)}, ${sqlText(`e2e-${tag}@example.test`)}, true, ${ownerId});`,
		);
		fixtures.entity = { id, name };
	}

	if (options.cashAccount) {
		const id = randomUUID();
		const name = `E2E caja ${tag}`;

		statements.push(
			`insert into public.cash_account (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
			 values ('${id}', 'CASH_BOX', ${sqlText(name)}, 'PEN', 0, ${APP_TODAY}, ${ownerId});`,
		);
		fixtures.cashAccount = { id, name };
	}

	if (options.bankAccount) {
		const id = randomUUID();
		const name = `E2E banco ${tag}`;
		const bankName = `Banco E2E ${tag}`;
		const openingBalance = options.bankOpeningBalance ?? 0;

		statements.push(
			`insert into public.cash_account (id, type, name, currency, bank_name, account_number, opening_balance, opening_balance_date, owner_id)
			 values ('${id}', 'BANK_ACCOUNT', ${sqlText(name)}, 'PEN', ${sqlText(bankName)}, ${sqlText(`E2E-${tag}`)}, ${openingBalance}, ${APP_TODAY}, ${ownerId});`,
		);
		fixtures.bankAccount = { id, name };
	}

	if (options.pettyCashAccount) {
		const id = randomUUID();
		const name = `E2E caja chica ${tag}`;

		// Fondo de cambio 500 y limite 200 por vale: el spec crea un vale de 120 y lo anula.
		statements.push(
			`insert into public.cash_account (id, type, name, currency, opening_balance, opening_balance_date, is_petty_cash, change_fund, petty_expense_limit, custodian_name, owner_id)
			 values ('${id}', 'CASH_BOX', ${sqlText(name)}, 'PEN', 0, ${APP_TODAY}, true, 500, 200, ${sqlText(`Custodio E2E ${tag}`)}, ${ownerId});`,
		);
		fixtures.pettyCashAccount = { id, name };
	}

	if (options.paymentMethod) {
		const id = randomUUID();
		const name = `Metodo E2E ${tag}`;
		const code = optionObject(options.paymentMethod)?.code ?? `E2E_${tag.toUpperCase()}`;

		statements.push(
			`insert into public.payment_method (id, owner_id, code, name)
			 values ('${id}', ${ownerId}, ${sqlText(code)}, ${sqlText(name)});`,
		);
		fixtures.paymentMethod = { id, name, code };
	}

	if (options.receiptCategory) {
		const id = randomUUID();
		const name = `Categoria E2E ${tag}`;
		const direction = optionObject(options.receiptCategory)?.direction ?? "INGRESO";

		statements.push(
			`insert into public.cash_receipt_category (id, owner_id, direction, name, code)
			 values ('${id}', ${ownerId}, '${direction}', ${sqlText(name)}, ${sqlText(`E2E_CAT_${tag.toUpperCase()}`)});`,
		);
		fixtures.receiptCategory = { id, name };
	}

	if (options.voucher) {
		const id = randomUUID();
		const number = `E2E-${tag.toUpperCase()}-0001`;
		const total = options.voucherTotal ?? 1000;

		statements.push(
			`insert into public.comprobante (id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, owner_id)
			 values ('${id}', '${fixtures.entity?.id}', 'VENTA', 'FACTURA', ${sqlText(number)}, ${APP_TODAY}, ${total}, 0, ${total}, 'CONTADO', ${ownerId});`,
		);
		fixtures.voucher = { id, number, total };
	}

	if (statements.length > 0) {
		psqlLines(`begin;\n${statements.join("\n")}\ncommit;\n`);
	}


	return fixtures;
}

/**
 * Cuenta de caja de OTRO dueno, para probar que el dominio rechaza una cuenta ajena.
 *
 * No se usa la cuenta del dueno demo a proposito: el suite no depende del estado de los seeds.
 * Se crea un segundo dueno desechable y se borra con el resto de sus fixtures.
 */
export function provisionForeignCashAccount(owner: Owner): { id: string; name: string } {
	const id = randomUUID();
	const name = `E2E caja ajena ${owner.tag}`;

	psqlLines(
		`insert into public.cash_account (id, type, name, currency, opening_balance, opening_balance_date, owner_id)
		 values ('${id}', 'CASH_BOX', ${sqlText(name)}, 'PEN', 0, ${APP_TODAY}, ${sqlText(owner.id)});\n`,
	);

	return { id, name };
}

/** Sesiones vivas del dueno en `auth.session`. Sirve para probar que cerrar sesion revoca. */
export function countOwnerSessions(ownerId: string): number {
	return Number(psqlValue(`select count(*) from auth.session where user_id = ${sqlText(ownerId)};`));
}

/**
 * Borra todo lo del dueno, en orden de FK.
 *
 * Orden: las hijas de la conciliacion, de la caja chica y de los cierres -> `payment` (RESTRICT)
 * -> `comprobante` -> `entidad` -> las cuentas y catalogos -> `app_setting` -> `auth.users` (que
 * arrastra sesiones y cuentas).
 *
 * Cada linea va ANTES de las tablas que referencia y el comentario dice cual FK obliga la
 * posicion: sin eso, el primer spec que cree una de estas filas muere por violacion de FK en el
 * `after` y el diagnostico apunta al teardown, no a lo que se rompio (L5 del doc del vertical).
 */
export function deleteOwnerFixtures(ownerId: string): void {
	const id = sqlText(ownerId);

	psqlLines(
		[
			"begin;",
			// `bank_reconciliation_item` no tiene owner_id (lo hereda del padre): se borra por padre.
			// FK `reconciliation_id` -> bank_reconciliation (con ON DELETE CASCADE, pero se ordena
			// igual: si un dia pierde el cascade, esto sigue funcionando).
			`delete from public.bank_reconciliation_item where reconciliation_id in (select id from public.bank_reconciliation where owner_id = ${id});`,
			// FK `cash_account_id` -> cash_account SIN cascade: tiene que salir antes que la cuenta.
			`delete from public.bank_reconciliation where owner_id = ${id};`,
			// FK `payment_id` -> payment con ON DELETE RESTRICT: antes del recibo.
			`delete from public.payment_allocation where owner_id = ${id};`,
			// FK `payment_id` -> payment y `account_id` -> cash_account: antes de los dos. El `payment`
			// que genera el vale (SPEC 49) sale con la linea de `payment`, no queda huerfano.
			`delete from public.petty_cash_vale where owner_id = ${id};`,
			// FK `source_account_id` y `target_account_id` -> cash_account: referencia la cuenta DOS
			// veces, sin cascade, asi que va antes que ella.
			`delete from public.cash_transfer where owner_id = ${id};`,
			// FK `cash_count_id` -> cash_count (cascade): se borra por padre.
			`delete from public.cash_count_denomination where cash_count_id in (select id from public.cash_count where owner_id = ${id});`,
			// FK `cash_account_id` -> cash_account sin cascade y `owner_id` -> auth.users tambien sin
			// cascade: ninguno de los dos borrados la alcanza, hay que nombrarla.
			`delete from public.cash_count where owner_id = ${id};`,
			// FK `cash_close_id` -> cash_close (cascade): se borra por padre, como los arqueos.
			`delete from public.cash_close_denomination where cash_close_id in (select id from public.cash_close where owner_id = ${id});`,
			// FK `cash_account_id` -> cash_account.
			`delete from public.cash_close where owner_id = ${id};`,
			// FKs `cash_account_id`, `category_id` y `method_id`: antes de las tres tablas.
			`delete from public.payment where owner_id = ${id};`,
			`delete from public.comprobante where owner_id = ${id};`,
			`delete from public.entidad where owner_id = ${id};`,
			// FK `owner_id` -> auth.users (cascade): se borra antes que el usuario, y despues de todo
			// lo que la referencia (recibos, transferencias, cierres, arqueos, conciliaciones).
			`delete from public.cash_account where owner_id = ${id};`,
			`delete from public.payment_method where owner_id = ${id};`,
			`delete from public.cash_receipt_category where owner_id = ${id};`,
			// `app_setting` NO tiene FK a auth.users (migracion 20261006063301): borrar el usuario no
			// la toca, asi que hay que nombrarla o la fila queda huerfana para siempre (L8).
			`delete from public.app_setting where owner_id = ${id};`,
			// `voucher_series` (slice 2, S3) SI tiene FK a `auth.users` con cascade, asi que borrar
			// el usuario la alcanzaria. Se nombra igual, como el resto: el teardown borra cada tabla
			// por `owner_id` y el conteo del teardown global (`COUNTED_TABLES`) delata la que falte.
			`delete from public.voucher_series where owner_id = ${id};`,
			`delete from auth.users where id = ${id};`,
			"commit;",
			"",
		].join("\n"),
	);
}
