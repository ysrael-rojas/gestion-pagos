import type { ReactNode } from "react";
import Script from "next/script";
import { DashboardLayout } from "@adminlte/react";
import { menuItems } from "@/lib/menu";
import "@adminlte/react/css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "../adminlte-theme.css";

export default function DashboardRouteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <DashboardLayout
        menuItems={menuItems}
        logo={<span>Gestión de Pagos</span>}
        user={{ name: "", image: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" }}
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
