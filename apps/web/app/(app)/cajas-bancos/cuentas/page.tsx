// Detalle de cuentas con saldos (C5 del vertical de cajas-bancos).
//
// Misma ruta que en el origen (`app/(app)/cajas-bancos/cuentas/page.tsx`), con el mismo componente.
// Muestra el saldo a hoy de cada cuenta, que la base calcula (S2), y consolida a soles con el tipo
// de cambio de los ajustes (SPEC 52).
import { CuentasView } from "@/components/cajas-bancos/cuentas-view";

export default function CajasBancosCuentasPage() {
  return <CuentasView />;
}
