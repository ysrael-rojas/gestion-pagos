// Test de la decision de sembrado de catalogos (desvio deliberado de T5b2, ver el comentario de
// `lib/pagos/catalogs.ts`).
//
// El origen sembraba dentro del render del formulario (`ensureCatalogsSeeded()`), o sea un GET que
// escribe. Aca el formulario lee los catalogos y, si vuelven vacios, llama a `POST
// /catalogs/ensure` una sola vez y vuelve a leer. Lo unico que se puede romper sin red es la
// decision, asi que se prueba sola.
import assert from "node:assert/strict";
import { test } from "node:test";

import type {
	CashReceiptCategoryCatalogItem,
	PaymentMethodCatalogItem,
} from "../api/client.ts";
import { CASH_METHOD_CODE, needsCatalogSeed } from "./catalogs.ts";

function method(id: string): PaymentMethodCatalogItem {
	return { id, code: "EFECTIVO", name: "Efectivo", isActive: true };
}

function category(id: string): CashReceiptCategoryCatalogItem {
	return { id, direction: "INGRESO", name: "Cobranza de venta", code: "COBRANZA_VENTA", isActive: true };
}

test("needsCatalogSeed pide sembrar cuando falta cualquier catalogo que el formulario usa", () => {
	// Un dueno nuevo: sin metodos y sin categorias.
	assert.equal(needsCatalogSeed([], []), true);
	// Tiene metodos pero le faltan categorias (o al reves): hay que sembrar igual.
	assert.equal(needsCatalogSeed([method("m")], []), true);
	assert.equal(needsCatalogSeed([], [category("c")]), true);
	// Ya tiene los dos: no se escribe nada (la ruta es idempotente, pero no se llama al pedo).
	assert.equal(needsCatalogSeed([method("m")], [category("c")]), false);
});

test("CASH_METHOD_CODE es el codigo del origen que separa caja de banco", () => {
	// El formulario exige CASH_BOX para este metodo y BANK_ACCOUNT para el resto; si el codigo
	// cambia, el selector de cuentas ofrece las cuentas equivocadas.
	assert.equal(CASH_METHOD_CODE, "EFECTIVO");
});
