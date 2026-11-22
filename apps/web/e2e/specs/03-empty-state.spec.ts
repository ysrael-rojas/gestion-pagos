import { expect, test } from "../support/test";
import { signInThroughForm } from "../support/ui";

// Spec 3: el listado del dueno desechable arranca vacio.
//
// No es un detalle cosmetico: el listado es lo que prueba el aislamiento por dueno en la UI. Si
// RLS o el filtro por `owner_id` fallaran, un usuario nuevo veria los 45 pagos de la demo.
test.describe("listado de un dueno nuevo", () => {
	test("ingresos y egresos arrancan en el estado vacio", async ({ page, owner }) => {
		await signInThroughForm(page, owner);

		await expect(page.getByRole("link", { name: "Ingresos" })).toBeVisible();
		await page.goto("/pagos/ingresos");
		await expect(page).toHaveURL(/\/pagos\/ingresos$/);
		await expect(page.getByRole("heading", { name: "Ingresos" })).toBeVisible();
		await expect(page.getByRole("cell", { name: "No hay ingresos registrados" })).toBeVisible();
		await expect(page.getByText(/Mostrando 0–0 de 0/)).toBeVisible();
		// Ninguna fila con recibo: ni las de la demo ni ninguna otra.
		await expect(page.getByRole("cell", { name: /^R[IE]-\d{6}$/ })).toHaveCount(0);
		await expect(page.getByRole("link", { name: "Registrar pago" })).toBeVisible();

		await expect(page.getByRole("link", { name: "Egresos" })).toBeVisible();
		await page.goto("/pagos/egresos");
		await expect(page).toHaveURL(/\/pagos\/egresos$/);
		await expect(page.getByRole("cell", { name: "No hay egresos registrados" })).toBeVisible();
		await expect(page.getByRole("cell", { name: /^R[IE]-\d{6}$/ })).toHaveCount(0);
	});
});
