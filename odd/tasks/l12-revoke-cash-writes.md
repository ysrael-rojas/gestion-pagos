# L12(a): revocar UPDATE/DELETE en las tablas de cajas sin romper la anulacion del vale

La deuda L12(a) del vertical cajas-bancos pedia "grants por columna" para poder revocar `UPDATE`/
`DELETE`. El explorador demostro que esa premisa es falsa: la escritura de la app sobre esas tablas
pasa por funciones `SECURITY DEFINER`, que corren como el dueno de la tabla y no como
`authenticated`. Es un revoke puro.

## Specs

**S1 — alcance del revoke.** Sobre `cash_transfer`, `petty_cash_vale`, `cash_count`,
`cash_close_denomination`, `cash_count_denomination`, `bank_reconciliation` y
`bank_reconciliation_item`, `authenticated` **conserva `SELECT` e `INSERT`** y **pierde `UPDATE` y
`DELETE`**. `cash_account` y `app_setting` **no se tocan**: la app las escribe directo, sin RPC
(`cash/cash-accounts.service.ts` insert/update/soft-delete, `cash/settings.service.ts`
`onConflictDoUpdate`), y revocar ahi rompe la pantalla de cuentas y la de configuracion.

**S2 — nada de la app se rompe.** Las cinco escrituras siguen funcionando porque son
`SECURITY DEFINER`: `void_petty_cash_vale` (`20261027202217:131-132`), `close_cash_account`
(`20261006063301:249`), y `register_cash_count`, `create_cash_transfer`,
`save_bank_reconciliation` por el mismo patron. El precedente ya vive en el repo: `cash_close` tiene
`UPDATE`/`DELETE` revocados desde `20261029101500:136` y `close_cash_account` la escribe hoy.

**S3 — el guard de RLS refleja el estado nuevo.** En `packages/db/scripts/check-rls-enforcement.mjs`
las aserciones F y G que hoy esperan `refusal: "missing-policy"` (0 filas) sobre `cash_transfer`,
`petty_cash_vale` y `bank_reconciliation` pasan a `refusal: "missing-privilege"` (SQLSTATE 42501).
Se agrega **una** asercion de matriz que fija el estado convergido (sin `UPDATE`/`DELETE`, con
`SELECT`/`INSERT`) para que un `grant ... on all tables in schema public` futuro —que es justo como
se otorgaron hoy (`20261029101500:96`)— no reintroduzca el privilegio en silencio. El total
publicado (hoy **46**) se actualiza en los cuatro lugares que lo nombran: `README.md:66`,
`.github/CI.md:47`, `docs/operacion/entornos.md:134`, `.agents/skills/caja-bancos-mype/SKILL.md:76`.

**S4 — el snapshot de esquema converge.** `packages/db/scripts/schema-snapshot.sql` regenerado con
`node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql` (nunca con
`pnpm db:dump >`, que corrompe el archivo), y `db:dump --check` en verde.

**S5 — la deuda se corrige donde se documento.** `odd/tasks/port-vertical-cajas-bancos.md`: L12(a) y
L25 dejan de afirmar que hacen falta grants por columna, con la evidencia del definer y del
precedente `cash_close`. Una deuda que se cierra con una premisa equivocada deja la proxima trampa.

## Tasks

| ID | Spec | Ruta |
| --- | --- | --- |
| T1 | S1, S2 | worker: migracion nueva de revoke |
| T2 | S3 | worker: check-rls + los cuatro conteos |
| T3 | S4 | worker: snapshot regenerado |
| T4 | S5 | parent: correccion del documento del feature |

## Log

**L1** (usuario, textual): "comencemos con las deudas". Decision previa del usuario sobre la deuda 2:
la entrada "Resumen" de la navbar apunta a `/cajas-bancos` (PR #12).

**L2** Matriz medida en L25 y estado de grants leidos de `information_schema.role_table_grants` por el
explorador: `authenticated` tiene DML completo en `cash_account`, `cash_count`,
`cash_close_denomination`, `cash_count_denomination`, `cash_transfer`, `petty_cash_vale`,
`bank_reconciliation`, `bank_reconciliation_item`; en `cash_close` ya esta revocado. `payment` es el
unico precedente de grants por columna (`20261029101500:143-146`) y su motivo declarado en el propio
archivo es **converger al ACL del origen**, no una necesidad de codigo.

**L3** Evidencia primaria leida por el parent, no delegada: `void_petty_cash_vale` es
`language plpgsql security definer set search_path = ''` (`20261027202217:131-132`) y
`close_cash_account` es `security definer` (`20261006063301:249`).

**L4** Tres decisiones, con su motivo:

1. **Sin grants por columna.** Serian privilegio muerto: el camino de escritura no pasa por
   `authenticated`. La deuda se cierra con un revoke y se corrige el documento en vez de agregar
   ACLs para satisfacer una premisa equivocada.
2. **`cash_account` y `app_setting` quedan fuera del revoke**, porque sus escrituras si son DML
   directo del rol de la app. Documentarlo en la migracion para que nadie las "complete" despues.
3. **Solo `UPDATE`/`DELETE`.** El `INSERT` sobre las tablas RPC-only queda como esta: sin politica
   de INSERT afecta 0 filas, o sea que ya es inerte, y revocarlo seria ampliar el alcance de la
   deuda sin que nadie lo haya pedido.
