// Edicion de una venta (T5 del port). Mismo `VoucherFormView` que el alta, con `voucherId`: la
// vista lee el comprobante (`GET /vouchers/:id`), precarga el formulario con `toVoucherFormValues`
// (en CONTADO los dias de credito quedan vacios, S3) y guarda con `PATCH /vouchers/:id` (RPC
// `editar_venta`, body completo).
//
// Con pagos registrados el formulario muestra el aviso de S5 y bloquea importe, numero, cliente y
// fecha; el juez final sigue siendo el trigger `comprobante_protect_paid`, que la RPC no puede
// saltar (S6). La pantalla no duplica esa regla: la muestra.
//
// `params` es una promesa (Next 16) y se espera en el servidor. El id no se valida aca: un id
// inexistente, de otro dueno o de una compra lo resuelve el API con un 404, y la vista pinta su
// estado "Comprobante no encontrado" con ese mensaje.
import { VoucherFormView } from "@/components/ventas/voucher-form-view";

export default async function EditarVentaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <VoucherFormView voucherKind="VENTA" voucherId={id} />;
}
