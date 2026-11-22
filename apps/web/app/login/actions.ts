"use server";

// Server Actions de la sesion. Portado de `app/login/actions.ts` del origen, con un cambio de
// fondo: donde el origen hablaba con Supabase Auth, esto habla con el handler de Better Auth de
// `apps/api` a traves de `lib/auth/session.ts`.
//
// Sigue siendo una Server Action y no un fetch del navegador porque `apps/api` no habilita CORS
// y porque la cookie de sesion es `HttpOnly`: el navegador nunca ve ni envía el token, lo hace el
// servidor de Next.
import { loginSchema } from "@gestion/shared";
import { redirect } from "next/navigation";
import { signInWithEmail, signOutSession } from "@/lib/auth/session";

/** Estado del formulario. `error` es texto ya listo para mostrar. */
export interface AuthFormState {
  error: string | null;
}

/**
 * Inicia sesion y redirige al inicio.
 *
 * El mensaje de error es el del API: si Better Auth responde `401 Invalid email or password` se
 * muestra eso, no un "algo salio mal" que deje al usuario sin saber si el problema es su clave,
 * el servidor o el origen no confiable (`403 Invalid origin`).
 */
export async function signIn(_previousState: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = formData.get("email");
  const password = formData.get("password");

  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Completa todos los campos" };
  }

  // El schema es el mismo contrato de `@gestion/shared` que usa el borde de apps/api (S8): la
  // validacion no vive duplicada en la pantalla.
  const parsed = loginSchema.safeParse({ email, password });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Los datos enviados no son válidos" };
  }

  const result = await signInWithEmail(parsed.data.email, parsed.data.password);

  if (result.error) {
    return { error: result.error };
  }

  redirect("/");
}

/** Cierra la sesion y vuelve al login. */
export async function signOut(): Promise<void> {
  await signOutSession();

  redirect("/login");
}
