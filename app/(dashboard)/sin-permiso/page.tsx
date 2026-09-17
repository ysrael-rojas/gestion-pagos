import type { Metadata } from "next";
import Link from "next/link";
import { AppContent } from "@adminlte/react";

export const metadata: Metadata = {
  title: "Sin permiso",
};

export default function SinPermisoPage() {
  return (
    <AppContent
      title="Sin permiso"
      breadcrumbs={[{ label: "Home", href: "/" }, { label: "Sin permiso" }]}
    >
      <p>No tienes permiso para ver esta sección.</p>
      <Link className="text-decoration-underline" href="/">
        Volver al inicio
      </Link>
    </AppContent>
  );
}
