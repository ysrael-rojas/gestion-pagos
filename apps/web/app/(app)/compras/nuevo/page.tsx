// Alta de una compra (T5, S11 de `odd/tasks/port-vertical-compras.md`).
//
// Es el MISMO formulario que el alta de venta (`VoucherFormView`) con `voucherKind="COMPRA"`: el
// titulo (`Registrar compra`), la etiqueta de la entidad (`Proveedor`), el selector de proveedores y
// la ruta de vuelta salen de `voucherCopy("COMPRA")` (S7).
//
// DOS COSAS QUE EN COMPRAS NO APLICAN, y por eso esta pagina no las configura:
//
//   * El numero NO se previsualiza ni lo asigna una serie: lo tipea el usuario y viaja en el body
//     (S2). El formulario ya distingue el vertical y deja el campo editable.
//   * Una compra no necesita series: `VoucherFormView` solo las carga para ventas y
//     `isSaleSeriesBlocked` exime a compras, asi que sin ninguna serie configurada el alta NO queda
//     bloqueada (a diferencia de `/ventas/nuevo`).
//
// Pagina de servidor que no resuelve datos: el formulario vive en el navegador y escribe por el
// puente `/api/backend/purchases` (POST, RPC `crear_compra`). La sesion la garantiza el layout de
// `(app)`.
import { VoucherFormView } from "@/components/ventas/voucher-form-view";

export default function NuevaCompraPage() {
  return <VoucherFormView voucherKind="COMPRA" />;
}
