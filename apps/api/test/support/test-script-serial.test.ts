// Contrato del runner del API (S1 de `odd/tasks/api-e2e-serial-concurrency.md`).
//
// Los e2e del API comparten el dueno demo y su credencial (`auth.account`), asi que los archivos
// tienen que correr en serie. Eso vive en una bandera de `package.json`, que nadie mira al revisar
// un spec: si alguien la saca, la suite vuelve a ser intermitente sin que ningun test lo note. Este
// test es el que lo nota.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readPackageJson(): { scripts?: Record<string, string> } {
	const raw = readFileSync(join(packageRoot, "package.json"), "utf8");
	return JSON.parse(raw) as { scripts?: Record<string, string> };
}

test("el script de test del API corre los archivos en serie", () => {
	const script = readPackageJson().scripts?.test;

	assert.ok(script, "apps/api/package.json no declara el script `test`.");
	assert.match(
		script,
		/--test-concurrency=1\b/,
		"el script `test` del API no pasa `--test-concurrency=1`: los e2e comparten el dueno demo y su credencial, y en paralelo se pisan (ver `test/support/fixtures.ts`, `grantDemoCredential`).",
	);
});

test("el script de test del API cubre todos los specs del paquete", () => {
	const script = readPackageJson().scripts?.test;

	assert.ok(script, "apps/api/package.json no declara el script `test`.");
	assert.match(
		script,
		/test\/\*\*\/\*\.test\.ts/,
		"el script `test` del API no usa el glob `test/**/*.test.ts`: un spec fuera del glob correria sin la serializacion.",
	);
});

test("el fixture expone el contrato del actor demo compartido", () => {
	const fixtures = readFileSync(join(packageRoot, "test", "support", "fixtures.ts"), "utf8");

	for (const name of ["findSeededOwnerId", "grantDemoCredential", "revokeDemoCredential"]) {
		assert.match(
			fixtures,
			new RegExp(`export\\s+async\\s+function\\s+${name}\\b`),
			`el fixture ya no exporta \`${name}\`: el comentario de \`grantDemoCredential\` y la serializacion de la suite existen por ese actor compartido.`,
		);
	}
});
