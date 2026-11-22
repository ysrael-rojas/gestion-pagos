import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppNavbar } from "@/components/app-navbar";
import { CajasBancosProvider } from "@/components/cajas-bancos/cajas-bancos-provider";
import { ClientesProvider } from "@/components/clientes/clientes-provider";
import { PagosProvider } from "@/components/pagos/pagos-provider";
import { getSessionUser } from "@/lib/auth/session";

/**
 * Layout del grupo `(app)`: todo lo que cuelga de aca exige sesion y se dibuja dentro del shell.
 *
 * Portado de `app/(app)/layout.tsx` del origen con estas diferencias, todas por el stack:
 *
 * - La sesion la resuelve `lib/auth/session.ts` contra el handler de Better Auth de `apps/api`
 *   (antes: `supabase.auth.getUser()`). La comprobacion es de servidor, asi que un usuario sin
 *   sesion no llega a ver el shell: el redirect ocurre antes de renderizar una sola pieza.
 * - Los providers son los que existen hoy: `ClientesProvider`, `CajasBancosProvider` (lectura de
 *   `entidad` y `cash_account`, que alimentan los selectores de pagos) y `PagosProvider`. Los de
 *   `ventas` y `compras` del origen NO estan: son verticales de T5c y `apps/api` todavia no
 *   expone sus rutas. Ver `components/pagos/pagos-provider.tsx`, donde se explica por que su
 *   `refresh` no se llama.
 * - El usuario de la sesion baja al navbar (para mostrar el correo junto a "Cerrar sesión").
 */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <ClientesProvider>
      <CajasBancosProvider>
        <PagosProvider>
          <div className="flex min-h-svh flex-col">
            <AppNavbar user={user} />
            <main className="flex-1">{children}</main>
          </div>
        </PagosProvider>
      </CajasBancosProvider>
    </ClientesProvider>
  );
}
