// Listado de cajas y bancos (C5 del vertical de cajas-bancos).
//
// En el origen esta ruta era el dashboard del vertical
// (`app/(app)/cajas-bancos/page.tsx` -> `DashboardView`) y el listado de cuentas vivia dentro de
// "Configuracion > Cuentas". Aca el dashboard es C7 (proyeccion y flujo del mes) y el listado con su
// formulario ya tiene API, asi que la ruta raiz del vertical es el listado: es lo primero que un
// dueno nuevo necesita (registrar su caja) y no depende de pantallas sin portar.
//
// La pagina es de servidor y no resuelve nada: el componente es cliente porque todo el estado
// (modal, filtro, tabla) vive en el navegador y las escrituras salen por el puente
// `/api/backend`.
import { CajasBancosListadoView } from "@/components/cajas-bancos/cajas-bancos-listado-view";

export default function CajasBancosPage() {
  return <CajasBancosListadoView />;
}
