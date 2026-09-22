/**
 * RBAC cerrado del sistema. Fuente única de roles, permisos y su relación.
 *
 * Los permisos no viven en la base de datos: se derivan del rol en código.
 * Un Usuario tiene exactamente un rol (ADR-0006).
 */

export const ROLES_USUARIO = ["administrador", "operador"] as const;

export type RolUsuario = (typeof ROLES_USUARIO)[number];

export const PERMISOS = [
  "ver_dashboard",
  "gestionar_terceros",
  "gestionar_usuarios",
  "gestionar_compras",
] as const;

export type Permiso = (typeof PERMISOS)[number];

export const ETIQUETAS_ROL: Record<RolUsuario, string> = {
  administrador: "Administrador",
  operador: "Operador",
};

export const PERMISOS_POR_ROL: Record<RolUsuario, readonly Permiso[]> = {
  administrador: [
    "ver_dashboard",
    "gestionar_terceros",
    "gestionar_usuarios",
    "gestionar_compras",
  ],
  operador: ["ver_dashboard", "gestionar_terceros", "gestionar_compras"],
};

export function tienePermiso(rol: RolUsuario, permiso: Permiso): boolean {
  return PERMISOS_POR_ROL[rol].includes(permiso);
}

export function esRolUsuario(valor: unknown): valor is RolUsuario {
  return ROLES_USUARIO.some((rol) => rol === valor);
}
