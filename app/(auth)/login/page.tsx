import type { Metadata } from "next";

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
        <form className="login-form">
          <div className="login-form-header">
            <h1 className="login-form-title">Iniciar sesión</h1>
            <p className="login-form-subtitle">Ingresa para gestionar tus pagos.</p>
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="email">
              EMAIL
            </label>
            <input
              className="login-input"
              id="email"
              type="email"
              autoComplete="email"
              placeholder="tu@empresa.com"
            />
          </div>

          <div className="login-field">
            <label className="login-label" htmlFor="password">
              CONTRASEÑA
            </label>
            <input
              className="login-input"
              id="password"
              type="password"
              autoComplete="current-password"
            />
          </div>

          <a className="login-link" href="#">
            ¿Olvidaste tu contraseña?
          </a>

          <button className="login-button" type="button">
            Iniciar sesión
          </button>

          <p className="login-footer">
            ¿Te invitó la empresa?{" "}
            <a className="login-link" href="#">
              Activa tu cuenta
            </a>
          </p>
        </form>
      </section>
    </main>
  );
}
