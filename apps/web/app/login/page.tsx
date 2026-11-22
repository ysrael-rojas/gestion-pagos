import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthForm } from "@/components/auth/auth-form";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Iniciar sesión",
};

/**
 * Portado de `app/login/page.tsx` del origen.
 *
 * Se agrega el redirect de sesion ya iniciada, que en el origen vivia en `proxy.ts` (middleware)
 * junto con el refresco de token de Supabase. Better Auth no necesita refresco de token en un
 * middleware, y `proxy.ts` no existe en este paquete, asi que la unica comprobacion queda acá:
 * entrar a `/login` con sesion lleva al inicio en vez de mostrar el formulario.
 */
export default async function LoginPage() {
  const user = await getSessionUser();

  if (user) {
    redirect("/");
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-pastel-cream/40 p-6">
      <div className="text-center">
        <h1 className="font-heading text-2xl font-semibold">Gestión</h1>
        <p className="text-sm text-muted-foreground">Ventas, compras, pagos y cajas</p>
      </div>
      <AuthForm />
    </main>
  );
}
