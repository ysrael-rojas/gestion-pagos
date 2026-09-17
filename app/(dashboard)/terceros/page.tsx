import type { Metadata } from "next";
import { AppContent } from "@adminlte/react";
import { TercerosLista } from "@/components/terceros/terceros-lista";
import { listarTerceros } from "@/lib/terceros/acciones";

export const metadata: Metadata = {
  title: "Clientes y Proveedores",
};

export const dynamic = "force-dynamic";

export default async function TercerosPage() {
  const terceros = await listarTerceros();

  return (
    <AppContent
      title="Clientes y Proveedores"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Clientes y Proveedores" }]}
    >
      <TercerosLista iniciales={terceros} />
    </AppContent>
  );
}
