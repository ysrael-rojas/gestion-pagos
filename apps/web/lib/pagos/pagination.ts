// Recorrido de paginas para las listas que el origen traia completas.
//
// Por que existe: el proyecto original pedia TODOS los pagos de una direccion y renderizaba la
// lista entera. El endpoint equivalente pagina (`pageSize` por defecto y maximo 100), asi que una
// sola request devuelve la primera pagina y el pago 101 desaparece de la pantalla **sin ningun
// error**: la lista se ve vacia, o corta, y nadie se entera. Este modulo trae todas las paginas.
//
// Se escribe como funcion pura sobre un `fetchPage` inyectado para poder probar el corte exacto
// (ultima pagina incompleta) y el tope, sin red y sin mocks de modulo.

/** Tope de paginas: 200 x 100 = 20.000 filas. Mas que eso es un error de datos, no una lista. */
export const MAX_PAGES = 200;

export interface CollectAllPagesOptions {
	pageSize?: number;
	maxPages?: number;
}

/**
 * Pide paginas al `fetchPage` hasta recibir una incompleta.
 *
 * El criterio de corte es `lote.length < pageSize`, no `lote.length === 0`: si el total es un
 * multiplo exacto del tamano de pagina hay que pedir una pagina mas para saber que se termino.
 */
export async function collectAllPages<T>(
	fetchPage: (page: number, pageSize: number) => Promise<T[]>,
	{ pageSize = 100, maxPages = MAX_PAGES }: CollectAllPagesOptions = {},
): Promise<T[]> {
	const all: T[] = [];

	for (let page = 1; page <= maxPages; page += 1) {
		const batch = await fetchPage(page, pageSize);
		all.push(...batch);

		if (batch.length < pageSize) {
			return all;
		}
	}

	throw new Error(
		`La lista supero ${maxPages} paginas de ${pageSize} filas: se corto para no pedir sin fin. ` +
			"Si el volumen es real, hay que paginar en la interfaz en vez de traer todo.",
	);
}
