import type { MenuGroup, MenuHeader, MenuItem, MenuNode } from "@adminlte/react";

import {
  tienePermiso,
  type Permiso,
  type RolUsuario,
} from "@/lib/auth/permisos";

/** Ítem de menú con el permiso que lo habilita. */
type ItemMenu = MenuItem & { permiso: Permiso };

/** Grupo cuyos hijos también declaran permiso. */
type GrupoMenu = Omit<MenuGroup, "children"> & { children: NodoMenu[] };

type NodoMenu = MenuHeader | ItemMenu | GrupoMenu;

const menuItems: NodoMenu[] = [
  {
    type: "item",
    text: "Dashboard",
    href: "/",
    icon: "bi-speedometer2",
    permiso: "ver_dashboard",
  },
  {
    type: "header",
    text: "GESTIÓN",
  },
  {
    type: "group",
    text: "MAESTRO",
    icon: "bi-database",
    children: [
      {
        type: "item",
        text: "CLIENTES Y PROVEEDORES",
        href: "/terceros",
        icon: "bi-people",
        permiso: "gestionar_terceros",
      },
    ],
  },
  // Placeholders de sección para specs futuras: sin ruta real aún.
  {
    type: "item",
    text: "Facturas",
    href: "#",
    icon: "bi-receipt",
    permiso: "ver_dashboard",
  },
  {
    type: "item",
    text: "Conciliación",
    href: "#",
    icon: "bi-arrow-left-right",
    permiso: "ver_dashboard",
  },
  {
    type: "group",
    text: "ADMINISTRACIÓN",
    icon: "bi-shield-lock",
    children: [
      {
        type: "item",
        text: "USUARIOS",
        href: "/usuarios",
        icon: "bi-person-badge",
        permiso: "gestionar_usuarios",
      },
    ],
  },
];

function filtrarPorPermiso(rol: RolUsuario, nodos: NodoMenu[]): NodoMenu[] {
  const permitidos: NodoMenu[] = [];

  for (const nodo of nodos) {
    if (nodo.type === "item") {
      if (tienePermiso(rol, nodo.permiso)) {
        permitidos.push(nodo);
      }
      continue;
    }

    if (nodo.type === "group") {
      const children = filtrarPorPermiso(rol, nodo.children);

      if (children.length > 0) {
        permitidos.push({ ...nodo, children });
      }
      continue;
    }

    permitidos.push(nodo);
  }

  return permitidos;
}

/** Menú lateral del rol, sin los ítems ni los grupos que no le corresponden. */
export function construirMenu(rol: RolUsuario): MenuNode[] {
  return filtrarPorPermiso(rol, menuItems);
}
