// Detalle de una compra (T5, S11 de `odd/tasks/port-vertical-compras.md`).
//
// Es `VoucherDetalleView` con `voucherKind="COMPRA"`: la misma vista que `/ventas/[id]`, con la
// etiqueta `Proveedor` y la banda de montos de la base, que en una compra es el saldo POR PAGAR
// (S6). `Registrar pago` solo se pinta con `status === 'PENDIENTE'` (S10) y navega al alta de
// egresos con la entidad y el comprobante precargados.
//
// `params` es una promesa (Next 16) y se espera en el servidor: el id no se valida aca. Quien decide
// si la compra existe es el API (`GET /purchases/:id`), y la vista ya tiene su estado "Comprobante
// no encontrado" con el mensaje del dominio (`El comprobante no existe.`). Por eso la pagina NO
// llama a `notFound()`: un 404 de Next reemplazaria la pantalla que el vertical ya dibuja.
//
// Una compra no lleva notas: la seccion de notas del detalle es solo de ventas (L3e), porque una
// nota RECIBIDA sobre una compra queda fuera de este slice.
import { VoucherDetalleView } from "@/components/ventas/voucher-detalle-view";

export default async function CompraDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <VoucherDetalleView voucherKind="COMPRA" voucherId={id} />;
}
