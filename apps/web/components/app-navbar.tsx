"use client";

// Portado de `components/app-navbar.tsx` del origen. Es el marco que van a habitar todos los
// verticales de dominio; hoy es el unico contenido del shell.
//
// Una sola diferencia con el origen, y es la que pide la tarea: aca solo se enlazan rutas que
// existen en este repo. Los modulos que el origen ya tenia pero que todavia no se portaron
// (T5c) se siguen viendo —para que el mapa de la app no cambie de forma entre verticales— pero
// quedan deshabilitados y sin `href`: un enlace a una ruta inexistente seria un 404 disfrazado
// de navegacion.
//
// Cada vertical que se porta mueve su entrada de `PENDING_GROUPS` a `LINKS`, sin renombrarla ni
// reordenar el resto: "Maestro" ya es una ruta real (`/clientes/listado`, T5c) y por eso se
// enlaza como los pagos. "Caja y bancos" (C5 del vertical de cajas-bancos) hace lo mismo con SUS
// tres pantallas portadas: el origen era un desplegable de seis entradas y aca quedan tres enlaces
// directos, con las etiquetas del origen (`Resumen` es la raiz del vertical, que en este repo es el
// listado de cuentas). Conciliacion, extractos y configuracion NO se enlazan: son C6/C7 y su API
// todavia no esta expuesta.
import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  Calculator,
  Database,
  FileText,
  Landmark,
  LayoutDashboard,
  Receipt,
  Settings,
  ShoppingCart,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@gestion/shared";
import { SignOutButton } from "@/components/auth/sign-out-button";
import {
  NavigationMenu,
  NavigationMenuLink,
  NavigationMenuItem,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from "@/components/ui/navigation-menu";
import type { SessionUser } from "@/lib/auth/session";

type NavLink = {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Marca activa SOLO en la ruta exacta. Necesario cuando una entrada es prefijo de otra: sin esto,
   * `/cajas-bancos` quedaria resaltada tambien en `/cajas-bancos/cuentas` y `/cajas-bancos/cuadres`.
   */
  exact?: boolean;
};

/** Modulo del origen que todavia no existe en este repo: se muestra, no se enlaza. */
type PendingGroup = {
  label: string;
  icon: LucideIcon;
  /** Rutas del origen, solo como documentacion (van al `title`): no se renderizan como enlaces. */
  modules: string[];
};

/** Rutas que existen hoy en `apps/web`. */
const LINKS: NavLink[] = [
  { label: "Resumen", href: "/", icon: LayoutDashboard },
  // Vertical de pagos (T5b2). En el origen era un desplegable "Pagos" con dos entradas; aca se
  // enlazan las dos directamente, sin cambiar el mapa de la app ni inventar rutas.
  { label: "Ingresos", href: "/pagos/ingresos", icon: ArrowDownCircle },
  { label: "Egresos", href: "/pagos/egresos", icon: ArrowUpCircle },
  // Vertical de clientes (T5c): en el origen era el grupo "Maestro"; aca es un enlace directo,
  // con el mismo trato que las dos entradas de pagos.
  { label: "Maestro", href: "/clientes/listado", icon: Database },
  // Vertical de cajas-bancos (C5): las tres pantallas que ya tienen API, con las etiquetas del
  // origen. La primera es prefijo de las otras dos, asi que solo se resalta en su ruta exacta.
  { label: "Caja y bancos", href: "/cajas-bancos", icon: Landmark, exact: true },
  { label: "Detalle de Cuentas", href: "/cajas-bancos/cuentas", icon: Wallet },
  { label: "Cuadres de Caja", href: "/cajas-bancos/cuadres", icon: Calculator },
  { label: "Estado del API", href: "/health", icon: Activity },
];

/** Los modulos del origen, en el mismo orden que su barra, pendientes de port (T5c). */
const PENDING_GROUPS: PendingGroup[] = [
  { label: "Ventas", icon: Receipt, modules: ["/ventas", "/ventas/nuevo", "/ventas/[id]"] },
  { label: "Compras", icon: ShoppingCart, modules: ["/compras", "/compras/nuevo", "/compras/[id]"] },
  { label: "Notas y retenciones", icon: FileText, modules: ["/notas/credito", "/notas/debito", "/retenciones"] },
  { label: "Configuración", icon: Settings, modules: ["/configuracion"] },
];

/** Marca activa la entrada también en sus rutas hijas (/clientes/listado/... si alguna vez existe). */
function isPathActive(pathname: string, href: string, exact = false): boolean {
  return pathname === href || (!exact && pathname.startsWith(`${href}/`));
}

export function AppNavbar({ user }: { user: SessionUser }) {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 w-full px-4 pt-4">
      <div className="mx-auto flex h-14 w-full items-center gap-3 rounded-2xl border-[3px] border-ink bg-card px-3 shadow-[var(--clay-shadow)]">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg border-[3px] border-ink bg-pastel-mint">
            <Building2 className="size-5" />
          </span>
          <span className="hidden font-heading text-base font-semibold sm:inline">
            Gestión Comercial
          </span>
        </Link>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <NavigationMenu>
            <NavigationMenuList>
              {LINKS.map((item) => (
                <NavigationMenuItem key={item.href}>
                  <NavigationMenuLink
                    active={isPathActive(pathname, item.href, item.exact)}
                    render={<Link href={item.href} />}
                    className={cn(navigationMenuTriggerStyle(), "gap-2")}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </NavigationMenuLink>
                </NavigationMenuItem>
              ))}

              {PENDING_GROUPS.map((group) => (
                <NavigationMenuItem key={group.label}>
                  <span
                    aria-disabled="true"
                    data-pending="true"
                    title={`Todavía no portado: ${group.modules.join(", ")}`}
                    className={cn(
                      navigationMenuTriggerStyle(),
                      "cursor-not-allowed gap-2 opacity-50 hover:text-muted-foreground",
                    )}
                  >
                    <group.icon />
                    <span>{group.label}</span>
                  </span>
                </NavigationMenuItem>
              ))}
            </NavigationMenuList>
          </NavigationMenu>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className="hidden max-w-[14rem] truncate font-mono text-xs text-muted-foreground lg:inline"
            title={user.email}
          >
            {user.email}
          </span>
          <SignOutButton className="w-auto justify-center" />
        </div>
      </div>
    </header>
  );
}
