import {
  normalizarCampos,
  validar,
  type DatosTipoComprobante,
  type Resultado,
  type TipoComprobante,
} from "@/lib/tipos-comprobante/dominio";

const CLAVE = "gestion-pagos:tipos-comprobante:v1";

const SEMILLA: TipoComprobante[] = [
  {
    id: "tipo-factura",
    nombre: "Factura",
    activo: true,
    creadoEn: "2026-01-05T10:00:00.000Z",
  },
  {
    id: "tipo-boleta",
    nombre: "Boleta",
    activo: true,
    creadoEn: "2026-01-05T10:00:00.000Z",
  },
  {
    id: "tipo-recibo-honorarios",
    nombre: "Recibo por honorarios",
    activo: true,
    creadoEn: "2026-01-05T10:00:00.000Z",
  },
  {
    id: "tipo-ticket",
    nombre: "Ticket",
    activo: true,
    creadoEn: "2026-01-05T10:00:00.000Z",
  },
  {
    id: "tipo-nota-credito",
    nombre: "Nota de crédito",
    activo: true,
    creadoEn: "2026-01-05T10:00:00.000Z",
  },
];

function clonarSemilla(): TipoComprobante[] {
  return SEMILLA.map((tipo) => ({ ...tipo }));
}

function generarId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `tipo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escribir(tipos: TipoComprobante[]): void {
  window.localStorage.setItem(CLAVE, JSON.stringify(tipos));
}

function leer(): TipoComprobante[] {
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

    return parseado as TipoComprobante[];
  } catch {
    return clonarSemilla();
  }
}

export function listar(): TipoComprobante[] {
  return leer();
}

export function obtener(id: string): TipoComprobante | null {
  return leer().find((tipo) => tipo.id === id) ?? null;
}

export function crear(datos: DatosTipoComprobante): Resultado<TipoComprobante> {
  const tipos = leer();
  const normalizados = normalizarCampos(datos);
  const errores = validar(normalizados, tipos);

  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const tipo: TipoComprobante = {
    id: generarId(),
    ...normalizados,
    activo: true,
    creadoEn: new Date().toISOString(),
  };

  escribir([...tipos, tipo]);

  return { ok: true, valor: tipo };
}

export function actualizar(
  id: string,
  datos: DatosTipoComprobante,
): Resultado<TipoComprobante> {
  const tipos = leer();
  const indice = tipos.findIndex((tipo) => tipo.id === id);

  if (indice === -1) {
    return { ok: false, errores: { general: "El tipo de comprobante no existe." } };
  }

  const normalizados = normalizarCampos(datos);
  const errores = validar(normalizados, tipos, id);

  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }

  const actualizado: TipoComprobante = { ...tipos[indice], ...normalizados };
  const siguientes = tipos.map((tipo) => (tipo.id === id ? actualizado : tipo));

  escribir(siguientes);

  return { ok: true, valor: actualizado };
}

export function desactivar(id: string): Resultado<TipoComprobante> {
  return cambiarEstado(id, false);
}

export function reactivar(id: string): Resultado<TipoComprobante> {
  return cambiarEstado(id, true);
}

function cambiarEstado(id: string, activo: boolean): Resultado<TipoComprobante> {
  const tipos = leer();
  const objetivo = tipos.find((tipo) => tipo.id === id);

  if (objetivo === undefined) {
    return { ok: false, errores: { general: "El tipo de comprobante no existe." } };
  }

  const actualizado: TipoComprobante = { ...objetivo, activo };
  escribir(tipos.map((tipo) => (tipo.id === id ? actualizado : tipo)));

  return { ok: true, valor: actualizado };
}
