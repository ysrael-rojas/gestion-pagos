"use server";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import { esRolUsuario } from "@/lib/auth/permisos";
import { requerirPermiso } from "@/lib/auth/sesion";
import type { Database, Tables } from "@/lib/database.types";
import { crearClienteAdmin } from "@/lib/supabase/server";
import {
  MENSAJE_CORREO_DUPLICADO,
  MENSAJE_DESACTIVAR_PROPIO,
  MENSAJE_ROL_PROPIO,
  MENSAJE_ULTIMO_ADMIN,
  esUltimoAdminActivo,
  normalizarCampos,
  puedeCambiarEstado,
  puedeCambiarRol,
  validarAlta,
  validarEdicion,
  type DatosAltaUsuario,
  type DatosEdicionUsuario,
  type PerfilGuardable,
  type Resultado,
  type Usuario,
} from "@/lib/usuarios/dominio";

type ClienteAdmin = SupabaseClient<Database>;
type FilaPerfil = Tables<"users">;

const ERROR_GENERAL = "No se pudo completar la operación.";
const USUARIOS_POR_PAGINA = 1000;

function aUsuario(
  perfil: FilaPerfil,
  auth: Pick<User, "email" | "last_sign_in_at">,
): Usuario | null {
  if (!esRolUsuario(perfil.role)) {
    return null;
  }

  return {
    id: perfil.id,
    nombre: perfil.name,
    correo: auth.email ?? "",
    rol: perfil.role,
    activo: perfil.active,
    ultimoAcceso: auth.last_sign_in_at ?? null,
    creadoEn: perfil.created_at,
  };
}

function aPerfilGuardable(perfil: FilaPerfil): PerfilGuardable {
  return { id: perfil.id, rol: perfil.role, activo: perfil.active };
}

function esCorreoDuplicado(error: { code?: string; message: string }): boolean {
  return (
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already (been )?registered|already exists/i.test(error.message)
  );
}

/**
 * Recorre `listUsers` por páginas hasta agotarlas. Se apoya en `nextPage` y,
 * además, en el tamaño de la página, para no truncar el listado en silencio si
 * el servidor limita el `perPage` solicitado.
 */
async function listarUsuariosAuth(admin: ClienteAdmin): Promise<Map<string, User>> {
  const porId = new Map<string, User>();
  let pagina = 1;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({
      page: pagina,
      perPage: USUARIOS_POR_PAGINA,
    });

    if (error) {
      console.error("Error al listar los Usuarios de Auth:", error);
      throw new Error("No se pudieron cargar los Usuarios.");
    }

    data.users.forEach((usuario) => porId.set(usuario.id, usuario));

    if (data.users.length < USUARIOS_POR_PAGINA || !data.nextPage) {
      break;
    }

    pagina = data.nextPage;
  }

  return porId;
}

async function obtenerPerfil(admin: ClienteAdmin, id: string): Promise<FilaPerfil | null> {
  const { data, error } = await admin
    .from("users")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("Error al cargar el perfil del Usuario:", error);
    return null;
  }

  return data;
}

async function contarAdminsActivos(admin: ClienteAdmin): Promise<number> {
  const { count, error } = await admin
    .from("users")
    .select("id", { count: "exact", head: true })
    .eq("role", "administrador")
    .eq("active", true);

  if (error) {
    console.error("Error al contar los administradores activos:", error);
    throw new Error("No se pudo comprobar el número de administradores activos.");
  }

  return count ?? 0;
}

/** Une el perfil con su Usuario de Auth para completar correo y último acceso. */
async function completarConAuth(
  admin: ClienteAdmin,
  perfil: FilaPerfil,
): Promise<Resultado<Usuario>> {
  const { data, error } = await admin.auth.admin.getUserById(perfil.id);

  if (error) {
    console.error("Error al cargar el Usuario de Auth:", error);
    return { ok: false, errores: { general: ERROR_GENERAL } };
  }

  const usuario = aUsuario(perfil, data.user);

  return usuario
    ? { ok: true, valor: usuario }
    : { ok: false, errores: { general: ERROR_GENERAL } };
}

export async function listarUsuarios(): Promise<Usuario[]> {
  await requerirPermiso("gestionar_usuarios");

  const admin = crearClienteAdmin();
  const [{ data: perfiles, error }, authPorId] = await Promise.all([
    admin.from("users").select("*").order("name", { ascending: true }),
    listarUsuariosAuth(admin),
  ]);

  if (error) {
    console.error("Error al listar los Usuarios:", error);
    throw new Error("No se pudieron cargar los Usuarios.");
  }

  return perfiles.flatMap((perfil) => {
    const usuario = aUsuario(perfil, authPorId.get(perfil.id) ?? {});
    return usuario ? [usuario] : [];
  });
}

export async function crearUsuario(
  datos: DatosAltaUsuario,
): Promise<Resultado<Usuario>> {
  await requerirPermiso("gestionar_usuarios");

  const normalizado = normalizarCampos(datos);
  const errores = validarAlta(normalizado);
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const admin = crearClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({
    email: normalizado.correo,
    password: normalizado.contrasena,
    email_confirm: true,
    app_metadata: { name: normalizado.nombre },
  });

  if (error) {
    if (esCorreoDuplicado(error)) {
      return { ok: false, errores: { correo: MENSAJE_CORREO_DUPLICADO } };
    }

    console.error("Error al crear el Usuario en Auth:", error);
    return { ok: false, errores: { general: ERROR_GENERAL } };
  }

  const { data: perfil, error: errorPerfil } = await admin
    .from("users")
    .update({ name: normalizado.nombre, role: normalizado.rol, active: true })
    .eq("id", data.user.id)
    .select()
    .single();

  if (errorPerfil) {
    console.error("Error al activar el perfil del Usuario nuevo:", errorPerfil);
    return { ok: false, errores: { general: ERROR_GENERAL } };
  }

  const usuario = aUsuario(perfil, data.user);

  return usuario
    ? { ok: true, valor: usuario }
    : { ok: false, errores: { general: ERROR_GENERAL } };
}

export async function actualizarUsuario(
  id: string,
  datos: DatosEdicionUsuario,
): Promise<Resultado<Usuario>> {
  const actor = await requerirPermiso("gestionar_usuarios");

  const normalizado = normalizarCampos(datos);
  const errores = validarEdicion(normalizado);
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const admin = crearClienteAdmin();
  const objetivo = await obtenerPerfil(admin, id);
  if (!objetivo || !esRolUsuario(objetivo.role)) {
    return { ok: false, errores: { general: ERROR_GENERAL } };
  }

  const cambiaRol = objetivo.role !== normalizado.rol;

  if (cambiaRol && !puedeCambiarRol(actor, objetivo)) {
    return { ok: false, errores: { rol: MENSAJE_ROL_PROPIO } };
  }

  if (cambiaRol && normalizado.rol !== "administrador") {
    const adminsActivos = await contarAdminsActivos(admin);
    if (esUltimoAdminActivo(aPerfilGuardable(objetivo), adminsActivos)) {
      return { ok: false, errores: { rol: MENSAJE_ULTIMO_ADMIN } };
    }
  }

  const { data: perfil, error } = await admin
    .from("users")
    .update({ name: normalizado.nombre, role: normalizado.rol })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error al actualizar el Usuario:", error);
    return { ok: false, errores: { general: ERROR_GENERAL } };
  }

  return completarConAuth(admin, perfil);
}

export async function cambiarActivoUsuario(
  id: string,
  activo: boolean,
): Promise<Resultado<Usuario>> {
  const actor = await requerirPermiso("gestionar_usuarios");

  const admin = crearClienteAdmin();
  const objetivo = await obtenerPerfil(admin, id);
  if (!objetivo || !esRolUsuario(objetivo.role)) {
    return { ok: false, errores: { general: ERROR_GENERAL } };
  }

  if (actor.id === objetivo.id) {
    return { ok: false, errores: { general: MENSAJE_DESACTIVAR_PROPIO } };
  }

  // Activar nunca reduce el número de administradores activos; solo desactivar
  // puede dejar el sistema sin ninguno.
  if (!activo) {
    const adminsActivos = await contarAdminsActivos(admin);
    if (!puedeCambiarEstado(actor, aPerfilGuardable(objetivo), adminsActivos)) {
      return { ok: false, errores: { general: MENSAJE_ULTIMO_ADMIN } };
    }
  }

  const { data: perfil, error } = await admin
    .from("users")
    .update({ active: activo })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("Error al cambiar el estado del Usuario:", error);
    return { ok: false, errores: { general: ERROR_GENERAL } };
  }

  return completarConAuth(admin, perfil);
}
