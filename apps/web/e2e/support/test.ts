// `test` extendido con el dueno desechable.
//
// Cada test que pide `owner` obtiene un usuario nuevo, creado por el camino real de alta, y al
// terminar (pase o falle) se borran sus fixtures en orden de FK. Los specs no comparten estado: el
// orden de ejecucion no puede cambiar el resultado de ninguno.
import { test as base, expect } from "@playwright/test";

import { deleteOwnerFixtures, createOwner, type Owner } from "./owner";

export const test = base.extend<{ owner: Owner }>({
	// eslint-disable-next-line no-empty-pattern -- Playwright exige el primer parametro de fixtures.
	owner: async ({}, use) => {
		const owner = await createOwner();

		try {
			await use(owner);
		} finally {
			deleteOwnerFixtures(owner.id);
		}
	},
});

export { expect, type Owner };
