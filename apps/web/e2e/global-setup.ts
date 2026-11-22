// Setup global del e2e: valida el entorno, elige el transporte de psql y toma el baseline.
//
// Se ejecuta una vez, antes de los specs y despues de que Playwright arranco `apps/api` y la web
// (los dos `webServer` de `playwright.config.ts`). Lo que comprueba aca es lo que, si esta mal,
// haria fallar todos los specs con mensajes que parecen del producto:
//
// 1. `psql` y el API apuntan a la MISMA base. Si no, las fixtures se siembran en una base y la app
//    consulta otra: los specs fallarian con "el pago no aparece", que no es la causa.
// 2. El API responde `/health` (el webServer ya espero al puerto, pero un proceso que escucha y no
//    sirve no se distingue hasta que corre un test).
// 3. El conteo de filas de la base sembrada, que el teardown global vuelve a medir.
import { API_ORIGIN, databaseNameFromUrl, databaseUrl } from "./support/env";
import { describeCounts, measureCounts, saveBaseline } from "./support/database";
import { psqlValue, resolveTransport } from "./support/psql";

export default async function globalSetup(): Promise<void> {
	const transport = resolveTransport();
	const connectedTo = psqlValue("select current_database();", transport);
	const expected = databaseNameFromUrl(databaseUrl());

	if (connectedTo !== expected) {
		throw new Error(
			`El transporte de psql (${transport.label}) apunta a "${connectedTo}" y DATABASE_URL ` +
				`nombra "${expected}". Tienen que ser la misma base: las fixtures se siembran con ` +
				"psql y la app las lee por DATABASE_URL.",
		);
	}

	const health = await fetch(`${API_ORIGIN}/health`);

	if (!health.ok) {
		throw new Error(`El API respondio ${health.status} en ${API_ORIGIN}/health.`);
	}

	// Un dueno desechable de una corrida anterior abortada (Ctrl-C, `| head`, un kill) haria que el
	// baseline incluya sus filas: el teardown compararia contra una base ya sucia y pasaria. El
	// setup no los borra por su cuenta -- podrian ser de otra corrida en paralelo -- pero no deja
	// empezar sobre un estado desconocido.
	const leftovers = Number(
		psqlValue(
			"select count(*) from auth.users where email like 'e2e-%@example.test';",
			transport,
		),
	);

	if (leftovers > 0) {
		throw new Error(
			`Hay ${leftovers} usuario(s) desechable(s) de una corrida anterior. El baseline de filas ` +
				"ya no representa la base sembrada, asi que el check del teardown no probaria nada. " +
				"Borra esas filas (e2e/support/owner.ts, deleteOwnerFixtures) antes de volver a correr.",
		);
	}

	const counts = measureCounts();
	saveBaseline(counts);

	console.log(`[e2e] base: ${connectedTo}`);
	console.log(`[e2e] psql: ${transport.label}`);
	console.log(`[e2e] baseline de filas: ${describeCounts(counts)}`);
}
