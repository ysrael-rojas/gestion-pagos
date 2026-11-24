// Interacciones con la UI real: login, listado y formulario de pagos.
//
// Todos los helpers usan aserciones web-first (`expect(...).toBeVisible()`, `toPass()`) y nunca
// `waitForTimeout`: el suite no puede depender de que una peticion tarde menos que una espera
// fija. Cuando un control aparece despues de una carga asincronica (los catalogos se siembran en
// el primer render del formulario), el reintento es del framework y el predicado es el estado
// final, no el paso del tiempo.
import { expect, type Locator, type Page } from "@playwright/test";

import type { Owner } from "./owner";

/** Escapa un texto para usarlo dentro de una expresion regular. */
function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Inicia sesion por el formulario real de `/login` y espera a estar en el inicio.
 *
 * El formulario es una Server Action: el navegador hace un POST al mismo `/login`, el servidor de
 * Next habla con Better Auth y la cookie de sesion vuelve como `HttpOnly`. Probar por aca es
 * probar el camino completo (incluida la validacion de `BETTER_AUTH_TRUSTED_ORIGINS`), no solo el
 * API.
 */
export async function signInThroughForm(page: Page, owner: Owner): Promise<void> {
	await page.goto("/login");
	await expect(page.locator("#email")).toBeVisible();
	await page.locator("#email").fill(owner.email);
	await page.locator("#password").fill(owner.password);
	await page.getByRole("button", { name: "Iniciar sesión" }).click();

	await expect(page).toHaveURL("/");
	// La sesion que el shell resolvio en el servidor, dibujada: misma que usa el navbar.
	await expect(page.getByText(`sesión: ${owner.email}`)).toBeVisible();
}

/**
 * Abre un `Select` de Base UI y elige una opcion por su nombre.
 *
 * Los selects del formulario se llenan despues del primer render (catalogos por HTTP), asi que
 * abrir y elegir se reintenta entero: si el popup se abre vacio, el reintento lo vuelve a abrir en
 * vez de fallar. `aria-expanded` evita alternar abierto/cerrado entre intentos.
 */
export async function chooseOption(page: Page, field: string, option: string): Promise<void> {
	const trigger = page.getByRole("combobox", { name: field, exact: true });
	// Sin `exact`: hay etiquetas con sufijo. La cuenta de caja se muestra como
	// "<nombre> · PEN" y la opcion se elige por su nombre.
	const item = page.getByRole("option", { name: option });

	await expect(trigger).toBeEnabled();

	await expect(async () => {
		if ((await trigger.getAttribute("aria-expanded")) !== "true") {
			await trigger.click();
		}

		await expect(item).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });

	await item.click();
	await expect(trigger).toContainText(option);
}

/** Elige la entidad clienta/proveedor en el autocomplete, por nombre. */
export async function chooseEntity(page: Page, entityName: string): Promise<void> {
	const combo = page.getByRole("combobox", { name: "Cliente/Proveedor (opcional)" });
	const item = page.getByRole("option", { name: new RegExp(escapeRegExp(entityName)) });

	await expect(combo).toBeEnabled();

	await expect(async () => {
		if ((await combo.getAttribute("aria-expanded")) !== "true") {
			await combo.click();
		}

		await expect(item).toBeVisible({ timeout: 1_000 });
	}).toPass({ timeout: 20_000 });

	await item.click();
	await expect(combo).toHaveValue(entityName);
}

/** Valor de una fila del resumen del alta (`<dt>Asignado</dt><dd>S/ …</dd>`). */
export function summaryValue(page: Page, term: string): Locator {
	return page
		.locator("dl dt")
		.filter({ hasText: new RegExp(`^${escapeRegExp(term)}$`) })
		.locator("xpath=following-sibling::dd[1]");
}

/** Entrada del formulario de alta. */
export interface IncomePaymentInput {
	entityName?: string;
	methodName: string;
	cashAccountName: string;
	categoryName: string;
	amount: number;
	/** Comprobante a asignar y cuanto del importe. */
	allocation?: { voucherNumber: string; amount: number };
}

/** Fila de la asignación: la que contiene el numero del comprobante. */
export function allocationRow(page: Page, voucherNumber: string): Locator {
	return page
		.locator("#payment-form div.divide-y > div")
		.filter({ hasText: voucherNumber });
}

/**
 * Llena el formulario de alta sin enviarlo.
 *
 * Deja el estado observable a la vista (resumen y saldos) para que cada spec afirme lo que
 * necesita: el alta en si la hace `submitPayment`.
 */
export async function fillIncomePaymentForm(page: Page, input: IncomePaymentInput): Promise<void> {
	await expect(page.locator("#payment-form")).toBeVisible();

	if (input.entityName) {
		await chooseEntity(page, input.entityName);
	}

	await chooseOption(page, "Método", input.methodName);
	await chooseOption(page, "Caja/Banco", input.cashAccountName);
	await chooseOption(page, "Categoría", input.categoryName);

	// `exact`: el importe de cada asignacion tambien se llama "Importe a asignar a …".
	await page.getByRole("spinbutton", { name: "Importe", exact: true }).fill(String(input.amount));

	if (input.allocation) {
		const row = allocationRow(page, input.allocation.voucherNumber);

		await expect(row).toBeVisible();
		await row.getByRole("checkbox").check();

		const amountInput = page.getByRole("spinbutton", {
			name: `Importe a asignar a ${input.allocation.voucherNumber}`,
		});

		await expect(amountInput).toBeEnabled();
		await amountInput.fill(String(input.allocation.amount));
	}
}

/**
 * Envia el formulario y espera volver al listado (el alta redirige al listado de la direccion).
 *
 * `basePath` y `heading` distinguen INGRESO de EGRESO: el formulario es el mismo, pero el alta de un
 * cobro vuelve a `/pagos/ingresos` (titulo `Ingresos`) y la de un pago a proveedor a
 * `/pagos/egresos` (titulo `Egresos`). Los defaults conservan el caso de ingresos, que es el que ya
 * usaban los specs 04, 05 y 10.
 */
export async function submitPayment(
	page: Page,
	basePath = "/pagos/ingresos",
	heading = "Ingresos",
): Promise<void> {
	await page.getByRole("button", { name: "Registrar", exact: true }).click();

	await expect(page).toHaveURL(new RegExp(`${escapeRegExp(basePath)}$`));
	await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

/** Fila del listado que corresponde a una entidad (el nombre es unico por dueno desechable). */
export function paymentRow(page: Page, entityName: string): Locator {
	return page.getByRole("row").filter({ hasText: entityName });
}

/** Numero de recibo que muestra la fila (`RI-000123`). */
export async function receiptNumberOf(row: Locator): Promise<string> {
	return (await row.getByRole("cell").first().innerText()).trim();
}

/** Region de notificaciones (sonner): donde la UI muestra los mensajes del API tal cual. */
export function notifications(page: Page): Locator {
	return page.locator("[data-sonner-toaster]");
}
