import type { TipoComprobante } from "@/lib/tipos-comprobante/dominio";

export type CondicionPago = "contado" | "credito";

export interface ComprobanteCompra {
  id: string;
  fechaEmision: string;
  tipoComprobanteId: string;
  numero: string;
  proveedor: string;
  subtotal: number;
  igv: number;
  total: number;
  condicionPago: CondicionPago;
  fechaVencimiento: string | null;
  activo: boolean;
  creadoEn: string;
}

export type CampoValidable =
  | "fechaEmision"
  | "tipoComprobanteId"
  | "numero"
  | "proveedor"
  | "subtotal"
  | "total"
  | "condicionPago"
  | "fechaVencimiento";

export type CampoError = CampoValidable | "general";

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; errores: Partial<Record<CampoError, string>> };

export type DatosComprobanteCompra = Omit<
  ComprobanteCompra,
  "id" | "igv" | "activo" | "creadoEn"
>;

export const CONDICIONES_PAGO: readonly CondicionPago[] = ["contado", "credito"];

export const ETIQUETAS_CONDICION: Record<CondicionPago, string> = {
  contado: "Contado",
  credito: "Crédito",
};

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export function esCondicionPago(valor: unknown): valor is CondicionPago {
  return typeof valor === "string" && (CONDICIONES_PAGO as readonly string[]).includes(valor);
}

export function esFechaValida(valor: string): boolean {
  if (!FECHA_RE.test(valor)) {
    return false;
  }

  const fecha = new Date(`${valor}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
}

export function calcularIgv(subtotal: number, total: number): number {
  return Math.round((total - subtotal) * 100) / 100;
}

export function normalizarCampos(
  datos: DatosComprobanteCompra,
): DatosComprobanteCompra {
  const esCredito = datos.condicionPago === "credito";
  const vencimiento = (datos.fechaVencimiento ?? "").trim();

  return {
    fechaEmision: datos.fechaEmision.trim(),
    tipoComprobanteId: datos.tipoComprobanteId.trim(),
    numero: datos.numero.trim(),
    proveedor: datos.proveedor.trim(),
    subtotal: datos.subtotal,
    total: datos.total,
    condicionPago: datos.condicionPago,
    fechaVencimiento: esCredito && vencimiento !== "" ? vencimiento : null,
  };
}

function existeTerna(
  comprobantes: ComprobanteCompra[],
  datos: DatosComprobanteCompra,
  idExcluido?: string,
): boolean {
  return comprobantes.some(
    (comprobante) =>
      comprobante.id !== idExcluido &&
      comprobante.tipoComprobanteId === datos.tipoComprobanteId &&
      comprobante.proveedor === datos.proveedor &&
      comprobante.numero === datos.numero,
  );
}

export function validar(
  datos: DatosComprobanteCompra,
  comprobantes: ComprobanteCompra[],
  tipos: TipoComprobante[],
  idExcluido?: string,
): Partial<Record<CampoError, string>> {
  const errores: Partial<Record<CampoError, string>> = {};

  if (!esFechaValida(datos.fechaEmision)) {
    errores.fechaEmision = "Selecciona una fecha de emisión válida.";
  }

  if (!tipos.some((tipo) => tipo.id === datos.tipoComprobanteId)) {
    errores.tipoComprobanteId = "Selecciona un tipo de comprobante válido.";
  }

  if (datos.numero.length < 1 || datos.numero.length > 20) {
    errores.numero = "El número de documento es obligatorio.";
  }

  if (datos.proveedor.length < 2) {
    errores.proveedor = "El proveedor debe tener al menos 2 caracteres.";
  }

  if (!Number.isFinite(datos.subtotal) || datos.subtotal < 0) {
    errores.subtotal = "El subtotal debe ser un número mayor o igual a 0.";
  } else if (!Number.isFinite(datos.total) || datos.total < datos.subtotal) {
    errores.total = "El total no puede ser menor que el subtotal.";
  }

  if (!esCondicionPago(datos.condicionPago)) {
    errores.condicionPago = "Selecciona una condición de pago válida.";
  } else if (datos.condicionPago === "credito") {
    if (datos.fechaVencimiento === null) {
      errores.fechaVencimiento =
        "La fecha de vencimiento es obligatoria para comprobantes a crédito.";
    } else if (!esFechaValida(datos.fechaVencimiento)) {
      errores.fechaVencimiento = "Selecciona una fecha de vencimiento válida.";
    } else if (datos.fechaVencimiento < datos.fechaEmision) {
      errores.fechaVencimiento = "El vencimiento no puede ser anterior a la emisión.";
    }
  }

  if (
    errores.tipoComprobanteId === undefined &&
    errores.numero === undefined &&
    errores.proveedor === undefined &&
    existeTerna(comprobantes, datos, idExcluido)
  ) {
    errores.numero = "Ya existe un comprobante con ese tipo, proveedor y número.";
  }

  return errores;
}
