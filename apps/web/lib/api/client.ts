// Cliente HTTP de apps/web contra apps/api.
//
// S8: el frontend no toca la base; consume `apps/api` por HTTP y el contrato compartido son
// los schemas Zod de `@gestion/shared` (por eso el payload de escritura se tipa con
// `PaymentFormValues` en vez de duplicar la forma).
//
// Solo se exponen los endpoints que `apps/api` ya sirve:
//   GET  /health            -> apps/api/src/health/health.controller.ts
//   GET  /payments          -> apps/api/src/payments/payments.controller.ts (requiere sesion)
//   POST /contract/payments -> apps/api/src/contract/contract.controller.ts (smoke del contrato)

import type { PaymentFormValues } from "@gestion/shared";

const DEFAULT_API_BASE_URL = "http://localhost:3001";

/**
 * Base del API.
 *
 * `NEXT_PUBLIC_API_URL` solo existe porque el navegador tambien llama al API (T5b); el
 * servidor puede usar `API_URL`, que no se inlinea en el bundle del cliente.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

/** Error de transporte o de estado HTTP del API. `status: 0` = no hubo respuesta. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Espeja `HealthResponse` de `apps/api/src/health/health.controller.ts`. */
export interface HealthResponse {
  status: "ok";
  service: "@gestion/api";
  timestamp: string;
}

/**
 * Espeja `PaymentListItem` de `apps/api/src/payments/payments.service.ts`.
 *
 * `amount` viaja como string porque en la base es `numeric(12,2)` y es la unica forma
 * exacta; `createdAt` es un `Date` en el servicio y un ISO string al cruzar JSON.
 */
export interface PaymentListItem {
  id: string;
  direction: "INGRESO" | "EGRESO";
  paymentDate: string;
  receiptNumber: string | null;
  amount: string;
  status: "EN_REVISION" | "PROCESADO" | "ANULADO";
  reference: string | null;
  notes: string | null;
  entityId: string | null;
  entityName: string | null;
  methodId: string;
  methodName: string | null;
  cashAccountId: string;
  categoryId: string;
  isCashMovement: boolean;
  createdAt: string;
}

/** Espeja `ValidatedPaymentResponse` de `apps/api/src/contract/contract.controller.ts`. */
export interface ValidatedPaymentResponse {
  valid: true;
  parsed: PaymentFormValues;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  let response: Response;

  try {
    response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new ApiError(0, `No se pudo conectar con ${url}: ${reason}`);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new ApiError(response.status, `${url} respondio ${response.status}: ${body.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}

/** Liveness del API. No toca la base: responde mientras el proceso este arriba. */
export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health", { cache: "no-store" });
}

/**
 * Pagos del usuario autenticado.
 *
 * `apps/api` resuelve la identidad de la sesion de Better Auth a partir de la cookie; la
 * autenticacion del frontend queda fuera de T5a, asi que el llamador pasa las cabeceras.
 */
export function listPayments(init?: RequestInit): Promise<PaymentListItem[]> {
  return request<PaymentListItem[]>("/payments", { cache: "no-store", ...init });
}

/** Smoke del borde de validacion: el API devuelve el payload ya parseado por el schema. */
export function validatePayment(values: PaymentFormValues): Promise<ValidatedPaymentResponse> {
  return request<ValidatedPaymentResponse>("/contract/payments", {
    method: "POST",
    body: JSON.stringify(values),
  });
}
