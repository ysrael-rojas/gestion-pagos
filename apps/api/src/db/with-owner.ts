// El unico camino a la base: una transaccion con la identidad del request fijada.
//
// Dos piezas, en este orden, y ninguna es opcional:
//
//   1. `set_config('app.user_id', <uuid>, true)` -- es el `SET LOCAL` del GUC que lee `auth.uid()`
//      (shim de la migracion 00000000000001_auth_compat.sql). `true` lo hace local a ESTA
//      transaccion: dos requests concurrentes sobre el pool nunca se pisan la identidad.
//   2. `set local role authenticated` -- sin esto no hay aislamiento. La conexion es `dev_user`,
//      que es **owner** de las tablas y superusuario del contenedor: los owners de una tabla
//      ignoran sus politicas RLS (a menos que la tabla tenga `FORCE ROW LEVEL SECURITY`, que las
//      migraciones portadas no ponen a proposito, porque los seeds y las migraciones escriben
//      como owner). Cambiar el rol de la transaccion a `authenticated` es el modelo de PostgREST:
//      dejamos de ser el owner y pasan a aplicar las 39 politicas portadas. El rol se revierte
//      solo al terminar la transaccion, asi que la conexion vuelve al pool como `dev_user`.
//
// `authenticated` tiene los privilegios de tabla que le da la migracion
// 20261029101500_better_auth_tables_and_role_grants.sql; las politicas son las que recortan filas.
//
// Por que importa: las 39 politicas RLS son la capa que no se puede olvidar. Un
// `where owner_id = ...` escrito en el servicio es una decision que alguien puede omitir en
// la proxima query; la politica se evalua en PostgreSQL para toda fila leida o escrita. El
// filtro explicito que agregan los servicios es defensa en profundidad, no la garantia.
import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./db.provider";

/**
 * Corre `run` dentro de una transaccion que ya tiene `app.user_id` fijado y el rol de sesion
 * cambiado a `authenticated`.
 *
 * Better Auth NO pasa por aca: escribe `auth.*` como owner y no debe quedar sujeto a RLS.
 *
 * @param ownerId id del usuario autenticado (`auth.users.id`, uuid).
 */
export async function withOwner<T>(
	db: Database,
	ownerId: string,
	run: (tx: Transaction) => Promise<T>,
): Promise<T> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select set_config('app.user_id', ${ownerId}, true)`);
		await tx.execute(sql`set local role authenticated`);
		return run(tx);
	});
}
