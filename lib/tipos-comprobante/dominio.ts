export interface TipoComprobante {
  id: string;
  nombre: string;
  activo: boolean;
  creadoEn: string;
}

export type CampoValidable = "nombre";

export type CampoError = CampoValidable | "general";

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; errores: Partial<Record<CampoError, string>> };

export type DatosTipoComprobante = Omit<TipoComprobante, "id" | "activo" | "creadoEn">;

export function normalizarCampos(datos: DatosTipoComprobante): DatosTipoComprobante {
  return { nombre: datos.nombre.trim() };
}

function existeNombre(
  tipos: TipoComprobante[],
  nombre: string,
  idExcluido?: string,
): boolean {
  const objetivo = nombre.toLowerCase();
  return tipos.some(
    (tipo) => tipo.id !== idExcluido && tipo.nombre.toLowerCase() === objetivo,
  );
}

export function validar(
  datos: DatosTipoComprobante,
  tipos: TipoComprobante[],
  idExcluido?: string,
): Partial<Record<CampoError, string>> {
  const errores: Partial<Record<CampoError, string>> = {};

  if (datos.nombre.length < 2) {
    errores.nombre = "El nombre debe tener al menos 2 caracteres.";
  } else if (existeNombre(tipos, datos.nombre, idExcluido)) {
    errores.nombre = "Ya existe un tipo de comprobante con ese nombre.";
  }

  return errores;
}
