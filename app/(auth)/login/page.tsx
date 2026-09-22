import type { Metadata } from "next";
import { redirect } from "next/navigation";
import "./login.css";
import { LoginForm } from "./login-form";
import { obtenerUsuarioActual } from "@/lib/auth/sesion";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default async function LoginPage() {
  // Solo un Usuario con perfil y `active = true` cuenta como sesión: el JWT
  // vigente no basta. La decisión vive aquí, con la DAL, y no en el proxy.
  const usuario = await obtenerUsuarioActual();

  if (usuario) {
    redirect("/");
  }

  return (
    <main className="login">
      <section className="login-brand">
        <h1 className="login-brand-title">ERP GESTION COMERCIAL</h1>
        <p className="login-brand-subtitle">Software para control del pagos</p>
      </section>

      <section className="login-form-panel">
        <LoginForm />
      </section>
    </main>
  );
}
