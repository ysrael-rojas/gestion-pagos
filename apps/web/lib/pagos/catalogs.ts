// Catalogos de caja del formulario de pagos.
//
// DESVIO DELIBERADO respecto del origen (`lib/caja/defaults.ts` + `ensureCatalogsSeeded()`):
// en el origen, abrir el formulario disparaba una siembra perezosa —3 metodos de pago y 13
// categorias por dueno— dentro de un GET. Un GET que escribe es un defecto, no un comportamiento
// a preservar. Aca la siembra es explicita (`POST /catalogs/ensure`, idempotente) y la web la
// llama una sola vez cuando las lecturas vuelven vacias: el efecto para el usuario es el mismo
// (abre el formulario y encuentra los catalogos), el mecanismo es honesto.
//
// Los codigos y nombres de las semillas viven en `apps/api/src/payments/catalogs.defaults.ts`,
// copiados del origen, porque es el servidor el que escribe.
import type {
	CashReceiptCategoryCatalogItem,
	PaymentMethodCatalogItem,
} from "@/lib/api/client";

/**
 * Codigo del metodo que postea a una caja de efectivo (el resto se asume banco/tarjeta).
 *
 * El formulario lo usa para decidir si el selector de cuenta ofrece cajas o bancos. Es el mismo
 * valor que `CASH_METHOD_CODE` de `lib/caja/defaults.ts` en el origen y el de las semillas de
 * `apps/api`, y esta fijado por un test: cambiarlo manda los pagos a la cuenta equivocada.
 */
export const CASH_METHOD_CODE = "EFECTIVO";

/**
 * Hay que sembrar si falta alguno de los dos catalogos que el formulario ofrece.
 *
 * Con `true` el formulario llama `ensureCatalogs()` una vez y vuelve a leer. Con `false` no
 * escribe nada: la ruta es idempotente, pero un GET no deberia tener efectos.
 */
export function needsCatalogSeed(
	methods: PaymentMethodCatalogItem[],
	categories: CashReceiptCategoryCatalogItem[],
): boolean {
	return methods.length === 0 || categories.length === 0;
}
