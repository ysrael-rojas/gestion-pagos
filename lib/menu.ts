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
      },
    ],
  },
  // Placeholders de sección para specs futuras: sin ruta real aún.
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
