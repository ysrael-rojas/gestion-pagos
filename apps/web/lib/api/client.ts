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
// Las interfaces de abajo reflejan `apps/api/src/payments/payments.types.ts`,
// `apps/api/src/payments/catalogs.types.ts` y, desde C7 del vertical de cajas-bancos,
// `apps/api/src/cash/cash-flow.types.ts`, que son el contrato de salida del API. Se declaran
// aca (en vez de importarse de apps/api) porque `apps/web` no depende de `@gestion/api`: el
// paquete del backend no es publicable y su build es un bundle de esbuild. Cambiar un campo alla
// es cambiar este archivo, y el unico lugar donde eso se nota rapido son los tests de la UI.
import type {
  CashCloseFormValues,
  CashCountFormValues,
  CashReceiptCategoryFormValues,
  ClientFormValues,
  PaymentFormValues,
  PaymentMethodFormValues,
} from "@gestion/shared";

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

/**
 * Fila completa de `cash_account` (`apps/api/src/cash/cash-accounts.types.ts`).
 *
 * Es el `CashAccount` de `lib/cuentas/entidades.ts:8-32` del origen: `CashAccountCatalogItem` mas
 * todo lo que el formulario de cuentas necesita (los datos bancarios, la periodicidad de cierre,
 * el saldo de apertura con su fecha, las notas y el bloque de caja chica: fondo, limite por vale
 * y custodio). `numeric(12,2)` llega como number y los timestamps como ISO string; `date` viaja
 * "YYYY-MM-DD" sin conversion.
 *
 * No confundir con `CashAccountCatalogItem`: ese es el selector del formulario de pagos y sigue
 * devolviendo cinco columnas. La fila completa la devuelven `GET /cash-accounts/:id` y las dos
 * escrituras.
 */
export interface CashAccountRecord extends CashAccountCatalogItem {
  bankName: string | null;
  accountNumber: string | null;
  cci: string | null;
  closingPeriodicity: ClosingPeriodicity | null;
  openingBalance: number;
  openingBalanceDate: string;
  notes: string | null;
  isPettyCash: boolean;
  changeFund: number;
  pettyExpenseLimit: number | null;
  custodianName: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Body de `POST /cash-accounts` y `PATCH /cash-accounts/:id`
 * (`apps/api/src/cash/cash-accounts.query.ts`).
 *
 * Es el `CashAccountFormMutation` del origen (`lib/cuentas/entidades.ts:34-50`): los seis campos
 * que el formulario siempre manda van obligatorios y el resto es opcional. `type` viaja en el
 * body porque el schema compartido de la FILA no lo trae.
 *
 * El PATCH REEMPLAZA las columnas editables (no es un merge): la UI manda el formulario completo y
 * un opcional omitido vuelve a su default del schema compartido.
 */
export interface CashAccountWrite {
  type: CashAccountType;
  name: string;
  currency: string;
  openingBalance: number;
  openingBalanceDate: string;
  isActive: boolean;
  bankName?: string;
  accountNumber?: string;
  cci?: string;
  closingPeriodicity?: ClosingPeriodicity | null;
  notes?: string;
  isPettyCash?: boolean;
  changeFund?: number;
  pettyExpenseLimit?: number;
  custodianName?: string;
}

/**
 * Una fila de `GET /cash-positions` (`apps/api/src/cash/positions.types.ts`).
 *
 * Es la union que el origen hacia en el cliente de la RPC `get_cash_positions` con
 * `listCashAccounts()` (`listCashPositionsConsolidated`, `lib/caja/caja.ts:453-476`), ya resuelta
 * en SQL: el SALDO lo devuelve la base (S2) y las otras siete columnas son de la misma fila de
 * `cash_account`, que es lo que leen el dashboard (`type`, `currency`, `balance`) y el listado
 * (`name`, `bankName`, `closingPeriodicity`, `isPettyCash`).
 *
 * El origen lo tipaba anidado (`CashAccountPosition { account, balance }`); aca la fila es plana
 * porque asi la devuelve el API y no hay nada que anidar. Cambiarla es cambiar
 * `positions.types.ts` alla.
 */
export interface CashAccountPosition {
  accountId: string;
  name: string;
  type: CashAccountType;
  currency: string;
  balance: number;
  bankName: string | null;
  closingPeriodicity: ClosingPeriodicity | null;
  isPettyCash: boolean;
}

/**
 * `GET /last-movement-dates`: `accountId -> "YYYY-MM-DD"` del ultimo recibo no anulado.
 *
 * Una cuenta AUSENTE del mapa no tiene movimientos (la UI muestra "sin movimientos"), que es
 * justo lo que el origen decidia con este mapa (`lib/caja/caja.ts:478-500`).
 */
export type LastMovementDates = Record<string, string>;

/**
 * Una fila del conteo fisico de un cierre (`cash_close_denomination`).
 *
 * Es el `CloseDenomination` del origen (`lib/caja/caja.ts`, `listCloseDenominations`), la misma
 * forma que manda el modal al cerrar, asi que la grilla del acta no traduce nada.
 */
export interface CloseDenomination {
  denomination: number;
  quantity: number;
}

/**
 * Un cierre de caja (`GET /cash-closes`, `apps/api/src/cash/closes.types.ts`).
 *
 * Es el `CashClose` del origen campo por campo (`components/pagos/types.ts:103-130`): los totales
 * y la `difference` los escribio la RPC `close_cash_account`, no la app (S2). `differenceTolerance`
 * es el snapshot de la tolerancia vigente al cerrar y `countedBy`/`verifiedBy` la doble firma del
 * acta; los tres son `null` en los cierres anteriores a esas migraciones.
 */
export interface CashCloseRecord {
  id: string;
  cashAccountId: string;
  periodicity: ClosingPeriodicity;
  periodStart: string;
  periodEnd: string;
  openingBalance: number;
  incomeTotal: number;
  expenseTotal: number;
  expectedBalance: number;
  transferInTotal: number;
  transferOutTotal: number;
  countedBalance: number | null;
  changeFund: number | null;
  difference: number | null;
  differenceReason: string | null;
  differenceTolerance: number | null;
  countedBy: string | null;
  verifiedBy: string | null;
  penUsdRate: number | null;
  notes: string | null;
  createdAt: string;
}

/**
 * `GET /cash-closes/:id` y la respuesta del alta: el cierre con su arqueo por denominacion.
 *
 * El origen pedia el cierre y el detalle en paralelo; el API los devuelve juntos porque los lee
 * en la misma transaccion. `denominations` viene vacio en los cierres de banco.
 */
export interface CashCloseDetail extends CashCloseRecord {
  denominations: CloseDenomination[];
}

/**
 * Un arqueo sorpresivo (`GET /cash-counts`, `lib/caja/arqueos.ts:8-21` del origen).
 *
 * `expectedBalance` y `difference` los calculo `register_cash_count` con la misma formula que el
 * cierre (`private.cash_expected_balance`): la UI los muestra, no los deriva.
 */
export interface CashCountRecord {
  id: string;
  accountId: string;
  countDate: string;
  countedBalance: number;
  expectedBalance: number;
  difference: number;
  changeFund: number | null;
  countedBy: string | null;
  isSurprise: boolean;
  notes: string | null;
  createdAt: string;
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

/** Los tres valores del enum `closing_periodicity` (`apps/api/src/cash/settings.types.ts`). */
export type ClosingPeriodicity = "DAILY" | "WEEKLY" | "MONTHLY";

/**
 * Ajustes del dueno: `key -> value`, tal como estan en `app_setting`.
 *
 * Es un mapa de strings y no un objeto con las tres claves porque la tabla es clave/valor y
 * admite cualquier clave; los lectores con defaults viven en `lib/cajas-bancos/settings.ts`.
 */
export type AppSettings = Record<string, string>;

/**
 * Body de `PATCH /settings`: solo las tres claves que expone la tarjeta de configuracion.
 *
 * Los numeros viajan como numeros; el API los normaliza como los guardaba el origen
 * (`String(rate)` y `tolerance.toFixed(2)`), asi que el valor guardado no depende del cliente.
 */
export interface SettingsUpdate {
  default_closing_periodicity?: ClosingPeriodicity;
  pen_usd_rate?: number;
  cash_difference_tolerance?: number;
}

/** `POST /settings/ensure`: cuantas filas falto crear (`0` = ya estaba sembrado). */
export interface SettingsSeedResult {
  created: number;
}

/**
 * `GET /cash-flow/monthly?from=&to=`: ingresos, egresos y neto del periodo.
 *
 * Espeja `MonthlyCashFlow` de `apps/api/src/cash/cash-flow.types.ts`, que a su vez es el
 * `CashFlowTotals` de `lib/caja/dashboard.ts` del origen (tres claves, estos nombres: el dashboard
 * es el consumidor). `net` es ingresos − egresos y PUEDE SER NEGATIVO; no es un saldo.
 *
 * Los tres numeros los agrega PostgreSQL con el filtro del origen (`status <> 'ANULADO'` y fecha
 * INCLUSIVE en los dos bordes). La web NO suma recibos para producirlos (S2).
 */
export interface MonthlyCashFlow {
  income: number;
  expense: number;
  net: number;
}

/** Body de `PATCH` de los dos catalogos: nombre y estado, los dos opcionales. */
export interface CatalogPatch {
  name?: string;
  isActive?: boolean;
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

/**
 * Llamada JSON al API con el contrato unico del frontend: base segun donde corra, `ApiError` con
 * el `message` del dominio intacto y `undefined` en 204.
 *
 * Es la unica implementacion de transporte del repo. Los modulos de un vertical que no pueden
 * escribir en este archivo (por ejemplo `lib/cajas-bancos/transporte.ts`) la importan en vez de
 * copiar el `fetch`: dos `fetch` divergen en lo que importa (errores, credenciales, no-store), y
 * eso fue exactamente la deuda que dejo C6 del vertical de cajas-bancos.
 */
export async function request<T>(
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

/**
 * Catalogo de cuentas del dueno (`listCashAccounts` del origen), para el selector de pagos.
 *
 * Cinco columnas y nada mas: es el contrato que consume `components/pagos/*`. La fila completa del
 * vertical de cajas-bancos se pide por id (`getCashAccount`) o vuelve de una escritura.
 */
export function listCashAccounts(): Promise<CashAccountCatalogItem[]> {
  return request<CashAccountCatalogItem[]>("/cash-accounts");
}

/** Fila completa de una cuenta viva del dueno (`GET /cash-accounts/:id`). */
export function getCashAccount(id: string): Promise<CashAccountRecord> {
  return request<CashAccountRecord>(`/cash-accounts/${encodeURIComponent(id)}`);
}

/** Alta de cuenta (`createCashAccount` del origen). Devuelve la fila completa creada. */
export function createCashAccount(values: CashAccountWrite): Promise<CashAccountRecord> {
  return request<CashAccountRecord>("/cash-accounts", { method: "POST", body: values });
}

/** Modificacion (`updateCashAccount`). Reemplaza las columnas editables, no hace merge. */
export function updateCashAccount(
  id: string,
  values: CashAccountWrite,
): Promise<CashAccountRecord> {
  return request<CashAccountRecord>(`/cash-accounts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: values,
  });
}

/**
 * Baja logica (`softDeleteCashAccount`): `POST /cash-accounts/:id/delete`.
 *
 * POST y no DELETE porque la fila no desaparece: se marca `deleted_at` (los pagos y cierres la
 * referencian), igual que la baja de una entidad o la anulacion de un pago.
 */
export async function softDeleteCashAccount(id: string): Promise<void> {
  await request<{ deleted: true }>(`/cash-accounts/${encodeURIComponent(id)}/delete`, {
    method: "POST",
  });
}

/**
 * Saldos de todas las cuentas vivas del dueno (`listCashPositionsConsolidated` del origen).
 *
 * Una sola llamada: el origen pedia la RPC de posiciones y el catalogo de cuentas en paralelo y
 * los cruzaba en el cliente. `asOf` es el corte; sin el, la base usa `current_date`.
 */
export function listCashPositions(asOf?: string): Promise<CashAccountPosition[]> {
  return request<CashAccountPosition[]>("/cash-positions", { query: { asOf } });
}

/**
 * Saldo de UNA cuenta a una fecha (`getCashPosition` del origen, que devolvia un number).
 *
 * Un id inexistente, borrado o de otro dueno responde 404: el `ApiError` llega con el mensaje de
 * dominio del API. No se devuelve un 0 silencioso, que seria un saldo inventado.
 */
export function getCashPosition(accountId: string, asOf?: string): Promise<number> {
  return request<number>(`/cash-accounts/${encodeURIComponent(accountId)}/position`, {
    query: { asOf },
  });
}

/**
 * Ultimo recibo no anulado por cuenta (`listLastMovementDates` del origen).
 *
 * Una sola llamada (la RPC `list_last_movement_dates`): PostgREST rechazaba el agregado
 * `payment_date.max()` en el origen y por eso se movio a SQL (SPEC 55).
 */
export function listLastMovementDates(): Promise<LastMovementDates> {
  return request<LastMovementDates>("/last-movement-dates");
}

/**
 * Cierres del dueno (`listCashCloses` del origen), del mas reciente al mas antiguo.
 *
 * `accountId` es el filtro de la pantalla de cuadres; sin el vuelve el historial completo, que es
 * lo que necesita el dashboard para consolidar.
 *
 * El prefijo `cash-closes` todavia NO esta en la lista blanca del puente del navegador
 * (`app/api/backend/[...path]/route.ts`): desde un Server Component anda, desde el navegador
 * responde 404 del puente hasta que se agregue alla (fuera de la superficie de C4).
 */
export function listCashCloses(accountId?: string): Promise<CashCloseRecord[]> {
  return request<CashCloseRecord[]>("/cash-closes", { query: { accountId } });
}

/**
 * Un cierre con su arqueo (`getCashClose` + `listCloseDenominations` del origen).
 *
 * Un id inexistente o de otro dueno responde 404: la RLS recorta la fila antes de que el API la
 * vea, asi que nunca se devuelven las denominaciones de otro dueno.
 */
export function getCashClose(id: string): Promise<CashCloseDetail> {
  return request<CashCloseDetail>(`/cash-closes/${encodeURIComponent(id)}`);
}

/**
 * Cierra un periodo (`closeCashAccount` del origen, RPC `close_cash_account`).
 *
 * El body es el contrato del modal (`CashCloseFormValues` de `@gestion/shared`). Las reglas que
 * deciden si el cierre se permite las aplica la base (periodo ya cerrado, fecha futura,
 * tolerancia sin motivo): el `ApiError` trae su mensaje ya redactado y el modal lo muestra tal
 * cual. El cierre es IRREVERSIBLE: no hay endpoint de reapertura.
 */
export function createCashClose(values: CashCloseFormValues): Promise<CashCloseDetail> {
  return request<CashCloseDetail>("/cash-closes", { method: "POST", body: values });
}

/**
 * Arqueos sorpresivos del dueno (`listCashCounts` del origen), del mas reciente al mas antiguo.
 *
 * Filtro `accountId` como en los cierres; el mismo aviso del puente del navegador aplica al
 * prefijo `cash-counts`.
 */
export function listCashCounts(accountId?: string): Promise<CashCountRecord[]> {
  return request<CashCountRecord[]>("/cash-counts", { query: { accountId } });
}

/**
 * Registra un arqueo que no cierra periodo (`createCashCount`, RPC `register_cash_count`).
 *
 * Devuelve la fila recien creada, que es lo que el origen releia con `getCashCount` despues de
 * la RPC.
 */
export function createCashCount(values: CashCountFormValues): Promise<CashCountRecord> {
  return request<CashCountRecord>("/cash-counts", { method: "POST", body: values });
}

/** Metodos de pago (`listPaymentMethods`). */
export function listPaymentMethods(onlyActive = true): Promise<PaymentMethodCatalogItem[]> {
  return request<PaymentMethodCatalogItem[]>("/payment-methods", {
    query: { onlyActive: String(onlyActive) },
  });
}

/**
 * Categorias de recibo, opcionalmente por direccion (`listCategories`).
 *
 * `onlyActive` viaja por default en `true`, que es el contrato del formulario de pagos: ahi una
 * categoria desactivada no debe ofrecerse. La tarjeta de configuracion manda `false` porque
 * necesita ver tambien las desactivadas — de lo contrario la fila desaparece del listado y no hay
 * forma de volver a activarla desde la UI.
 */
export function listReceiptCategories(
  direction?: PaymentDirection,
  onlyActive = true,
): Promise<CashReceiptCategoryCatalogItem[]> {
  return request<CashReceiptCategoryCatalogItem[]>("/receipt-categories", {
    query: { direction, onlyActive: String(onlyActive) },
  });
}

/**
 * Alta de metodo de pago (`createPaymentMethod` del origen, C7).
 *
 * El body es el schema compartido del formulario (`paymentMethodSchema`), asi que el `code` viaja ya
 * normalizado (trim, mayusculas, espacios a guion bajo) y un codigo repetido responde 409 con un
 * mensaje que lo nombra: el llamador muestra ese texto tal cual.
 */
export function createPaymentMethod(
  values: PaymentMethodFormValues,
): Promise<PaymentMethodCatalogItem> {
  return request<PaymentMethodCatalogItem>("/payment-methods", {
    method: "POST",
    body: values,
  });
}

/**
 * Renombrar y/o activar o desactivar un metodo (`updatePaymentMethod`, C7).
 *
 * PATCH PARCIAL y sin `code`: el codigo es inmutable despues del alta (no esta en el schema del
 * body, asi que el API lo descarta si se manda). No hay `DELETE`: "borrar" un catalogo es
 * desactivarlo, porque los recibos lo referencian. Devuelve la fila ya guardada.
 */
export function updatePaymentMethod(
  id: string,
  values: CatalogPatch,
): Promise<PaymentMethodCatalogItem> {
  return request<PaymentMethodCatalogItem>(`/payment-methods/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: values,
  });
}

/**
 * Alta de categoria de recibo (`createCategory` del origen, C7).
 *
 * SIN `code`: el codigo estable lo DERIVA el API del nombre (`categoryCodeFromName`) porque la
 * columna es `not null` y unica por dueno, y duplicar la derivacion en la web podria producir dos
 * codigos distintos para el mismo nombre. El schema compartido del formulario tampoco lo tiene.
 */
export function createReceiptCategory(
  values: CashReceiptCategoryFormValues,
): Promise<CashReceiptCategoryCatalogItem> {
  return request<CashReceiptCategoryCatalogItem>("/receipt-categories", {
    method: "POST",
    body: values,
  });
}

/**
 * Renombrar y/o activar o desactivar una categoria (`updateCategory`, C7).
 *
 * PATCH parcial: renombrar NO re-deriva el `code` (SPEC 37: el codigo sobrevive al renombre) y la
 * `direction` no se toca. Mismo criterio que los metodos: desactivar es el "borrado".
 */
export function updateReceiptCategory(
  id: string,
  values: CatalogPatch,
): Promise<CashReceiptCategoryCatalogItem> {
  return request<CashReceiptCategoryCatalogItem>(`/receipt-categories/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: values,
  });
}

/**
 * Ingresos, egresos y neto de un periodo (`getMonthlyCashFlow(from, to)` del origen).
 *
 * Las dos fechas son obligatorias y el rango es INCLUSIVE en las dos puntas, porque el rango lo
 * elige la pantalla (mes actual, mes anterior). El calculo es SQL (S2): esta funcion no suma nada,
 * solo transporta el agregado que ya excluyo los recibos anulados.
 */
export function getMonthlyCashFlow(from: string, to: string): Promise<MonthlyCashFlow> {
  return request<MonthlyCashFlow>("/cash-flow/monthly", { query: { from, to } });
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

/**
 * Ajustes del dueno (`getAppSettings`). Lectura pura: no siembra nada, aunque el dueno no tenga
 * ninguna fila todavia (`GET /settings` devuelve `{}`).
 */
export function getSettings(): Promise<AppSettings> {
  return request<AppSettings>("/settings");
}

/**
 * Upsert parcial de los ajustes de la tarjeta (`setAppSetting`, tres veces en el origen).
 *
 * Devuelve el mapa completo ya guardado, que es lo que la tarjeta vuelve a leer.
 */
export function updateSettings(values: SettingsUpdate): Promise<AppSettings> {
  return request<AppSettings>("/settings", { method: "PATCH", body: values });
}

/**
 * Siembra idempotente de las tres semillas del origen (`ensureDefaultSettings`, deuda L67).
 *
 * Ver `lib/cajas-bancos/settings.ts`: en el origen esto escribia dentro del render de la tarjeta
 * de configuracion; aca es una llamada explicita y una sola vez.
 */
export function ensureSettings(): Promise<SettingsSeedResult> {
  return request<SettingsSeedResult>("/settings/ensure", { method: "POST", body: {} });
}

/** Smoke del borde de validacion: el API devuelve el payload ya parseado por el schema. */
export function validatePayment(values: PaymentFormValues): Promise<ValidatedPaymentResponse> {
  return request<ValidatedPaymentResponse>("/contract/payments", {
    method: "POST",
    body: values,
  });
}
