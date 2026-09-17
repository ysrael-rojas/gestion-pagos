import type { Metadata } from "next";
import { AppContent } from "@adminlte/react";
import { TercerosLista } from "@/components/terceros/terceros-lista";

export const metadata: Metadata = {
  title: "Clientes y Proveedores",
};

export default function TercerosPage() {
  return (
    <AppContent
      title="Clientes y Proveedores"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Clientes y Proveedores" }]}
    >
      <TercerosLista />
    </AppContent>
  );
}
