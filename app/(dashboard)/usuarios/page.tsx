import type { Metadata } from "next";
import { AppContent } from "@adminlte/react";
import { requerirPermiso } from "@/lib/auth/sesion";

export const metadata: Metadata = {
  title: "Usuarios",
};

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  await requerirPermiso("gestionar_usuarios");

  return (
    <AppContent
      title="Usuarios"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Usuarios" }]}
    >
      <p>La administración de Usuarios llega en SPEC 06.</p>
    </AppContent>
  );
}
