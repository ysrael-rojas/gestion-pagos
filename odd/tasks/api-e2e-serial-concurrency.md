# API e2e serializados: el actor demo es compartido

`main` quedo con CI en rojo despues de mergear el vertical cajas-bancos. No es el producto: es un
fixture de test que comparte un actor entre archivos que corren en procesos paralelos.

## Specs

**S1.** `pnpm --filter @gestion/api test` corre sus archivos en serie (`--test-concurrency=1`),
porque `cash-settings`, `catalogs`, `payments` y `entities` dan y revocan credencial sobre el MISMO
`auth.users` demo (`7f9e00ea-c5a0-4ddb-b72c-4f6ad912f782`, de `00-demo-user.sql`).

**S2.** La suite completa del API sigue verde contra la base sembrada: 127 tests, 0 fallos, exit 0, y
`pnpm typecheck` en 0 errores. La serializacion no cambia ningun caso, solo el orden de ejecucion.

## Tasks

| ID | Spec | Ruta | Estado |
| --- | --- | --- | --- |
| T1 | S1 | inline (parent) | hecho: bandera en `apps/api/package.json`, comentario en `test/support/fixtures.ts`, fila 8 de `.github/CI.md` |
| T2 | S2 | gentle-ai-verify | verificar suite + typecheck |

## Log

**L1** (usuario, textual): "arreglar el fixture ahora".

**L2** Evidencia de CI, run `45266185329` sobre `main` = `99fc622`, dos intentos, dos sintomas del
mismo defecto:

- intento 1: 127 tests, 120 pass, **7 fail** — los 7 son `cash-settings.e2e`, `hookFailed`,
  `insert or update on table "account" violates foreign key constraint "account_user_id_fkey"`,
  `code: '23503'`, en `grantDemoCredential` (`fixtures.ts:127`).
- intento 2 (rerun): 127 tests, 109 pass, **18 fail** — `payments.e2e` con
  `error: 'Invalid email or password'`.

`payments` y `catalogs` pasaron en el intento 1 y `cash-settings` no; al reves en el intento 2. Eso
prueba interaccion entre archivos, no un defecto de un spec aislado: cada uno inserta una fila
`auth.account` nueva para el mismo usuario y `revokeDemoCredential` borra **todas** las filas
`credential` de ese usuario.

**L3** Linea base local antes de tocar nada: `127/127`, exit 0, 2m14s. El fallo no se reproduce en
una maquina sola porque la ventana entre `demoOwnerEmail` y el `insert` (con `hashPassword` en el
medio) es corta; en CI el runner es mas lento y la ventana se abre.

**L4** Decision: contener con `--test-concurrency=1`, que no cambia semantica de nada (ni de la base
de desarrollo, ni de los datos sembrados). Se descarto hacer la credencial "compartida y no
destructiva" (dejarla viva en la base de desarrollo) por ser un cambio con olor a seguridad sobre un
usuario sembrado. Si algun dia cada spec levanta su propio dueno con datos sembrados, la bandera se
saca.
