import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppNavbar } from "@/components/app-navbar";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Layout del grupo `(app)`: todo lo que cuelga de aca exige sesion y se dibuja dentro del shell.
 *
 * Portado de `app/(app)/layout.tsx` del origen con tres diferencias, todas por el stack:
 *
 * - La sesion la resuelve `lib/auth/session.ts` contra el handler de Better Auth de `apps/api`
 *   (antes: `supabase.auth.getUser()`). La comprobacion es de servidor, asi que un usuario sin
 *   sesion no llega a ver el shell: el redirect ocurre antes de renderizar una sola pieza.
 * - No se envuelve en los providers de dominio (`PagosProvider`, `ClientesProvider`, ...) del
 *   origen: son parte de los verticales, que no se portan en esta tarea.
 * - El usuario de la sesion baja al navbar (para mostrar el correo junto a "Cerrar sesión").
 */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-svh flex-col">
      <AppNavbar user={user} />
      <main className="flex-1">{children}</main>
    </div>
  );
}
