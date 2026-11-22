import { expect, test } from "@playwright/test";

// Spec 1: la puerta de entrada del vertical.
//
// El layout de `(app)` resuelve la sesion en el servidor y redirige ANTES de renderizar
// (`app/(app)/layout.tsx`). Lo que se prueba es eso: sin cookie, `/pagos/ingresos` no muestra la
// pantalla de pagos ni un shell vacio, termina en el formulario de login.
test.describe("visitante sin sesion", () => {
	test("entrar a /pagos/ingresos redirige a /login", async ({ page }) => {
		await page.goto("/pagos/ingresos");

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.locator("#email")).toBeVisible();
		await expect(page.locator("#password")).toBeVisible();
		await expect(page.getByRole("button", { name: "Iniciar sesión" })).toBeVisible();
		// Ni un rastro del vertical: el redirect es de servidor, no un "acceso denegado" dibujado
		// dentro del shell autenticado.
		await expect(page.getByRole("heading", { name: "Ingresos" })).toHaveCount(0);
	});

	test("la home tambien exige sesion", async ({ page }) => {
		await page.goto("/");

		await expect(page).toHaveURL(/\/login$/);
		await expect(page.locator("#email")).toBeVisible();
	});
});
