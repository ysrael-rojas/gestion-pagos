// Drift guard del esquema: serializa lo que la base *realmente* tiene y lo compara con el
// snapshot commiteado.
//
// Por que existe: en el port hubo tres defectos que ningun pipeline detectaba -- RLS que no
// se aplicaba, un GRANT masivo que deshizo un hardening a nivel de columna, y un build frio
// que no resolvia imports. Los dos primeros son diferencias entre lo que las migraciones
// dicen y lo que la base tiene. Este dump convierte esa diferencia en un diff.
//
// Que compara: el catalogo de los esquemas `public`, `auth` y `private` -- relaciones,
// columnas, tipos, constraints, indices, enums, funciones, triggers, politicas, los roles de
// la plataforma (anon/authenticated/service_role), los privilegios (de tabla, de columna, de
// funcion, de esquema y los default privileges de las tablas futuras) y el estado de RLS.
//
// Que NO compara:
//   - datos (esto es un dump de esquema; las filas de los seeds no aparecen),
//   - el nombre del dueno de los objetos (S16: `owner to current_user`; el dueno es quien
//     despliega, asi que su nombre cambia entre una maquina y otra y se emite como OWNER),
//   - el rol que otorga (`grantor`), que es el mismo dueno por construccion,
//   - las entradas de ACL que **dependen de como se inicializo la base** en vez de lo que las
//     migraciones conceden. Son dos, y estan excluidas a proposito (reducen el alcance del
//     guard, ver el bloque "Exclusiones" mas abajo):
//       (a) el pseudo-rol `pg_database_owner` -- se emite como OWNER,
//       (b) `GRANT USAGE ON SCHEMA public TO PUBLIC` -- el default de initdb.
//
// Portabilidad: dos bases migradas con las mismas 50 migraciones tienen que dar el mismo dump
// aunque se hayan creado de forma distinta. Se probo con (1) una base del `postgres:18` del CI
// (`public` viene de `template1`, con `pg_database_owner`) y (2) una base reseteada a mano con
// `drop schema public cascade; create schema public;` como superusuario, como quedo
// `gestion_pagos_dev` (L32). Sin las dos exclusiones, la (1) tiene tres lineas mas y el guard
// falla por inicializacion, no por drift: un guard asi entrena a ignorarlo.
//
// Formato: texto plano, una linea por objeto, secciones en orden fijo y lineas ordenadas
// dentro de cada seccion. Eso hace que el diff sea legible y que no dependa del orden en que
// el catalogo devuelve las filas.
//
// Uso:
//   node scripts/dump-schema.mjs            imprime el dump en stdout
//   node scripts/dump-schema.mjs > ...      regenera el snapshot (documentado en su header)
//   node scripts/dump-schema.mjs --check    compara con el snapshot; exit 1 si difieren
//
// Requiere DATABASE_URL (como el resto de los scripts de este paquete). No usa `pg_dump` a
// proposito: el cliente del runner puede ser mas viejo que el servidor (psql 16 contra
// PostgreSQL 18 en el CI), y `pg_dump` se niega a dumpear un servidor de major distinto. Este
// dump lee el catalogo con SQL estandar, asi que funciona igual con cualquier cliente.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const snapshotPath = join(here, "schema-snapshot.sql");

const AREAS = ["public", "auth", "private"];
const PLATFORM_ROLES = ["anon", "authenticated", "service_role"];

// ---------------------------------------------------------------------------
// Exclusiones deliberadas (reducen el alcance del guard; no ocultar drift real)
// ---------------------------------------------------------------------------
//
// 1. `pg_database_owner` se emite como OWNER.
//    Es el pseudo-rol dueno de la base. En una base creada por initdb, el esquema `public`
//    viene de `template1` con `nspacl = {pg_database_owner=UC/pg_database_owner,=U/...}`, asi
//    que sus privilegios aparecen a nombre de `pg_database_owner`; en una base reseteada a
//    mano (`drop schema public cascade; create schema public;`) el ACL se materializa a nombre
//    del dueno real. Es el mismo hecho semantico (el dueno tiene CREATE y USAGE sobre
//    `public`, que es su privilegio implicito) y ningun archivo de migracion nombra a
//    `pg_database_owner`. Se normaliza, no se pierde informacion: el privilegio del dueno
//    sigue siendo visible.
//
// 2. `GRANT USAGE ON SCHEMA public TO PUBLIC` no se emite.
//    Es el default `=U/pg_database_owner` que initdb pone en `public` desde PostgreSQL 15. Una
//    base cuyo `public` se recreo a mano NO lo tiene (la migracion grant a PUBLIC de este port
//    es sobre `auth`, y esa si se emite). Emitirlo hacia que el guard fallara por como se creo
//    la base. Lo que se pierde: que alguien revoque ese default en un initdb. Como el privilegio
//    no lo concede ninguna migracion, no es parte del contrato del port.
//
// Todo lo demas se emite tal cual: en particular los grants a `authenticated`, `anon`,
// `service_role`, los de tabla y los **de columna** del hardening `20261012221550` (L30/L31),
// que son justamente el defecto que el guard tiene que seguir viendo.

/**
 * Nombre canonico del grantee de una entrada de ACL.
 *
 * Devuelve null cuando la entrada cae en una de las exclusiones documentadas arriba.
 */
function canonicalGrantee({ nspname, privilege_type, is_public, is_owner, grantee_name }) {
	if (is_public) {
		// Exclusion (2): el USAGE de PUBLIC sobre `public` solo existe en bases de initdb.
		if (privilege_type === "USAGE" && nspname === "public") return null;
		return "PUBLIC";
	}
	// Exclusion (1): pseudo-rol de initdb, mismo hecho que el privilegio del dueno.
	if (is_owner || grantee_name === "pg_database_owner") return "OWNER";
	return grantee_name;
}

const HEADER = `-- gestion-pagos -- snapshot canonico del esquema (drift guard del CI)
--
-- Generado por \`packages/db/scripts/dump-schema.mjs\` leyendo el catalogo de una base
-- MIGRADA (no los archivos .sql). Es lo que la base realmente tiene.
--
-- Regenerar despues de agregar o cambiar una migracion:
--   export DATABASE_URL=postgresql://<user>:<password>@127.0.0.1:5434/gestion_pagos_dev
--   node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql
--
-- Verificar (lo que corre el CI):
--   pnpm --filter @gestion/db db:dump --check
--
-- Reglas del formato: solo esquema (ningun dato), una linea por objeto, secciones en orden
-- fijo y lineas ordenadas. El dueno se emite como OWNER y el grantor se omite, porque cambian
-- con el rol que despliega (S16) y no son parte del contrato. NO editar a mano.
--
-- Exclusiones (a proposito, para que el guard mida el contrato y no como se inicializo la
-- base): el pseudo-rol \`pg_database_owner\` se emite como OWNER, y
-- \`GRANT USAGE ON SCHEMA public TO PUBLIC\` (default de initdb desde PostgreSQL 15) no se emite.
-- El resto de los privilegios se compara tal cual, incluidos los de columna del hardening
-- 20261012221550. Detalle y justificacion: comentario de cabecera de dump-schema.mjs.
--
-- Secciones: ROLES, SCHEMAS, RELATIONS, COLUMNS, ENUMS, CONSTRAINTS, INDEXES, FUNCTIONS,
-- TRIGGERS, POLICIES, PRIVILEGES.`;

const oneLine = (value) =>
	value === null || value === undefined ? "-" : String(value).replace(/\s+/g, " ").trim();

const flag = (value) => (value ? "true" : "false");

/** Seccion: un marcador `[NOMBRE]` y sus lineas ordenadas (sin duplicados). */
function section(name, lines) {
	const unique = [...new Set(lines)].sort();
	return { name, lines: unique };
}

function render(sections) {
	const blocks = sections.map((entry) => [entry.name, ...entry.lines].join("\n"));
	return `${[HEADER, ...blocks].join("\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Catalogo
// ---------------------------------------------------------------------------

/**
 * Ejecuta una consulta del catalogo con `search_path` fijo.
 *
 * `search_path = pg_catalog` es lo que hace determinista la salida de `pg_get_expr`,
 * `pg_get_constraintdef`, `pg_get_indexdef` y `pg_get_triggerdef`: con un search_path sin
 * `public`, todo nombre se emite calificado con su esquema, en vez de depender del search_path
 * de quien corre el dump.
 */
async function query(client, text, values = []) {
	const { rows } = await client.query(text, values);
	return rows;
}

async function collect(client) {
	const sections = [];

	// --- roles de la plataforma --------------------------------------------------------------
	// Se listan solo los tres roles que crea el shim de S13 (no todo el cluster: el CI crea un
	// rol para la conexion, y eso no es parte del esquema de la aplicacion).
	const roles = await query(
		client,
		`select r.rolname, r.rolcanlogin, r.rolinherit, r.rolbypassrls, r.rolsuper, r.rolcreaterole
		   from pg_catalog.pg_roles r
		  where r.rolname = any($1::text[])
		  order by r.rolname`,
		[PLATFORM_ROLES],
	);
	sections.push(
		section(
			"ROLES",
			roles.map(
				(r) =>
					`ROLE ${r.rolname} login=${flag(r.rolcanlogin)} inherit=${flag(r.rolinherit)} ` +
					`bypassrls=${flag(r.rolbypassrls)} super=${flag(r.rolsuper)} ` +
					`createrole=${flag(r.rolcreaterole)}`,
			),
		),
	);

	// --- esquemas ----------------------------------------------------------------------------
	// public/auth/private son los tres esquemas de la aplicacion (L32: `private` guarda los
	// helpers de los triggers y tambien hay que resetearlo).
	const schemas = await query(
		client,
		`select n.nspname, n.nspacl is null as acl_is_default
		   from pg_catalog.pg_namespace n
		  where n.nspname = any($1::text[])
		  order by n.nspname`,
		[AREAS],
	);
	sections.push(
		section(
			"SCHEMAS",
			schemas.map((s) => `SCHEMA ${s.nspname} acl=${s.acl_is_default ? "default" : "explicit"}`),
		),
	);

	// --- relaciones --------------------------------------------------------------------------
	const relations = await query(
		client,
		`select n.nspname, c.relname, c.relkind, c.relrowsecurity, c.relforcerowsecurity,
		        c.relacl is null as acl_is_default
		   from pg_catalog.pg_class c
		   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		  where n.nspname = any($1::text[])
		    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
		  order by n.nspname, c.relname`,
		[AREAS],
	);
	const KIND = { r: "table", p: "partitioned-table", v: "view", m: "matview", S: "sequence", f: "foreign-table" };
	sections.push(
		section(
			"RELATIONS",
			relations.map(
				(r) =>
					`RELATION ${KIND[r.relkind] ?? r.relkind} ${r.nspname}.${r.relname} ` +
					`rls=${flag(r.relrowsecurity)} force_rls=${flag(r.relforcerowsecurity)} ` +
					`acl=${r.acl_is_default ? "default" : "explicit"}`,
			),
		),
	);

	// --- columnas ----------------------------------------------------------------------------
	const columns = await query(
		client,
		`select n.nspname, c.relname, a.attname,
		        pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
		        a.attnotnull, a.attidentity, a.attgenerated,
		        pg_catalog.pg_get_expr(d.adbin, d.adrelid) as column_default
		   from pg_catalog.pg_attribute a
		   join pg_catalog.pg_class c on c.oid = a.attrelid
		   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		   left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
		  where n.nspname = any($1::text[])
		    and c.relkind in ('r', 'p', 'v', 'm', 'f')
		    and a.attnum > 0 and not a.attisdropped
		  order by n.nspname, c.relname, a.attnum`,
		[AREAS],
	);
	sections.push(
		section(
			"COLUMNS",
			columns.map(
				(c) =>
					`COLUMN ${c.nspname}.${c.relname}.${c.attname} type=${oneLine(c.data_type)} ` +
					`not_null=${flag(c.attnotnull)} default=${oneLine(c.column_default)} ` +
					`identity=${c.attidentity === "" ? "-" : c.attidentity} ` +
					`generated=${c.attgenerated === "" ? "-" : c.attgenerated}`,
			),
		),
	);

	// --- enums (y dominios) ------------------------------------------------------------------
	// `pg_type` con `typtype = 'e'` (enums) o 'd' (dominios). Se excluyen los tipos de fila de
	// las tablas (`typrelid <> 0`), que no son objetos declarados.
	const types = await query(
		client,
		`select n.nspname, t.typname, t.typtype,
		        coalesce(
		          (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
		             from pg_catalog.pg_enum e where e.enumtypid = t.oid),
		          pg_catalog.format_type(t.typbasetype, t.typtypmod)
		        ) as definition
		   from pg_catalog.pg_type t
		   join pg_catalog.pg_namespace n on n.oid = t.typnamespace
		  where n.nspname = any($1::text[])
		    and t.typtype in ('e', 'd')
		    and t.typrelid = 0
		  order by n.nspname, t.typname`,
		[AREAS],
	);
	sections.push(
		section(
			"ENUMS",
			types.map(
				(t) =>
					`${t.typtype === "e" ? "ENUM" : "DOMAIN"} ${t.nspname}.${t.typname} ` +
					`definition=${oneLine(t.definition)}`,
			),
		),
	);

	// --- constraints -------------------------------------------------------------------------
	const constraints = await query(
		client,
		`select n.nspname, c.relname, con.conname, con.contype, con.convalidated,
		        pg_catalog.pg_get_constraintdef(con.oid) as definition
		   from pg_catalog.pg_constraint con
		   join pg_catalog.pg_class c on c.oid = con.conrelid
		   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		  where n.nspname = any($1::text[])
		    and con.conrelid <> 0
		  order by n.nspname, c.relname, con.conname`,
		[AREAS],
	);
	sections.push(
		section(
			"CONSTRAINTS",
			constraints.map(
				(k) =>
					`CONSTRAINT ${k.nspname}.${k.relname} ${k.conname} type=${k.contype} ` +
					`validated=${flag(k.convalidated)} definition=${oneLine(k.definition)}`,
			),
		),
	);

	// --- indices -----------------------------------------------------------------------------
	const indexes = await query(
		client,
		`select ns.nspname, t.relname as table_name, i.relname as index_name,
		        ix.indisunique, ix.indisvalid,
		        pg_catalog.pg_get_indexdef(ix.indexrelid) as definition
		   from pg_catalog.pg_index ix
		   join pg_catalog.pg_class i on i.oid = ix.indexrelid
		   join pg_catalog.pg_class t on t.oid = ix.indrelid
		   join pg_catalog.pg_namespace ns on ns.oid = t.relnamespace
		  where ns.nspname = any($1::text[])
		  order by ns.nspname, t.relname, i.relname`,
		[AREAS],
	);
	sections.push(
		section(
			"INDEXES",
			indexes.map(
				(x) =>
					`INDEX ${x.nspname}.${x.table_name} ${x.index_name} ` +
					`unique=${flag(x.indisunique)} valid=${flag(x.indisvalid)} ` +
					`definition=${oneLine(x.definition)}`,
			),
		),
	);

	// --- funciones ---------------------------------------------------------------------------
	// La definicion completa (cuerpo incluido) se colapsa a una linea: es el objeto donde vive
	// casi toda la logica del dominio, y un hash no diria *que* cambio.
	const functions = await query(
		client,
		`select n.nspname, p.proname, p.prokind, p.prosecdef,
		        pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
		        pg_catalog.pg_get_functiondef(p.oid) as definition,
		        p.proacl is null as acl_is_default
		   from pg_catalog.pg_proc p
		   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		  where n.nspname = any($1::text[])
		  order by n.nspname, p.proname, arguments`,
		[AREAS],
	);
	sections.push(
		section(
			"FUNCTIONS",
			functions.map(
				(f) =>
					`FUNCTION ${f.nspname}.${f.proname}(${oneLine(f.arguments)}) ` +
					`kind=${f.prokind} security=${f.prosecdef ? "definer" : "invoker"} ` +
					`acl=${f.acl_is_default ? "default" : "explicit"} ` +
					`definition=${oneLine(f.definition)}`,
			),
		),
	);

	// --- triggers ----------------------------------------------------------------------------
	const triggers = await query(
		client,
		`select n.nspname, c.relname, t.tgname, t.tgenabled,
		        pg_catalog.pg_get_triggerdef(t.oid) as definition
		   from pg_catalog.pg_trigger t
		   join pg_catalog.pg_class c on c.oid = t.tgrelid
		   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		  where n.nspname = any($1::text[])
		    and not t.tgisinternal
		  order by n.nspname, c.relname, t.tgname`,
		[AREAS],
	);
	sections.push(
		section(
			"TRIGGERS",
			triggers.map(
				(t) =>
					`TRIGGER ${t.nspname}.${t.relname} ${t.tgname} enabled=${t.tgenabled} ` +
					`definition=${oneLine(t.definition)}`,
			),
		),
	);

	// --- politicas RLS -----------------------------------------------------------------------
	const policies = await query(
		client,
		`select n.nspname, c.relname, pol.polname, pol.polcmd, pol.polpermissive,
		        (select string_agg(case when r = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end, ','
		                            order by case when r = 0 then 'PUBLIC' else pg_catalog.pg_get_userbyid(r) end)
		           from unnest(pol.polroles) as r) as roles,
		        pg_catalog.pg_get_expr(pol.polqual, pol.polrelid) as using_expr,
		        pg_catalog.pg_get_expr(pol.polwithcheck, pol.polrelid) as check_expr
		   from pg_catalog.pg_policy pol
		   join pg_catalog.pg_class c on c.oid = pol.polrelid
		   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		  where n.nspname = any($1::text[])
		  order by n.nspname, c.relname, pol.polname`,
		[AREAS],
	);
	const COMMAND = { r: "select", a: "insert", w: "update", d: "delete", "*": "all" };
	sections.push(
		section(
			"POLICIES",
			policies.map(
				(p) =>
					`POLICY ${p.nspname}.${p.relname} ${p.polname} ` +
					`command=${COMMAND[p.polcmd] ?? p.polcmd} permissive=${flag(p.polpermissive)} ` +
					`roles=${oneLine(p.roles)} using=${oneLine(p.using_expr)} ` +
					`check=${oneLine(p.check_expr)}`,
			),
		),
	);

	// --- privilegios -------------------------------------------------------------------------
	// El dueno se emite como OWNER y el grantor se omite: los dos son el rol que despliega
	// (S16), asi que sus nombres no son parte del contrato del esquema.
	const privileges = [];

	const relationAcl = await query(
		client,
		`select n.nspname, c.relname, acl.privilege_type, acl.is_grantable, acl.grantee,
		        pg_catalog.pg_get_userbyid(acl.grantee) as grantee_name, acl.grantee = 0 as is_public,
		        acl.grantee = (select oid from pg_catalog.pg_roles where rolname = current_user) as is_owner
		   from pg_catalog.pg_class c
		   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		   cross join lateral pg_catalog.aclexplode(c.relacl) as acl
		  where n.nspname = any($1::text[])
		    and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')
		  order by n.nspname, c.relname, acl.privilege_type`,
		[AREAS],
	);
	for (const row of relationAcl) {
		const grantee = canonicalGrantee(row);
		if (grantee === null) continue;
		privileges.push(
			`GRANT ${row.privilege_type} ON TABLE ${row.nspname}.${row.relname} TO ${grantee}` +
				(row.is_grantable ? " WITH GRANT OPTION" : ""),
		);
	}

	// Privilegios de COLUMNA: son la capa que el GRANT masivo de T4b deshizo (L30/L31), asi que
	// el drift guard tiene que verlos o no sirve para el defecto que lo motivo.
	const columnAcl = await query(
		client,
		`select n.nspname, c.relname, att.attname, acl.privilege_type, acl.is_grantable,
		        pg_catalog.pg_get_userbyid(acl.grantee) as grantee_name, acl.grantee = 0 as is_public,
		        acl.grantee = (select oid from pg_catalog.pg_roles where rolname = current_user) as is_owner
		   from pg_catalog.pg_attribute att
		   join pg_catalog.pg_class c on c.oid = att.attrelid
		   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
		   cross join lateral pg_catalog.aclexplode(att.attacl) as acl
		  where n.nspname = any($1::text[])
		    and att.attnum > 0 and not att.attisdropped
		  order by n.nspname, c.relname, att.attname, acl.privilege_type`,
		[AREAS],
	);
	for (const row of columnAcl) {
		const grantee = canonicalGrantee(row);
		if (grantee === null) continue;
		privileges.push(
			`GRANT ${row.privilege_type}(${row.nspname}.${row.relname}.${row.attname}) ON TABLE ` +
				`${row.nspname}.${row.relname} TO ${grantee}` +
				(row.is_grantable ? " WITH GRANT OPTION" : ""),
		);
	}

	const functionAcl = await query(
		client,
		`select n.nspname, p.proname,
		        pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
		        acl.privilege_type, acl.is_grantable,
		        pg_catalog.pg_get_userbyid(acl.grantee) as grantee_name, acl.grantee = 0 as is_public,
		        acl.grantee = (select oid from pg_catalog.pg_roles where rolname = current_user) as is_owner
		   from pg_catalog.pg_proc p
		   join pg_catalog.pg_namespace n on n.oid = p.pronamespace
		   cross join lateral pg_catalog.aclexplode(p.proacl) as acl
		  where n.nspname = any($1::text[])
		  order by n.nspname, p.proname, arguments, acl.privilege_type`,
		[AREAS],
	);
	for (const row of functionAcl) {
		const grantee = canonicalGrantee(row);
		if (grantee === null) continue;
		privileges.push(
			`GRANT ${row.privilege_type} ON FUNCTION ${row.nspname}.${row.proname}(${oneLine(
				row.arguments,
			)}) TO ${grantee}` + (row.is_grantable ? " WITH GRANT OPTION" : ""),
		);
	}

	const schemaAcl = await query(
		client,
		`select n.nspname, acl.privilege_type, acl.is_grantable,
		        pg_catalog.pg_get_userbyid(acl.grantee) as grantee_name, acl.grantee = 0 as is_public,
		        acl.grantee = (select oid from pg_catalog.pg_roles where rolname = current_user) as is_owner
		   from pg_catalog.pg_namespace n
		   cross join lateral pg_catalog.aclexplode(n.nspacl) as acl
		  where n.nspname = any($1::text[])
		  order by n.nspname, acl.privilege_type`,
		[AREAS],
	);
	for (const row of schemaAcl) {
		const grantee = canonicalGrantee(row);
		if (grantee === null) continue;
		privileges.push(
			`GRANT ${row.privilege_type} ON SCHEMA ${row.nspname} TO ${grantee}` +
				(row.is_grantable ? " WITH GRANT OPTION" : ""),
		);
	}

	// Default privileges: el grant a las tablas FUTURAS (`alter default privileges` de
	// 20261029101500). No aparece en la ACL de ninguna tabla existente, asi que sin esta
	// seccion borrarlo seria invisible para el drift guard.
	const defaultAcl = await query(
		client,
		`select n.nspname, d.defaclobjtype, acl.privilege_type, acl.is_grantable,
		        pg_catalog.pg_get_userbyid(acl.grantee) as grantee_name, acl.grantee = 0 as is_public,
		        acl.grantee = (select oid from pg_catalog.pg_roles where rolname = current_user) as is_owner
		   from pg_catalog.pg_default_acl d
		   join pg_catalog.pg_namespace n on n.oid = d.defaclnamespace
		   cross join lateral pg_catalog.aclexplode(d.defaclacl) as acl
		  where n.nspname = any($1::text[])
		  order by n.nspname, d.defaclobjtype, acl.privilege_type`,
		[AREAS],
	);
	const OBJECT_TYPE = { r: "TABLES", S: "SEQUENCES", f: "FUNCTIONS", T: "TYPES", n: "SCHEMAS" };
	for (const row of defaultAcl) {
		const grantee = canonicalGrantee(row);
		if (grantee === null) continue;
		privileges.push(
			`DEFAULT ACL IN SCHEMA ${row.nspname} FOR ${OBJECT_TYPE[row.defaclobjtype] ?? row.defaclobjtype} ` +
				`GRANT ${row.privilege_type} TO ${grantee}` +
				(row.is_grantable ? " WITH GRANT OPTION" : ""),
		);
	}

	// Event triggers: el shim de S13 provee `public.rls_auto_enable()` como stub. Si alguien
	// creara el event trigger real (como hace Supabase), tambien es un cambio de esquema.
	const eventTriggers = await query(
		client,
		`select e.evtname, e.evtevent, e.evtenabled,
		        pg_catalog.pg_get_function_identity_arguments(e.evtfoid) as arguments,
		        f.proname, n.nspname
		   from pg_catalog.pg_event_trigger e
		   join pg_catalog.pg_proc f on f.oid = e.evtfoid
		   join pg_catalog.pg_namespace n on n.oid = f.pronamespace
		  order by e.evtname`,
	);
	for (const row of eventTriggers) {
		privileges.push(
			`EVENT TRIGGER ${row.evtname} event=${row.evtevent} enabled=${row.evtenabled} ` +
				`function=${row.nspname}.${row.proname}(${oneLine(row.arguments)})`,
		);
	}

	sections.push(section("PRIVILEGES", privileges));

	return sections;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Diff de lineas por subsecuencia comun maxima (LCS), con hunks y numero de linea.
 *
 * Por que no basta recortar el prefijo/sufijo comun: si alguien agrega o borra UNA linea en el
 * medio, todas las siguientes se corren y un diff ingenuo las reporta como cambiadas (cientos
 * de lineas espurias). Un guard cuyo diff hay que descifrar termina ignorado. Esto muestra
 * solo las lineas que de verdad difieren, con contexto.
 */
function diffOps(expected, actual) {
	const n = expected.length;
	const m = actual.length;
	const width = m + 1;
	// lcs[i * width + j] = largo de la subsecuencia comun de expected[i..] y actual[j..].
	const lcs = new Int32Array((n + 1) * width);
	for (let i = n - 1; i >= 0; i -= 1) {
		for (let j = m - 1; j >= 0; j -= 1) {
			lcs[i * width + j] =
				expected[i] === actual[j]
					? lcs[(i + 1) * width + (j + 1)] + 1
					: Math.max(lcs[(i + 1) * width + j], lcs[i * width + (j + 1)]);
		}
	}

	const ops = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (expected[i] === actual[j]) {
			ops.push({ sign: " ", text: expected[i], a: i + 1, b: j + 1 });
			i += 1;
			j += 1;
		} else if (lcs[(i + 1) * width + j] >= lcs[i * width + (j + 1)]) {
			ops.push({ sign: "-", text: expected[i], a: i + 1, b: j + 1 });
			i += 1;
		} else {
			ops.push({ sign: "+", text: actual[j], a: i + 1, b: j + 1 });
			j += 1;
		}
	}
	while (i < n) {
		ops.push({ sign: "-", text: expected[i], a: i + 1, b: j + 1 });
		i += 1;
	}
	while (j < m) {
		ops.push({ sign: "+", text: actual[j], a: i + 1, b: j + 1 });
		j += 1;
	}
	return ops;
}

/** Diff unificado con 3 lineas de contexto, hunk por hunk. */
function renderDiff(expected, actual, { context = 3, maxLines = 120 } = {}) {
	const ops = diffOps(expected, actual);
	const changed = ops.filter((op) => op.sign !== " ").length;
	if (changed === 0) return "";

	// Agrupa los cambios que esten a menos de 2 * contexto lineas iguales uno del otro.
	const changedIndexes = ops.map((op, index) => (op.sign === " " ? -1 : index)).filter((i) => i >= 0);
	const ranges = [];
	for (const index of changedIndexes) {
		const start = Math.max(0, index - context);
		const end = Math.min(ops.length - 1, index + context);
		const last = ranges.at(-1);
		if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
		else ranges.push({ start, end });
	}

	const out = [`  snapshot vs base viva: ${changed} linea(s) de diferencia, ${ranges.length} bloque(s)`];
	let emitted = 0;
	let omitted = 0;
	for (const range of ranges) {
		const slice = ops.slice(range.start, range.end + 1);
		const first = slice[0];
		const aCount = slice.filter((op) => op.sign !== "+").length;
		const bCount = slice.filter((op) => op.sign !== "-").length;
		const header = `  @@ -${first.a},${aCount} +${first.b},${bCount} @@`;
		const lines = [header, ...slice.map((op) => `  ${op.sign} ${op.text}`)];
		if (emitted + lines.length > maxLines) {
			omitted += lines.length;
			continue;
		}
		emitted += lines.length;
		out.push(...lines);
	}
	if (omitted > 0) {
		out.push(`  ... ${omitted} linea(s) de diff omitidas (corre db:dump para ver el dump completo)`);
	}
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const checkMode = process.argv.includes("--check");
const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
	console.error(
		"db:dump: falta DATABASE_URL. Este script compara una base real; no inventa una conexion.",
	);
	process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

let live;
try {
	// Fijo el search_path ANTES de cualquier `pg_get_*`: con `public` fuera del path, los
	// nombres salen siempre calificados con su esquema, iguales en cualquier maquina.
	await client.query("set search_path = pg_catalog");
	live = render(await collect(client));
} finally {
	await client.end();
}

if (!checkMode) {
	process.stdout.write(live);
	process.exit(0);
}

const snapshot = readFileSync(snapshotPath, "utf8").replace(/\r\n/g, "\n");
const liveLines = live.split("\n");
const snapshotLines = snapshot.split("\n");

if (liveLines.length === snapshotLines.length && live === snapshot) {
	console.log(`db:dump: el esquema coincide con ${snapshotPath} (${liveLines.length} lineas).`);
	process.exit(0);
}

console.error(`db:dump: el esquema de la base NO coincide con ${snapshotPath}.`);
console.error(renderDiff(snapshotLines, liveLines));
console.error(
	"db:dump: si el cambio es intencional, viene de una migracion y el snapshot se regenera con:\n" +
		"  node packages/db/scripts/dump-schema.mjs > packages/db/scripts/schema-snapshot.sql\n" +
		"Si el cambio se hizo a mano en la base, falta la migracion que lo expresa.",
);

process.exit(1);
