import type { Metadata } from "next";
import "./login.css";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

export default function LoginPage() {
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
