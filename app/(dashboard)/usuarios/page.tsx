import type { Metadata } from "next";
import { AppContent } from "@adminlte/react";
import { UsuariosLista } from "@/components/usuarios/usuarios-lista";
import { requerirPermiso } from "@/lib/auth/sesion";
import { listarUsuarios } from "@/lib/usuarios/acciones";

export const metadata: Metadata = {
  title: "Usuarios",
};

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const usuario = await requerirPermiso("gestionar_usuarios");
  const usuarios = await listarUsuarios();

  return (
    <AppContent
      title="Usuarios"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Usuarios" }]}
    >
      <UsuariosLista iniciales={usuarios} actorId={usuario.id} />
    </AppContent>
  );
}
