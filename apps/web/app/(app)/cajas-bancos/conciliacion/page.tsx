// Conciliacion bancaria del periodo (C7 del vertical de cajas-bancos).
//
// Misma ruta que en el origen (`app/(app)/cajas-bancos/conciliacion/page.tsx`), con el mismo
// componente. La pantalla compara el saldo del extracto con el que calcula la base (S2), deja
// explicar la diferencia con partidas y guarda el acta por la RPC `save_bank_reconciliation`
// (`POST /bank-reconciliations` a traves del puente). El prefijo `bank-reconciliations` esta en la
// lista blanca de `app/api/backend/[...path]/route.ts`.
import { ConciliacionView } from "@/components/cajas-bancos/conciliacion-view";

export default function CajasBancosConciliacionPage() {
  return <ConciliacionView />;
}
