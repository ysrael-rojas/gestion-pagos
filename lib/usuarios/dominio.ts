import { esRolUsuario, type RolUsuario } from "@/lib/auth/permisos";

export interface Usuario {
  id: string;
  nombre: string;
  correo: string;
  rol: RolUsuario;
  activo: boolean;
  ultimoAcceso: string | null;
  creadoEn: string;
}

export type CampoValidable = "correo" | "nombre" | "rol" | "contrasena";

export type CampoError = CampoValidable | "general";

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; errores: Partial<Record<CampoError, string>> };

export interface DatosAltaUsuario {
  correo: string;
  nombre: string;
  rol: RolUsuario;
  contrasena: string;
}

export interface DatosEdicionUsuario {
  nombre: string;
  rol: RolUsuario;
}

export const MENSAJE_CORREO_DUPLICADO = "Ya existe un Usuario con ese correo.";

export const MENSAJE_ROL_PROPIO = "No puedes cambiar tu propio rol";

export const MENSAJE_DESACTIVAR_PROPIO = "No puedes desactivar tu propia cuenta";

export const MENSAJE_ULTIMO_ADMIN = "Debe quedar al menos un administrador activo";

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizarCampos(datos: DatosAltaUsuario): DatosAltaUsuario;
export function normalizarCampos(datos: DatosEdicionUsuario): DatosEdicionUsuario;
export function normalizarCampos(
  datos: DatosAltaUsuario | DatosEdicionUsuario,
): DatosAltaUsuario | DatosEdicionUsuario {
  const nombre = datos.nombre.trim();

  if ("correo" in datos) {
    return { ...datos, nombre, correo: datos.correo.trim().toLowerCase() };
  }

  return { ...datos, nombre };
}

export function validarAlta(
  datos: DatosAltaUsuario,
): Partial<Record<CampoError, string>> {
  const errores: Partial<Record<CampoError, string>> = {};

  if (!CORREO_RE.test(datos.correo)) {
    errores.correo = "Introduce un correo válido.";
  }

  if (datos.nombre.length < 2) {
    errores.nombre = "El nombre debe tener al menos 2 caracteres.";
  }

  if (!esRolUsuario(datos.rol)) {
    errores.rol = "Selecciona un rol válido.";
  }

  if (datos.contrasena.length < 8) {
    errores.contrasena = "La contraseña debe tener al menos 8 caracteres.";
  }

  return errores;
}

export function validarEdicion(
  datos: DatosEdicionUsuario,
): Partial<Record<CampoError, string>> {
  const errores: Partial<Record<CampoError, string>> = {};

  if (datos.nombre.length < 2) {
    errores.nombre = "El nombre debe tener al menos 2 caracteres.";
  }

  if (!esRolUsuario(datos.rol)) {
    errores.rol = "Selecciona un rol válido.";
  }

  return errores;
}

export type PerfilGuardable = Pick<Usuario, "id" | "rol" | "activo">;

export function esUltimoAdminActivo(
  objetivo: Pick<Usuario, "rol" | "activo">,
  adminsActivos: number,
): boolean {
  return objetivo.rol === "administrador" && objetivo.activo && adminsActivos === 1;
}

export function puedeCambiarRol(
  actor: Pick<Usuario, "id">,
  objetivo: Pick<Usuario, "id">,
): boolean {
  return actor.id !== objetivo.id;
}

export function puedeCambiarEstado(
  actor: Pick<Usuario, "id">,
  objetivo: PerfilGuardable,
  adminsActivos: number,
): boolean {
  if (actor.id === objetivo.id) {
    return false;
  }

  return !esUltimoAdminActivo(objetivo, adminsActivos);
}
