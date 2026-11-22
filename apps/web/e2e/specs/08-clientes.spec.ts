import type { Page } from "@playwright/test";

import {
	comprobanteExists,
	countOwnerEntidades,
	entidadById,
	entidadesByDocument,
	randomRuc,
} from "../support/clientes-fixtures";
import { provisionFixtures } from "../support/owner";
import { expect, test } from "../support/test";
import { chooseOption, notifications, signInThroughForm } from "../support/ui";

// Spec 8: el vertical de clientes de punta a punta, por la UI.
//
// Fuente del vertical: `odd/tasks/port-vertical-clientes.md` (T5c). Lo que se afirma son efectos
// observables -- lo que el usuario ve (fila, modal, toast) y la fila de `public.entidad` cuando
// hace falta probar que el efecto fue en la base y no solo en el navegador (S7).
//
// Strings: todas las cadenas de S3 son textuales y se afirman enteras. El mensaje del conflicto
// lo produce `apps/api` (`entities.errors.ts`) y la UI lo muestra tal cual; el de `pagos` no puede
// aparecer nunca en una respuesta de clientes (S5), y el caso de duplicado lo verifica.
//
// Cada test usa un dueno desechable (fixture `owner`) que el teardown borra en orden de FK, con
// sus filas marcadas incluidas. El spec no crea pagos, asi que `receipt_sequence` no se mueve (el
// teardown global compara los conteos contra el baseline).

const LISTADO = "/clientes/listado";

/** Textual de `apps/api/src/entities/entities.errors.ts` (S3, `lib/clientes/entidades.ts:52`). */
const DUPLICATE_DOCUMENT_MESSAGE = "Ya existe un cliente con ese tipo y número de documento.";

/** Textual de `payments.errors.ts`: el defecto que S5 prohibe en este vertical. */
const PAYMENTS_ERROR_MESSAGE = "El comprobante ya está asignado a este pago.";

/** Textual de la confirmacion de baja (S3, `clientes/listado/page.tsx:138`). */
const DELETE_CONFIRMATION =
	"¿Seguro que quieres eliminar este cliente? Esta acción no se puede deshacer.";

type FormDocumentType = "RUC" | "DNI" | "SIN_DOCUMENTO";

const DOCUMENT_TYPE_LABELS: Record<FormDocumentType, string> = {
	RUC: "RUC",
	DNI: "DNI",
	SIN_DOCUMENTO: "Sin documento",
};

interface ClientFormInput {
	documentType: FormDocumentType;
	documentNumber?: string;
	name: string;
	billingEmail: string;
	isSupplier?: boolean;
}

/** Fila del listado que corresponde a un cliente (el nombre es unico por dueno desechable). */
function clientRow(page: Page, name: string) {
	return page.getByRole("row").filter({ hasText: name });
}

/** El modal de alta/edicion (rol `dialog`; la confirmacion de baja es `alertdialog`). */
function clientDialog(page: Page) {
	return page.getByRole("dialog");
}

/** Abre el modal de alta desde el boton de la pagina y devuelve su locator. */
async function openCreateModal(page: Page) {
	await page.getByRole("button", { name: "Registrar cliente" }).click();

	const dialog = clientDialog(page);

	await expect(dialog.getByRole("heading", { name: "Registrar cliente" })).toBeVisible();

	return dialog;
}

/**
 * Llena el formulario de cliente sin enviarlo.
 *
 * Los inputs se toman por `id` y no por etiqueta: la del numero de documento cambia con el tipo
 * ("Número de RUC", "Número de DNI", "Número de documento").
 */
async function fillClientForm(page: Page, input: ClientFormInput): Promise<void> {
	await expect(page.locator("#client-form")).toBeVisible();
	await chooseOption(page, "Tipo de documento", DOCUMENT_TYPE_LABELS[input.documentType]);

	if (input.documentNumber !== undefined) {
		await page.locator("#documentNumber").fill(input.documentNumber);
	}

	await page.locator("#name").fill(input.name);
	await page.locator("#billingEmail").fill(input.billingEmail);

	if (input.isSupplier) {
		await page.getByRole("checkbox", { name: "Es proveedor" }).check();
	}
}

/** Alta completa por la UI: formulario, guardar, toast y modal cerrado. */
async function createClientThroughForm(page: Page, input: ClientFormInput): Promise<void> {
	await openCreateModal(page);
	await fillClientForm(page, input);
	await page.getByRole("button", { name: "Registrar", exact: true }).click();

	await expect(notifications(page)).toContainText("Cliente registrado");
	await expect(clientDialog(page)).toHaveCount(0);
}

// El listado de un dueno nuevo: el estado vacio es lo que prueba el aislamiento en la UI (si RLS
// o el filtro por `owner_id` fallaran, se verian los clientes de la demo).
test("un dueno nuevo ve el listado de clientes vacio", async ({ page, owner }) => {
	await signInThroughForm(page, owner);

	// Navegacion real: la entrada "Maestro" del navbar, no un `goto`.
	await page.getByRole("link", { name: "Maestro" }).click();
	await expect(page).toHaveURL(/\/clientes\/listado$/);
	await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();

	await expect(page.getByRole("cell", { name: "No hay clientes registrados" })).toBeVisible();
	await expect(page.getByText(/Mostrando 0–0 de 0/)).toBeVisible();
	// Ninguna fila con documento: ni de la demo ni de otra corrida.
	await expect(
		page.getByRole("cell", { name: /^(RUC|DNI|Carné de extranjería): / }),
	).toHaveCount(0);
});

// S3: alta y sus strings ("Es proveedor", "Cliente registrado"). El documento y el correo se
// afirman en la fila y la fila de la base: el alta quedo escrita, no solo pintada.
test("registra un cliente con RUC y aparece en el listado", async ({ page, owner }) => {
	const ruc = randomRuc();
	const name = `E2E cliente ${owner.tag}`;
	const email = `e2e-cliente-${owner.tag}@example.test`;

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);
	await expect(page.getByRole("cell", { name: "No hay clientes registrados" })).toBeVisible();

	await createClientThroughForm(page, {
		documentType: "RUC",
		documentNumber: ruc,
		name,
		billingEmail: email,
		isSupplier: true,
	});

	const row = clientRow(page, name);

	await expect(row).toBeVisible();
	await expect(row).toContainText(`RUC: ${ruc}`);
	await expect(row).toContainText(email);

	// Una sola fila del dueno, y es la que el formulario describio (incluido "Es proveedor").
	expect(countOwnerEntidades(owner)).toBe(1);

	const saved = entidadesByDocument(owner, "RUC", ruc)[0] ?? null;

	expect(saved).not.toBeNull();
	expect(saved?.name).toBe(name);
	expect(saved?.documentNumber).toBe(ruc);
	expect(saved?.isSupplier).toBe(true);
	expect(saved?.deletedAt).toBeNull();
});

// S5: el conflicto de documento responde con el mensaje del vertical, no con el de pagos, y no
// suma filas. El `23505` lo produce la base (indice unico de documento) y lo traduce el API.
test("un documento duplicado muestra el mensaje del API y no crea una segunda fila", async ({
	page,
	owner,
}) => {
	const ruc = randomRuc();
	const firstName = `E2E cliente ${owner.tag}`;
	const secondName = `E2E duplicado ${owner.tag}`;

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	await createClientThroughForm(page, {
		documentType: "RUC",
		documentNumber: ruc,
		name: firstName,
		billingEmail: `e2e-cliente-${owner.tag}@example.test`,
	});
	await expect(clientRow(page, firstName)).toBeVisible();

	const dialog = await openCreateModal(page);

	await fillClientForm(page, {
		documentType: "RUC",
		documentNumber: ruc,
		name: secondName,
		billingEmail: `e2e-duplicado-${owner.tag}@example.test`,
	});
	await page.getByRole("button", { name: "Registrar", exact: true }).click();

	const toast = notifications(page);

	// El mensaje del API, entero y textual.
	await expect(toast.getByText(DUPLICATE_DOCUMENT_MESSAGE, { exact: true })).toBeVisible();
	// Y nunca el de pagos (S5).
	await expect(toast).not.toContainText(PAYMENTS_ERROR_MESSAGE);

	// El modal sigue abierto con lo que el usuario escribio: no hubo alta nueva.
	await expect(dialog).toBeVisible();
	await expect(dialog.locator("#name")).toHaveValue(secondName);

	await dialog.getByRole("button", { name: "Cancelar" }).click();
	await expect(clientDialog(page)).toHaveCount(0);

	await expect(clientRow(page, firstName)).toBeVisible();
	await expect(clientRow(page, secondName)).toHaveCount(0);
	expect(countOwnerEntidades(owner)).toBe(1);
	expect(entidadesByDocument(owner, "RUC", ruc)).toHaveLength(1);
});

// S3: edicion y su toast. Cambiar el tipo a "Sin documento" tiene que limpiar el numero en el
// formulario, y el update tiene que dejar de mostrar el RUC en la tabla.
test("editar el nombre y pasar el documento a Sin documento actualiza la fila", async ({
	page,
	owner,
}) => {
	const ruc = randomRuc();
	const name = `E2E cliente ${owner.tag}`;
	const renamed = `E2E renombrado ${owner.tag}`;

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	await createClientThroughForm(page, {
		documentType: "RUC",
		documentNumber: ruc,
		name,
		billingEmail: `e2e-cliente-${owner.tag}@example.test`,
	});

	const saved = entidadesByDocument(owner, "RUC", ruc)[0] ?? null;

	expect(saved).not.toBeNull();

	await clientRow(page, name).getByRole("button", { name: "Editar" }).click();

	const dialog = clientDialog(page);

	await expect(dialog.getByRole("heading", { name: "Editar cliente" })).toBeVisible();
	await expect(dialog.locator("#documentNumber")).toHaveValue(ruc);

	await dialog.locator("#name").fill(renamed);
	await chooseOption(page, "Tipo de documento", DOCUMENT_TYPE_LABELS.SIN_DOCUMENTO);

	// El tipo "Sin documento" limpia el numero: vacio y deshabilitado antes de guardar.
	await expect(dialog.locator("#documentNumber")).toHaveValue("");
	await expect(dialog.locator("#documentNumber")).toBeDisabled();

	await dialog.getByRole("button", { name: "Guardar cambios" }).click();

	await expect(notifications(page)).toContainText("Cliente actualizado");
	await expect(clientDialog(page)).toHaveCount(0);

	await expect(clientRow(page, renamed)).toBeVisible();
	await expect(clientRow(page, renamed)).toContainText("Sin documento");
	await expect(clientRow(page, name)).toHaveCount(0);
	await expect(page.getByRole("cell", { name: `RUC: ${ruc}` })).toHaveCount(0);

	// La modificacion escribio el nombre y normalizo el documento en la base.
	const updated = entidadById(owner, saved!.id);

	expect(updated).not.toBeNull();
	expect(updated?.name).toBe(renamed);
	expect(updated?.documentType).toBe("SIN_DOCUMENTO");
	expect(updated?.documentNumber).toBe("");
	expect(updated?.deletedAt).toBeNull();
});

// S4: la baja es logica y hereda el soft delete SIN guard. El cliente de la fixture tiene un
// comprobante que lo referencia: en el origen (y aca) igual se puede eliminar. La prueba de que
// no fue un filtro del navegador es doble: la fila queda con `deleted_at` y sigue fuera tras
// recargar.
test("eliminar un cliente con comprobantes lo marca como borrado y sigue fuera tras recargar", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { voucher: true });
	const entity = fixtures.entity!;
	const voucher = fixtures.voucher!;

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	const row = clientRow(page, entity.name);

	await expect(row).toBeVisible();
	await expect(row).toContainText("Sin documento");

	await row.getByRole("button", { name: "Eliminar" }).click();

	const dialog = page.getByRole("alertdialog");

	await expect(dialog.getByRole("heading", { name: "Eliminar cliente" })).toBeVisible();
	await expect(dialog).toContainText(DELETE_CONFIRMATION);

	await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();

	await expect(notifications(page)).toContainText("Cliente eliminado");
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	await expect(clientRow(page, entity.name)).toHaveCount(0);
	await expect(page.getByRole("cell", { name: "No hay clientes registrados" })).toBeVisible();

	// La fila no se borro: se marco. El comprobante que la referencia sigue vivo.
	const deleted = entidadById(owner, entity.id);

	expect(deleted).not.toBeNull();
	expect(deleted?.deletedAt).not.toBeNull();
	expect(comprobanteExists(owner, voucher.id)).toBe(true);

	// Y tras recargar no vuelve: el listado del API la excluye, no la tabla del navegador.
	await page.reload();
	await expect(page.getByRole("heading", { name: "Clientes" })).toBeVisible();
	await expect(page.getByRole("cell", { name: "No hay clientes registrados" })).toBeVisible();
	await expect(clientRow(page, entity.name)).toHaveCount(0);
});

// S7: una entrada rechazada no deja fila ni contador tocado. El formato del documento lo valida
// el mismo schema Zod que valida el API, asi que el formulario la bloquea antes de cualquier
// request: el spec afirma el error de campo, que no hubo POST y que la tabla quedo vacia.
test("un numero de documento invalido lo bloquea el formulario y no crea ninguna fila", async ({
	page,
	owner,
}) => {
	const name = `E2E invalido ${owner.tag}`;
	const entityWrites: string[] = [];

	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().includes("/api/backend/entities")) {
			entityWrites.push(request.url());
		}
	});

	await signInThroughForm(page, owner);
	await page.goto(LISTADO);

	const dialog = await openCreateModal(page);

	await fillClientForm(page, {
		documentType: "RUC",
		// Un RUC de 3 digitos: formato invalido para `clientSchema` (11 digitos).
		documentNumber: "123",
		name,
		billingEmail: `e2e-invalido-${owner.tag}@example.test`,
	});
	await page.getByRole("button", { name: "Registrar", exact: true }).click();

	await expect(dialog.getByRole("alert")).toHaveText("Número de documento inválido");
	await expect(dialog.locator("#documentNumber")).toHaveAttribute("aria-invalid", "true");
	// Ningun viaje al API: la validacion es la del formulario.
	expect(entityWrites).toEqual([]);

	// Nada se creo: el modal sigue abierto, el listado vacio y la tabla sin filas del dueno.
	await expect(dialog).toBeVisible();
	await dialog.getByRole("button", { name: "Cancelar" }).click();
	await expect(clientDialog(page)).toHaveCount(0);

	await expect(page.getByRole("cell", { name: "No hay clientes registrados" })).toBeVisible();
	await expect(clientRow(page, name)).toHaveCount(0);
	expect(countOwnerEntidades(owner)).toBe(0);
	expect(entidadesByDocument(owner, "RUC", "123")).toHaveLength(0);
});
