// Transporte del vertical de compras (T4, S7 de `odd/tasks/port-vertical-compras.md`).
//
// El `fetch` no se duplica: `request` es el de `lib/api/client.ts`, el unico transporte del
// frontend (resuelve la base segun donde corra, credenciales `same-origin` y `ApiError` con el
// mensaje del API sin tocar). El navegador pega en `/api/backend/purchases`, que T5 agrega a la
// lista blanca del puente con GET/POST/PATCH: este archivo no abre nada por su cuenta.
//
// Los cuatro endpoints son el contrato de T3 (`apps/api/src/purchases/purchases.controller.ts`):
//
//   GET    /purchases        listado (sin filtros: la pantalla filtra en el cliente, S10)
//   GET    /purchases/:id    detalle con saldo POR PAGAR (404 `El comprobante no existe.`)
//   POST   /purchases        alta (201, RPC `crear_compra`, body con el numero del proveedor)
//   PATCH  /purchases/:id    edicion (200, RPC `editar_compra`, body completo)
//
// POR QUE LOS TIPOS SON LOS DE VENTAS: el contrato de salida de T3 es DELIBERADAMENTE el mismo
// (`purchases.types.ts`: `PurchaseDetail = Voucher & { entityName }` y `PurchaseListItem` con las
// columnas de S10), porque el formulario y el detalle son COMPARTIDOS (S7) y una compra y una venta
// se leen con el mismo tipo en el cliente. Lo que cambia es el SIGNIFICADO: `entityName` es el
// proveedor y `balance` es el saldo por pagar.
//
// Los errores no se traducen: los mensajes de S8 los redacta el API
// (`apps/api/src/purchases/purchases.errors.ts`) y el `ApiError` los lleva al `toast` de la pantalla.
// Traducirlos aca duplicaria ese mapa, que ya decide status y texto.
import { request } from "../api/client.ts";
import type {
  VoucherDetail,
  VoucherListItem,
  VoucherWriteBody,
} from "../ventas/types.ts";

/** Las compras del dueno de la sesion, de la emision mas reciente a la mas vieja. */
export function listCompras(): Promise<VoucherListItem[]> {
  return request<VoucherListItem[]>("/purchases");
}

/** Una compra con su saldo por pagar (`paidAmount`/`balance`) y el nombre del proveedor. */
export function getCompra(id: string): Promise<VoucherDetail> {
  return request<VoucherDetail>(`/purchases/${encodeURIComponent(id)}`);
}

/** Alta de una compra. Devuelve el comprobante creado (201). */
export function createCompra(body: VoucherWriteBody): Promise<VoucherDetail> {
  return request<VoucherDetail>("/purchases", { method: "POST", body });
}

/** Edicion de una compra. El body es completo, igual que en `PATCH /entities/:id`. */
export function updateCompra(
  id: string,
  body: VoucherWriteBody
): Promise<VoucherDetail> {
  return request<VoucherDetail>(`/purchases/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}
