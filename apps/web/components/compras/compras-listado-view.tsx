"use client";

// Listado del vertical de compras (T4, S10 de `odd/tasks/port-vertical-compras.md`).
//
// La pantalla es la MISMA que la de ventas (`VoucherListadoView`, en `components/ventas`): columnas
// de S10 con `Proveedor` en lugar de `Cliente`, filtros Desde/Hasta/Estado pago, paginacion de 10,
// busqueda `Buscar compras...`, vacio `No hay compras registradas` y las acciones Ver/Editar/
// `Registrar pago` (esta ultima solo con la compra pendiente). Lo unico que aporta este archivo es
// el vertical: los textos salen de `voucherListCopy("COMPRA")` y los datos de
// `VOUCHER_SOURCES.COMPRA` (`GET /purchases`).
//
// Por que no una copia del listado: el estado de los filtros, la paginacion y la regla de
// `Registrar pago` son los mismos para los dos verticales. Duplicarlos habria dejado dos pantallas
// que se desincronizan al primer cambio de columna.
import { VoucherListadoView } from "@/components/ventas/ventas-listado-view";

export function ComprasListadoView() {
  return <VoucherListadoView voucherKind="COMPRA" />;
}
