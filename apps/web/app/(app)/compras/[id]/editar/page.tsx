// Edicion de una compra (T5, S11 de `odd/tasks/port-vertical-compras.md`).
//
// Mismo formulario que el alta, con `voucherId`: la vista lee la compra (`GET /purchases/:id`),
// precarga el formulario con `toVoucherFormValues` y guarda con `PATCH /purchases/:id` (RPC
// `editar_compra`, body completo con el numero).
//
// LA DIFERENCIA DELIBERADA CON LA VENTA (S2): el NUMERO y el TIPO de una compra son CORREGIBLES
// mientras el comprobante no tenga pagos ni ajustes. El numero lo emitio el proveedor, asi que un
// error de tipeo se corrige aca; el candado es el trigger `protect_paid_comprobante`, que congela
// importe, numero, tipo, proveedor y fecha en cuanto hay un pago. Con pagos, el formulario muestra
// el aviso de S5 (`paidLockMessage("COMPRA")`) y deshabilita esos campos, pero la pantalla no
// reemplaza al trigger: lo anticipa.
//
// `params` es una promesa (Next 16) y se espera en el servidor. El id no se valida aca: un id
// inexistente, de otro dueno o de una venta lo resuelve el API con un 404, y la vista pinta su
// estado "Comprobante no encontrado" con ese mensaje.
import { VoucherFormView } from "@/components/ventas/voucher-form-view";

export default async function EditarCompraPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <VoucherFormView voucherKind="COMPRA" voucherId={id} />;
}
