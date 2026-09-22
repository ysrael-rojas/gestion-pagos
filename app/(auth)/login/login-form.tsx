"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { iniciarSesion, type EstadoInicioSesion } from "./actions";

const ESTADO_INICIAL: EstadoInicioSesion = { error: null };

function BotonIniciarSesion() {
  const { pending } = useFormStatus();

  return (
    <button className="login-button" type="submit" disabled={pending}>
      {pending ? "Iniciando sesión…" : "Iniciar sesión"}
    </button>
  );
}

export function LoginForm() {
  const [estado, accion] = useActionState(iniciarSesion, ESTADO_INICIAL);

  return (
    <form className="login-form" action={accion}>
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
          name="email"
          type="email"
          autoComplete="email"
          placeholder="tu@empresa.com"
          required
        />
      </div>

      <div className="login-field">
        <label className="login-label" htmlFor="password">
          CONTRASEÑA
        </label>
        <input
          className="login-input"
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>

      {estado.error ? (
        <p className="login-error" role="alert">
          {estado.error}
        </p>
      ) : null}

      <a className="login-link" href="#">
        ¿Olvidaste tu contraseña?
      </a>

      <BotonIniciarSesion />

      <p className="login-footer">
        ¿Te invitó la empresa?{" "}
        <a className="login-link" href="#">
          Activa tu cuenta
        </a>
      </p>
    </form>
  );
}
