// Detalle de una venta (T5 del port). Es `VoucherDetalleView` con `voucherKind="VENTA"`, la misma
// vista que montara `/compras/[id]` cuando se porte compras (S1).
//
// `params` es una promesa (Next 16) y se espera en el servidor: el id no se valida aca. Quien
// decide si el comprobante existe es el API (`GET /vouchers/:id`), y la vista ya tiene su estado
// "Comprobante no encontrado" con el mensaje del dominio (`El comprobante no existe.`). Por eso la
// pagina NO llama a `notFound()`: no hay nada que resolver en el servidor y un 404 de Next
// reemplazaria la pantalla que el vertical ya dibuja — es el mismo criterio de las paginas
// portadas de clientes y cajas-bancos, donde la vista es el unico dueño del estado vacio.
//
// `Registrar pago` solo se pinta con `status === 'PENDIENTE'` (S10) y navega al alta de ingresos
// con la entidad y el comprobante precargados: el cobro es del vertical de pagos, no de este.
import { VoucherDetalleView } from "@/components/ventas/voucher-detalle-view";

export default async function VentaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <VoucherDetalleView voucherKind="VENTA" voucherId={id} />;
}
