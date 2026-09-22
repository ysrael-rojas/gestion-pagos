import type { Metadata } from "next";
import { AppContent } from "@adminlte/react";
import { TiposComprobanteLista } from "@/components/tipos-comprobante/tipos-comprobante-lista";
import { requerirPermiso } from "@/lib/auth/sesion";

export const metadata: Metadata = {
  title: "Tipos de comprobante",
};

export const dynamic = "force-dynamic";

export default async function TiposComprobantePage() {
  await requerirPermiso("gestionar_compras");

  return (
    <AppContent
      title="Tipos de comprobante"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Tipos de comprobante" }]}
    >
      <TiposComprobanteLista />
    </AppContent>
  );
}
