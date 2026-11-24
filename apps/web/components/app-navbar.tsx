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
// pantallas portadas: el origen era un desplegable de seis entradas y aca quedan seis enlaces
// directos, con las etiquetas del origen. El origen tenia ademas una entrada "Resumen" que
// apuntaba a su pantalla de inicio; en este repo esa pantalla no existe (`/` es el inventario del
// UI-kit) y el dashboard de tesoreria vive en `/cajas-bancos`, asi que la entrada se borro en vez de
// re-apuntarla: "Caja y bancos" es la entrada unica a la seccion y a su dashboard, y las otras
// cinco son sus hijas. Quedan 14 entradas en vez de 15, que tambien ayuda con el desborde que
// documenta el comentario del render.
// "Extractos" se enlazo en C6 y "Conciliacion" y "Configuracion" en C7, cuando su API quedo
// expuesta (bank-reconciliations, cash-flow, payment-methods, receipt-categories y settings).

import {
  Activity,
  ArrowDownCircle,
  ArrowUpCircle,
  Building2,
  Calculator,
  Database,
  FileText,
  Landmark,
  Receipt,
  Scale,
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
  // Vertical de pagos (T5b2). En el origen era un desplegable "Pagos" con dos entradas; aca se
  // enlazan las dos directamente, sin cambiar el mapa de la app ni inventar rutas.
  { label: "Ingresos", href: "/pagos/ingresos", icon: ArrowDownCircle },
  { label: "Egresos", href: "/pagos/egresos", icon: ArrowUpCircle },
  // Vertical de clientes (T5c): en el origen era el grupo "Maestro"; aca es un enlace directo,
  // con el mismo trato que las dos entradas de pagos.
  { label: "Maestro", href: "/clientes/listado", icon: Database },
  // Vertical de cajas-bancos (C5, C6 y C7): las pantallas que ya tienen API, con las etiquetas del
  // origen. La primera es prefijo de las otras, asi que solo se resalta en su ruta exacta.
  { label: "Caja y bancos", href: "/cajas-bancos", icon: Landmark, exact: true },
  { label: "Detalle de Cuentas", href: "/cajas-bancos/cuentas", icon: Wallet },
  { label: "Cuadres de Caja", href: "/cajas-bancos/cuadres", icon: Calculator },
  { label: "Extractos", href: "/cajas-bancos/extractos", icon: FileText },
  { label: "Conciliación", href: "/cajas-bancos/conciliacion", icon: Scale },
  { label: "Configuración de caja", href: "/cajas-bancos/configuracion", icon: Settings },
  // Vertical de ventas (T5 del port): era la primera entrada de `PENDING_GROUPS` y se enlaza a
  // `/ventas`, que ya es una ruta real (listado, alta, detalle y edicion). Se agrega al FINAL, sin
  // renombrar ni reordenar las anteriores, y con las tres pantallas del vertical colgando del
  // listado (`/ventas/nuevo`, `/ventas/[id]`, `/ventas/[id]/editar`): en el origen era un grupo con
  // esas mismas rutas.
  { label: "Ventas", href: "/ventas", icon: Receipt },
  { label: "Estado del API", href: "/health", icon: Activity },
];

/** Los modulos del origen, en el mismo orden que su barra, pendientes de port (T5c). */
const PENDING_GROUPS: PendingGroup[] = [
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
          {/*
            * `justify-start` en la RAIZ, no solo en la lista: el vertical de cajas-bancos llevo la
            * barra a 15 entradas y el primitivo centra por defecto (`justify-center` en
            * ui/navigation-menu.tsx). Su unico hijo no puede encogerse por debajo de su contenido
            * (~1.700px en una franja de ~650px), asi que centrar reparte el desborde por los DOS
            * lados: el de la izquierda queda en offset negativo y el navegador no puede scrollear
            * hacia alla. Consecuencia real, no teorica: las cinco primeras entradas de entonces
            * (Resumen, Ingresos, Egresos, Maestro, Caja y bancos) eran inalcanzables en un viewport
            * de 1280px y el click aterrizaba en el logo. "Resumen" ya no existe (ver el encabezado),
            * asi que hoy son cuatro; el desborde sigue igual de real. Lo encontro el e2e del vertical (spec 09); el spec 08
            * tambien lo estaba sufriendo por la entrada "Maestro".
            *
            * Se arregla aca y no en el default del primitivo: cambiar el default de un componente
            * compartido para un problema de densidad de esta barra seria mover el problema al
            * proximo consumidor.
            */}
          <NavigationMenu className="justify-start">
            {/* La lista tambien va con `justify-start`: importa cuando el contenido SI entra y el
              * sobrante es de la raiz, no de la lista. */}
            <NavigationMenuList className="justify-start">
              {LINKS.map((item) => (
                <NavigationMenuItem key={item.label}>
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
