// Extractos de una cuenta (C6 del vertical de cajas-bancos).
//
// Misma ruta que en el origen (`app/(app)/cajas-bancos/extractos/page.tsx`), con el mismo
// componente. Es una vista de cliente sobre DOS lecturas que ya existen: los recibos de la cuenta
// (`GET /cartera/statement/:accountId`) y sus transferencias (`GET /cash-transfers?accountId&from&to`).
// Extractos no tiene tabla ni ruta propia en el API (L15 del doc de la feature).
import { ExtractosView } from "@/components/cajas-bancos/extractos-view";

export default function CajasBancosExtractosPage() {
  return <ExtractosView />;
}
