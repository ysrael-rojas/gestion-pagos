import { expect, test } from "../support/test";
import { signInThroughForm } from "../support/ui";

// Spec 2: el inicio de sesion real, por el formulario.
//
// Valida de una sola vez: el formulario (Server Action) -> handler de Better Auth de `apps/api`
// -> validacion de `BETTER_AUTH_TRUSTED_ORIGINS` -> cookie `HttpOnly` -> layout protegido. Un
// 403 por origen no confiable se veria aca y no en el API por separado.
test.describe("inicio de sesion", () => {
	test("entra con un usuario desechable y llega al inicio con su sesion", async ({ page, owner }) => {
		await signInThroughForm(page, owner);

		await expect(page.getByRole("heading", { name: "Gestión", level: 1 })).toBeVisible();
		// La cookie de sesion no es legible por el JavaScript del navegador.
		const cookies = await page.context().cookies();
		const session = cookies.filter((cookie) => cookie.name.includes("better-auth"));

		expect(session.length).toBeGreaterThan(0);
		expect(session.every((cookie) => cookie.httpOnly)).toBe(true);

		// La sesion sobrevive a una recarga: no era estado en memoria del render.
		await page.reload();
		await expect(page.getByText(`sesión: ${owner.email}`)).toBeVisible();

		// Con sesion, `/login` no vuelve a mostrar el formulario.
		await page.goto("/login");
		await expect(page).toHaveURL("/");
	});

	test("una contrasena incorrecta muestra el mensaje del API, no un generico", async ({ page, owner }) => {
		await page.goto("/login");
		await page.locator("#email").fill(owner.email);
		await page.locator("#password").fill("contrasena-equivocada");
		await page.getByRole("button", { name: "Iniciar sesión" }).click();

		// El texto lo produce Better Auth y la Server Action lo devuelve tal cual
		// (`app/login/actions.ts`): un "algo salio mal" borraria la unica pista util.
		await expect(page.locator("form [role=alert]")).toHaveText("Invalid email or password");
		await expect(page).toHaveURL(/\/login$/);
	});
});
