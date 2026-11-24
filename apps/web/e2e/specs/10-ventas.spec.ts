import type { Page } from "@playwright/test";

import { provisionFixtures } from "../support/owner";
import { expect, test } from "../support/test";
import {
	chooseOption,
	fillIncomePaymentForm,
	notifications,
	signInThroughForm,
	submitPayment,
	summaryValue,
} from "../support/ui";
import {
	allocationsOf,
	comprobanteById,
	comprobanteByNumber,
	countOwnerComprobantes,
	insertVenta,
} from "../support/ventas-fixtures";

// Spec 10: el vertical de ventas de punta a punta, por la UI (S11 del doc del vertical, T5).
//
// Fuente: `odd/tasks/port-vertical-ventas.md`. Lo que se afirma es lo observable: lo que el usuario
// ve (titulos, columnas, filas, badge, avisos, toast) y, cuando la accion escribe, la fila de
// `public.comprobante` — para que el caso pruebe que el efecto fue en la base y no solo en el
// navegador. El API ya tiene su propio e2e (`apps/api/test/vouchers.e2e.test.ts`, 14 casos): aca no
// se re-testea el contrato HTTP, se prueba que las pantallas lo usan.
//
// Los cuatro casos de S11:
//
//   listado                  S10: columnas, fila con su total y su estado, `Registrar pago` solo
//                            en PENDIENTE, filtros Desde/Hasta/Estado pago y vacio.
//   alta                     el formulario real: montos derivados al 18 % (S2), fecha de emision
//                            del negocio (S9), dias de credito en NULL en CONTADO (S3) y persistencia.
//   detalle                  la banda de montos que calcula la base, la ficha con `dd/mm/yyyy` y el
//                            enlace `Registrar pago` con sus dos parametros.
//   edicion bloqueada        un pago real desde el vertical de pagos (entrando por ese mismo
//                            enlace) bloquea importe, numero, cliente y fecha (S5).
//
// Cada test usa un dueno desechable (fixture `owner`) y el teardown borra sus filas en orden de FK
// (`deleteOwnerFixtures`), incluidos el pago y su asignacion del cuarto caso; el teardown global
// compara el conteo de tablas contra el baseline, asi que una fila que se escape se ve.
//
// Los textos de S5 se afirman enteros: son el contrato visible del formulario y del detalle.

const LISTADO = "/ventas";

/** S10, textual de `lib/ventas/tabla.ts`. */
const EMPTY_MESSAGE = "No hay ventas registradas";

/** S5, textual de `lib/ventas/formulario.ts` (`paidLockMessage("VENTA")`). */
const PAID_LOCK_MESSAGE =
	"Este comprobante tiene pagos registrados: importe, número, cliente y fecha quedan bloqueados. Anula los pagos si necesitas corregirlo.";

/** S5: ayuda permanente del select de tipo mientras la entidad no tiene RUC. */
const FACTURA_RUC_HINT = "Para emitir factura, el cliente debe tener RUC.";

/** S5: lo que muestra el campo "Dirección" cuando la entidad no tiene una. */
const NO_ADDRESS = "Sin dirección registrada";

/** Las seis columnas de S10, en su orden. */
const COLUMNS = [
	"F. emisión",
	"T. comprobante",
	"Nro comprobante",
	"Cliente",
	"Total",
	"Estado pago",
];

/**
 * "Hoy" en la zona del NEGOCIO, que es la que usa la app (`getTodayLocalDate`) y las fixtures
 * (`(now() at time zone 'America/Lima')::date`). Se calcula aca y no con el reloj del proceso: el
 * runner puede estar en otra zona y el spec compararia contra un dia distinto (S9).
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

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Fila de la tabla que contiene ese texto (los numeros son unicos por dueno desechable). */
function ventaRow(page: Page, text: string) {
	return page.getByRole("row").filter({ hasText: text });
}

/** El `<dd>` que sigue a la etiqueta: el par etiqueta/valor de la ficha o de la banda de montos. */
function valueOf(page: Page, label: string) {
	return page.getByText(label, { exact: true }).locator("xpath=..");
}

/**
 * Elige la entidad en el autocomplete del formulario de comprobante.
 *
 * No reusa `chooseEntity` de `support/ui.ts`: ese helper busca el combo por
 * "Cliente/Proveedor (opcional)", que es la etiqueta del formulario de PAGOS. Aca la etiqueta la
 * pone `RequiredLabel htmlFor="entityId"` y sale de `voucherCopy`: "Cliente" en ventas, "Proveedor"
 * en compras (S1). El reintento es el mismo: los items aparecen cuando `ClientesProvider` termino
 * de leer `/entities`.
 */
async function chooseCliente(page: Page, name: string): Promise<void> {
	const combo = page.getByRole("combobox", { name: "Cliente", exact: true });
	const item = page.getByRole("option", { name: new RegExp(escapeRegExp(name)) });

	await expect(combo).toBeEnabled();

	await expect(async () => {
		if ((await combo.getAttribute("aria-expanded")) !== "true") {
			await combo.click();
		}

		await expect(item).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });

	await item.click();
	await expect(combo).toHaveValue(name);
}

// S10: el listado del dueno con sus columnas, la fila de una venta, las acciones y los filtros.
//
// Las dos filas las siembra la fixture: una venta PENDIENTE (`voucher: true`) y una ya pagada, que
// es la que prueba la mitad negativa de la regla de S10 (`Registrar pago` SOLO con `PENDIENTE`). El
// alta tiene su propio caso y aca lo que se prueba es la TABLA.
//
// El conteo de filas es la otra mitad de S10: dos filas de cuerpo y `Mostrando 1–2 de 2` prueban
// que el listado del API filtra por dueno — si RLS o el `owner_id` fallaran, aparecerian las
// ventas de la demo y el conteo dejaria de cerrar.
test("el listado muestra la venta con sus columnas, acciones y filtros", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, { voucher: true, voucherTotal: 1180 });
	const entity = fixtures.entity!;
	const voucher = fixtures.voucher!;
	// Segunda venta, ya pagada: es la otra mitad de la regla de S10 (`Registrar pago` SOLO con
	// `PENDIENTE`). Se siembra con la entidad de la fixture para no chocar con el indice unico de
	// documento de `entidad` (ver `insertVenta`).
	const pagada = insertVenta({
		owner,
		entityId: entity.id,
		voucherNumber: `B002-${owner.tag.toUpperCase()}`,
		total: 500,
		status: "PAGADO",
	});

	await signInThroughForm(page, owner);

	// Navegacion real: la entrada "Ventas" del navbar (T5), no un `goto`.
	await page.getByRole("link", { name: "Ventas", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}$`));

	// Titulo, subtitulo y accion principal (S10).
	await expect(page.getByRole("heading", { name: "Ventas" })).toBeVisible();
	await expect(page.getByText("Registra y administra tus ventas")).toBeVisible();
	await expect(page.getByRole("link", { name: "Registrar venta" })).toBeVisible();

	// Filtro global de S10 y las seis columnas, en su orden.
	await expect(page.getByPlaceholder("Buscar ventas...")).toBeVisible();

	for (const column of COLUMNS) {
		await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
	}

	const row = ventaRow(page, voucher.number);

	await expect(row).toBeVisible();
	await expect(row).toContainText("Factura");
	await expect(row).toContainText(entity.name);
	await expect(row).toContainText("S/ 1,180.00");
	await expect(row).toContainText("Pendiente");
	// S10: `Registrar pago` solo con `status === 'PENDIENTE'`; Ver y Editar siempre.
	await expect(row.getByRole("link", { name: "Registrar pago" })).toBeVisible();
	await expect(row.getByRole("button", { name: "Ver" })).toBeVisible();
	await expect(row.getByRole("button", { name: "Editar" })).toBeVisible();

	// La venta pagada: su badge y sus acciones, sin la accion de cobro.
	const paidRow = ventaRow(page, pagada.voucherNumber);

	await expect(paidRow).toBeVisible();
	await expect(paidRow).toContainText("Pagado");
	await expect(paidRow).toContainText("S/ 500.00");
	await expect(paidRow.getByRole("link", { name: "Registrar pago" })).toHaveCount(0);
	await expect(paidRow.getByRole("button", { name: "Ver" })).toBeVisible();
	await expect(paidRow.getByRole("button", { name: "Editar" })).toBeVisible();

	// Dos filas de cuerpo (las del dueno) ademas del encabezado.
	await expect(page.getByRole("row")).toHaveCount(3);
	await expect(page.getByText("Mostrando 1–2 de 2")).toBeVisible();

	// Filtro por estado (en cliente, S10): la venta sembrada esta PENDIENTE, asi que "Pagado" la
	// esconde y deja solo la pagada.
	await chooseOption(page, "Estado pago", "Pagado");

	await expect(row).toHaveCount(0);
	await expect(ventaRow(page, pagada.voucherNumber)).toBeVisible();
	await expect(page.getByText("Mostrando 1–1 de 1")).toBeVisible();

	// "Limpiar filtros" aparece solo con filtros activos y devuelve el listado completo.
	await page.getByRole("button", { name: "Limpiar filtros" }).click();
	await expect(ventaRow(page, voucher.number)).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}$`));

	// Filtros de fecha: los dos se leen de la URL y se aplican sobre `issue_date` (S10). La venta
	// es de hoy, asi que "hasta 2000" la excluye y "desde 2000" la incluye.
	await page.goto(`${LISTADO}?hasta=2000-01-01`);
	await expect(page.getByRole("cell", { name: EMPTY_MESSAGE })).toBeVisible();
	await expect(page.getByRole("button", { name: "Limpiar filtros" })).toBeVisible();

	await page.goto(`${LISTADO}?desde=2000-01-01&hasta=2999-12-31`);
	await expect(ventaRow(page, voucher.number)).toBeVisible();
});

// S11 (alta) + S2/S3/S9: el formulario real, de punta a punta.
//
// La entidad de la fixture no tiene RUC ni direccion: eso habilita las dos ramas de S5 que solo se
// ven en pantalla (la ayuda de FACTURA y el "Sin dirección registrada") y hace que el formulario
// autoseleccione BOLETA. Con total 118 los montos son exactos: subtotal 100,00 e IGV 18,00, sin
// ruido de redondeo, y esos numeros son los que quedan escritos en la fila.
test("registra una venta con los montos derivados y la abre en su detalle", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, { entity: true });
	const entity = fixtures.entity!;
	const number = "B001-1";
	const today = todayInLima();

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	// Navegacion real: el boton de la pantalla, no un `goto`.
	await page.getByRole("link", { name: "Registrar venta" }).click();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/nuevo$`));
	await expect(page.getByRole("heading", { name: "Registrar venta" })).toBeVisible();
	await expect(
		page.getByText("Completa los datos para registrar una nueva venta"),
	).toBeVisible();

	// S9: la fecha de emision arranca con el "hoy" del negocio, y las tres de solo lectura lo son.
	await expect(page.locator("#issueDate")).toHaveValue(today.iso);
	await expect(page.locator("#registrationDate")).toHaveValue(today.iso);
	await expect(page.locator("#registrationDate")).toBeDisabled();
	await expect(page.locator("#subtotal")).toBeDisabled();
	await expect(page.locator("#igv")).toBeDisabled();
	// S2/S5: la etiqueta del IGV es la del contrato.
	await expect(page.getByText("IGV 18 % (solo lectura)")).toBeVisible();
	// S5: sin entidad elegida (o sin RUC) la factura no es una opcion.
	await expect(page.getByText(FACTURA_RUC_HINT)).toBeVisible();

	await chooseCliente(page, entity.name);

	// Elegir la entidad fija el tipo: sin RUC el comprobante es BOLETA, nunca FACTURA.
	await expect(page.locator("#voucherType")).toContainText("Boleta");

	// S5: la entidad no tiene direccion registrada y el campo lo dice.
	await expect(page.locator("#entityAddress")).toHaveValue(NO_ADDRESS);

	await page.locator("#voucherNumber").fill(number);
	await chooseOption(page, "Condición", "Contado");

	// S2: los montos salen del total con el 18 % y redondeo a 2 decimales.
	//
	// El `toHaveValue` compara el `value` crudo del input, sin normalizar espacios (a diferencia de
	// `toContainText`): `Intl.NumberFormat` de `formatCurrency` separa el simbolo con un espacio
	// duro (U+00A0), asi que la asercion va con `\s` y no con un espacio comun.
	await page.locator("#total").fill("118");
	await expect(page.locator("#subtotal")).toHaveValue(/^S\/\s100\.00$/);
	await expect(page.locator("#igv")).toHaveValue(/^S\/\s18\.00$/);

	await page.getByRole("button", { name: "Registrar", exact: true }).click();

	await expect(notifications(page)).toContainText("Venta registrada");

	// El alta redirige al detalle del comprobante recien creado (mismo contrato que el API).
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/[0-9a-f-]{36}$`));
	await expect(page.getByRole("heading", { name: `Boleta ${number}` })).toBeVisible();

	// Y quedo ESCRITA: los montos que mostro el formulario, el estado que deriva la tabla y los
	// dias de credito en NULL porque la condicion es Contado (S3).
	const saved = comprobanteByNumber(owner, number);

	expect(saved).not.toBeNull();
	expect(saved?.voucherType).toBe("BOLETA");
	expect(saved?.subtotal).toBe(100);
	expect(saved?.igv).toBe(18);
	expect(saved?.total).toBe(118);
	expect(saved?.paymentType).toBe("CONTADO");
	expect(saved?.creditDays).toBeNull();
	expect(saved?.dueDate).toBeNull();
	expect(saved?.status).toBe("PENDIENTE");
	expect(saved?.issueDate).toBe(today.iso);
	expect(saved?.deletedAt).toBeNull();
	expect(countOwnerComprobantes(owner)).toBe(1);
});

// S11 (detalle): la pantalla de un comprobante sembrado.
//
// Los tres montos los calcula la base (`voucher_balance`), no el navegador: el comprobante no tiene
// pagos, asi que el saldo es el total y el abonado es 0,00. La ficha se afirma con el formato
// `dd/mm/yyyy` de `formatDate`, y el enlace `Registrar pago` con sus dos parametros, que es el
// contrato que consume `/pagos/ingresos/nuevo` (S10).
test("el detalle muestra los montos, la ficha y el enlace para registrar el pago", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { voucher: true, voucherTotal: 1000 });
	const entity = fixtures.entity!;
	const voucher = fixtures.voucher!;
	const today = todayInLima();

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	// Navegacion real: la accion "Ver" de la fila.
	await ventaRow(page, voucher.number).getByRole("button", { name: "Ver" }).click();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/${voucher.id}$`));

	await expect(page.getByRole("heading", { name: `Factura ${voucher.number}` })).toBeVisible();
	await expect(page.getByText(`Cliente: ${entity.name}`)).toBeVisible();

	// Banda de montos: total, abonado y saldo, como los devuelve la vista de saldos.
	await expect(valueOf(page, "Total")).toContainText("S/ 1,000.00");
	await expect(valueOf(page, "Monto abonado")).toContainText("S/ 0.00");
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 1,000.00");

	// Ficha del comprobante, con las fechas en `dd/mm/yyyy`.
	await expect(page.getByText("Datos del comprobante")).toBeVisible();
	await expect(valueOf(page, "Fecha de emisión")).toContainText(today.label);
	await expect(valueOf(page, "Fecha de registro")).toContainText(today.label);
	await expect(valueOf(page, "Tipo de comprobante")).toContainText("Factura");
	await expect(valueOf(page, "Nro comprobante")).toContainText(voucher.number);
	await expect(valueOf(page, "Condición")).toContainText("Contado");
	await expect(valueOf(page, "Estado")).toContainText("Pendiente");

	// S10: con saldo pendiente el detalle ofrece cobrar, y el enlace lleva la entidad y el
	// comprobante al alta de ingresos que ya existe en el vertical de pagos.
	await expect(page.getByRole("link", { name: "Registrar pago" })).toHaveAttribute(
		"href",
		`/pagos/ingresos/nuevo?entityId=${entity.id}&comprobanteId=${voucher.id}`,
	);
});

// S11 (edicion bloqueada por pagos) + S5: un pago real bloquea la edicion del comprobante.
//
// El pago se registra por el CAMINO REAL, entrando por el enlace `Registrar pago` del detalle: el
// formulario de ingresos abre con la entidad y el comprobante precargados (y el importe sugerido
// con el saldo), y lo unico que se elige son metodo, cuenta y categoria. Asi este caso tambien
// prueba el deep link de S10 contra el vertical de pagos, en vez de sembrar el pago por SQL.
//
// Con el pago registrado, el formulario de edicion tiene que mostrar el aviso de S5 y bloquear
// importe, numero, cliente y fecha. El juez final sigue siendo el trigger `comprobante_protect_paid`
// (S6): la pantalla no lo reemplaza, lo anticipa.
test("un comprobante con pagos queda bloqueado en la edicion", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, {
		cashAccount: true,
		voucher: true,
		voucherTotal: 1000,
	});
	const caja = fixtures.cashAccount!;
	const voucher = fixtures.voucher!;

	await signInThroughForm(page, owner);
	await page.goto(`${LISTADO}/${voucher.id}`);

	// El enlace del detalle lleva al alta de ingresos con las dos claves.
	await page.getByRole("link", { name: "Registrar pago" }).click();
	await expect(page).toHaveURL(/\/pagos\/ingresos\/nuevo\?/);
	await expect(page).toHaveURL(new RegExp(`comprobanteId=${voucher.id}`));

	await fillIncomePaymentForm(page, {
		methodName: "Efectivo",
		cashAccountName: caja.name,
		categoryName: "Cobranza de venta",
		amount: voucher.total,
	});

	// El deep link dejo el comprobante asignado por el saldo: no hace falta marcarlo a mano.
	await expect(summaryValue(page, "Asignado")).toHaveText("S/ 1,000.00");
	await expect(summaryValue(page, "Sin asignar")).toHaveText("S/ 0.00");

	await submitPayment(page);

	// El pago quedo escrito y asignado al comprobante.
	const allocations = allocationsOf(owner, voucher.id);

	expect(allocations).toHaveLength(1);
	expect(allocations[0]?.amount).toBe(1000);
	// El alta nace EN_REVISION (L65 del vertical de pagos): `voucher_balance` ya la cuenta como
	// abonada, que es lo que la pantalla de edicion lee para bloquear.
	expect(allocations[0]?.paymentStatus).toBe("EN_REVISION");

	// El listado ya muestra el abono: el saldo lo calcula la base.
	await page.goto(`${LISTADO}/${voucher.id}`);
	await expect(valueOf(page, "Monto abonado")).toContainText("S/ 1,000.00");
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 0.00");

	// Edicion: el aviso de S5 y los cuatro campos protegidos, deshabilitados.
	await page.goto(LISTADO);
	await ventaRow(page, voucher.number).getByRole("button", { name: "Editar" }).click();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/${voucher.id}/editar$`));
	await expect(page.getByRole("heading", { name: "Editar venta" })).toBeVisible();

	await expect(page.getByText(PAID_LOCK_MESSAGE)).toBeVisible();
	await expect(page.locator("#voucherNumber")).toBeDisabled();
	await expect(page.locator("#voucherNumber")).toHaveValue(voucher.number);
	await expect(page.locator("#total")).toBeDisabled();
	await expect(page.locator("#issueDate")).toBeDisabled();
	await expect(page.getByRole("combobox", { name: "Cliente", exact: true })).toBeDisabled();
	// La condicion y el tipo NO se bloquean: el trigger solo protege importe, numero, cliente y
	// fecha (L8 del doc de la feature), y la pantalla respeta ese alcance.
	await expect(page.getByRole("combobox", { name: "Condición" })).toBeEnabled();

	// La fila no cambio: la pantalla bloqueada no mando ningun cambio.
	const unchanged = comprobanteById(owner, voucher.id);

	expect(unchanged).not.toBeNull();
	expect(unchanged?.voucherNumber).toBe(voucher.number);
	expect(unchanged?.total).toBe(1000);
	expect(unchanged?.deletedAt).toBeNull();
});
