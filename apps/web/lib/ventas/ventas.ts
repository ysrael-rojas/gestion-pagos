// Transporte del vertical de ventas (T4 del port).
//
// El `fetch` no se duplica: `request` es el de `lib/api/client.ts`, el unico transporte del
// frontend (resuelve la base segun donde corra, credenciales `same-origin` y `ApiError` con el
// mensaje del API sin tocar). El navegador pega en `/api/backend/vouchers`, que YA esta en la lista
// blanca del puente con GET/POST/PATCH: este slice no tuvo que abrir nada.
//
// Los cuatro endpoints son el contrato de T3 (`apps/api/src/vouchers/vouchers.controller.ts`):
//
//   GET    /vouchers        listado (sin filtros: la pantalla filtra en el cliente, S10)
//   GET    /vouchers/:id    detalle con saldo (404 `El comprobante no existe.`)
//   POST   /vouchers        alta (201, RPC `crear_venta`)
//   PATCH  /vouchers/:id    edicion (200, RPC `editar_venta`, body completo)
//
// Los errores no se traducen: los mensajes de S6 los redacta el API y el `ApiError` los lleva al
// `toast` de la pantalla. Traducirlos aca duplicaria el mapa de errores que ya vive en
// `apps/api/src/vouchers/vouchers.errors.ts`.
//
// `VOUCHER_SOURCES` es el punto donde el formulario y el detalle COMPARTIDOS con compras piden sus
// datos (S1). Los dos verticales estan portados: VENTA contra `/vouchers` y COMPRA contra
// `/purchases` (T4 de compras, S7). El formulario y el detalle no saben cual es cual: eligen la
// fuente por `voucherKind` y el resto del comportamiento sale de `voucherCopy`.
import { request } from "../api/client.ts";
import {
  createCompra,
  getCompra,
  listCompras,
  updateCompra,
} from "../compras/compras.ts";
import type {
  VoucherDetail,
  VoucherKind,
  VoucherListItem,
  VoucherWriteBody,
} from "./types.ts";

/** Las ventas del dueno de la sesion, de la emision mas reciente a la mas vieja. */
export function listVentas(): Promise<VoucherListItem[]> {
  return request<VoucherListItem[]>("/vouchers");
}

/** Una venta con su saldo (`paidAmount`/`balance`) y el nombre del cliente. */
export function getVenta(id: string): Promise<VoucherDetail> {
  return request<VoucherDetail>(`/vouchers/${encodeURIComponent(id)}`);
}

/** Alta de una venta. Devuelve el comprobante creado (201). */
export function createVenta(body: VoucherWriteBody): Promise<VoucherDetail> {
  return request<VoucherDetail>("/vouchers", { method: "POST", body });
}

/** Edicion de una venta. El body es completo, igual que en `PATCH /entities/:id`. */
export function updateVenta(
  id: string,
  body: VoucherWriteBody
): Promise<VoucherDetail> {
  return request<VoucherDetail>(`/vouchers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body,
  });
}

/** Lo que el formulario y el detalle necesitan del vertical, ya sin saber cual es. */
export interface VoucherSource {
  list: () => Promise<VoucherListItem[]>;
  detail: (id: string) => Promise<VoucherDetail>;
  create: (body: VoucherWriteBody) => Promise<VoucherDetail>;
  update: (id: string, body: VoucherWriteBody) => Promise<VoucherDetail>;
}

/** Fuente de datos por vertical (S1): el formulario y el detalle se montan igual en los dos. */
export const VOUCHER_SOURCES: Record<VoucherKind, VoucherSource> = {
  VENTA: {
    list: listVentas,
    detail: getVenta,
    create: createVenta,
    update: updateVenta,
  },
  COMPRA: {
    list: listCompras,
    detail: getCompra,
    create: createCompra,
    update: updateCompra,
  },
};
