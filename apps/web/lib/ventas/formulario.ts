// Formulario del comprobante: lo que no es JSX (T4 del port, S1, S3, S5 y S9).
//
// El formulario es COMPARTIDO con compras (`voucherKind`), asi que ni los titulos, ni la etiqueta
// de la entidad, ni la ruta base pueden estar hardcodeadas a ventas: salen de `voucherCopy` (S1).
//
// Lo que este modulo fija y el JSX solo dibuja:
//
//   * Los valores iniciales del alta (S9: el "hoy" del negocio, via `getTodayLocalDate()`, nunca
//     `toISOString()`).
//   * Los valores iniciales de la edicion, incluido el `""` de los dias de credito cuando el
//     comprobante es CONTADO (S3: el campo se limpia, no queda en 0).
//   * La regla de pantalla "FACTURA exige cliente con RUC" (S5). NO esta en el schema ni en la
//     base: T3 decidio a proposito no validarla en el API, porque bloquearia la edicion de
//     comprobantes historicos; vive aca y se aplica al elegir el tipo y al enviar.
//   * El body del POST/PATCH (`toVoucherRequestBody`), que NO es el output del formulario sin
//     tocar: ver su comentario.
//   * El preview del numero de comprobante (`previewVoucherNumber`, S11): el numero dejo de
//     tipearse en el slice 2, lo asigna la base.
import {
  DEFAULT_CREDIT_DAYS,
  DEFAULT_SALE_STATUS,
} from "@gestion/shared/lib/data/sale-options.ts";
import type {
  VoucherFormInput,
  VoucherFormValues,
} from "@gestion/shared/lib/schemas/voucher.ts";
import { getTodayLocalDate } from "@gestion/shared/lib/utils.ts";

import type {
  PaymentType,
  Voucher,
  VoucherKind,
  VoucherSeries,
  VoucherType,
  VoucherWriteBody,
} from "./types.ts";
import { suggestVoucherNumber } from "./series.ts";

/** Error que se cuelga del select de tipo cuando el cliente no puede recibir factura (S5). */
export const FACTURA_REQUIRES_RUC = "No se puede emitir factura a un cliente sin RUC";

/** Ayuda permanente debajo del select de tipo, mientras no haya RUC (S5). */
export const FACTURA_RUC_HINT = "Para emitir factura, el cliente debe tener RUC.";

/** Lo que muestra el campo "Direccion" cuando la entidad no tiene una (S5). */
export const NO_ADDRESS_PLACEHOLDER = "Sin dirección registrada";

export interface VoucherKindCopy {
  /** "Cliente" / "Proveedor". */
  entityLabel: string;
  entityPlaceholder: string;
  entityNameFallback: string;
  basePath: string;
  /** "venta" / "compra": se usa en los titulos de la pantalla. */
  entityNoun: string;
  createTitle: string;
  editTitle: string;
  createSubtitle: string;
  editSubtitle: string;
}

const VOUCHER_KIND_COPY: Record<VoucherKind, VoucherKindCopy> = {
  VENTA: {
    entityLabel: "Cliente",
    entityPlaceholder: "Buscar cliente...",
    entityNameFallback: "Cliente no encontrado",
    basePath: "/ventas",
    entityNoun: "venta",
    createTitle: "Registrar venta",
    editTitle: "Editar venta",
    createSubtitle: "Completa los datos para registrar una nueva venta",
    editSubtitle: "Modifica los datos del comprobante",
  },
  COMPRA: {
    entityLabel: "Proveedor",
    entityPlaceholder: "Buscar proveedor...",
    entityNameFallback: "Proveedor no encontrado",
    basePath: "/compras",
    entityNoun: "compra",
    createTitle: "Registrar compra",
    editTitle: "Editar compra",
    createSubtitle: "Completa los datos para registrar una nueva compra",
    editSubtitle: "Modifica los datos del comprobante",
  },
};

/** Textos de la pantalla segun el vertical (S1: el formulario y el detalle son compartidos). */
export function voucherCopy(voucherKind: VoucherKind): VoucherKindCopy {
  return VOUCHER_KIND_COPY[voucherKind];
}

/**
 * Valores iniciales del alta.
 *
 * `voucherType` y `paymentType` arrancan vacios a proposito: son las dos decisiones que el usuario
 * tiene que tomar, y el schema compartido ya las exige con sus mensajes de S4.
 */
export function createEmptyVoucherFormValues(): VoucherFormInput {
  return {
    issueDate: getTodayLocalDate(),
    voucherType: "" as VoucherType,
    voucherNumber: "",
    entityId: "",
    total: "",
    paymentType: "" as PaymentType,
    creditDays: "",
    status: DEFAULT_SALE_STATUS,
  };
}

/** Valores iniciales de la edicion, a partir del comprobante que devuelve el API. */
export function toVoucherFormValues(voucher: Voucher): VoucherFormInput {
  return {
    issueDate: voucher.issueDate,
    voucherType: voucher.voucherType,
    voucherNumber: voucher.voucherNumber,
    entityId: voucher.entityId,
    total: voucher.total,
    paymentType: voucher.paymentType,
    // En CONTADO los dias son `null` en la base: el campo arranca vacio, no en 0 (S3).
    creditDays: voucher.creditDays ?? "",
    status: voucher.status,
  };
}

/**
 * Dias de credito que pone el formulario al cambiar la condicion (S3).
 *
 * Al elegir Crédito arranca en 30 (el plazo comercial del origen) y al volver a Contado se limpia:
 * la base tiene el CHECK `comprobante_credit_days`, y mandar dias en CONTADO se rechaza.
 */
export function creditDaysForPaymentType(paymentType: PaymentType | ""): number | "" {
  return paymentType === "CREDITO" ? DEFAULT_CREDIT_DAYS : "";
}

/**
 * Si la entidad elegida puede recibir una factura.
 *
 * Solo se aplica a ventas: en compras el tipo queda libre, como en el origen. Sin entidad elegida
 * todavia la respuesta es `false`, que es lo que muestra la ayuda de S5 en el formulario vacio.
 */
export function canIssueFactura(
  voucherKind: VoucherKind,
  entity: { documentType: string } | null | undefined
): boolean {
  if (voucherKind !== "VENTA") {
    return true;
  }

  return entity?.documentType === "RUC";
}

/** Aviso de comprobante con pagos (S5); nombra la entidad del vertical. */
export function paidLockMessage(voucherKind: VoucherKind): string {
  return voucherKind === "VENTA"
    ? "Este comprobante tiene pagos registrados: importe, número, cliente y fecha quedan bloqueados. Anula los pagos si necesitas corregirlo."
    : "Este comprobante tiene pagos registrados: importe, número, proveedor y fecha quedan bloqueados. Anula los pagos si necesitas corregirlo.";
}

/** Si el comprobante ya tiene pagos, importe/numero/entidad/fecha quedan bloqueados (S5). */
export function isPaidLocked(
  voucher: { paidAmount: number } | null | undefined
): boolean {
  return (voucher?.paidAmount ?? 0) > 0;
}

/**
 * Numero que muestra el campo de solo lectura (S11).
 *
 * Dos casos, y solo dos:
 *
 *   * Edicion: el numero ya emitido del comprobante. Es INMUTABLE (S13.3), asi que el preview no
 *     puede recalcularse desde la serie aunque esta haya avanzado desde que se emitio.
 *   * Alta: el proximo correlativo de la serie por defecto del tipo elegido (`F001-000126`). Es un
 *     preview y puede venir viejo: el numero real lo asigna la base dentro de la transaccion que
 *     escribe el comprobante (S2), y es el que devuelve el detalle.
 *
 * Sin tipo elegido o sin serie por defecto devuelve `""`: no se inventa un numero. Ese caso lo
 * cubre el bloqueo de la pantalla (`isSaleSeriesBlocked`) y los tipos deshabilitados.
 */
export function previewVoucherNumber(
  voucher: Pick<Voucher, "voucherNumber"> | null | undefined,
  defaultSeries:
    | Pick<VoucherSeries, "code" | "lastNumber">
    | null
    | undefined
): string {
  if (voucher) {
    return voucher.voucherNumber;
  }

  return defaultSeries ? suggestVoucherNumber(defaultSeries) : "";
}

/**
 * Body de `POST /vouchers` y `PATCH /vouchers/:id`.
 *
 * TRAMPA DEL PORT: el OUTPUT de `voucherFormSchema` (`creditDays: null` en CONTADO) **no** es un
 * INPUT valido del mismo schema, porque `z.coerce.number(null)` da `0` y falla `min(1)`. Como el
 * API revalida el body con ese schema compartido, mandar el output tal cual devolveria 400 "Los
 * días de crédito deben ser al menos 1" en toda venta al contado. En CONTADO el campo se OMITE
 * (no se manda `null` ni `""`), que el schema acepta y vuelve a normalizar a `null`.
 *
 * `status` viaja porque es parte del contrato del formulario, aunque el API no lo escriba: lo
 * deriva la tabla y lo recalcula `refresh_comprobante_status` al asignar o anular pagos.
 *
 * `voucherNumber` NO viaja (T5 del slice 2, S11): el numero lo asigna la base desde la serie por
 * defecto del tipo (S2) y el `preview` de la pantalla es solo una ayuda visual. El contrato de
 * escritura (`voucherWriteSchema`) sigue aceptandolo y ignorandolo por compatibilidad, pero el
 * cliente ya no lo manda.
 */
export function toVoucherRequestBody(values: VoucherFormValues): VoucherWriteBody {
  const body: VoucherWriteBody = {
    issueDate: values.issueDate,
    voucherType: values.voucherType,
    entityId: values.entityId,
    total: values.total,
    paymentType: values.paymentType,
    status: values.status,
  };

  if (values.creditDays != null) {
    body.creditDays = values.creditDays;
  }

  return body;
}
