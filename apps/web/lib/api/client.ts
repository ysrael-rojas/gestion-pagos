// Cliente HTTP de apps/web contra apps/api.
//
// S8: el frontend no toca la base. Consume `apps/api` por HTTP y el contrato compartido son los
// schemas Zod de `@gestion/shared` (por eso el payload de escritura se tipa con
// `PaymentFormValues` en vez de duplicar la forma).
//
// ## Por donde salen las llamadas
//
// - Servidor (Server Components, Server Actions): directo a `API_BASE_URL`.
// - Navegador: por la ruta propia `/api/backend/*` (`app/api/backend/[...path]/route.ts`).
//   `apps/api` no habilita CORS y la cookie de sesion es `HttpOnly`, asi que el navegador no
//   puede ni leer la respuesta ni mandar credenciales a otro origen. La ruta de Next reenvia la
//   cookie server-to-server y devuelve la respuesta del API tal cual.
//
// Las dos bases resuelven al MISMO contrato: cambiar de una a otra no cambia ni un campo.
//
// ## Tipos
//
// Las interfaces de abajo reflejan `apps/api/src/payments/payments.types.ts` y
// `apps/api/src/payments/catalogs.types.ts`, que son el contrato de salida del API. Se declaran
// aca (en vez de importarse de apps/api) porque `apps/web` no depende de `@gestion/api`: el
// paquete del backend no es publicable y su build es un bundle de esbuild. Cambiar un campo alla
// es cambiar este archivo, y el unico lugar donde eso se nota rapido son los tests de la UI.
import type { ClientFormValues, PaymentFormValues } from "@gestion/shared";

const DEFAULT_API_BASE_URL = "http://localhost:3001";

/**
 * Base del API para llamadas de servidor.
 *
 * `API_URL` es la del servidor de Next; `NEXT_PUBLIC_API_URL` existe para el build del navegador
 * aunque hoy el navegador nunca hable con el API directamente.
 */
export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_URL ??
  DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

/** Base same-origin que usa el navegador (ruta de Next que hace de puente con apps/api). */
export const BROWSER_API_BASE_URL = "/api/backend";

/** Error de transporte o de estado HTTP del API. `status: 0` = no hubo respuesta. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Contrato de salida (espeja apps/api)
// ---------------------------------------------------------------------------

export type PaymentDirection = "INGRESO" | "EGRESO";
export type PaymentStatus = "EN_REVISION" | "PROCESADO" | "ANULADO";
export type PaymentType = "CONTADO" | "CREDITO";
export type VoucherKind = "COMPRA" | "VENTA";
export type VoucherType =
  | "FACTURA"
  | "BOLETA"
  | "NOTA_VENTA"
  | "NOTA_CREDITO"
  | "NOTA_DEBITO"
  | "COMPROBANTE_RETENCION";
export type Currency = "PEN" | "USD";
export type DocumentType = "SIN_DOCUMENTO" | "RUC" | "DNI" | "CARNET_EXTRANJERIA";
export type CashAccountType = "CASH_BOX" | "BANK_ACCOUNT";

export interface Payment {
  id: string;
  entityId: string | null;
  direction: PaymentDirection;
  paymentDate: string;
  receiptNumber: string;
  amount: number;
  currency: Currency;
  methodId: string;
  methodName: string;
  cashAccountId: string;
  cashAccountName: string;
  categoryId: string;
  categoryName: string;
  reference: string | null;
  status: PaymentStatus;
  voidReason: string | null;
  voidedAt: string | null;
  notes: string | null;
  isCashMovement: boolean;
}

export interface PaymentListItem extends Payment {
  unassignedAmount: number;
}

export interface PaymentAllocation {
  id: string;
  paymentId: string;
  comprobanteId: string;
  amount: number;
  voucherNumber: string;
  voucherType: VoucherType;
}

export interface PaymentDetail extends Payment {
  allocations: PaymentAllocation[];
  assignedAmount: number;
  unassignedAmount: number;
}

export interface PaymentHistoryEntry {
  allocationId: string;
  paymentId: string;
  receiptNumber: string;
  paymentDate: string;
  direction: PaymentDirection;
  methodName: string;
  cashAccountName: string;
  categoryName: string;
  reference: string | null;
  paymentAmount: number;
  amount: number;
  status: PaymentStatus;
  voidedAt: string | null;
  voidReason: string | null;
  notes: string | null;
}

export interface VoucherBalance {
  comprobanteId: string;
  entityId: string;
  voucherKind: VoucherKind;
  voucherType: VoucherType;
  voucherNumber: string;
  issueDate: string;
  effectiveDueDate: string | null;
  paymentType: PaymentType;
  total: number;
  paidAmount: number;
  balance: number;
}

export interface CarteraBucket {
  count: number;
  amount: number;
  overdueCount: number;
  overdueAmount: number;
}

export interface CarteraResumen {
  receivable: CarteraBucket;
  payable: CarteraBucket;
  unassignedReceipts: CarteraBucket;
  unassignedPayments: CarteraBucket;
  today: string;
}

/** Mismo enum que `AssignState` de `lib/pagos/asignacion.ts`: no se persiste, se deriva. */
export type AssignState = "POR_ASIGNAR" | "ASIGNADO" | "ANULADO" | "MOVIMIENTO";

export interface PaymentAssignState {
  paymentId: string;
  status: PaymentStatus;
  unassignedAmount: number;
  isCashMovement: boolean;
  assignState: AssignState;
}

export interface EntityCatalogItem {
  id: string;
  documentType: DocumentType;
  documentNumber: string;
  name: string;
  address: string;
  phone: string;
  contactName: string;
  billingEmail: string;
  managementEmail: string;
  isSupplier: boolean;
}

/**
 * Entidade que devuelven las ESCRITURAS de `/entities` (`apps/api/src/entities/entities.types.ts`).
 *
 * Es `EntityCatalogItem` mas `isClient`: el listado por rol ya sabe cual es cual, pero la
 * respuesta de un alta o modificacion describe la fila completa, y `isClient` ahi importa (una
 * modificacion nunca lo cambia, y el e2e lo fija).
 */
export interface ClientRecord extends EntityCatalogItem {
  isClient: boolean;
}

export interface CashAccountCatalogItem {
  id: string;
  type: CashAccountType;
  name: string;
  currency: string;
  isActive: boolean;
}

export interface PaymentMethodCatalogItem {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface CashReceiptCategoryCatalogItem {
  id: string;
  direction: PaymentDirection;
  name: string;
  code: string;
  isActive: boolean;
}

/** `POST /catalogs/ensure`: cuantas filas falto crear (0/0 = ya estaba sembrado). */
export interface CatalogSeedResult {
  methods: number;
  categories: number;
}

/** Asignacion de entrada (`AllocationInput` del origen). */
export interface AllocationInput {
  comprobanteId: string;
  amount: number;
}

/** Filtros de `GET /payments` (`paymentListQuerySchema` de apps/api). */
export interface PaymentListFilters {
  direction?: PaymentDirection;
  desde?: string;
  hasta?: string;
  estado?: "TODOS" | PaymentStatus;
  page?: number;
  pageSize?: number;
}

/** Espeja `HealthResponse` de `apps/api/src/health/health.controller.ts`. */
export interface HealthResponse {
  status: "ok";
  service: "@gestion/api";
  timestamp: string;
}

/** Espeja `ValidatedPaymentResponse` de `apps/api/src/contract/contract.controller.ts`. */
export interface ValidatedPaymentResponse {
  valid: true;
  parsed: PaymentFormValues;
}

// ---------------------------------------------------------------------------
// Helpers puros (testeados en client.test.ts)
// ---------------------------------------------------------------------------

type QueryValue = string | number | boolean | null | undefined;

/**
 * Arma la query string de un endpoint.
 *
 * `undefined`/`null` significan "no filtrar" y no viajan: mandar `direction=` haria que Zod
 * rechazara el request, porque el enum no tiene cadena vacia. `0` si viaja (es un valor).
 */
export function buildQuery(params: Record<string, QueryValue>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;

    search.set(key, String(value));
  }

  const query = search.toString();

  return query ? `?${query}` : "";
}

/**
 * Mensaje de un error HTTP del API, tal cual lo redacto el dominio.
 *
 * El API responde con `{ statusCode, message, error }` (Nest) y el `message` puede ser un string
 * o un array (los mensajes del pipe de Zod). Los dos casos se muestran enteros: reemplazarlos por
 * un texto generico borra la unica explicacion util ("La cuenta de caja no existe").
 *
 * Lo que NO es JSON (un proxy, un 502 en HTML) se conserva recortado, en vez de perderse.
 */
export function apiErrorMessage(status: number, body: string): string {
  const trimmed = body.trim();
  const statusText = () =>
    status === 0 ? "No se pudo conectar con el API." : `El API respondió ${status}.`;

  if (!trimmed) {
    return statusText();
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // No es JSON: es la unica pista disponible, se muestra recortada.
    return trimmed.slice(0, 500);
  }

  const message = (parsed as { message?: unknown } | null)?.message;

  if (typeof message === "string" && message.trim()) {
    return message.trim();
  }

  if (Array.isArray(message)) {
    const parts = message
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());

    if (parts.length > 0) {
      return parts.join(" ");
    }
  }

  return statusText();
}

/** Base del API segun donde corra el codigo: absoluta en el servidor, same-origin en el navegador. */
export function resolveApiBase(): string {
  return typeof window === "undefined" ? API_BASE_URL : BROWSER_API_BASE_URL;
}

async function request<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH";
    query?: Record<string, QueryValue>;
    body?: unknown;
  } = {},
): Promise<T> {
  const base = resolveApiBase();
  const url = `${base}${path}${options.query ? buildQuery(options.query) : ""}`;
  const method = options.method ?? "GET";

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      // `same-origin` manda la cookie de sesion al puente de Next y no la expone al JS.
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);

    throw new ApiError(0, `No se pudo conectar con ${url}: ${reason}`);
  }

  if (!response.ok) {
    throw new ApiError(response.status, apiErrorMessage(response.status, await response.text()));
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** Liveness del API. No toca la base: responde mientras el proceso este arriba. */
export function getHealth(): Promise<HealthResponse> {
  return request<HealthResponse>("/health");
}

/** Pagos del dueno de la sesion, con filtros y paginacion (`listPayments`). */
export function listPayments(filters: PaymentListFilters = {}): Promise<PaymentListItem[]> {
  return request<PaymentListItem[]>("/payments", {
    query: {
      direction: filters.direction,
      desde: filters.desde,
      hasta: filters.hasta,
      estado: filters.estado,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  });
}

/** Detalle con asignaciones y saldos (`getPaymentDetail`). */
export function getPaymentDetail(id: string): Promise<PaymentDetail> {
  return request<PaymentDetail>(`/payments/${encodeURIComponent(id)}`);
}

/** Historial de un COMPROBANTE (`getPaymentHistory(comprobanteId)`). */
export function getPaymentHistory(comprobanteId: string): Promise<PaymentHistoryEntry[]> {
  return request<PaymentHistoryEntry[]>(`/payments/${encodeURIComponent(comprobanteId)}/history`);
}

/** Alta por la RPC `create_payment_with_allocations` (`createPayment`). */
export function createPayment(values: PaymentFormValues): Promise<PaymentDetail> {
  return request<PaymentDetail>("/payments", { method: "POST", body: values });
}

/** Anulacion con motivo (`voidPayment`). El API valida que no este ya anulado. */
export async function voidPayment(id: string, reason: string): Promise<void> {
  await request<{ voided: true }>(`/payments/${encodeURIComponent(id)}/void`, {
    method: "POST",
    body: { reason },
  });
}

/**
 * Asignacion de saldo a comprobantes (`addAllocations`).
 *
 * El origen hacia UPDATE del pago y despues INSERT de las asignaciones desde el cliente; aca es
 * una sola llamada al API, que lo hace en una transaccion. `entityId` solo aplica a un anticipo
 * sin entidad: liga el pago a la entidad elegida al asignar.
 */
export async function addAllocations(
  paymentId: string,
  items: AllocationInput[],
  entityId?: string,
): Promise<void> {
  await request<{ allocated: true }>(`/payments/${encodeURIComponent(paymentId)}/allocations`, {
    method: "POST",
    body: { items, entityId },
  });
}

/** Recibos con saldo sin asignar (`listUnassignedPayments`). */
export function listUnassignedPayments(direction: PaymentDirection): Promise<Payment[]> {
  return request<Payment[]>("/payments/unassigned", { query: { direction } });
}

/** Estado derivado por pago (`getAssignState`), sin pedir el detalle uno por uno. */
export function listAssignStates(direction?: PaymentDirection): Promise<PaymentAssignState[]> {
  return request<PaymentAssignState[]>("/payments/assign-state", { query: { direction } });
}

/** EN_REVISION -> PROCESADO en bloque (`markPaymentsProcessed`). Devuelve cuantos cambio. */
export function markPaymentsProcessed(paymentIds: string[]): Promise<number> {
  return request<number>("/payments/mark-processed", {
    method: "POST",
    body: { paymentIds },
  });
}

/** Resumen de cartera (`getCarteraResumen`). */
export function getCarteraResumen(): Promise<CarteraResumen> {
  return request<CarteraResumen>("/cartera/resumen");
}

/** Movimientos de una cuenta de caja en un rango (`listAccountStatement`). */
export function listAccountStatement(
  cashAccountId: string,
  from: string,
  to: string,
): Promise<Payment[]> {
  return request<Payment[]>(`/cartera/statement/${encodeURIComponent(cashAccountId)}`, {
    query: { from, to },
  });
}

/** Comprobantes con saldo abierto (`listOpenVouchers`). `entityId` filtra por entidad. */
export function listOpenVouchers(
  direction: PaymentDirection,
  entityId?: string,
): Promise<VoucherBalance[]> {
  return request<VoucherBalance[]>("/vouchers/open", {
    query: { direction, entityId },
  });
}

/** Entidades no borradas del dueno (`listClients` / `listSuppliers`). */
export function listEntities(role: "client" | "supplier"): Promise<EntityCatalogItem[]> {
  return request<EntityCatalogItem[]>("/entities", { query: { role } });
}

/** Alta de cliente (`createClientRecord` del origen). El body es el contrato del formulario. */
export function createEntity(values: ClientFormValues): Promise<ClientRecord> {
  return request<ClientRecord>("/entities", { method: "POST", body: values });
}

/** Modificacion de cliente (`updateClientRecord`). Mismo body que el alta. */
export function updateEntity(id: string, values: ClientFormValues): Promise<ClientRecord> {
  return request<ClientRecord>(`/entities/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: values,
  });
}

/**
 * Baja logica (`softDeleteClient`): `POST /entities/:id/delete`.
 *
 * POST y no DELETE porque la fila no desaparece: se marca `deleted_at`, igual que la anulacion
 * de un pago.
 */
export async function softDeleteEntity(id: string): Promise<void> {
  await request<{ deleted: true }>(`/entities/${encodeURIComponent(id)}/delete`, {
    method: "POST",
  });
}

/** Cuentas de caja y banco (`listCashAccounts`). */
export function listCashAccounts(): Promise<CashAccountCatalogItem[]> {
  return request<CashAccountCatalogItem[]>("/cash-accounts");
}

/** Metodos de pago (`listPaymentMethods`). */
export function listPaymentMethods(onlyActive = true): Promise<PaymentMethodCatalogItem[]> {
  return request<PaymentMethodCatalogItem[]>("/payment-methods", {
    query: { onlyActive: String(onlyActive) },
  });
}

/** Categorias de recibo, opcionalmente por direccion (`listCategories`). */
export function listReceiptCategories(
  direction?: PaymentDirection,
): Promise<CashReceiptCategoryCatalogItem[]> {
  return request<CashReceiptCategoryCatalogItem[]>("/receipt-categories", {
    query: { direction },
  });
}

/**
 * Siembra idempotente de las semillas de catalogo del origen (`ensureCatalogsSeeded`).
 *
 * Ver `lib/pagos/catalogs.ts`: en el origen esto escribia dentro del render del formulario; aca
 * es una llamada explicita y una sola vez.
 */
export function ensureCatalogs(): Promise<CatalogSeedResult> {
  return request<CatalogSeedResult>("/catalogs/ensure", { method: "POST", body: {} });
}

/** Smoke del borde de validacion: el API devuelve el payload ya parseado por el schema. */
export function validatePayment(values: PaymentFormValues): Promise<ValidatedPaymentResponse> {
  return request<ValidatedPaymentResponse>("/contract/payments", {
    method: "POST",
    body: values,
  });
}
