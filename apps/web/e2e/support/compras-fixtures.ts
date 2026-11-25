// Fixtures del vertical de compras para el spec 13 (T5 del slice 4, S11 y S12 de
// `odd/tasks/port-vertical-compras.md`).
//
// Mismo criterio que `ventas-fixtures.ts`: `owner.ts` siembra el comprobante y lo borra, pero no
// devuelve la fila ni sabe de compras, y el spec necesita afirmar lo que quedo ESCRITO (el numero
// que tipeo el usuario, los montos que derivo el formulario, los dias de credito en NULL y el
// candado por pagos). Sin esto, el spec solo probaria lo que se ve en pantalla.
//
// POR QUE UN PROVEEDOR PROPIO Y NO `provisionFixtures({ entity: true })`: la entidad de
// `owner.ts` nace `is_client = true` y `is_supplier = false`, y el selector de proveedores del
// formulario lee `GET /entities?role=supplier`, que filtra por `is_supplier`. Un dueno de compras
// necesita una entidad con ese rol: es lo que `insertSupplier` siembra.
//
// POR QUE LAS COMPRAS SE SIEMBRAN POR SQL: el alta por la pantalla la prueba el primer caso del
// spec; los otros necesitan una compra PREVIA (con un numero cualquiera, con pagos o sin ellos) sin
// depender de que el alta este bien, y `apps/api` no tiene ruta de escritura de comprobantes fuera
// de las RPC.
//
// Todo es aditivo: no cambia ningun helper existente ni el baseline de conteos (`database.ts` hereda
// `public.comprobante` y `public.entidad`, que `deleteOwnerFixtures` ya borra en orden de FK).
import { randomUUID } from "node:crypto";

import { APP_TODAY, type Owner } from "./owner";
import { psqlLines, psqlValue, sqlText } from "./psql";
import { comprobanteById, type ComprobanteRow } from "./ventas-fixtures";

/** Una entidad con rol de PROVEEDOR, la que necesita el selector del formulario de compras. */
export interface SupplierFixture {
	id: string;
	name: string;
	/** RUC de la fixture. Unico por dueno (`entidad_document_unique_per_owner`). */
	documentNumber: string;
}

/**
 * Siembra un proveedor (`is_supplier = true`, `is_client = false`).
 *
 * El documento es un `RUC` sintetico derivado del tag del dueno: la base solo exige que no sea
 * vacio cuando el tipo no es `SIN_DOCUMENTO`, y el formulario de compras usa el tipo de documento
 * para autoseleccionar FACTURA (que es lo que afirma el caso del alta).
 */
export function insertSupplier(owner: Owner): SupplierFixture {
	const id = randomUUID();
	const name = `E2E proveedor ${owner.tag}`;
	const documentNumber = `20${String(parseInt(owner.tag, 16) % 1_000_000_000).padStart(9, "0")}`;

	psqlLines(
		`insert into public.entidad (id, document_type, document_number, name, billing_email, is_client, is_supplier, owner_id)
		 values ('${id}', 'RUC', ${sqlText(documentNumber)}, ${sqlText(name)}, ${sqlText(`e2e-${owner.tag}@example.test`)}, false, true, ${sqlText(owner.id)});\n`,
	);

	return { id, name, documentNumber };
}

/** Una compra sembrada por SQL, para los casos que no prueban el alta. */
export interface InsertCompraInput {
	owner: Owner;
	/** Tiene que ser un proveedor del mismo dueno (`comprobante_owner_consistency`). */
	entityId: string;
	/** El numero que emitio el proveedor: en una compra lo tipea el usuario (S2). */
	voucherNumber: string;
	total: number;
	status?: "PENDIENTE" | "PAGADO";
}

/**
 * Siembra una compra (`voucher_kind = 'COMPRA'`) con el estado que el caso necesite.
 *
 * `PAGADO` es un estado que en produccion deriva `refresh_comprobante_status` al asignar pagos; aca
 * se escribe directo porque el caso que lo pide solo prueba que la pantalla respeta el estado de la
 * fila (`Registrar pago` solo con `PENDIENTE`, S10).
 */
export function insertCompra(input: InsertCompraInput): ComprobanteRow {
	const id = randomUUID();
	const status = input.status ?? "PENDIENTE";

	if (status !== "PENDIENTE" && status !== "PAGADO") {
		throw new Error(`Estado de compra no soportado por la fixture: ${JSON.stringify(status)}`);
	}

	// Sin `credit_days`: la compra es de CONTADO y el CHECK `comprobante_credit_days` exige NULL.
	psqlLines(
		`insert into public.comprobante (id, entity_id, voucher_kind, voucher_type, voucher_number, issue_date, subtotal, igv, total, payment_type, status, owner_id)
		 values ('${id}', '${input.entityId}', 'COMPRA', 'FACTURA', ${sqlText(input.voucherNumber)}, ${APP_TODAY}, ${input.total}, 0, ${input.total}, 'CONTADO', '${status}', ${sqlText(input.owner.id)});\n`,
	);

	const saved = compraById(input.owner, id);

	if (!saved) {
		throw new Error(`La compra sembrada no quedo legible: ${JSON.stringify(input.voucherNumber)}`);
	}

	return saved;
}

/** Cuantas compras tiene el dueno: lo que prueba que un alta escribio UNA fila y no otra cosa. */
export function countOwnerCompras(owner: Owner): number {
	return Number(
		psqlValue(
			`select count(*) from public.comprobante where owner_id = ${sqlText(owner.id)} and voucher_kind = 'COMPRA';`,
		),
	);
}

/**
 * La fila de la compra del dueno, o `null` si ese id no es una COMPRA suya.
 *
 * Reusa la lectura de `ventas-fixtures.ts` (mismas columnas, mismo parseo) y agrega la unica
 * verificacion que le falta al vertical: el `voucher_kind`. Asi el spec no puede pasar leyendo una
 * venta con el mismo numero (S2: los dos numeros pueden coexistir).
 */
export function compraById(owner: Owner, id: string): ComprobanteRow | null {
	const row = comprobanteById(owner, id);

	if (!row) {
		return null;
	}

	const kind = psqlValue(
		`select voucher_kind::text from public.comprobante where id = '${id}' and owner_id = ${sqlText(owner.id)};`,
	);

	return kind === "COMPRA" ? row : null;
}
