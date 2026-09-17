"use server";

import { redirect } from "next/navigation";

import { crearClienteSesion } from "@/lib/supabase/server";

export type EstadoInicioSesion = {
  error: string | null;
};

/**
 * Mensaje único para cualquier fallo de credenciales. Propagar el error de
 * Supabase revelaría si un correo existe.
 */
const MENSAJE_CREDENCIALES = "Correo o contraseña incorrectos.";

export async function iniciarSesion(
  _estadoPrevio: EstadoInicioSesion,
  formData: FormData,
): Promise<EstadoInicioSesion> {
  const correo = String(formData.get("email") ?? "").trim();
  const contrasena = String(formData.get("password") ?? "");

  if (!correo || !contrasena) {
    return { error: MENSAJE_CREDENCIALES };
  }

  const supabase = await crearClienteSesion();
  const { error } = await supabase.auth.signInWithPassword({
    email: correo,
    password: contrasena,
  });

  if (error) {
    return { error: MENSAJE_CREDENCIALES };
  }

  // Fuera de cualquier try/catch: redirect lanza una excepción de control.
  redirect("/");
}
