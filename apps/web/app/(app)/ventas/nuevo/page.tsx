// Alta de una venta (T5 del port). El origen monta aca el mismo `VoucherFormView` con
// `voucherKind="VENTA"`; compras lo reusara con `voucherKind="COMPRA"` (S1), asi que la pagina no
// decide nada del formulario: los titulos, la etiqueta de la entidad y la ruta de vuelta salen de
// `voucherCopy("VENTA")` (`lib/ventas/formulario.ts`).
//
// Sin `voucherId` la vista es un alta: no lee el comprobante, no muestra el aviso de pagos y el
// body sale por `POST /vouchers` (RPC `crear_venta`, S8).
//
// Pagina de servidor que no resuelve datos: el formulario vive en el navegador y escribe por el
// puente `/api/backend/vouchers`. La sesion la garantiza el layout de `(app)`.
import { VoucherFormView } from "@/components/ventas/voucher-form-view";

export default function NuevaVentaPage() {
  return <VoucherFormView voucherKind="VENTA" />;
}
