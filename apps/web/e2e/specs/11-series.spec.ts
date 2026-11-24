import type { Page } from "@playwright/test";

import { provisionFixtures } from "../support/owner";
import { insertSeries, notesOf, seriesByCode, seriesRows } from "../support/ventas-fixtures";
import { expect, test } from "../support/test";
import { chooseOption, notifications, signInThroughForm } from "../support/ui";

// Spec 11: Configuracion → Series de punta a punta, por la UI (T4/T5 del slice 2, S8 y S9 de
// `odd/tasks/port-vertical-series.md`; el caso de verificacion del slice es S12).
//
// Es la pantalla que el slice 1 dejo fuera: `voucher_series` existia en la base y no la leia ni la
// escribia nadie (L3), el navbar tenia una entrada `Configuración` sin ruta y el enlace
// `Configurar series` del alta de ventas era un enlace muerto. Desde este slice la pantalla vive en
// `/configuracion/series`, `/configuracion` redirige ahi y el CRUD va por RPC del API (S5): el
// borrado es LOGICO, el tipo de una serie no se edita y solo puede haber una predeterminada por
// tipo.
//
// Lo que se afirma es lo observable: lo que el usuario ve (encabezados, filas, badge, toast, error
// de campo) y, cuando la accion escribe, la fila de `public.voucher_series` — para que el caso
// pruebe que el efecto fue en la base y no solo en el navegador. El API ya tiene su propio e2e
// (`apps/api/test/series.e2e.test.ts`, 10 casos): aca no se re-testea el contrato HTTP, se prueba
// que la pantalla lo usa.
//
// Los casos:
//
//   redireccion     `/configuracion` redirige a `/configuracion/series` (S9), la pantalla de un
//                   dueno nuevo muestra su estado vacio con las columnas de S8, y el navbar marca
//                   `Configuración` como entrada activa.
//   alta            el alta por el modal real, con la fila en la base (`last_number`, `is_default`),
//                   el codigo duplicado rechazado con el mensaje de S6 y el codigo invalido
//                   bloqueado por el formulario con el mensaje de S7.
//   serie de nota   (slice 3, S11 del doc de notas) la pantalla ofrece `Nota de crédito` y
//                   `Nota de débito` junto a los tres tipos de venta, y la serie creada se USA: la
//                   nota de credito del detalle de una venta toma su numero y la hace avanzar.
//   edicion         el tipo queda fijo (S5, L4a) y mover la predeterminada deja UNA sola por tipo,
//                   en la pantalla y en la base.
//   baja            la baja es logica: la fila sale del listado (tambien tras recargar) y queda con
//                   `deleted_at` en la base.
//
// Cada test usa un dueno desechable (fixture `owner`) y el teardown borra sus series en orden de FK
// (`deleteOwnerFixtures`); el teardown global compara el conteo de tablas contra el baseline, que
// incluye `public.voucher_series`, asi que una fila que se escape se ve.

const SERIES = "/configuracion/series";
const CONFIGURACION = "/configuracion";

/** S8, textual de `lib/configuracion/series.ts`. */
const EMPTY_MESSAGE = "No hay series registradas. Agrega la primera para poder registrar ventas.";
const DEFAULT_BADGE = "Predeterminada";
const NO_DEFAULT_MARK = "—";
const CREATE_TOAST = "Serie agregada";
const UPDATE_TOAST = "Serie actualizada";
const DELETE_TOAST = "Serie eliminada";
const DELETE_DESCRIPTION =
	"Dejará de usarse para nuevas ventas. Los comprobantes ya registrados no cambian.";
const DEFAULT_CHECKBOX = "Usar como serie por defecto para este tipo";

/** S6, textual de `apps/api/src/series/series.errors.ts`. */
const DUPLICATE_CODE_MESSAGE = "Ya existe una serie con ese código para ese tipo.";

/** S7, textual de `packages/shared/src/lib/schemas/serie.ts`. */
const INVALID_CODE_MESSAGE = "Usa 1 a 4 caracteres alfanuméricos, por ejemplo F001";

/** Las cinco columnas de la tabla, en su orden (`SERIES_COPY`). */
const COLUMNS = ["Tipo", "Serie", "Último correlativo", "Por defecto", "Acciones"];

/** Fila de la tabla que contiene ese texto (los codigos son unicos por dueno desechable). */
function seriesRow(page: Page, text: string) {
	return page.getByRole("row").filter({ hasText: text });
}

/** El modal de alta/edicion (rol `dialog`; la confirmacion de baja es `alertdialog`). */
function serieDialog(page: Page) {
	return page.getByRole("dialog");
}

/** Abre el modal de alta desde el boton de la pagina y devuelve su locator. */
async function openCreateModal(page: Page) {
	// Con el modal cerrado hay un solo `Agregar serie` en la pagina; el del pie del modal aparece
	// despues, y por eso las acciones de adentro se buscan dentro de `dialog`.
	await page.getByRole("button", { name: "Agregar serie" }).click();

	const dialog = serieDialog(page);

	await expect(dialog.getByRole("heading", { name: "Agregar serie" })).toBeVisible();

	return dialog;
}

// S9: `/configuracion` es un redirect a la pantalla de series, no una pantalla intermedia.
//
// Es el requisito del slice: la entrada `Configuración` del navbar y el enlace `Configurar series`
// del alta de ventas apuntaban a `/configuracion` y la ruta no existia (L3). Se afirma desde el
// navbar (navegacion real) y con un `goto` directo, porque el redirect tiene que valer para las
// dos entradas.
test("configuracion redirige a series y el navbar marca la entrada como activa", async ({
	page,
	owner,
}) => {
	await signInThroughForm(page, owner);

	// Navegacion real: la entrada `Configuración` del navbar (T5 del slice 2).
	await page.getByRole("link", { name: "Configuración", exact: true }).click();

	// S9: llego a la pantalla de series, sin pasar por una ruta muerta.
	await expect(page).toHaveURL(new RegExp(`${SERIES}$`));

	// S8: el encabezado de la seccion y el de la tarjeta, con sus dos bajadas completas.
	await expect(page.getByRole("heading", { name: "Configuración" })).toBeVisible();
	await expect(
		page.getByText("Administra la numeración de tus comprobantes de venta."),
	).toBeVisible();
	await expect(page.getByText("Series de comprobantes", { exact: true })).toBeVisible();
	await expect(
		page.getByText(
			"Registra las series de cada tipo de comprobante y elige cuál se usa por defecto. El correlativo lo asigna el sistema al registrar ventas.",
		),
	).toBeVisible();
	await expect(
		page.getByText("Solo una serie por tipo puede quedar como predeterminada."),
	).toBeVisible();

	// Las cinco columnas, en su orden.
	for (const column of COLUMNS) {
		await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
	}

	// Un dueno nuevo no tiene series: estado vacio de S8 (no hay filas de la demo).
	await expect(page.getByRole("cell", { name: EMPTY_MESSAGE })).toBeVisible();
	await expect(page.getByRole("row")).toHaveCount(2);

	// S9: la entrada del navbar queda resaltada tambien en la ruta hija. `aria-current="page"` es lo
	// que el primitivo del navbar usa para pintar el estado activo (`data-active`), no una clase
	// que el spec tenga que conocer.
	await expect(page.getByRole("link", { name: "Configuración", exact: true })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await expect(page.getByRole("link", { name: "Ventas", exact: true })).not.toHaveAttribute(
		"aria-current",
		"page",
	);

	// El redirect vale tambien entrando por la URL a secas.
	await page.goto(CONFIGURACION);
	await expect(page).toHaveURL(new RegExp(`${SERIES}$`));
});

// S8 + S6/S7: el alta por el modal real, el duplicado y el codigo invalido.
//
// El alta se hace por el formulario (no por SQL) porque es la pieza que nunca se habia probado: el
// select de tipo ofrece solo los tres tipos que se emiten (S4), el codigo se normaliza a mayusculas
// y el default lo limpia la RPC en la misma transaccion (S5). El duplicado lo rechaza el indice
// unico de la base traducido al mensaje de S6; el codigo invalido lo bloquea el formulario antes de
// cualquier request, con el mensaje de S7.
test("agrega una serie y rechaza el codigo duplicado y el invalido", async ({ page, owner }) => {
	await signInThroughForm(page, owner);
	await page.goto(SERIES);

	await expect(page.getByRole("cell", { name: EMPTY_MESSAGE })).toBeVisible();

	// --- Alta ---
	const dialog = await openCreateModal(page);

	// El codigo viaja en minusculas a proposito: la pantalla lo sube al tipear.
	await chooseOption(page, "Tipo de comprobante", "Factura");
	await dialog.locator("#serie-code").fill("f001");
	await expect(dialog.locator("#serie-code")).toHaveValue("F001");
	await dialog.getByRole("checkbox", { name: DEFAULT_CHECKBOX }).check();
	await dialog.getByRole("button", { name: "Agregar serie" }).click();

	await expect(notifications(page)).toContainText(CREATE_TOAST);
	await expect(serieDialog(page)).toHaveCount(0);

	const row = seriesRow(page, "F001");

	await expect(row).toBeVisible();
	await expect(row).toContainText("Factura");
	// S8: el correlativo de la tabla es el ULTIMO usado, con relleno a 6 (`000000`), y la marca de
	// predeterminada es un badge.
	await expect(row).toContainText("000000");
	await expect(row).toContainText(DEFAULT_BADGE);

	// Quedo ESCRITA: el tipo, el codigo normalizado, el correlativo desde el que arranca y el
	// default. No hay forma de que esto lo haya inventado el navegador.
	const saved = seriesByCode(owner, "FACTURA", "F001");

	expect(saved).not.toBeNull();
	expect(saved?.lastNumber).toBe(0);
	expect(saved?.isDefault).toBe(true);
	expect(saved?.deletedAt).toBeNull();
	expect(seriesRows(owner)).toHaveLength(1);

	// --- Codigo duplicado (S6) ---
	const duplicate = await openCreateModal(page);

	await chooseOption(page, "Tipo de comprobante", "Factura");
	await duplicate.locator("#serie-code").fill("F001");
	await duplicate.getByRole("button", { name: "Agregar serie" }).click();

	const toast = notifications(page);

	await expect(toast.getByText(DUPLICATE_CODE_MESSAGE, { exact: true })).toBeVisible();
	// El modal sigue abierto con lo que el usuario escribio: no hubo alta nueva.
	await expect(duplicate).toBeVisible();
	await expect(duplicate.locator("#serie-code")).toHaveValue("F001");
	expect(seriesRows(owner)).toHaveLength(1);

	// --- Codigo invalido (S7) ---
	//
	// Se cuentan las escrituras que salen del modal: el `maxLength` de 4 del input no alcanza para un
	// codigo con guion, y el schema lo rechaza sin viajar al API.
	const serieWrites: string[] = [];

	page.on("request", (request) => {
		if (request.method() === "POST" && request.url().includes("/api/backend/series")) {
			serieWrites.push(request.url());
		}
	});

	await duplicate.locator("#serie-code").fill("F0-1");
	await duplicate.getByRole("button", { name: "Agregar serie" }).click();

	await expect(duplicate.getByRole("alert")).toHaveText(INVALID_CODE_MESSAGE);
	await expect(duplicate.locator("#serie-code")).toHaveAttribute("aria-invalid", "true");
	// Ningun viaje al API: la validacion es la del formulario.
	expect(serieWrites).toEqual([]);

	await duplicate.getByRole("button", { name: "Cancelar" }).click();
	await expect(serieDialog(page)).toHaveCount(0);

	// La serie original sigue ahi, entera, y no se creo ninguna otra.
	await expect(seriesRow(page, "F001")).toContainText(DEFAULT_BADGE);
	expect(seriesRows(owner)).toHaveLength(1);
});

// S5 (L4a) + S8: el tipo de una serie no se edita, y mover la predeterminada deja una sola por tipo.
//
// El tipo se deshabilita al editar porque cambiarlo reescribiria la numeracion ya emitida a nombre
// de otro tipo de comprobante: `editar_serie` ni siquiera lo recibe. El default si se mueve, y el
// indice unico parcial `voucher_series_default_per_type_idx` es el juez: la RPC limpia el anterior
// del mismo tipo en la misma transaccion.
test("edita una serie con el tipo fijo y mueve la predeterminada", async ({ page, owner }) => {
	// La primera serie viene sembrada con correlativo ya usado: la tabla tiene que mostrar el
	// ultimo, no el proximo.
	insertSeries({ owner, voucherType: "FACTURA", code: "F001", lastNumber: 5, isDefault: true });

	await signInThroughForm(page, owner);
	await page.goto(SERIES);

	const first = seriesRow(page, "F001");

	await expect(first).toBeVisible();
	await expect(first).toContainText("000005");
	await expect(first).toContainText(DEFAULT_BADGE);

	// Segunda serie del MISMO tipo, sin marcar por defecto.
	const dialog = await openCreateModal(page);

	await chooseOption(page, "Tipo de comprobante", "Factura");
	await dialog.locator("#serie-code").fill("F002");
	await dialog.getByRole("button", { name: "Agregar serie" }).click();

	await expect(notifications(page)).toContainText(CREATE_TOAST);
	await expect(seriesRow(page, "F002")).toBeVisible();

	// S8: "por defecto" es una sola por tipo, y la segunda serie no la hereda.
	await expect(page.getByText(DEFAULT_BADGE, { exact: true })).toHaveCount(1);
	await expect(seriesRow(page, "F002")).toContainText(NO_DEFAULT_MARK);

	// --- Edicion ---
	await page.getByRole("button", { name: "Editar serie F002" }).click();

	const edit = serieDialog(page);

	await expect(edit.getByRole("heading", { name: "Editar serie" })).toBeVisible();
	await expect(edit.locator("#serie-code")).toHaveValue("F002");

	// S5/L4a: el tipo es un dato fijo de la serie, no un campo editable.
	await expect(edit.locator("#serie-voucher-type")).toBeDisabled();
	await expect(edit.locator("#serie-voucher-type")).toContainText("Factura");

	// Mover la predeterminada: F002 pasa a ser la que numera las facturas.
	const checkbox = edit.getByRole("checkbox", { name: DEFAULT_CHECKBOX });

	await expect(checkbox).not.toBeChecked();
	await checkbox.check();
	await edit.getByRole("button", { name: "Guardar cambios" }).click();

	await expect(notifications(page)).toContainText(UPDATE_TOAST);
	await expect(serieDialog(page)).toHaveCount(0);

	// En la pantalla: F002 es la predeterminada y F001 ya no; el badge aparece UNA vez.
	await expect(seriesRow(page, "F002")).toContainText(DEFAULT_BADGE);
	await expect(seriesRow(page, "F001")).not.toContainText(DEFAULT_BADGE);
	await expect(seriesRow(page, "F001")).toContainText(NO_DEFAULT_MARK);
	await expect(page.getByText(DEFAULT_BADGE, { exact: true })).toHaveCount(1);

	// En la base: tambien una sola, y es F002. El correlativo no se toco (lo mueve una venta, S2).
	const rows = seriesRows(owner);
	const defaults = rows.filter(
		(serie) => serie.voucherType === "FACTURA" && serie.isDefault && serie.deletedAt === null,
	);

	expect(defaults).toHaveLength(1);
	expect(defaults[0]?.code).toBe("F002");
	expect(seriesByCode(owner, "FACTURA", "F001")?.lastNumber).toBe(5);
});

// S5 + S8: la baja es LOGICA y deja de usarse para nuevas ventas.
//
// `eliminar_serie` escribe `deleted_at`: la fila sigue en la base (los comprobantes ya emitidos no
// cambian) y desaparece del listado porque `GET /series` la excluye. El caso lo prueba por los dos
// lados, y recarga para que no quede la duda de un filtro del navegador.
test("dar de baja una serie la marca como borrada y la saca de la tabla", async ({ page, owner }) => {
	const serie = insertSeries({ owner, voucherType: "BOLETA", code: "B001", isDefault: true });

	await signInThroughForm(page, owner);
	await page.goto(SERIES);

	await expect(seriesRow(page, "B001")).toBeVisible();

	// El `aria-label` de la accion lleva el codigo de la serie (S8).
	await page.getByRole("button", { name: "Eliminar serie B001" }).click();

	const dialog = page.getByRole("alertdialog");

	await expect(dialog.getByRole("heading", { name: "Eliminar serie B001" })).toBeVisible();
	await expect(dialog).toContainText(DELETE_DESCRIPTION);

	await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();

	await expect(notifications(page)).toContainText(DELETE_TOAST);
	await expect(page.getByRole("alertdialog")).toHaveCount(0);
	// La fila sale del listado SIN recargar a mano: la vista recarga desde el API despues del toast
	// (`reload()` de `series-view`), asi que esto prueba tambien que la baja fue exitosa para el
	// cliente y no solo en la base.
	await expect(seriesRow(page, "B001")).toHaveCount(0);
	await expect(page.getByRole("cell", { name: EMPTY_MESSAGE })).toBeVisible();

	// La fila no se borro: se marco.
	const deleted = seriesByCode(owner, "BOLETA", "B001");

	expect(deleted).not.toBeNull();
	expect(deleted?.id).toBe(serie.id);
	expect(deleted?.deletedAt).not.toBeNull();

	// Y tras recargar no vuelve: el listado del API la excluye, no la tabla del navegador.
	await page.reload();
	await expect(page.getByText("Series de comprobantes", { exact: true })).toBeVisible();
	await expect(page.getByRole("cell", { name: EMPTY_MESSAGE })).toBeVisible();
	await expect(seriesRow(page, "B001")).toHaveCount(0);
});

// S11 del slice 3 (y S3 del doc de notas): la pantalla ofrece los tipos de nota y la serie que se
// crea se USA.
//
// Hasta el slice 2 `crear_serie` rechazaba `NOTA_CREDITO` y `NOTA_DEBITO`, asi que la pantalla no los
// ofrecia. Desde `20261127090000_notas_rpcs.sql` son dos de los cinco tipos que la app emite, y esta
// es la prueba de punta a punta del ciclo completo: se crea la serie por el modal real (codigo en
// minusculas, que la pantalla sube al tipear) y despues se registra una nota de credito desde el
// detalle de una venta, que toma `FC01-000001` de ESA serie y la hace avanzar.
//
// Los dos lados se afirman contra la base: la fila de `voucher_series` con `last_number = 0` recien
// creada y `1` despues de la nota, y la fila de la nota con el numero que le asigno la base.
test("crea la serie de una nota de crédito y numera la primera nota", async ({ page, owner }) => {
	const fixtures = provisionFixtures(owner, { voucher: true, voucherTotal: 500 });
	const voucher = fixtures.voucher!;

	await signInThroughForm(page, owner);
	await page.goto(SERIES);

	const dialog = await openCreateModal(page);

	// S11 del slice 3: el select ofrece los tipos de nota junto a los de venta.
	await chooseOption(page, "Tipo de comprobante", "Nota de crédito");
	await dialog.locator("#serie-code").fill("fc01");
	await expect(dialog.locator("#serie-code")).toHaveValue("FC01");
	await dialog.getByRole("checkbox", { name: DEFAULT_CHECKBOX }).check();
	await dialog.getByRole("button", { name: "Agregar serie" }).click();

	await expect(notifications(page)).toContainText(CREATE_TOAST);

	const created = seriesByCode(owner, "NOTA_CREDITO", "FC01");

	expect(created).not.toBeNull();
	expect(created?.isDefault).toBe(true);
	expect(created?.lastNumber).toBe(0);
	await expect(seriesRow(page, "FC01")).toContainText("Nota de crédito");
	await expect(seriesRow(page, "FC01")).toContainText(DEFAULT_BADGE);

	// Y SE USA: la nota de credito del detalle de la venta toma el numero de esa serie.
	await page.goto(`/ventas/${voucher.id}`);
	await page.getByRole("button", { name: "Agregar nota de crédito" }).click();

	const nota = page.getByRole("dialog");

	await expect(nota.getByRole("heading", { name: "Registrar una nota de crédito" })).toBeVisible();
	await expect(nota.locator("#nota-voucherNumber")).toHaveValue("FC01-000001");

	await chooseOption(page, "Motivo", "Otros conceptos");
	await nota.locator("#nota-total").fill("100");
	await nota.getByRole("button", { name: "Registrar" }).click();

	await expect(notifications(page).getByText("Documento registrado")).toBeVisible();
	await expect(page.getByRole("dialog")).toHaveCount(0);

	const notas = notesOf(owner, voucher.id);

	expect(notas).toHaveLength(1);
	expect(notas[0]?.voucherNumber).toBe("FC01-000001");
	expect(notas[0]?.motiveCode).toBe("10");
	// El correlativo lo movio la MISMA transaccion del alta (S3 del doc de notas).
	expect(seriesByCode(owner, "NOTA_CREDITO", "FC01")?.lastNumber).toBe(1);
});
