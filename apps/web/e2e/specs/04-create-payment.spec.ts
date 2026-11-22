import { provisionFixtures } from "../support/owner";
import { expect, test } from "../support/test";
import {
	fillIncomePaymentForm,
	paymentRow,
	receiptNumberOf,
	signInThroughForm,
	submitPayment,
	summaryValue,
} from "../support/ui";

// Spec 4: el alta completa por el formulario real, con una asignacion.
//
// El dueno se crea SIN metodos de pago ni categorias: eso prueba la self-provision de catalogos
// (`POST /catalogs/ensure`, L65). Si alguien la rompiera, los selects quedarian vacios y el alta
// seria imposible — el spec falla en el primer `chooseOption`.
test("registra un ingreso con una asignacion y el pago aparece en el listado", async ({
	page,
	owner,
}) => {
	// Unico comprobante del dueno: 1000 de saldo abierto, para asignarle 600.
	const fixtures = provisionFixtures(owner, { cashAccount: true, voucher: true, voucherTotal: 1000 });
	const entity = fixtures.entity!;
	const voucher = fixtures.voucher!;

	await signInThroughForm(page, owner);
	await expect(page.getByRole("link", { name: "Ingresos" })).toBeVisible();
	await page.goto("/pagos/ingresos");
	await expect(page.getByRole("cell", { name: "No hay ingresos registrados" })).toBeVisible();

	// Navegacion real al formulario: el boton del listado, no un `goto`.
	await page.getByRole("link", { name: "Registrar pago" }).click();
	await expect(page).toHaveURL(/\/pagos\/ingresos\/nuevo$/);
	await expect(page.getByRole("heading", { name: "Registrar ingreso" })).toBeVisible();

	await fillIncomePaymentForm(page, {
		entityName: entity.name,
		methodName: "Efectivo",
		cashAccountName: fixtures.cashAccount!.name,
		categoryName: "Cobranza de venta",
		amount: 1000,
		allocation: { voucherNumber: voucher.number, amount: 600 },
	});

	// Resumen en vivo: 600 asignados de 1000, 400 sin asignar.
	await expect(summaryValue(page, "Asignado")).toHaveText("S/ 600.00");
	await expect(summaryValue(page, "Sin asignar")).toHaveText("S/ 400.00");
	// Y el saldo resultante del comprobante marcado: aparece en la asignacion y en el resumen.
	await expect(page.getByText("Nuevo saldo por comprobante")).toBeVisible();
	await expect(page.getByText(`Factura ${voucher.number}`)).toHaveCount(2);
	await expect(
		page.getByText("Nuevo saldo", { exact: true }).locator("xpath=.."),
	).toContainText("S/ 400.00");

	await submitPayment(page);

	// El pago quedo en el listado con su numero de recibo, y el saldo sin asignar es el real.
	const row = paymentRow(page, entity.name);

	await expect(row).toBeVisible();
	await expect(row).toContainText("En revisión");
	await expect(row).toContainText("Por asignar");
	await expect(row).toContainText("S/ 1,000.00");
	await expect(row).toContainText("S/ 400.00");

	const receipt = await receiptNumberOf(row);

	expect(receipt).toMatch(/^RI-\d{6}$/);

	// La asignacion se persistio con el pago: el detalle la muestra con su importe.
	await row.getByRole("button", { name: "Ver" }).click();

	const dialog = page.getByRole("dialog");

	await expect(dialog).toContainText("Detalle del pago");
	await expect(dialog).toContainText(receipt);
	await expect(dialog).toContainText(voucher.number);
	await expect(dialog).toContainText("S/ 600.00");

	await dialog.getByRole("button", { name: "Cerrar" }).click();
	await expect(dialog).toHaveCount(0);
});
