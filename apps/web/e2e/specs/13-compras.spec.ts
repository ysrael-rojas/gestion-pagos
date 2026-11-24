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
	compraById,
	countOwnerCompras,
	insertCompra,
	insertSupplier,
} from "../support/compras-fixtures";
import { allocationsOf } from "../support/ventas-fixtures";

// Spec 13: el vertical de compras de punta a punta, por la UI (T5 del slice 4; S7, S10 y S11 de
// `odd/tasks/port-vertical-compras.md`, y el caso de verificacion de S12).
//
// Lo que se afirma es lo observable: lo que el usuario ve (titulos, columnas, filas, badge, avisos,
// toast, saldo por pagar) y, cuando la accion escribe, la fila de `public.comprobante` — para que el
// caso pruebe que el efecto fue en la base y no solo en el navegador. El API ya tiene su propio e2e
// (`apps/api/test/purchases.e2e.test.ts` y `compras-rpc.e2e.test.ts`): aca no se re-testea el
// contrato HTTP, se prueba que las pantallas lo usan.
//
// LO QUE HACE DISTINTO A UNA COMPRA (S2), y por eso aparece en todos los casos:
//
//   1. El numero lo emitio el PROVEEDOR: se TIPEA en el formulario y viaja en el body. No hay serie
//      nuestra, no hay preview y una compra NO necesita series configuradas para darse de alta.
//   2. El numero se puede CORREGIR al editar mientras la compra no tenga pagos; el candado es el
//      trigger `protect_paid_comprobante`, que congela importe, numero, tipo, proveedor y fecha en
//      cuanto hay un pago. El tipo tampoco se bloquea por ser edicion, a diferencia de la venta.
//   3. Una compra es una cuenta POR PAGAR: `Registrar pago` lleva a `/pagos/egresos/nuevo` con la
//      entidad y el comprobante precargados, no a ingresos (S6).
//
// Los cuatro casos:
//
//   alta, listado y detalle   el formulario real con el numero del proveedor y los montos derivados
//                             al 18 %; la fila en el listado con el nombre del proveedor, sus
//                             acciones y la busqueda; el detalle con el saldo por pagar.
//   correccion del numero     edicion de una compra sin pagos: el numero (y el tipo) se pueden
//                             corregir, y la fila queda con el numero nuevo.
//   registrar pago            la accion de la fila y la del detalle llevan al alta de EGRESOS con las
//                             dos claves, y la compra aparece ahi como cuenta por pagar.
//   edicion bloqueada         un pago real por el egreso bloquea importe, numero, proveedor y fecha
//                             (S5 con el texto de compras); la condicion sigue editable.
//
// Cada test usa un dueno desechable (fixture `owner`) y el teardown borra sus filas en orden de FK
// (`deleteOwnerFixtures`), incluidas las compras (filas de `comprobante`), el proveedor y, en el
// ultimo caso, el pago con su asignacion; el teardown global compara el conteo de tablas contra el
// baseline, asi que una fila que se escape se ve.

const LISTADO = "/compras";
const NUEVA = `${LISTADO}/nuevo`;

/** S10, textual de `lib/compras/tabla.ts`. */
const EMPTY_MESSAGE = "No hay compras registradas";

/** S5, textual de `lib/ventas/formulario.ts` (`paidLockMessage("COMPRA")`). */
const PAID_LOCK_MESSAGE =
	"Este comprobante tiene pagos registrados: importe, número, proveedor y fecha quedan bloqueados. Anula los pagos si necesitas corregirlo.";

/** Las seis columnas de S10, en su orden, con `Proveedor` en lugar de `Cliente`. */
const COLUMNS = [
	"F. emisión",
	"T. comprobante",
	"Nro comprobante",
	"Proveedor",
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
function compraRow(page: Page, text: string) {
	return page.getByRole("row").filter({ hasText: text });
}

/** El par etiqueta/valor de la ficha o de la banda de montos. */
function valueOf(page: Page, label: string) {
	return page.getByText(label, { exact: true }).locator("xpath=..");
}

/**
 * Elige el PROVEEDOR en el autocomplete del formulario de comprobante.
 *
 * No reusa `chooseEntity` de `support/ui.ts`: ese helper busca el combo por
 * "Cliente/Proveedor (opcional)", que es la etiqueta del formulario de PAGOS. Aca la etiqueta la pone
 * `RequiredLabel htmlFor="entityId"` y sale de `voucherCopy`: "Cliente" en ventas, "Proveedor" en
 * compras (S7). El reintento es el mismo: los items aparecen cuando termino la lectura de
 * `/entities?role=supplier`.
 */
async function chooseProveedor(page: Page, name: string): Promise<void> {
	const combo = page.getByRole("combobox", { name: "Proveedor", exact: true });
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

/** Id de la compra que la pantalla esta mostrando: el ultimo segmento de `/compras/<uuid>`. */
function detalleId(page: Page): string {
	const id = new URL(page.url()).pathname.split("/").pop() ?? "";

	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
		throw new Error(`La URL no es la de un detalle de comprobante: ${page.url()}`);
	}

	return id;
}

// S11 (alta) + S10 (listado y detalle) + S7 (formulario compartido): el camino completo por la UI.
//
// El dueno arranca SIN compras: eso permite afirmar primero el vacio de S10 (`No hay compras
// registradas`, que es el texto propio de este vertical y no el de ventas) y despues que el alta
// escribio exactamente una fila.
//
// El proveedor de la fixture tiene RUC, asi que el formulario autoselecciona FACTURA y el tipo es
// editable (en compras el tipo nunca se deshabilita, S7). El numero se TIPEA: `F001-000123` es el
// del comprobante que emitio el proveedor, no un correlativo de una serie nuestra (S2).
//
// Con total 118 los montos son exactos: subtotal 100,00 e IGV 18,00, sin ruido de redondeo, y esos
// numeros son los que quedan escritos en la fila.
test("registra una compra con el numero del proveedor y la muestra en el listado y el detalle", async ({
	page,
	owner,
}) => {
	const supplier = insertSupplier(owner);
	const today = todayInLima();
	const numero = "F001-000123";

	await signInThroughForm(page, owner);

	// Navegacion real: la entrada "Compras" del navbar (S11), no un `goto`.
	await page.getByRole("link", { name: "Compras", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}$`));

	// Titulo, subtitulo, accion principal y busqueda (S10).
	await expect(page.getByRole("heading", { name: "Compras" })).toBeVisible();
	await expect(page.getByText("Registra y administra tus compras")).toBeVisible();
	await expect(page.getByRole("link", { name: "Registrar compra" })).toBeVisible();
	await expect(page.getByPlaceholder("Buscar compras...")).toBeVisible();
	// El vacio es el del vertical: `No hay compras registradas`, no el de ventas.
	await expect(page.getByRole("cell", { name: EMPTY_MESSAGE })).toBeVisible();

	// Navegacion real: el boton de la pantalla, no un `goto`.
	await page.getByRole("link", { name: "Registrar compra" }).click();
	await expect(page).toHaveURL(new RegExp(`${NUEVA}$`));
	await expect(page.getByRole("heading", { name: "Registrar compra" })).toBeVisible();
	await expect(
		page.getByText("Completa los datos para registrar una nueva compra"),
	).toBeVisible();

	// S9: la fecha de emision arranca con el "hoy" del negocio.
	await expect(page.locator("#issueDate")).toHaveValue(today.iso);
	// S2: el numero se TIPEA. Arranca vacio y habilitado, sin preview de serie.
	await expect(page.locator("#voucherNumber")).toBeEnabled();
	await expect(page.locator("#voucherNumber")).toHaveValue("");
	// S7/S11: una compra NO necesita series, asi que el alta no se bloquea sin ellas.
	await expect(page.getByText("Aún no tienes series de venta configuradas.")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Registrar", exact: true })).toBeEnabled();

	await chooseProveedor(page, supplier.name);

	// Con RUC el tipo es Factura, y en compras el selector NO queda deshabilitado (S7).
	await expect(page.locator("#voucherType")).toContainText("Factura");
	await expect(page.locator("#voucherType")).toBeEnabled();

	await page.locator("#voucherNumber").fill(numero);
	await chooseOption(page, "Condición", "Contado");
	await page.locator("#total").fill("118");

	// S2 del slice 1: los montos salen del total con el 18 % y redondeo a 2 decimales.
	//
	// El `toHaveValue` compara el `value` crudo del input, sin normalizar espacios (a diferencia de
	// `toContainText`): `Intl.NumberFormat` de `formatCurrency` separa el simbolo con un espacio
	// duro (U+00A0), asi que la asercion va con `\s` y no con un espacio comun.
	await expect(page.locator("#subtotal")).toHaveValue(/^S\/\s100\.00$/);
	await expect(page.locator("#igv")).toHaveValue(/^S\/\s18\.00$/);

	await page.getByRole("button", { name: "Registrar", exact: true }).click();

	await expect(notifications(page)).toContainText("Compra registrada");
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/[0-9a-f-]{36}$`));

	// Quedo ESCRITA: el numero que tipeo el usuario (no uno de serie), los montos derivados, el
	// estado que deriva la tabla y los dias de credito en NULL porque la condicion es Contado.
	const id = detalleId(page);
	const saved = compraById(owner, id);

	expect(saved).not.toBeNull();
	expect(saved?.voucherNumber).toBe(numero);
	expect(saved?.voucherType).toBe("FACTURA");
	expect(saved?.subtotal).toBe(100);
	expect(saved?.igv).toBe(18);
	expect(saved?.total).toBe(118);
	expect(saved?.paymentType).toBe("CONTADO");
	expect(saved?.creditDays).toBeNull();
	expect(saved?.dueDate).toBeNull();
	expect(saved?.status).toBe("PENDIENTE");
	expect(saved?.issueDate).toBe(today.iso);
	expect(saved?.deletedAt).toBeNull();
	expect(countOwnerCompras(owner)).toBe(1);

	// Detalle (S11): el comprobante que emitio el proveedor, con el saldo POR PAGAR de la base.
	await expect(page.getByRole("heading", { name: `Factura ${numero}` })).toBeVisible();
	await expect(page.getByText(`Proveedor: ${supplier.name}`)).toBeVisible();
	await expect(valueOf(page, "Total")).toContainText("S/ 118.00");
	await expect(valueOf(page, "Monto abonado")).toContainText("S/ 0.00");
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 118.00");
	await expect(valueOf(page, "Nro comprobante")).toContainText(numero);

	// S10: con saldo pendiente el detalle ofrece pagar, y el enlace es el de EGRESOS (S6).
	await expect(page.getByRole("link", { name: "Registrar pago" })).toHaveAttribute(
		"href",
		`/pagos/egresos/nuevo?entityId=${supplier.id}&comprobanteId=${id}`,
	);

	// Listado (S10): la fila con el proveedor, su total, su estado y sus tres acciones.
	await page.goto(LISTADO);

	const row = compraRow(page, numero);

	await expect(row).toBeVisible();
	await expect(row).toContainText("Factura");
	await expect(row).toContainText(supplier.name);
	await expect(row).toContainText("S/ 118.00");
	await expect(row).toContainText("Pendiente");
	await expect(row.getByRole("link", { name: "Registrar pago" })).toBeVisible();
	await expect(row.getByRole("button", { name: "Ver" })).toBeVisible();
	await expect(row.getByRole("button", { name: "Editar" })).toBeVisible();

	// Las seis columnas de S10 y el conteo (una fila de cuerpo ademas del encabezado).
	for (const column of COLUMNS) {
		await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
	}

	await expect(page.getByRole("row")).toHaveCount(2);
	await expect(page.getByText("Mostrando 1–1 de 1")).toBeVisible();

	// La busqueda global es la de TanStack y el vacio es el del vertical: lo que no coincide deja la
	// tabla sin filas y con el mensaje de S10.
	await page.getByPlaceholder("Buscar compras...").fill("no-existe-esta-compra");

	await expect(page.getByRole("cell", { name: EMPTY_MESSAGE })).toBeVisible();
	await expect(row).toHaveCount(0);

	await page.getByPlaceholder("Buscar compras...").fill(numero);
	await expect(row).toBeVisible();
});

// S2: el numero de una compra SE PUEDE CORREGIR mientras no tenga pagos.
//
// Es la diferencia deliberada con la venta, donde el numero lo asigno la base y es inmutable. Aca el
// numero es un dato transcripto del documento del proveedor: un error de tipeo se corrige. El tipo
// tambien, por la misma razon (L3g), y por eso el selector NO queda deshabilitado al editar (en
// ventas si).
//
// La compra se siembra por SQL con un numero "mal tipeado" y se corrige por la pantalla; lo que se
// afirma al final es la fila escrita, no solo el formulario.
test("corrige el numero de una compra sin pagos", async ({ page, owner }) => {
	const supplier = insertSupplier(owner);
	const compra = insertCompra({
		owner,
		entityId: supplier.id,
		voucherNumber: "F001-000124",
		total: 590,
	});
	const corregido = "F001-000142";

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	// Navegacion real: la accion "Editar" de la fila.
	await compraRow(page, compra.voucherNumber).getByRole("button", { name: "Editar" }).click();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/${compra.id}/editar$`));
	await expect(page.getByRole("heading", { name: "Editar compra" })).toBeVisible();

	// Con la compra sin pagos no hay aviso de bloqueo ni campos deshabilitados.
	await expect(page.getByText(PAID_LOCK_MESSAGE)).toHaveCount(0);

	const number = page.locator("#voucherNumber");

	await expect(number).toBeEnabled();
	await expect(number).toHaveValue(compra.voucherNumber);
	await expect(page.locator("#voucherType")).toBeEnabled();

	await number.fill(corregido);
	await page.getByRole("button", { name: "Guardar cambios" }).click();

	await expect(notifications(page)).toContainText("Compra actualizada");
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/${compra.id}$`));
	await expect(page.getByRole("heading", { name: `Factura ${corregido}` })).toBeVisible();

	// La fila quedo con el numero nuevo y nada mas cambio: el importe, el estado y el proveedor son
	// los de la compra que se edito.
	const saved = compraById(owner, compra.id);

	expect(saved).not.toBeNull();
	expect(saved?.voucherNumber).toBe(corregido);
	expect(saved?.total).toBe(590);
	expect(saved?.status).toBe("PENDIENTE");
	expect(saved?.voucherType).toBe("FACTURA");
	expect(countOwnerCompras(owner)).toBe(1);
});

// S10 + S6: `Registrar pago` de una compra lleva al alta de EGRESOS.
//
// Se prueba desde el LISTADO (la accion de la fila) y se verifica el formulario de destino: la
// entidad y el comprobante llegan precargados por la URL y la compra aparece como cuenta POR PAGAR
// con su saldo asignado. Si el enlace apuntara a ingresos, el comprobante no estaria en la lista
// (`validate_allocation` exige EGRESO para una COMPRA) y la asignacion quedaria vacia.
//
// El caso no registra nada: solo prueba el camino de entrada, que es lo que este slice agrega.
test("registrar pago lleva al alta de egresos con la compra precargada", async ({ page, owner }) => {
	const supplier = insertSupplier(owner);
	const compra = insertCompra({
		owner,
		entityId: supplier.id,
		voucherNumber: "F001-000200",
		total: 1000,
	});

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	const row = compraRow(page, compra.voucherNumber);

	await expect(row.getByRole("link", { name: "Registrar pago" })).toHaveAttribute(
		"href",
		`/pagos/egresos/nuevo?entityId=${supplier.id}&comprobanteId=${compra.id}`,
	);

	await row.getByRole("link", { name: "Registrar pago" }).click();

	await expect(page).toHaveURL(/\/pagos\/egresos\/nuevo\?/);
	await expect(page).toHaveURL(new RegExp(`entityId=${supplier.id}`));
	await expect(page).toHaveURL(new RegExp(`comprobanteId=${compra.id}`));
	await expect(page.getByRole("heading", { name: "Registrar egreso" })).toBeVisible();

	// La compra se ofrece como cuenta por pagar y el deep link la asigna por su saldo.
	await expect(
		page.getByRole("combobox", { name: "Cliente/Proveedor (opcional)" }),
	).toHaveValue(supplier.name);

	const allocation = page
		.locator("#payment-form div.divide-y > div")
		.filter({ hasText: compra.voucherNumber });

	await expect(allocation).toBeVisible();
	await expect(summaryValue(page, "Asignado")).toHaveText("S/ 1,000.00");

	// Nada se escribio: el caso solo navego.
	expect(countOwnerCompras(owner)).toBe(1);
	expect(allocationsOf(owner, compra.id)).toHaveLength(0);
});

// S5 + S2: un pago real bloquea la edicion de la compra.
//
// El pago se registra por el CAMINO REAL, entrando por el enlace `Registrar pago` del detalle: el
// formulario de egresos abre con el proveedor y la compra precargados y lo unico que se elige son
// metodo, cuenta y categoria. Asi el caso prueba tambien que una compra es pagable por egreso (S6)
// y que `voucher_balance` la cuenta como abonada.
//
// Con el pago registrado, el formulario de edicion muestra el aviso de S5 con el texto de COMPRAS
// (`proveedor`, no `cliente`) y bloquea importe, numero, proveedor y fecha. El juez final sigue
// siendo el trigger `comprobante_protect_paid`: la pantalla no lo reemplaza, lo anticipa.
//
// Lo que NO se bloquea: el TIPO y la CONDICION. El tipo porque en compras se corrige igual que el
// numero (L3g) y el trigger solo protege los otros campos; la condicion porque el trigger tampoco la
// toca.
test("con pagos registrados la compra queda bloqueada en la edicion", async ({ page, owner }) => {
	const supplier = insertSupplier(owner);
	const compra = insertCompra({
		owner,
		entityId: supplier.id,
		voucherNumber: "F001-000300",
		total: 1000,
	});
	const fixtures = provisionFixtures(owner, {
		cashAccount: true,
		receiptCategory: { direction: "EGRESO" },
	});
	const caja = fixtures.cashAccount!;
	const categoria = fixtures.receiptCategory!;

	await signInThroughForm(page, owner);
	await page.goto(`${LISTADO}/${compra.id}`);

	// El enlace del detalle lleva al alta de egresos con las dos claves.
	await page.getByRole("link", { name: "Registrar pago" }).click();
	await expect(page).toHaveURL(/\/pagos\/egresos\/nuevo\?/);

	await fillIncomePaymentForm(page, {
		methodName: "Efectivo",
		cashAccountName: caja.name,
		categoryName: categoria.name,
		amount: compra.total,
	});

	// El deep link dejo la compra asignada por su saldo: no hace falta marcarla a mano.
	await expect(summaryValue(page, "Asignado")).toHaveText("S/ 1,000.00");
	await expect(summaryValue(page, "Sin asignar")).toHaveText("S/ 0.00");

	await submitPayment(page, "/pagos/egresos", "Egresos");

	// El pago quedo escrito y asignado a la compra.
	const allocations = allocationsOf(owner, compra.id);

	expect(allocations).toHaveLength(1);
	expect(allocations[0]?.amount).toBe(1000);
	// El alta nace EN_REVISION (L65 del vertical de pagos): `voucher_balance` ya la cuenta como
	// abonada, que es lo que la pantalla de edicion lee para bloquear.
	expect(allocations[0]?.paymentStatus).toBe("EN_REVISION");

	// El detalle muestra el abono: el saldo lo calcula la base.
	await page.goto(`${LISTADO}/${compra.id}`);
	await expect(valueOf(page, "Monto abonado")).toContainText("S/ 1,000.00");
	await expect(valueOf(page, "Saldo por pagar")).toContainText("S/ 0.00");

	// Edicion: el aviso de S5 y los cuatro campos protegidos, deshabilitados.
	await page.goto(LISTADO);
	await compraRow(page, compra.voucherNumber).getByRole("button", { name: "Editar" }).click();
	await expect(page).toHaveURL(new RegExp(`${LISTADO}/${compra.id}/editar$`));
	await expect(page.getByRole("heading", { name: "Editar compra" })).toBeVisible();

	await expect(page.getByText(PAID_LOCK_MESSAGE)).toBeVisible();
	await expect(page.locator("#voucherNumber")).toBeDisabled();
	await expect(page.locator("#voucherNumber")).toHaveValue(compra.voucherNumber);
	await expect(page.locator("#total")).toBeDisabled();
	await expect(page.locator("#issueDate")).toBeDisabled();
	await expect(page.getByRole("combobox", { name: "Proveedor", exact: true })).toBeDisabled();
	// El tipo NO se bloquea: en compras es corregible, y los pagos no lo congelan (solo el trigger
	// protege importe, numero, proveedor y fecha).
	await expect(page.locator("#voucherType")).toBeEnabled();
	await expect(page.getByRole("combobox", { name: "Condición" })).toBeEnabled();

	// La fila no cambio: la pantalla bloqueada no mando ningun cambio.
	const unchanged = compraById(owner, compra.id);

	expect(unchanged).not.toBeNull();
	expect(unchanged?.voucherNumber).toBe(compra.voucherNumber);
	expect(unchanged?.total).toBe(1000);
	expect(unchanged?.deletedAt).toBeNull();
});
