import type { Metadata } from "next";
import { AppContent } from "@adminlte/react";
import { ComprobantesLista } from "@/components/comprobantes/comprobantes-lista";
import { requerirPermiso } from "@/lib/auth/sesion";

export const metadata: Metadata = {
  title: "Comprobantes de compra",
};

export const dynamic = "force-dynamic";

export default async function ComprobantesPage() {
  await requerirPermiso("gestionar_compras");

  return (
    <AppContent
      title="Comprobantes de compra"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Comprobantes de compra" }]}
    >
      <ComprobantesLista />
    </AppContent>
  );
}
