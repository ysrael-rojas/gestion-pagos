import "server-only";

import type { JwtPayload } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import {
  esRolUsuario,
  tienePermiso,
  type Permiso,
  type RolUsuario,
} from "@/lib/auth/permisos";
import { crearClienteAdmin, crearClienteSesion } from "@/lib/supabase/server";

export type UsuarioSesion = {
  id: string;
  correo: string;
  nombre: string;
  rol: RolUsuario;
};

/**
 * El `sub` y el `email` del JWT no se dan por sentados: se comprueban en
 * tiempo de ejecución y se estrecha el tipo sin recurrir a `as`.
 */
function leerIdDeClaims(claims: JwtPayload): string | null {
  const id = claims.sub;

  return typeof id === "string" && id.length > 0 ? id : null;
}

function leerCorreoDeClaims(claims: JwtPayload): string {
  return typeof claims.email === "string" ? claims.email : "";
}

/**
 * Identidad del Usuario en la sesión actual, o `null` si no hay sesión, si no
 * hay perfil o si el perfil está inactivo. Valida el JWT con `getClaims()` y
 * carga el perfil con el cliente administrativo.
 */
export const obtenerUsuarioActual = cache(
  async (): Promise<UsuarioSesion | null> => {
    const supabase = await crearClienteSesion();
    const { data, error } = await supabase.auth.getClaims();

    if (error || !data) {
      return null;
    }

    const id = leerIdDeClaims(data.claims);
    if (!id) {
      return null;
    }

    const admin = crearClienteAdmin();
    const { data: perfil, error: errorPerfil } = await admin
      .from("users")
      .select("id, name, role, active")
      .eq("id", id)
      .maybeSingle();

    if (errorPerfil || !perfil || !perfil.active || !esRolUsuario(perfil.role)) {
      return null;
    }

    return {
      id: perfil.id,
      correo: leerCorreoDeClaims(data.claims),
      nombre: perfil.name,
      rol: perfil.role,
    };
  },
);

/** Exige sesión. Redirige a `/login` si no la hay. */
export async function requerirUsuario(): Promise<UsuarioSesion> {
  const usuario = await obtenerUsuarioActual();

  if (!usuario) {
    redirect("/login");
  }

  return usuario;
}

/** Exige sesión y permiso. Redirige a `/sin-permiso` si el rol no lo tiene. */
export async function requerirPermiso(
  permiso: Permiso,
): Promise<UsuarioSesion> {
  const usuario = await requerirUsuario();

  if (!tienePermiso(usuario.rol, permiso)) {
    redirect("/sin-permiso");
  }

  return usuario;
}
