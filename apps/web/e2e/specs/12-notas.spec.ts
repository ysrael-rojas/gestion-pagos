import type { Page } from "@playwright/test";

import { provisionFixtures } from "../support/owner";
import { expect, test } from "../support/test";
import { chooseOption, notifications, signInThroughForm } from "../support/ui";
import { insertSeries, notesOf, seriesByCode } from "../support/ventas-fixtures";

// Spec 12: notas de credito y debito de punta a punta, por la UI (T5 del slice 3; S1, S2, S3, S5,
// S9, S10 y S11 de `odd/tasks/port-vertical-notas.md`; el caso de verificacion del slice es S12).
//
// Es el cierre del ciclo de emision: un comprobante ya no se corrige editandolo, se corrige con una
// nota. Lo que se afirma es lo OBSERVABLE — lo que el usuario ve (el titulo de la seccion, el vacio,
// las columnas, la fila con su motivo y su total, los dos totales, el saldo de la banda de montos, el
// toast y el mensaje de rechazo) y, cuando la accion escribe, la fila de `public.comprobante` y el
// `last_number` de la serie — para que el caso pruebe que el efecto fue en la base y no solo en el
// navegador. El API ya tiene su propio e2e (`apps/api/test/notes.e2e.test.ts` y
// `notas-rpc.e2e.test.ts`): aca no se re-testea el contrato HTTP, se prueba que la pantalla lo usa.
//
// LO QUE ESTE SPEC FIJA DEL CONTRATO NUEVO:
//
//   1. El NUMERO lo asigna la base desde la serie por defecto del TIPO de la nota (S3): la pantalla
//      lo muestra como preview de solo lectura y el numero que vale es el que quedo escrito.
//   2. La NC BAJA el saldo del comprobante y la ND lo SUBA (S2). El saldo lo calcula `voucher_balance`
//      (la pantalla no resta nada), y por eso cada caso lee la banda de montos despues del alta: es
//      la prueba de que el detalle se recargo.
//   3. El TOPE es una invariante de base (S5), con su mensaje verbatim. La pantalla muestra
//      `Tope disponible para este documento:` y el rechazo llega del API.
//   4. Sin serie por defecto del tipo de la nota no hay alta (S3): la pantalla lo dice antes de
//      mandar la peticion y deshabilita `Registrar`.
//
// Los cuatro casos:
//
//   credito      alta de una NC desde el detalle: preview del numero, montos con el 18 %, la fila en
//                 la tabla con su motivo y su total, el total de NC, el saldo para abajo y la fila
//                 escrita con el numero que asigno la serie (que avanzo).
//   debito       alta de una ND: el aviso de que aumenta el saldo, y el saldo para arriba.
//   tope         una NC de 800 sobre un comprobante de 1000 pasa; la de 300 se rechaza con el mensaje
//                 de S5, sin nota nueva y sin mover el correlativo.
//   sin serie    un dueno con serie de FACTURA pero sin serie de nota de credito ve el bloqueo de S3
//                 con su enlace, el boton deshabilitado y NINGUNA escritura.
//
// Cada test usa un dueno desechable (fixture `owner`) y el teardown borra sus filas en orden de FK
// (`deleteOwnerFixtures`), incluidas las notas (son filas de `comprobante`) y las series; el teardown
// global compara el conteo de tablas contra el baseline, asi que una fila que se escape se ve.

const LISTADO = "/ventas";

/** S11, textual de `lib/notas/textos.ts`. */
const SECTION_TITLE = "Notas de crédito/débito";
const EMPTY_MESSAGE = "Este comprobante no tiene notas de crédito ni de débito aplicadas.";
const SUBTITLE = "Completa los datos para registrar la nota.";
const CREDIT_TITLE = "Registrar una nota de crédito";
const DEBIT_TITLE = "Registrar una nota de débito";
const AVAILABLE_CREDIT_LABEL = "Tope disponible para este documento:";
const DEBIT_RAISES_BALANCE = "Una nota de débito aumenta el saldo del comprobante.";
const SAVED_TOAST = "Documento registrado";

/** S5, textual de la RPC `public.crear_nota` (y de `apps/api/src/notes/notes.errors.ts`). */
const CREDIT_CEILING_MESSAGE =
	"Las notas de crédito y retenciones no pueden superar el total del comprobante referenciado.";

/** S3, textual de la RPC `public.crear_nota`: sin serie por defecto del tipo de la nota. */
const NO_NOTE_SERIES_MESSAGE =
	"No hay una serie por defecto para este tipo de comprobante. Configura una en Configuración → Series.";

const SERIES_CONFIG_PATH = "/configuracion/series";

/** Las cinco columnas de la tabla de S11, en su orden. */
const COLUMNS = ["Tipo", "Número", "Emisión", "Motivo", "Total"];

/**
 * "Hoy" en la zona del NEGOCIO, que es la que usa la app (`getTodayLocalDate`) y las fixtures
 * (`(now() at time zone 'America/Lima')::date`). Igual que el spec 10: el runner puede estar en otra
 * zona y el spec compararia contra un dia distinto.
 */
function todayInLima(): { iso: string; label: string } {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone: "America/Lima",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).formatToParts(new Date());

	const valueOf = (type: "year" | "month" | "day"): string =>
		parts.find((part) => part.type === type)?.value ?? "";

	const year = valueOf("year");
	const month = valueOf("month");
	const day = valueOf("day");

	return { iso: `${year}-${month}-${day}`, label: `${day}/${month}/${year}` };
}

/** El `<dd>` que sigue a la etiqueta de la banda de montos (mismo helper que el spec 10). */
function valueOf(page: Page, label: string) {
	return page.getByText(label, { exact: true }).locator("xpath=..");
}

/** El modal de alta (rol `dialog`; el del detalle es el unico de la pagina). */
function notaDialog(page: Page) {
	return page.getByRole("dialog");
}

/** Fila de la tabla de notas que contiene ese numero (es unico por dueno desechable). */
function notaRow(page: Page, voucherNumber: string) {
	return page.getByRole("row").filter({ hasText: voucherNumber });
}

/**
 * Abre el alta de una nota desde la seccion del detalle y devuelve el locator del modal.
 *
 * El titulo del modal es el de S11 y es lo que espera la asercion: si el boton abriera el modal del
 * otro tipo, el caso fallaria aca y no en el numero.
 */
async function openNotaModal(page: Page, action: string, title: string) {
	await page.getByRole("button", { name: action }).click();

	const dialog = notaDialog(page);

	await expect(dialog.getByRole("heading", { name: title })).toBeVisible();
	await expect(dialog).toContainText(SUBTITLE);

	return dialog;
}

/**
 * Completa un alta ya abierta y espera el toast de S11.
 *
 * El total viaja como texto porque es lo que el usuario tipea en el input; el formulario lo coacciona
 * a numero, igual que el contrato compartido.
 */
async function submitNota(page: Page, dialog: ReturnType<typeof notaDialog>, input: {
	motive: string;
	total: string;
}) {
	await chooseOption(page, "Motivo", input.motive);
	await dialog.locator("#nota-total").fill(input.total);
	await dialog.getByRole("button", { name: "Registrar" }).click();

	await expect(notifications(page).getByText(SAVED_TOAST)).toBeVisible();
	await expect(notaDialog(page)).toHaveCount(0);
}

// S11 + S2 + S3: el alta de una nota de CREDITO desde el detalle del comprobante.
//
// El comprobante de la fixture es una FACTURA de 1180 al contado, sin pagos: la banda de montos
// muestra 1180 de total y 1180 de saldo. Con una NC de 118 los montos del formulario son exactos
// (subtotal 100,00 e IGV 18,00, sin ruido de redondeo) y el saldo queda en 1062,00, que es lo que
// calcula `voucher_balance` restando la nota.
test("registra una nota de crédito y el saldo del comprobante baja", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, { voucher: true, voucherTotal: 1180 });
	const voucher = fixtures.voucher!;
	const today = todayInLima();

	insertSeries({ owner, voucherType: "NOTA_CREDITO", code: "FC01", isDefault: true });

	await signInThroughForm(page, owner);
	await page.goto(`${LISTADO}/${voucher.id}`);

	// S11: la seccion existe en el detalle, con su titulo y su estado vacio.
	await expect(page.getByText(SECTION_TITLE, { exact: true })).toBeVisible();
	await expect(page.getByText(EMPTY_MESSAGE)).toBeVisible();
	// Sin notas todavia el saldo es el total del comprobante.
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 1,180.00");

	const dialog = await openNotaModal(page, "Agregar nota de crédito", CREDIT_TITLE);

	// S9: la fecha de emision arranca con el "hoy" del negocio.
	await expect(dialog.locator("#nota-issueDate")).toHaveValue(today.iso);

	// S3/S11: el numero es un preview de SOLO LECTURA de la serie por defecto del tipo de la nota.
	// `FC01` con `last_number = 0` -> `FC01-000001`; el real lo asigna la base y se afirma abajo.
	await expect(dialog.locator("#nota-voucherNumber")).toBeDisabled();
	await expect(dialog.locator("#nota-voucherNumber")).toHaveValue("FC01-000001");

	// S5: el tope disponible es el total del comprobante menos las NC ya aplicadas (ninguna).
	// `formatCurrency` separa el simbolo con un espacio duro, asi que la asercion va con `\s`.
	// Se afirma sobre el modal entero y no sobre un `<p>`: el `getByText` de la ficha tambien podria
	// resolver al contenedor, y lo que importa es el texto, no quien lo envuelve.
	await expect(dialog).toContainText(
		/Tope disponible para este documento:\s*S\/\s1,180\.00/,
	);

	// S4: los montos salen del total con el 18 %, igual que en el alta de comprobantes.
	await chooseOption(page, "Motivo", "Devolución por ítem");
	await dialog.locator("#nota-total").fill("118");
	await expect(dialog.locator("#nota-subtotal")).toHaveValue(/^S\/\s100\.00$/);
	await expect(dialog.locator("#nota-igv")).toHaveValue(/^S\/\s18\.00$/);
	await expect(dialog.getByText("Subtotal (solo lectura)")).toBeVisible();
	await expect(dialog.getByText("IGV 18 % (solo lectura)")).toBeVisible();

	await dialog.getByRole("button", { name: "Registrar" }).click();

	await expect(notifications(page).getByText(SAVED_TOAST)).toBeVisible();
	// El modal se cierra solo cuando el alta salio bien.
	await expect(notaDialog(page)).toHaveCount(0);

	// La fila escrita: el numero lo asigno la base desde la serie del TIPO de la nota (S3), y el
	// motivo es el del catalogo de S9 que eligio el usuario.
	const notas = notesOf(owner, voucher.id);

	expect(notas).toHaveLength(1);
	expect(notas[0]?.voucherType).toBe("NOTA_CREDITO");
	expect(notas[0]?.voucherNumber).toBe("FC01-000001");
	expect(notas[0]?.motiveCode).toBe("07");
	expect(notas[0]?.total).toBe(118);
	expect(notas[0]?.issueDate).toBe(today.iso);
	// La serie avanzo en la MISMA transaccion que la nota: sin eso, la proxima repetiria el numero.
	expect(seriesByCode(owner, "NOTA_CREDITO", "FC01")?.lastNumber).toBe(1);

	// S11: la nota aparece en la tabla del detalle con su tipo, su numero, su motivo y su total.
	for (const column of COLUMNS) {
		await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
	}

	const row = notaRow(page, "FC01-000001");

	await expect(row).toBeVisible();
	await expect(row).toContainText("Nota de crédito");
	await expect(row).toContainText(today.label);
	await expect(row).toContainText("Devolución por ítem");
	await expect(row).toContainText("S/ 118.00");
	// El vacio dejo de mostrarse: la seccion ya tiene filas.
	await expect(page.getByText(EMPTY_MESSAGE)).toHaveCount(0);

	// S11: los dos totales, cada uno con SU suma (la ND no se mezcla con la NC).
	await expect(page.getByText("Notas de crédito", { exact: true }).locator("xpath=..")).toContainText(
		"S/ 118.00",
	);
	await expect(page.getByText("Notas de débito", { exact: true }).locator("xpath=..")).toContainText(
		"S/ 0.00",
	);

	// S2: la NC DISMINUYE el saldo del comprobante, y la pantalla se recargo sola despues del alta.
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 1,062.00");
	// La banda sigue mostrando el total del comprobante: la nota no lo reescribe.
	await expect(valueOf(page, "Monto abonado")).toContainText("S/ 0.00");
});

// S2 + S9 + S11: el alta de una nota de DEBITO aumenta el saldo del comprobante.
//
// Es la mitad simetrica del caso anterior y la que el origen avisaba en el formulario: una ND suma.
// El comprobante de la fixture es de 1000 y la ND de 50, asi que el saldo queda en 1050,00. El motivo
// `01` es "Intereses por mora" en el catalogo de DEBITO (en el de credito el mismo codigo es otra
// cosa, S9).
test("registra una nota de débito y el saldo del comprobante sube", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, { voucher: true, voucherTotal: 1000 });
	const voucher = fixtures.voucher!;

	insertSeries({ owner, voucherType: "NOTA_DEBITO", code: "FD01", isDefault: true });

	await signInThroughForm(page, owner);
	await page.goto(`${LISTADO}/${voucher.id}`);

	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 1,000.00");

	const dialog = await openNotaModal(page, "Agregar nota de débito", DEBIT_TITLE);

	// S11: una ND no consume el tope; el formulario lo dice en vez de mostrar un disponible.
	await expect(dialog).toContainText(DEBIT_RAISES_BALANCE);
	await expect(dialog).not.toContainText(AVAILABLE_CREDIT_LABEL);
	// El preview es el de la serie de la NOTA DE DEBITO, no el de la de credito.
	await expect(dialog.locator("#nota-voucherNumber")).toHaveValue("FD01-000001");

	await submitNota(page, dialog, { motive: "Intereses por mora", total: "50" });

	const notas = notesOf(owner, voucher.id);

	expect(notas).toHaveLength(1);
	expect(notas[0]?.voucherType).toBe("NOTA_DEBITO");
	expect(notas[0]?.voucherNumber).toBe("FD01-000001");
	expect(notas[0]?.motiveCode).toBe("01");
	expect(notas[0]?.total).toBe(50);
	expect(seriesByCode(owner, "NOTA_DEBITO", "FD01")?.lastNumber).toBe(1);

	const row = notaRow(page, "FD01-000001");

	await expect(row).toContainText("Nota de débito");
	await expect(row).toContainText("Intereses por mora");
	await expect(row).toContainText("S/ 50.00");
	await expect(page.getByText("Notas de débito", { exact: true }).locator("xpath=..")).toContainText(
		"S/ 50.00",
	);
	await expect(page.getByText("Notas de crédito", { exact: true }).locator("xpath=..")).toContainText(
		"S/ 0.00",
	);

	// S2: la ND AUMENTA el saldo (1000 + 50).
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 1,050.00");
});

// S5: el tope es una invariante de base y el usuario ve su mensaje.
//
// El tope es "la suma de notas de credito no puede superar el total del comprobante referenciado":
// sobre 1000, una NC de 800 entra (quedan 200 de tope, y la pantalla lo muestra actualizado) y una de
// 300 se rechaza. El rechazo lo decide `public.crear_nota` con el comprobante bloqueado, asi que el
// texto es el de S5 verbatim. El caso afirma tambien que no se escribio nada: ni nota ni correlativo.
test("rechaza la nota de crédito que supera el total del comprobante referenciado", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { voucher: true, voucherTotal: 1000 });
	const voucher = fixtures.voucher!;

	insertSeries({ owner, voucherType: "NOTA_CREDITO", code: "FC01", isDefault: true });

	await signInThroughForm(page, owner);
	await page.goto(`${LISTADO}/${voucher.id}`);

	// Primera NC: 800 de 1000, dentro del tope.
	const first = await openNotaModal(page, "Agregar nota de crédito", CREDIT_TITLE);

	await submitNota(page, first, { motive: "Anulación de la operación", total: "800" });

	// El tope que queda se recalcula con las notas ya aplicadas: 1000 - 800 = 200.
	const second = await openNotaModal(page, "Agregar nota de crédito", CREDIT_TITLE);

	await expect(second).toContainText(
		/Tope disponible para este documento:\s*S\/\s200\.00/,
	);

	// Segunda NC: 300 sobre los 200 que quedan. El formulario la deja enviar (el tope es de la base,
	// no de la pantalla) y el API la rechaza con el mensaje de S5.
	await chooseOption(page, "Motivo", "Otros conceptos");
	await second.locator("#nota-total").fill("300");
	await second.getByRole("button", { name: "Registrar" }).click();

	await expect(notifications(page).getByText(CREDIT_CEILING_MESSAGE, { exact: true })).toBeVisible();
	// El modal sigue abierto con lo que el usuario escribio, para que corrija el importe.
	await expect(second).toBeVisible();
	await expect(second.locator("#nota-total")).toHaveValue("300");

	// Cerrar sin guardar: el modal abierto deja el resto de la pagina fuera del arbol de
	// accesibilidad (Base UI marca el contenido como modal), asi que la tabla de abajo se afirma
	// recien despues de cerrarlo.
	await second.getByRole("button", { name: "Cancelar" }).click();
	await expect(notaDialog(page)).toHaveCount(0);

	// No se escribio nada: una sola nota y el correlativo de la serie en 1.
	const notas = notesOf(owner, voucher.id);

	expect(notas).toHaveLength(1);
	expect(notas[0]?.voucherNumber).toBe("FC01-000001");
	expect(notas[0]?.total).toBe(800);
	expect(seriesByCode(owner, "NOTA_CREDITO", "FC01")?.lastNumber).toBe(1);

	// Y la pantalla sigue mostrando una sola nota con su total.
	await expect(notaRow(page, "FC01-000001")).toContainText("S/ 800.00");
	await expect(notaRow(page, "FC01-000002")).toHaveCount(0);
	// El saldo refleja solo la NC que si entro: 1000 - 800.
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 200.00");
});

// S3: sin serie por defecto del TIPO de la nota no hay numero posible.
//
// El dueno tiene una serie de FACTURA: el alta de ventas funcionaria, pero una nota de credito no
// tiene de donde numerar. La pantalla lo anticipa con el texto de S3 y el enlace a la pantalla de
// series (`/configuracion/series`), y deshabilita `Registrar` en vez de dejar que el usuario llene
// el formulario para recibir un 400 al final. El caso cuenta las escrituras para probar que no hubo
// ninguna peticion al API.
test("sin serie de nota de crédito el alta queda bloqueada y ofrece configurarla", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { voucher: true, voucherTotal: 1000 });
	const voucher = fixtures.voucher!;

	// Serie de FACTURA solamente: es lo que hace que el bloqueo sea POR TIPO y no por "no hay series".
	insertSeries({ owner, voucherType: "FACTURA", code: "F001", isDefault: true });

	const noteWrites: string[] = [];

	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().includes("/api/backend/notes")) {
			noteWrites.push(request.url());
		}
	});

	await signInThroughForm(page, owner);
	await page.goto(`${LISTADO}/${voucher.id}`);

	await expect(page.getByText(EMPTY_MESSAGE)).toBeVisible();

	const dialog = await openNotaModal(page, "Agregar nota de crédito", CREDIT_TITLE);

	// S3: el mensaje del contrato, con el enlace a la pantalla donde se arregla.
	await expect(dialog.getByText(NO_NOTE_SERIES_MESSAGE)).toBeVisible();
	await expect(dialog.getByRole("link", { name: "Configurar series" })).toHaveAttribute(
		"href",
		SERIES_CONFIG_PATH,
	);

	// Sin serie no hay preview ni alta posible.
	await expect(dialog.locator("#nota-voucherNumber")).toHaveValue("");
	await expect(dialog.getByRole("button", { name: "Registrar" })).toBeDisabled();

	// Sin serie de NOTA_DEBITO tampoco: el bloqueo no es del tipo que se miro.
	await dialog.getByRole("button", { name: "Cancelar" }).click();
	await expect(notaDialog(page)).toHaveCount(0);

	const debit = await openNotaModal(page, "Agregar nota de débito", DEBIT_TITLE);

	await expect(debit.getByText(NO_NOTE_SERIES_MESSAGE)).toBeVisible();
	await expect(debit.getByRole("button", { name: "Registrar" })).toBeDisabled();

	// Ninguna escritura salio del navegador: la pantalla bloqueo el alta antes del API.
	expect(noteWrites).toEqual([]);
	expect(notesOf(owner, voucher.id)).toEqual([]);
});
