import type { Page } from "@playwright/test";

import {
	cashAccountByName,
	paymentById,
	receiptCategoryIsActive,
	reconciliationFor,
	transfersBetween,
	valeBySerial,
} from "../support/cajas-fixtures";
import { provisionFixtures } from "../support/owner";
import { expect, test } from "../support/test";
import { chooseOption, notifications, signInThroughForm } from "../support/ui";

// Spec 9: el vertical de cajas y bancos de punta a punta, por la UI (S9 del doc del vertical).
//
// Fuente: `odd/tasks/port-vertical-cajas-bancos.md` (T8 = C8). El vertical llego hasta aca con API
// y tests de API verdes, pero sus pantallas NUNCA se habian renderizado en un navegador (L14 para
// C5, L19 para C6 y C7). Lo que este spec prueba es exactamente eso: que cada pantalla pinta lo
// que la base devuelve y que su escritura PERSISTE. No re-testea el API (tiene mas de 100 casos):
// una afirmacion por pantalla, la del efecto que el usuario ve, y la fila de la base cuando la
// accion escribe.
//
// Las pantallas y lo que se afirma de cada una:
//
//   `/cajas-bancos`              dashboard (C7): sus tarjetas y el estado vacio de un dueno nuevo.
//   `configuracion` > Cuentas    listado de C5 + alta por el formulario real.
//   `/cajas-bancos/cuentas`      saldos por cuenta (S2: el numero lo calcula la base).
//   transferencia + extractos    `POST /cash-transfers` (C6) leido de vuelta en `/extractos`.
//   caja chica                   vale creado y anulado, con su recibo (C6, SPEC 49).
//   `/cajas-bancos/conciliacion` acta guardada y su version impresa (C7, SPEC 53).
//   `configuracion` > catalogos  metodos y categorias, y el interruptor de una categoria (C7).
//
// No hay cierre de periodo ni arqueo: esas dos escrituras ya estan cubiertas por
// `cash-closes.e2e` en el API y su pantalla (`cuadres`) es la unica del vertical que este spec no
// ejercita; el acta impresa se prueba por la conciliacion, que usa el mismo mecanismo.
//
// Cada test usa un dueno desechable (fixture `owner`) y el teardown lo borra en orden de FK
// (`deleteOwnerFixtures`), incluidas las tablas nuevas de caja; el teardown global compara el
// conteo de filas contra el baseline, asi que una tabla que se escape se ve como una diferencia.

const DASHBOARD = "/cajas-bancos";
const CONFIGURACION = "/cajas-bancos/configuracion";
const CUENTAS = "/cajas-bancos/cuentas";
const EXTRACTOS = "/cajas-bancos/extractos";
const CONCILIACION = "/cajas-bancos/conciliacion";

/** Fila de cualquier tabla del vertical que contenga ese texto (los nombres son unicos por dueno). */
function rowWith(page: Page, text: string) {
	return page.getByRole("row").filter({ hasText: text });
}

/** Una cuenta se elige por "<nombre> · PEN": es la etiqueta de los selects de cuenta del vertical. */
function accountOption(name: string): string {
	return `${name} · PEN`;
}

// C7: la raiz del vertical es el dashboard de tesoreria.
//
// El estado vacio es lo que prueba el aislamiento en la UI (S6) y, de paso, que las tres lecturas
// del dashboard respondieron: si `GET /cash-positions`, `/cash-flow/monthly` o `/cartera/resumen`
// fallaran (por ejemplo, un prefijo que falta en el puente `/api/backend`), la tabla quedaria en
// esqueleto o en error y no llegaria a "No hay cajas ni bancos activos".
test("la raiz del vertical dibuja el dashboard de un dueno nuevo", async ({ page, owner }) => {
	await signInThroughForm(page, owner);

	// Navegacion real: la entrada "Caja y bancos" del navbar.
	await page.getByRole("link", { name: "Caja y bancos", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${DASHBOARD}$`));
	await expect(page.getByRole("heading", { name: "Tesorería" })).toBeVisible();

	// Las tres tarjetas de saldos y el resultado del mes.
	await expect(page.getByText("Disponible total")).toBeVisible();
	await expect(page.getByText("En cajas", { exact: true })).toBeVisible();
	await expect(page.getByText("En bancos", { exact: true })).toBeVisible();
	// `exact` obligatorio: la bajada del encabezado («Disponible consolidado, resultado del mes y
	// cartera…») tambien contiene el texto, y sin exact el locator resuelve a dos elementos y
	// Playwright lo rechaza por strict mode aunque la tarjeta este a la vista.
	await expect(page.getByText("Resultado del mes", { exact: true })).toBeVisible();

	// Un dueno sin cuentas: cero cuentas activas y el desglose vacio, sin filas de la demo.
	await expect(page.getByText("0 cuentas activas")).toBeVisible();
	await expect(
		page.getByRole("cell", {
			name: "No hay cajas ni bancos activos. Regístralos en Configuración.",
		}),
	).toBeVisible();

	await expect(page.getByRole("heading", { name: "Accesos rápidos" })).toBeVisible();
	// `exact` aca no es cosmetica: el nombre accesible del link del navbar es "Cuadres de Caja" y el
	// de la tarjeta es "Cuadres de caja". `getByRole({ name })` ignora mayusculas por defecto, asi
	// que sin exact resuelve a los dos y Playwright lo rechaza. Con exact queda el acceso rapido,
	// que es justo lo que la asercion quiere probar.
	await expect(page.getByRole("link", { name: "Cuadres de caja", exact: true })).toBeVisible();
});

// C5: el listado de cuentas, el alta por el formulario real y la pantalla de saldos.
//
// El alta va por el formulario (no por SQL) porque es la pieza de C5 que nunca se habia probado:
// el select de tipo habilita y deshabilita los bloques de banco y caja chica, y el `POST
// /cash-accounts` vuelve a leer el catalogo. El saldo de la pantalla de cuentas es el que calcula
// la base (S2): el spec no lo suma, lo compara con el saldo inicial que el propio formulario
// escribio.
test("el listado de cuentas registra una cuenta bancaria y la muestra con su saldo", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { cashAccount: true });
	const caja = fixtures.cashAccount!;
	const bankName = `E2E cuenta ${owner.tag}`;
	const bankEntity = `Banco E2E ${owner.tag}`;

	await signInThroughForm(page, owner);
	await page.getByRole("link", { name: "Configuración de caja" }).click();
	await expect(page).toHaveURL(new RegExp(`${CONFIGURACION}$`));
	await expect(
		page.getByRole("heading", { name: "Configuración de caja y bancos" }),
	).toBeVisible();

	// La solapa por defecto es "Cuentas": el listado de C5.
	await expect(page.getByRole("heading", { name: "Cajas y Bancos" })).toBeVisible();

	const cajaRow = rowWith(page, caja.name);

	await expect(cajaRow).toBeVisible();
	await expect(cajaRow).toContainText("Caja");

	// Alta real: modal, tipo, nombre, datos bancarios y saldo inicial.
	await page.getByRole("button", { name: "Registrar cuenta" }).click();

	const dialog = page.getByRole("dialog");

	await expect(dialog.getByRole("heading", { name: "Registrar cuenta" })).toBeVisible();

	await chooseOption(page, "Tipo de cuenta", "Banco (cuenta)");
	await dialog.locator("#name").fill(bankName);
	await dialog.locator("#bankName").fill(bankEntity);
	await dialog.locator("#accountNumber").fill(`E2E-${owner.tag}`);
	await dialog.locator("#openingBalance").fill("250");
	await dialog.getByRole("button", { name: "Registrar", exact: true }).click();

	await expect(notifications(page)).toContainText("Cuenta registrada");
	await expect(page.getByRole("dialog")).toHaveCount(0);

	const newRow = rowWith(page, bankName);

	await expect(newRow).toBeVisible();
	await expect(newRow).toContainText("Banco");

	// La fila quedo en la base con el tipo y el saldo que describio el formulario.
	const saved = cashAccountByName(owner, bankName);

	expect(saved).not.toBeNull();
	expect(saved?.type).toBe("BANK_ACCOUNT");
	expect(saved?.currency).toBe("PEN");
	expect(saved?.openingBalance).toBe(250);
	expect(saved?.isActive).toBe(true);
	expect(saved?.isPettyCash).toBe(false);

	// Pantalla de saldos (C5): las dos cuentas y el saldo a hoy de la nueva, sin movimientos.
	await page.goto(CUENTAS);
	await expect(page.getByText("Cuentas registradas")).toBeVisible();

	const balanceRow = rowWith(page, bankName);

	await expect(balanceRow).toBeVisible();
	await expect(balanceRow).toContainText("S/ 250.00");
	await expect(rowWith(page, caja.name)).toContainText("Caja");
});

// C6: una transferencia entre dos cuentas, leida de vuelta en el extracto de la cuenta destino.
//
// La transferencia es `POST /cash-transfers` (la RPC `create_cash_transfer`): la pantalla no
// inserta nada. El extracto es una VISTA sobre dos lecturas (recibos + transferencias, L15), asi
// que verla ahi prueba las dos: que la transferencia persistio y que el extracto la interpreta
// como INGRESO de la cuenta destino, que es la decision de `buildStatementRows`.
test("una transferencia entre dos cuentas aparece en el extracto de la cuenta destino", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { cashAccount: true, bankAccount: true, bankOpeningBalance: 1000 });
	const caja = fixtures.cashAccount!;
	const banco = fixtures.bankAccount!;

	await signInThroughForm(page, owner);
	await page.goto(CUENTAS);

	await expect(rowWith(page, caja.name)).toBeVisible();

	await page.getByRole("button", { name: "Transferir" }).click();

	const dialog = page.getByRole("dialog");

	await expect(dialog.getByRole("heading", { name: "Transferir entre cuentas" })).toBeVisible();

	// Origen el banco (tiene saldo) y destino la caja.
	await chooseOption(page, "Cuenta de origen", accountOption(banco.name));
	await chooseOption(page, "Cuenta de destino", accountOption(caja.name));
	await dialog.locator("#amount").fill("300");
	await dialog.getByRole("button", { name: "Transferir", exact: true }).click();

	await expect(notifications(page)).toContainText("Transferencia registrada");
	await expect(page.getByRole("dialog")).toHaveCount(0);

	// La transferencia quedo escrita entre las dos cuentas del dueno.
	const transfers = transfersBetween(owner, banco.id, caja.id);

	expect(transfers).toHaveLength(1);
	expect(transfers[0]?.amount).toBe(300);

	// Y el extracto de la caja la muestra como un ingreso del dia.
	await page.getByRole("link", { name: "Extractos", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${EXTRACTOS}$`));
	await expect(page.getByRole("heading", { name: "Extractos" })).toBeVisible();

	await chooseOption(page, "Cuenta", accountOption(caja.name));

	const transferRow = rowWith(page, "Transferencia entre cuentas");

	await expect(transferRow).toBeVisible();
	await expect(transferRow).toContainText("Ingreso");
	await expect(transferRow).toContainText("S/ 300.00");
});

// C6 + SPEC 49: el vale de caja chica se crea, mueve el total pendiente y se anula.
//
// Las dos escrituras son RPC (`create_petty_cash_vale` / `void_petty_cash_vale`), y el vale crea
// ademas su recibo de egreso: por eso el spec afirma las DOS filas. La anulacion del vale anula
// tambien el recibo, con su motivo; si alguien dejara el recibo vivo, el saldo de la caja chica no
// volveria y el cierre no cuadraria (que es justo lo que SPEC 49 arreglo).
test("un vale de caja chica se registra, mueve el pendiente y se anula con su recibo", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, {
		pettyCashAccount: true,
		// El vale exige una categoria de EGRESO y el metodo `EFECTIVO` del dueno.
		receiptCategory: { direction: "EGRESO" },
		paymentMethod: { code: "EFECTIVO" },
	});
	const pettyCash = fixtures.pettyCashAccount!;
	const category = fixtures.receiptCategory!;
	const paidTo = `Proveedor E2E ${owner.tag}`;

	await signInThroughForm(page, owner);
	await page.goto(CUENTAS);

	const pettyRow = rowWith(page, pettyCash.name);

	await expect(pettyRow).toBeVisible();
	// Solo una caja chica ofrece el panel de vales.
	await pettyRow.getByRole("button", { name: "Vales" }).click();

	const panel = page.getByRole("dialog").filter({ hasText: `Caja chica · ${pettyCash.name}` });

	await expect(panel).toBeVisible();
	await expect(panel.getByText("Aún no hay vales registrados.")).toBeVisible();

	await panel.getByRole("button", { name: "Nuevo vale" }).click();

	const form = page.locator("#petty-cash-vale-form");

	await expect(form).toBeVisible();

	await chooseOption(page, "Categoría del gasto", category.name);
	await form.locator("#paidTo").fill(paidTo);
	await form.locator("#concept").fill("Pasajes y movilidad");
	await form.locator("#amount").fill("120");
	await page.getByRole("button", { name: "Registrar vale" }).click();

	await expect(notifications(page)).toContainText("Vale N.º 1 registrado");

	// El vale nace PENDIENTE y su importe entra en el total pendiente del panel.
	const valeRow = rowWith(page, paidTo);

	await expect(valeRow).toBeVisible();
	await expect(valeRow).toContainText("Pendiente");
	await expect(valeRow).toContainText("S/ 120.00");
	await expect(panel.getByText("1 vale(s) pendiente(s) por S/ 120.00.")).toBeVisible();

	const pending = valeBySerial(owner, pettyCash.id, 1);

	expect(pending).not.toBeNull();
	expect(pending?.status).toBe("PENDIENTE");
	expect(pending?.amount).toBe(120);

	// El vale genero su recibo de egreso (SPEC 49), en revision como cualquier alta.
	expect(pending?.paymentId).not.toBeNull();

	const generated = paymentById(owner, pending!.paymentId!);

	expect(generated).not.toBeNull();
	expect(generated?.status).toBe("EN_REVISION");
	expect(generated?.amount).toBe(120);

	// Anular (sin motivo en el vale: la RPC anula el vale y su recibo).
	await valeRow.getByRole("button", { name: "Anular" }).click();

	await expect(notifications(page)).toContainText("Vale N.º 1 anulado");
	await expect(valeRow).toContainText("Anulado");
	await expect(panel.getByText("No hay vales pendientes.")).toBeVisible();

	const voided = valeBySerial(owner, pettyCash.id, 1);

	expect(voided?.status).toBe("ANULADO");

	const voidedPayment = paymentById(owner, pending!.paymentId!);

	expect(voidedPayment?.status).toBe("ANULADO");
	// El motivo lo escribe la RPC `void_petty_cash_vale` (`packages/db`), no la pantalla: nombra el
	// vale con "N.º <serial>" y es el texto que va a leer quien revise el egreso, asi que se afirma
	// exacto. El `toContain("Vale de caja chica …")` anterior fallaba por la mayuscula del prefijo
	// del motivo ("Anulación de vale…"), no porque hubiera un segundo pago: la anulacion solo
	// cambia el estado del recibo que el vale ya tenia.
	expect(voidedPayment?.voidReason).toBe("Anulación de vale de caja chica N.º 1");
});

// C7 + SPEC 53: la conciliacion de una cuenta bancaria se guarda y su acta se imprime.
//
// El saldo "segun mis registros" lo calcula la base (`GET /cash-accounts/:id/position`): el spec no
// lo suma. Con extracto 900 y una partida en transito de 100 el saldo conciliado da 1000, que es el
// saldo inicial de la cuenta, asi que la pantalla tiene que decir "Conciliado" — si la partida no
// se guardara, o si el saldo de libros no fuera el de la base, la diferencia no daria cero.
//
// La impresion se prueba con el MEDIO de impresion emulado, que es lo que la pantalla declara: el
// acta se monta en un portal sobre el body y `app/globals.css` la deja en `display: none` en
// pantalla (igual que los portales de recibo y de cuadre), mostrandola solo bajo `@media print`.
// `window.print` se sustituye por un no-op porque el dialogo del sistema no existe en headless.
test("guarda la conciliacion de un banco y su acta impresa muestra el acta firmada", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { bankAccount: true, bankOpeningBalance: 1000 });
	const banco = fixtures.bankAccount!;
	const description = `Deposito en transito ${owner.tag}`;

	// `window.print()` abriria el dialogo del sistema y un `afterprint` desmonta el acta (`onClose`).
	// Las dos cosas se neutralizan desde `addInitScript`, que corre antes que cualquier codigo de la
	// app y en cada documento, para poder mirar el documento que la impresion produce.
	await page.addInitScript(() => {
		Object.defineProperty(window, "print", { value: () => {}, configurable: true });
		window.addEventListener("afterprint", (event) => event.stopImmediatePropagation(), {
			capture: true,
		});
	});

	await signInThroughForm(page, owner);
	await page.getByRole("link", { name: "Conciliación", exact: true }).click();
	await expect(page).toHaveURL(new RegExp(`${CONCILIACION}$`));
	await expect(page.getByRole("heading", { name: "Conciliación bancaria" })).toBeVisible();

	// La unica cuenta bancaria del dueno se elige sola y el formulario no se hidrata hasta que las
	// tres lecturas del periodo terminan. La senal de que ya llego el saldo segun registros (lo
	// calcula la base, S2) es el aviso de diferencia: mientras el saldo no llega, la diferencia da
	// cero y el aviso no existe. Escribir antes se perderia, porque la respuesta repinta el saldo del
	// extracto con el formulario vacio.
	await expect(page.locator("#reconciliation-statement")).toBeVisible();
	await expect(page.locator("#reconciliation-statement")).toHaveAccessibleName(
		"Saldo según extracto bancario",
	);
	await expect(page.getByText("Hay una diferencia por encontrar")).toBeVisible();

	// El saldo del extracto se copia a mano; la partida explica la diferencia.
	await page.locator("#reconciliation-statement").fill("900");
	await page.getByRole("button", { name: "Agregar partida" }).click();
	await page.getByLabel("Descripción de la partida 1").fill(description);
	await page.getByLabel("Monto de la partida 1").fill("100");
	await page.locator("#reconciliation-prepared-by").fill(`Contador E2E ${owner.tag}`);

	// 900 del extracto + 100 en transito = 1000, el saldo de libros: diferencia cero.
	await expect(page.getByText("Conciliado", { exact: true })).toBeVisible();

	await page.getByRole("button", { name: "Guardar conciliación" }).click();
	await expect(notifications(page)).toContainText("Conciliación guardada");

	// El acta quedo guardada con sus dos saldos y su partida.
	const saved = reconciliationFor(owner, banco.id);

	expect(saved).not.toBeNull();
	expect(saved?.statementBalance).toBe(900);
	expect(saved?.booksBalance).toBe(1000);
	expect(saved?.preparedBy).toBe(`Contador E2E ${owner.tag}`);
	expect(saved?.items).toEqual([
		{ kind: "DEPOSITO_EN_TRANSITO", description, amount: 100 },
	]);

	// El acta impresa: el mismo documento, pero solo en papel.
	//
	// El portal SI esta montado en la pantalla (el trace de la corrida anterior lo tiene en el DOM
	// en todas las instantaneas, incluida la del fallo: con `window.print` sustituido el `afterprint`
	// no llega y el acta no se desmonta). Lo que no se ve es el documento: `app/globals.css` lo deja
	// en `display: none` fuera de `@media print`, y un elemento no pintado no aporta rol, asi que
	// `getByRole("heading")` no resolvia nada. El contrato es que el acta ES la pagina impresa — la
	// misma regla oculta el resto de la app al imprimir —, por eso lo que se emula es el medio y no
	// la visibilidad. La emulacion va despues del click: en `@media print` el boton ya no se ve.
	await page.getByRole("button", { name: "Imprimir acta" }).click();

	await page.emulateMedia({ media: "print" });

	const acta = page.locator(".conciliacion-print-portal");

	await expect(acta.getByRole("heading", { name: "Acta de conciliación bancaria" })).toBeVisible();
	await expect(acta).toContainText(`${banco.name}`);
	await expect(acta).toContainText(description);
	await expect(acta).toContainText("900.00");
	await expect(acta).toContainText("1,000.00");

	// Y en papel no queda nada mas: el formulario de pantalla no se imprime.
	await expect(page.locator("#reconciliation-statement")).toBeHidden();
});

// C7: la pantalla de configuracion lista los catalagos y desactiva una categoria.
//
// Un catalogo no se borra, se desactiva: la categoria la referencian los recibos. El spec afirma el
// efecto en las dos direcciones, la fila (`Inactiva`) y la columna `is_active` de la base.
test("la configuracion lista los catalogos y desactiva una categoria", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, {
		receiptCategory: { direction: "EGRESO" },
		paymentMethod: true,
	});
	const category = fixtures.receiptCategory!;
	const method = fixtures.paymentMethod!;

	await signInThroughForm(page, owner);
	await page.getByRole("link", { name: "Configuración de caja" }).click();
	await expect(page).toHaveURL(new RegExp(`${CONFIGURACION}$`));

	// Catalogo 1: metodos de pago.
	await page.getByRole("button", { name: "Métodos de pago" }).click();
	// `exact` en el nombre: la celda de acciones tiene un boton "Renombrar <nombre>" y el match por
	// defecto es por subcadena, asi que sin `exact` el locator resuelve a dos celdas (la del nombre
	// y la de acciones) y falla por modo estricto.
	await expect(page.getByRole("cell", { name: method.code })).toBeVisible();
	await expect(page.getByRole("cell", { name: method.name, exact: true })).toBeVisible();

	// Catalogo 2: categorias de recibos, con su interruptor.
	await page.getByRole("button", { name: "Categorías" }).click();

	const categoryRow = rowWith(page, category.name);

	await expect(categoryRow).toBeVisible();
	await expect(categoryRow).toContainText("Activa");

	await categoryRow.getByRole("button", { name: "Desactivar" }).click();

	await expect(notifications(page)).toContainText(
		"Categoría desactivada: deja de ofrecerse en el formulario de pagos.",
	);
	await expect(categoryRow).toContainText("Inactiva");
	// Sigue listada para poder volver a activarla: el borrado no existe.
	await expect(categoryRow.getByRole("button", { name: "Activar" })).toBeVisible();

	expect(receiptCategoryIsActive(owner, category.id)).toBe(false);
});
