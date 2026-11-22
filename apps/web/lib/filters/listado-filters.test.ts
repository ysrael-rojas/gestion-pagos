// Tests de `lib/filters/listado-filters.ts` (portado tal cual del origen).
//
// Estos helpers definen que significa "filtrar el listado": que llega desde la URL, que se valida,
// que se vuelve a escribir en la URL y que se aplica sobre las filas ya cargadas. Un cambio aca
// cambia lo que el usuario ve al entrar a /pagos/ingresos?desde=...&estado=PROCESADO.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	DEFAULT_PAYMENT_STATUS_FILTER,
	PAYMENT_RECEIPT_STATUSES,
	applyListadoFilters,
	filtersToSearchParams,
	parseListadoFilters,
} from "./listado-filters.ts";

test("parseListadoFilters acepta solo fechas YYYY-MM-DD y estados conocidos", () => {
	assert.deepEqual(parseListadoFilters({}, PAYMENT_RECEIPT_STATUSES), {
		desde: null,
		hasta: null,
		estado: DEFAULT_PAYMENT_STATUS_FILTER,
	});

	assert.deepEqual(
		parseListadoFilters(
			{ desde: "2026-01-01", hasta: "2026-01-31", estado: "PROCESADO" },
			PAYMENT_RECEIPT_STATUSES,
		),
		{ desde: "2026-01-01", hasta: "2026-01-31", estado: "PROCESADO" },
	);

	// Una fecha mal formada se descarta entera, no se recorta a lo que "parezca" valido.
	assert.deepEqual(parseListadoFilters({ desde: "2026-1-1", hasta: "ayer" }), {
		desde: null,
		hasta: null,
		estado: DEFAULT_PAYMENT_STATUS_FILTER,
	});

	// Un estado fuera del catalogo de la pantalla vuelve a TODOS (no rompe el listado).
	assert.equal(
		parseListadoFilters({ estado: "PENDIENTE" }, PAYMENT_RECEIPT_STATUSES).estado,
		"TODOS",
	);

	// Un parametro repetido (?desde=a&desde=b) usa el primero, como el origen.
	assert.equal(parseListadoFilters({ desde: ["2026-02-01", "2026-03-01"] }).desde, "2026-02-01");
});

test("filtersToSearchParams omite el estado por defecto y conserva el resto", () => {
	assert.equal(
		filtersToSearchParams({ desde: null, hasta: null, estado: "TODOS" }).toString(),
		"",
	);
	assert.equal(
		filtersToSearchParams({ desde: "2026-01-01", hasta: null, estado: "PROCESADO" }).toString(),
		"desde=2026-01-01&estado=PROCESADO",
	);
});

test("applyListadoFilters filtra por fecha de pago y por estado", () => {
	const rows = [
		{ id: "a", paymentDate: "2026-01-10", status: "EN_REVISION" },
		{ id: "b", paymentDate: "2026-01-20", status: "PROCESADO" },
		{ id: "c", paymentDate: "2026-02-05", status: "ANULADO" },
	];

	const ids = (filters: Parameters<typeof applyListadoFilters>[1]) =>
		applyListadoFilters(rows, filters, { dateField: "paymentDate" }).map((row) => row.id);

	assert.deepEqual(ids({ desde: null, hasta: null, estado: "TODOS" }), ["a", "b", "c"]);
	assert.deepEqual(ids({ desde: "2026-01-15", hasta: null, estado: "TODOS" }), ["b", "c"]);
	assert.deepEqual(ids({ desde: null, hasta: "2026-01-20", estado: "TODOS" }), ["a", "b"]);
	assert.deepEqual(ids({ desde: null, hasta: null, estado: "PROCESADO" }), ["b"]);
	// El rango es inclusivo en los dos extremos.
	assert.deepEqual(ids({ desde: "2026-01-10", hasta: "2026-02-05", estado: "TODOS" }), [
		"a",
		"b",
		"c",
	]);
});

test("applyListadoFilters usa issueDate por defecto y acepta un comparador propio", () => {
	const rows = [
		{ id: "a", issueDate: "2026-01-10", status: "PENDIENTE" },
		{ id: "b", issueDate: "2026-02-10", status: "PAGADO" },
	];

	assert.deepEqual(
		applyListadoFilters(rows, { desde: "2026-02-01", hasta: null, estado: "TODOS" }).map(
			(row) => row.id,
		),
		["b"],
		"sin opciones mira issueDate",
	);

	// `matchesStatus` permite mapear un estado de pantalla a varios de fila.
	assert.deepEqual(
		applyListadoFilters(rows, { desde: null, hasta: null, estado: "PENDIENTE" }, {
			matchesStatus: (row, status) => (status === "PENDIENTE" ? row.status !== "PAGADO" : false),
		}).map((row) => row.id),
		["a"],
	);
});
