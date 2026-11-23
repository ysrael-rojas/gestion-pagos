// Cuadres de caja: cierres, arqueos y acta (C5 del vertical de cajas-bancos).
//
// Misma ruta que en el origen (`app/(app)/cajas-bancos/cuadres/page.tsx`), con el mismo componente.
// Es la pantalla donde se CIERRA un periodo (irreversible, S4) y donde se registra un arqueo
// sorpresivo; las dos escrituras son los RPC del API, no DML desde el navegador.
import { CuadresView } from "@/components/cajas-bancos/cuadres-view";

export default function CajasBancosCuadresPage() {
  return <CuadresView />;
}
