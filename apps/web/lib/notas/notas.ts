// Transporte del vertical de notas (T4 del slice 3: S1, S10 y S11 de
// `odd/tasks/port-vertical-notas.md`).
//
// El `fetch` no se duplica: `request` es el de `lib/api/client.ts`, el unico transporte del frontend
// (resuelve la base segun donde corra, credenciales `same-origin` y `ApiError` con el mensaje del API
// sin tocar). El navegador pega en `/api/backend/notes`, prefijo que T5 agrego a la lista blanca del
// puente: `POST` y `GET` ya estaban entre los verbos reenviados y el `?voucherId=` de la lectura
// pasa tal cual, porque el puente reenvia la query string (`route.ts`).
//
// Los dos endpoints son el contrato de T3 (`apps/api/src/notes/notes.controller.ts`):
//
//   POST  /notes                  alta (201 con la fila del ajuste, ya con el numero asignado)
//   GET   /notes?voucherId=<uuid> las notas de ESE comprobante, de la mas reciente a la mas vieja
//
// Los errores no se traducen: los mensajes de S10 los redacta el API
// (`apps/api/src/notes/notes.errors.ts`) y el `ApiError` los lleva al `toast` de la pantalla.
// Traducirlos aca duplicaria ese mapa, que ya decide status y texto.
import type {
  NotaWriteValues,
  VoucherAdjustmentRow,
} from "@gestion/shared/lib/schemas/nota.ts";

import { request } from "../api/client.ts";

/** Las notas de credito/debito de un comprobante (lista vacia si no tiene ninguna). */
export function listNotas(voucherId: string): Promise<VoucherAdjustmentRow[]> {
  return request<VoucherAdjustmentRow[]>("/notes", { query: { voucherId } });
}

/**
 * Alta de una nota. Devuelve la fila escrita (201), con el numero que asigno la base.
 *
 * El body NO lleva el numero (`toNotaRequestBody`): lo asigna `public.crear_nota` desde la serie por
 * defecto del tipo de la nota (S3).
 */
export function createNota(body: NotaWriteValues): Promise<VoucherAdjustmentRow> {
  return request<VoucherAdjustmentRow>("/notes", { method: "POST", body });
}
