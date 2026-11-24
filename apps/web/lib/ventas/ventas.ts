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
// datos (S1). Hoy solo VENTA tiene implementacion: compras es un slice posterior y `apps/api` no
// expone sus rutas, asi que la fuente de COMPRA rechaza con un mensaje explicito en vez de devolver
// datos inventados o de reventar con un `undefined`.
import { request } from "../api/client.ts";
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

export const VOUCHER_KIND_NOT_PORTED =
  "El vertical de compras todavía no está portado: apps/api no expone sus rutas.";

function notPorted(): Promise<never> {
  return Promise.reject(new Error(VOUCHER_KIND_NOT_PORTED));
}

/** Fuente de datos por vertical (S1). La de COMPRA se completa cuando se porte compras. */
export const VOUCHER_SOURCES: Record<VoucherKind, VoucherSource> = {
  VENTA: {
    list: listVentas,
    detail: getVenta,
    create: createVenta,
    update: updateVenta,
  },
  COMPRA: {
    list: notPorted,
    detail: notPorted,
    create: notPorted,
    update: notPorted,
  },
};
