-- ============================================================================
-- L12(a) del vertical cajas-bancos: `authenticated` pierde UPDATE y DELETE en las tablas de
-- cajas y bancos que la aplicacion escribe SOLO por funciones `SECURITY DEFINER`.
--
-- La deuda pedia "grants por columna" para poder revocar UPDATE/DELETE. La premisa era falsa: el
-- camino de escritura de la app sobre estas tablas no es DML de `authenticated`, es una llamada a
-- una funcion `SECURITY DEFINER` que corre como el dueno de la tabla. Un revoke puro alcanza, y
-- los grants por columna serian privilegio muerto. `cash_close` ya vive en ese estado desde
-- `20261029101500:136` y su escritura (`close_cash_account`) funciona hoy: es el precedente.
--
-- Por que esta migracion existe y no bastaba lo que ya estaba: cuatro de estas tablas YA tenian
-- su revoke en el origen del port (`20261014194051:45` y `:92`, `20261027203718:27` y `:57`), y
-- `20261029101500:96` -- el `grant select, insert, update, delete on all tables in schema public
-- to authenticated` del port -- los deshizo en silencio. Ese grant es masivo e idempotente: basta
-- que un archivo futuro lo repita para devolver el privilegio. Por eso el estado nuevo se fija
-- tambien en `packages/db/scripts/check-rls-enforcement.mjs` (asercion de matriz del grupo M), no
-- solo en este archivo.
--
-- ---------------------------------------------------------------------------
-- Que se revoca y que NO.
-- ---------------------------------------------------------------------------
-- Revoke: `cash_transfer`, `petty_cash_vale`, `cash_count`, `cash_close_denomination`,
-- `cash_count_denomination`, `bank_reconciliation`, `bank_reconciliation_item`.
--
-- NO se revoca `cash_account` ni `app_setting`: la app las escribe con DML DIRECTO del rol de la
-- aplicacion, sin RPC de por medio, y revocar ahi rompe dos pantallas.
--   * `cash_account`: alta, edicion y baja logica en
--     `apps/api/src/cash/cash-accounts.service.ts:169` (insert), `:195` (update) y `:223`
--     (soft delete: `update ... set deleted_at = now()`).
--   * `app_setting`: el upsert de configuracion en `apps/api/src/cash/settings.service.ts:186`
--     (insert) y `:188` (`onConflictDoUpdate`, que necesita UPDATE sobre la fila existente).
-- Las dos tablas siguen con `SELECT`/`INSERT`/`UPDATE`/`DELETE`. Si alguien "completa" este
-- archivo agregandolas, el `db:check-rls` no lo detecta como mejora: el e2e de la API se cae.
--
-- ---------------------------------------------------------------------------
-- Por que el revoke no rompe ninguna de las cinco escrituras.
-- ---------------------------------------------------------------------------
-- Las cinco son `SECURITY DEFINER`, o sea que corren con los privilegios del dueno de la tabla
-- (`dev_user`), no con los de `authenticated`: el revoke no las alcanza.
--   * `void_petty_cash_vale` -- `20261027202217:131-132` (funcion y su `security definer`).
--   * `close_cash_account`   -- `20261006063301:249` (`security definer`; redefinida despues con
--     la misma clausula).
--   * `create_cash_transfer` -- `20261014165429:53-60`.
--   * `register_cash_count`  -- `20261027203718:60-68`.
--   * `save_bank_reconciliation` -- `20261028074215:98-102`.
-- `SECURITY DEFINER` sin `search_path` fijo seria un agujero; las cinco traen
-- `set search_path = ''`, igual que el resto de las RPC del repo.
--
-- El `INSERT` queda como esta: la deuda es sobre UPDATE/DELETE y el origen tampoco fue consistente
-- ahi (`20261014194051:45` y `:92` y `20261027203718:27` y `:57` revocaban tambien el INSERT, pero
-- `cash_transfer` conserva su politica de INSERT en `20261014165429:40`). Revocarlo seria ampliar
-- el alcance sin que nadie lo haya pedido.
--
-- ---------------------------------------------------------------------------
-- Por que NO se agregan grants por columna.
-- ---------------------------------------------------------------------------
-- El unico precedente de grants por columna es `payment` (`20261029101500:140-141`, que reaplica
-- el hardening de `20261012221550_harden_financial_history_v1.sql`), y su motivo declarado en ese
-- mismo bloque (`20261029101500:120-135`) es CONVERGER AL ACL DEL ORIGEN: el historial financiero
-- del origen concede UPDATE solo sobre cuatro columnas, y el port lo reafirma despues de su grant
-- masivo. No es una necesidad de codigo. Copiar ese patron aca agregaria privilegios por columna
-- que ninguna ruta usa (la app ya no escribe estas tablas como `authenticated`), que es justo el
-- privilegio muerto que esta deuda cierra. Si alguna vez una ruta necesita UPDATE directo sobre
-- una columna, el grant se agrega junto con esa ruta y su prueba, no antes.
--
-- Idempotente: `revoke` lo es por naturaleza. Reaplicar el archivo converge al mismo estado, y las
-- tablas existen desde migraciones anteriores (`20261014165429`, `20261014194051`,
-- `20261027203718`, `20261028074215`), asi que no hace falta guard de existencia.
-- ============================================================================

revoke update, delete on table public.cash_transfer from authenticated;
revoke update, delete on table public.petty_cash_vale from authenticated;
revoke update, delete on table public.cash_count from authenticated;
revoke update, delete on table public.cash_close_denomination from authenticated;
revoke update, delete on table public.cash_count_denomination from authenticated;
revoke update, delete on table public.bank_reconciliation from authenticated;
revoke update, delete on table public.bank_reconciliation_item from authenticated;
