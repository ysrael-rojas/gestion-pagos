import type { MenuNode } from "@adminlte/react";

export const menuItems: MenuNode[] = [
  {
    type: "item",
    text: "Dashboard",
    href: "/",
    icon: "bi-speedometer2",
  },
  {
    type: "header",
    text: "GESTIÓN",
  },
  // Placeholders de sección para specs futuras: sin ruta real aún.
  {
    type: "item",
    text: "Clientes",
    href: "#",
    icon: "bi-people",
  },
  {
    type: "item",
    text: "Facturas",
    href: "#",
    icon: "bi-receipt",
  },
  {
    type: "item",
    text: "Conciliación",
    href: "#",
    icon: "bi-arrow-left-right",
  },
];
