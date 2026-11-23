// Lectura de filas del vertical de cajas y bancos para el spec 09 (C8).
//
// Por que existe en vez de reusar `owner.ts`: las fixtures de ese archivo SIEMBRAN y no devuelven
// la fila, y este vertical necesita lo contrario — afirmar lo que la PANTALLA escribio, cuando ya
// paso el momento de sembrar:
//
//   `cash_account`             el alta por el formulario de cuentas (C5).
//   `cash_transfer`            la transferencia que despues se lee en el extracto (C6).
//   `petty_cash_vale`          el vale creado y anulado, y el `payment` que genera (SPEC 49).
//   `bank_reconciliation`      la cabecera y sus partidas (C7, SPEC 53).
//   `cash_receipt_category`    el interruptor de la pantalla de configuracion (C7).
//
// Es el mismo criterio (y el mismo transporte) que `clientes-fixtures.ts` para el spec 08. Nada de
// este archivo escribe: no hay una segunda via de siembra.
//
// Solo se piden columnas sin separador propio: con `psql -A` cada linea es una fila y los campos
// van unidos con `|`.
import type { Owner } from "./owner";
import { psqlLines, psqlValue, sqlText } from "./psql";

/** Fila de `public.cash_account` que el spec necesita afirmar. */
export interface CashAccountRow {
	id: string;
	type: string;
	currency: string;
	openingBalance: number;
	isActive: boolean;
	isPettyCash: boolean;
}

/** Fila de `public.cash_transfer`. */
export interface CashTransferRow {
	id: string;
	sourceAccountId: string;
	targetAccountId: string;
	amount: number;
	transferDate: string;
}

/** Fila de `public.petty_cash_vale`. */
export interface PettyCashValeRow {
	id: string;
	serial: number;
	status: string;
	amount: number;
	/** Recibo de egreso que la RPC creo con el vale (`null` si no lo genero). */
	paymentId: string | null;
}

/** Fila de `public.payment`. */
export interface PaymentRow {
	id: string;
	status: string;
	amount: number;
	voidReason: string | null;
}

/** Cabecera + partidas de `public.bank_reconciliation`. */
export interface ReconciliationRow {
	id: string;
	statementBalance: number;
	booksBalance: number;
	preparedBy: string | null;
	items: { kind: string; description: string; amount: number }[];
}

/**
 * Filas de una tabla del dueno, con las columnas pedidas unidas por `|`.
 *
 * `fields` son expresiones SQL ya armadas (se interpolan tal cual, y por eso solo se usan desde
 * este archivo con literales constantes).
 */
function rowsFor(owner: Owner, table: string, select: string, where: string): string[][] {
	const sql =
		`select ${select} from ${table} ` +
		`where owner_id = ${sqlText(owner.id)} and ${where} order by created_at;\n`;

	return psqlLines(sql).map((line) => line.split("|"));
}

/** La cuenta del dueno con ese nombre (el nombre es unico por dueno desechable). `null` si no existe. */
export function cashAccountByName(owner: Owner, name: string): CashAccountRow | null {
	const [fields] = rowsFor(
		owner,
		"public.cash_account",
		[
			"id",
			"type::text",
			"currency",
			"opening_balance::text",
			"is_active::text",
			"is_petty_cash::text",
		].join(" || '|' || "),
		`name = ${sqlText(name)}`,
	);

	if (!fields) {
		return null;
	}

	const [id, type, currency, openingBalance, isActive, isPettyCash] = fields as [
		string,
		string,
		string,
		string,
		string,
		string,
	];

	return {
		id,
		type,
		currency,
		openingBalance: Number(openingBalance),
		isActive: isActive === "true",
		isPettyCash: isPettyCash === "true",
	};
}

/** Transferencias del dueno entre esas dos cuentas (origen -> destino). */
export function transfersBetween(
	owner: Owner,
	sourceAccountId: string,
	targetAccountId: string,
): CashTransferRow[] {
	return rowsFor(
		owner,
		"public.cash_transfer",
		["id", "source_account_id", "target_account_id", "amount::text", "transfer_date::text"].join(
			" || '|' || ",
		),
		`source_account_id = ${sqlText(sourceAccountId)} and target_account_id = ${sqlText(targetAccountId)}`,
	).map((fields) => {
		const [id, source, target, amount, transferDate] = fields as [
			string,
			string,
			string,
			string,
			string,
		];

		return {
			id,
			sourceAccountId: source,
			targetAccountId: target,
			amount: Number(amount),
			transferDate,
		};
	});
}

/** El vale de la cuenta con ese correlativo (lo asigna la RPC bajo lock). `null` si no existe. */
export function valeBySerial(
	owner: Owner,
	accountId: string,
	serial: number,
): PettyCashValeRow | null {
	const [fields] = rowsFor(
		owner,
		"public.petty_cash_vale",
		["id", "serial::text", "status::text", "amount::text", "coalesce(payment_id::text, '')"].join(
			" || '|' || ",
		),
		`account_id = ${sqlText(accountId)} and serial = ${String(serial)}`,
	);

	if (!fields) {
		return null;
	}

	const [id, valeSerial, status, amount, paymentId] = fields as [
		string,
		string,
		string,
		string,
		string,
	];

	return {
		id,
		serial: Number(valeSerial),
		status,
		amount: Number(amount),
		paymentId: paymentId === "" ? null : paymentId,
	};
}

/** El recibo del dueno por id. `null` si no existe (o si es de otro dueno). */
export function paymentById(owner: Owner, id: string): PaymentRow | null {
	const [fields] = rowsFor(
		owner,
		"public.payment",
		["id", "status::text", "amount::text", "coalesce(void_reason, '')"].join(" || '|' || "),
		`id = ${sqlText(id)}`,
	);

	if (!fields) {
		return null;
	}

	const [paymentId, status, amount, voidReason] = fields as [string, string, string, string];

	return {
		id: paymentId,
		status,
		amount: Number(amount),
		voidReason: voidReason === "" ? null : voidReason,
	};
}

/**
 * El acta guardada de una cuenta, con sus partidas.
 *
 * Dos consultas a proposito: la cabecera no tiene `owner_id` en las partidas (`bank_reconciliation_item`
 * hereda el dueno del padre), asi que la segunda filtra por `reconciliation_id`.
 */
export function reconciliationFor(owner: Owner, accountId: string): ReconciliationRow | null {
	const [fields] = rowsFor(
		owner,
		"public.bank_reconciliation",
		["id", "statement_balance::text", "books_balance::text", "coalesce(prepared_by, '')"].join(
			" || '|' || ",
		),
		`cash_account_id = ${sqlText(accountId)}`,
	);

	if (!fields) {
		return null;
	}

	const [id, statementBalance, booksBalance, preparedBy] = fields as [
		string,
		string,
		string,
		string,
	];

	const items = psqlLines(
		`select kind::text || '|' || description || '|' || amount::text from public.bank_reconciliation_item where reconciliation_id = ${sqlText(id)} order by created_at;\n`,
	).map((line) => {
		const [kind, description, amount] = line.split("|") as [string, string, string];

		return { kind, description, amount: Number(amount) };
	});

	return {
		id,
		statementBalance: Number(statementBalance),
		booksBalance: Number(booksBalance),
		preparedBy: preparedBy === "" ? null : preparedBy,
		items,
	};
}

/**
 * `true` si la categoria del dueno esta activa.
 *
 * El interruptor de la pantalla de configuracion es un `PATCH /receipt-categories/:id` con
 * `isActive`: la fila no se borra, se marca (una categoria la referencian los recibos).
 */
export function receiptCategoryIsActive(owner: Owner, id: string): boolean {
	return (
		psqlValue(
			`select is_active from public.cash_receipt_category where owner_id = ${sqlText(owner.id)} and id = ${sqlText(id)};`,
		) === "t"
	);
}
