import {
  calcularIgv,
  normalizarCampos,
  validar,
  type ComprobanteCompra,
  type DatosComprobanteCompra,
  type Resultado,
} from "@/lib/comprobantes/dominio";
import { listar as listarTipos } from "@/lib/tipos-comprobante/repo";

const CLAVE = "gestion-pagos:comprobantes:v1";

export interface ComprobanteCompraVista extends ComprobanteCompra {
  tipoNombre: string;
}

const SEMILLA: ComprobanteCompra[] = [
  {
    id: "comprobante-0001",
    fechaEmision: "2026-01-15",
    tipoComprobanteId: "tipo-factura",
    numero: "F001-00001234",
    proveedor: "Distribuidora San Martín S.A.C.",
    subtotal: 1000,
    igv: 180,
    total: 1180,
    condicionPago: "contado",
    fechaVencimiento: null,
    activo: true,
    creadoEn: "2026-01-15T09:30:00.000Z",
  },
  {
    id: "comprobante-0002",
    fechaEmision: "2026-01-28",
    tipoComprobanteId: "tipo-factura",
    numero: "F001-00001235",
    proveedor: "Inversiones Andinas S.A.C.",
    subtotal: 2500,
    igv: 450,
    total: 2950,
    condicionPago: "credito",
    fechaVencimiento: "2026-02-28",
    activo: true,
    creadoEn: "2026-01-28T15:10:00.000Z",
  },
  {
    id: "comprobante-0003",
    fechaEmision: "2026-02-03",
    tipoComprobanteId: "tipo-boleta",
    numero: "B001-00000456",
    proveedor: "Ferretería El Sol E.I.R.L.",
    subtotal: 320,
    igv: 57.6,
    total: 377.6,
    condicionPago: "contado",
    fechaVencimiento: null,
    activo: true,
    creadoEn: "2026-02-03T11:45:00.000Z",
  },
  {
    id: "comprobante-0004",
    fechaEmision: "2026-02-12",
    tipoComprobanteId: "tipo-recibo-honorarios",
    numero: "E001-00000078",
    proveedor: "Estudio Contable Vega & Asociados",
    subtotal: 800,
    igv: 0,
    total: 800,
    condicionPago: "contado",
    fechaVencimiento: null,
    activo: true,
    creadoEn: "2026-02-12T08:20:00.000Z",
  },
  {
    id: "comprobante-0005",
    fechaEmision: "2026-02-20",
    tipoComprobanteId: "tipo-ticket",
    numero: "T001-00000912",
    proveedor: "Grifería Central E.I.R.L.",
    subtotal: 150,
    igv: 27,
    total: 177,
    condicionPago: "contado",
    fechaVencimiento: null,
    activo: true,
    creadoEn: "2026-02-20T17:05:00.000Z",
  },
  {
    id: "comprobante-0006",
    fechaEmision: "2026-03-01",
    tipoComprobanteId: "tipo-factura",
    numero: "F001-00001240",
    proveedor: "Suministros Pacífico S.A.C.",
    subtotal: 4800,
    igv: 864,
    total: 5664,
    condicionPago: "credito",
    fechaVencimiento: "2026-04-15",
    activo: true,
    creadoEn: "2026-03-01T10:00:00.000Z",
  },
  {
    id: "comprobante-0007",
    fechaEmision: "2026-03-10",
    tipoComprobanteId: "tipo-nota-credito",
    numero: "NC01-00000023",
    proveedor: "Textiles del Norte S.A.",
    subtotal: 500,
    igv: 90,
    total: 590,
    condicionPago: "contado",
    fechaVencimiento: null,
    activo: true,
    creadoEn: "2026-03-10T14:35:00.000Z",
  },
  {
    id: "comprobante-0008",
    fechaEmision: "2026-03-18",
    tipoComprobanteId: "tipo-boleta",
    numero: "B001-00000480",
    proveedor: "Transportes Rápidos del Sur S.R.L.",
    subtotal: 950,
    igv: 171,
    total: 1121,
    condicionPago: "credito",
    fechaVencimiento: "2026-04-30",
    activo: false,
    creadoEn: "2026-03-18T12:15:00.000Z",
  },
];

function clonarSemilla(): ComprobanteCompra[] {
  return SEMILLA.map((comprobante) => ({ ...comprobante }));
}

function generarId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `comprobante-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escribir(comprobantes: ComprobanteCompra[]): void {
  window.localStorage.setItem(CLAVE, JSON.stringify(comprobantes));
}

function leer(): ComprobanteCompra[] {
  if (typeof window === "undefined") {
    return clonarSemilla();
  }

  const bruto = window.localStorage.getItem(CLAVE);

  if (bruto === null) {
    return clonarSemilla();
  }

  try {
    const parseado: unknown = JSON.parse(bruto);

    if (!Array.isArray(parseado)) {
      return clonarSemilla();
    }

    return parseado as ComprobanteCompra[];
  } catch {
    return clonarSemilla();
  }
}

function conNombreTipo(comprobantes: ComprobanteCompra[]): ComprobanteCompraVista[] {
  const nombres = new Map(listarTipos().map((tipo) => [tipo.id, tipo.nombre]));

  return comprobantes.map((comprobante) => ({
    ...comprobante,
    tipoNombre: nombres.get(comprobante.tipoComprobanteId) ?? "—",
  }));
}

export function listar(): ComprobanteCompraVista[] {
  return conNombreTipo(leer());
}

export function obtener(id: string): ComprobanteCompraVista | null {
  const comprobante = leer().find((item) => item.id === id);

  return comprobante === undefined ? null : conNombreTipo([comprobante])[0];
}

export function crear(datos: DatosComprobanteCompra): Resultado<ComprobanteCompra> {
  const comprobantes = leer();
  const normalizados = normalizarCampos(datos);
  const errores = validar(normalizados, comprobantes, listarTipos());

  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const comprobante: ComprobanteCompra = {
    id: generarId(),
    ...normalizados,
    igv: calcularIgv(normalizados.subtotal, normalizados.total),
    activo: true,
    creadoEn: new Date().toISOString(),
  };

  escribir([...comprobantes, comprobante]);

  return { ok: true, valor: comprobante };
}

export function actualizar(
  id: string,
  datos: DatosComprobanteCompra,
): Resultado<ComprobanteCompra> {
  const comprobantes = leer();
  const indice = comprobantes.findIndex((item) => item.id === id);

  if (indice === -1) {
    return { ok: false, errores: { general: "El comprobante no existe." } };
  }

  const normalizados = normalizarCampos(datos);
  const errores = validar(normalizados, comprobantes, listarTipos(), id);

  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const actualizado: ComprobanteCompra = {
    ...comprobantes[indice],
    ...normalizados,
    igv: calcularIgv(normalizados.subtotal, normalizados.total),
  };

  escribir(comprobantes.map((item) => (item.id === id ? actualizado : item)));

  return { ok: true, valor: actualizado };
}

export function desactivar(id: string): Resultado<ComprobanteCompra> {
  return cambiarEstado(id, false);
}

export function reactivar(id: string): Resultado<ComprobanteCompra> {
  return cambiarEstado(id, true);
}

function cambiarEstado(id: string, activo: boolean): Resultado<ComprobanteCompra> {
  const comprobantes = leer();
  const objetivo = comprobantes.find((item) => item.id === id);

  if (objetivo === undefined) {
    return { ok: false, errores: { general: "El comprobante no existe." } };
  }

  const actualizado: ComprobanteCompra = { ...objetivo, activo };
  escribir(comprobantes.map((item) => (item.id === id ? actualizado : item)));

  return { ok: true, valor: actualizado };
}
