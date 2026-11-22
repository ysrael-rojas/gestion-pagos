import { provisionFixtures } from "../support/owner";
import { expect, test } from "../support/test";
import {
	fillIncomePaymentForm,
	notifications,
	paymentRow,
	signInThroughForm,
	submitPayment,
} from "../support/ui";

// Spec 5: anulacion desde el listado.
//
// El pago se crea por el formulario (no por SQL): la anulacion necesita una fila real en la tabla,
// con su numero de recibo, y crearla por la ruta real es ademas la unica forma de que el especimen
// sea el que produce la UI. Despues: Anular -> modal -> motivo -> confirmar -> estado y accion.
test("anular un pago del listado cambia su estado y quita la accion de anular", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { cashAccount: true, voucher: true });
	const entity = fixtures.entity!;

	await signInThroughForm(page, owner);
	await expect(page.getByRole("link", { name: "Ingresos" })).toBeVisible();
	await page.goto("/pagos/ingresos");
	await page.getByRole("link", { name: "Registrar pago" }).click();

	await fillIncomePaymentForm(page, {
		entityName: entity.name,
		methodName: "Efectivo",
		cashAccountName: fixtures.cashAccount!.name,
		categoryName: "Cobranza de venta",
		amount: 1000,
		allocation: { voucherNumber: fixtures.voucher!.number, amount: 1000 },
	});
	await submitPayment(page);

	const row = paymentRow(page, entity.name);

	await expect(row).toContainText("En revisión");
	await expect(row).toContainText("Asignado");
	await expect(row.getByRole("button", { name: "Anular" })).toBeVisible();

	await row.getByRole("button", { name: "Anular" }).click();

	const dialog = page.getByRole("dialog");

	await expect(dialog).toContainText("Anular pago");
	await dialog.getByLabel("Motivo de anulación").fill("e2e: anulacion de prueba");
	await dialog.getByRole("button", { name: "Confirmar anulación" }).click();

	await expect(notifications(page)).toContainText("Pago anulado");
	await expect(dialog).toContainText("Anulado");

	await dialog.getByRole("button", { name: "Cerrar" }).click();
	await expect(dialog).toHaveCount(0);

	// En el listado: el estado cambio y la accion desaparecio.
	await expect(row).toContainText("Anulado");
	await expect(row.getByRole("button", { name: "Anular" })).toHaveCount(0);
	// Un pago anulado ya no ofrece reasignar su saldo.
	await expect(row.getByRole("button", { name: "Asignar" })).toHaveCount(0);
});
