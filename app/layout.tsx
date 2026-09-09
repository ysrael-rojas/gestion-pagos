import type { Metadata } from "next";
import type { ReactNode } from "react";
import Script from "next/script";
import { Geist, Geist_Mono } from "next/font/google";
import { DashboardLayout } from "@adminlte/react";
import { menuItems } from "@/lib/menu";
import "@adminlte/react/css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./globals.css";
import "./adminlte-theme.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Gestión de Pagos",
    template: "%s · Gestión de Pagos",
  },
  description: "Dashboard de gestión de pagos",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="es"
      data-bs-theme="light"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body>
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
      </body>
      <Script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.8/dist/js/bootstrap.bundle.min.js" />
    </html>
  );
}
