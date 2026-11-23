// Dashboard de tesoreria: la raiz del vertical de cajas-bancos (C7).
//
// Misma ruta y mismo componente que el origen (`app/(app)/cajas-bancos/page.tsx` -> `DashboardView`).
// C5 habia dejado el listado de cuentas en esta ruta y anotado que el dashboard era C7; ahora que
// existen el agregado del mes (`GET /cash-flow/monthly`), la proyeccion y la cartera breve, la raiz
// vuelve a ser el dashboard y el listado sigue en "Configuracion > Cuentas" y en
// `/cajas-bancos/cuentas`.
//
// La pagina es de servidor y no resuelve nada: todo el estado vive en el navegador y las lecturas
// salen por el puente `/api/backend`.
import { DashboardView } from "@/components/cajas-bancos/dashboard-view";

export default function CajasBancosPage() {
  return <DashboardView />;
}
