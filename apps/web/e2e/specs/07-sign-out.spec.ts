import { countOwnerSessions } from "../support/owner";
import { expect, test } from "../support/test";
import { signInThroughForm } from "../support/ui";

// Spec 7: cerrar sesion revoca la sesion, no solo la cookie.
//
// Dos afirmaciones distintas y las dos importan: el navegador deja de tener acceso (redirige a
// /login en las rutas protegidas) y la sesion deja de existir en la base. Solo la primera seria
// compatible con un boton que borra la cookie y deja el token vivo en el servidor.
//
// El dueno arranca sin sesiones (`createOwner` lo crea por SQL, sin emitir ninguna), asi que "cero
// sesiones" es una afirmacion sobre ESTE login y no sobre restos de la fixture.
test("cerrar sesion revoca la sesion y las rutas protegidas vuelven al login", async ({
	page,
	owner,
}) => {
	await signInThroughForm(page, owner);
	expect(countOwnerSessions(owner.id)).toBeGreaterThan(0);

	await page.getByRole("button", { name: "Cerrar sesión" }).click();

	await expect(page).toHaveURL(/\/login$/);
	expect(countOwnerSessions(owner.id)).toBe(0);

	await page.goto("/");
	await expect(page).toHaveURL(/\/login$/);

	await page.goto("/pagos/ingresos");
	await expect(page).toHaveURL(/\/login$/);
});
