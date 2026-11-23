// Configuracion de caja y bancos (C7 del vertical de cajas-bancos).
//
// Misma ruta que en el origen (`app/(app)/cajas-bancos/configuracion/page.tsx`), con el mismo
// componente: cuentas (el listado de C5), metodos de pago, categorias de recibo y los tres ajustes
// generales. Las escrituras de catalogo son `POST/PATCH /payment-methods` y
// `POST/PATCH /receipt-categories`; los ajustes, `PATCH /settings` con la siembra explicita de
// `POST /settings/ensure` (S7).
import { ConfiguracionView } from "@/components/cajas-bancos/configuracion-view";

export default function CajasBancosConfiguracionPage() {
  return <ConfiguracionView />;
}
