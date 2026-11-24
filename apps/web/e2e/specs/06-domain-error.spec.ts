import { deleteOwnerFixtures, provisionFixtures, provisionForeignCashAccount, createOwner } from "../support/owner";
import { expect, test } from "../support/test";
import {
	chooseOption,
	fillIncomePaymentForm,
	notifications,
	signInThroughForm,
} from "../support/ui";

// Spec 6: el error de dominio llega al usuario tal cual.
//
// El mensaje lo produce la RPC `create_payment_with_allocations` ("La cuenta de caja no existe",
// `42501`), `apps/api` lo traduce a 403 conservando el texto y el puente `/api/backend` no lo
// toca: el navegador solo ve el mensaje. Lo que se afirma es EXACTAMENTE eso, en la notificacion
// que la UI muestra. Un "No se pudo registrar el pago" generico hace fallar este spec.
//
// Como se llega a ese estado: el formulario no permite elegir una cuenta ajena (el select solo
// ofrece las del dueno), asi que el spec intercepta el POST del navegador y cambia
// `cashAccountId` por el de OTRO dueno desechable, que existe de verdad en la base. La cuenta
// ajena no se toma de la demo: el suite no depende del estado de los seeds.
test("una cuenta de caja ajena muestra el mensaje de dominio y no crea el pago", async ({
	page,
	owner,
}) => {
	const fixtures = provisionFixtures(owner, { cashAccount: true });
	const intruder = await createOwner();

	try {
		const foreign = provisionForeignCashAccount(intruder);
		let rewrittenBody: Record<string, unknown> | null = null;

		await page.route("**/api/backend/payments", async (route) => {
			const request = route.request();

			if (request.method() !== "POST") {
				await route.fallback();
				return;
			}

			const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
			body.cashAccountId = foreign.id;
			rewrittenBody = body;

			await route.continue({ postData: JSON.stringify(body) });
		});

		await signInThroughForm(page, owner);
		await page.goto("/pagos/ingresos/nuevo");
		await expect(page.locator("#payment-form")).toBeVisible();

		// Todo lo demas es valido: metodo y categoria se auto-siembran, la cuenta es la propia
		// (el spec la cambia en vuelo) y no hace falta asignacion para llegar a la validacion.
		await chooseOption(page, "Método", "Efectivo");
		await chooseOption(page, "Caja/Banco", fixtures.cashAccount!.name);
		await chooseOption(page, "Categoría", "Cobranza de venta");
		await page.getByRole("spinbutton", { name: "Importe", exact: true }).fill("100");

		await page.getByRole("button", { name: "Registrar", exact: true }).click();

		// La reescritura tiene que haber ocurrido: si el POST no paso por el handler, el alta se
		// habria hecho con la cuenta propia y este spec estaria probando otra cosa.
		await expect.poll(() => rewrittenBody?.cashAccountId ?? null).toBe(foreign.id);

		// El mensaje exacto del dominio, en la notificacion de la UI.
		await expect(
			notifications(page).getByText("La cuenta de caja no existe", { exact: true }),
		).toBeVisible();

		// Y el alta NO ocurrio: se sigue en el formulario y el listado sigue vacio.
		await expect(page).toHaveURL(/\/pagos\/ingresos\/nuevo$/);
		await page.goto("/pagos/ingresos");
		await expect(page.getByRole("cell", { name: "No hay ingresos registrados" })).toBeVisible();
	} finally {
		deleteOwnerFixtures(intruder.id);
	}
});

// El mismo camino, con una cuenta que no existe en absoluto. Es la otra mitad del mensaje: el
// dueno del pago no es "quien tiene la cuenta", y el error no distingue si la cuenta es de otro o
// no existe. Se prueba con el formulario completo para que el spec no dependa de detalles del
// payload.
test("una cuenta de caja inexistente produce el mismo mensaje de dominio", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, { cashAccount: true });

	await page.route("**/api/backend/payments", async (route) => {
		const request = route.request();

		if (request.method() !== "POST") {
			await route.fallback();
			return;
		}

		const body = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
		body.cashAccountId = "00000000-0000-4000-8000-000000000000";

		await route.continue({ postData: JSON.stringify(body) });
	});

	await signInThroughForm(page, owner);
	await page.goto("/pagos/ingresos/nuevo");
	await expect(page.locator("#payment-form")).toBeVisible();

	await fillIncomePaymentForm(page, {
		methodName: "Efectivo",
		cashAccountName: fixtures.cashAccount!.name,
		categoryName: "Cobranza de venta",
		amount: 100,
	});

	await page.getByRole("button", { name: "Registrar", exact: true }).click();

	await expect(
		notifications(page).getByText("La cuenta de caja no existe", { exact: true }),
	).toBeVisible();
	await expect(page).toHaveURL(/\/pagos\/ingresos\/nuevo$/);
});
