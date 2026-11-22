import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectAllPages } from "./pagination.ts";

/** Fabrica un `fetchPage` que sirve `total` filas de `pageSize`, registrando cada pagina pedida. */
function pagesOf(total: number, pageSize: number) {
	const requested: number[] = [];
	const fetchPage = async (page: number, size: number) => {
		requested.push(page);
		const start = (page - 1) * size;
		return Array.from({ length: Math.max(0, Math.min(size, total - start)) }, (_, i) => start + i);
	};

	return { fetchPage, requested };
}

describe("collectAllPages", () => {
	it("devuelve vacio y pide una sola pagina cuando no hay filas", async () => {
		const { fetchPage, requested } = pagesOf(0, 100);

		const rows = await collectAllPages(fetchPage, { pageSize: 100 });

		assert.deepEqual(rows, []);
		assert.deepEqual(requested, [1]);
	});

	it("devuelve las filas de una pagina incompleta sin pedir otra", async () => {
		const { fetchPage, requested } = pagesOf(45, 100);

		const rows = await collectAllPages(fetchPage, { pageSize: 100 });

		assert.equal(rows.length, 45);
		assert.deepEqual(requested, [1]);
	});

	it("pide una pagina mas cuando el total es multiplo exacto del tamano de pagina", async () => {
		const { fetchPage, requested } = pagesOf(200, 100);

		const rows = await collectAllPages(fetchPage, { pageSize: 100 });

		assert.equal(rows.length, 200);
		assert.deepEqual(requested, [1, 2, 3], "la tercera pagina vacia es la que prueba el fin");
	});

	it("trae todas las filas aunque superen una pagina", async () => {
		const { fetchPage, requested } = pagesOf(250, 100);

		const rows = await collectAllPages(fetchPage, { pageSize: 100 });

		assert.equal(rows.length, 250);
		assert.deepEqual(rows, Array.from({ length: 250 }, (_, i) => i), "sin huecos ni repetidos");
		assert.deepEqual(requested, [1, 2, 3]);
	});

	it("corta con error en vez de pedir sin fin al superar el tope", async () => {
		const { fetchPage } = pagesOf(1_000_000, 100);

		await assert.rejects(
			() => collectAllPages(fetchPage, { pageSize: 100, maxPages: 3 }),
			/supero 3 paginas/,
		);
	});
});
