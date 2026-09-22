import type { ReactNode } from "react";
import Script from "next/script";
import { DashboardLayout } from "@adminlte/react";
import { cerrarSesion } from "@/lib/auth/acciones";
import { ETIQUETAS_ROL } from "@/lib/auth/permisos";
import { requerirUsuario } from "@/lib/auth/sesion";
import { construirMenu } from "@/lib/menu";
import "@adminlte/react/css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "../adminlte-theme.css";

// Imagen transparente: el Usuario aún no tiene avatar propio.
const IMAGEN_TRANSPARENTE =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export default async function DashboardRouteLayout({
  children,
}: {
  children: ReactNode;
}) {
  const usuario = await requerirUsuario();

  return (
    <>
      <DashboardLayout
        menuItems={construirMenu(usuario.rol)}
        logo={<span>Gestión de Pagos</span>}
        user={{
          name: usuario.nombre,
          role: ETIQUETAS_ROL[usuario.rol],
          image: IMAGEN_TRANSPARENTE,
        }}
        topbarEnd={
          <form action={cerrarSesion}>
            <button className="btn btn-outline-secondary" type="submit">
              Cerrar sesión
            </button>
          </form>
        }
        fixedHeader
        fixedSidebar
        colorModeToggle={false}
        initialColorMode="light"
      >
        {children}
      </DashboardLayout>
      <Script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" />
    </>
  );
}
