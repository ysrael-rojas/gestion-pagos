export type TipoDocumento = "DNI" | "RUC" | "CARNET_EXTRANJERIA" | "SIN_DOCUMENTO";

export type RolTercero = "cliente" | "proveedor";

export interface Tercero {
  id: string;
  tipoDocumento: TipoDocumento;
  numeroDocumento: string | null;
  nombre: string;
  domicilioFiscal: string;
  telefono: string;
  correo: string;
  roles: RolTercero[];
  activo: boolean;
  creadoEn: string;
  actualizadoEn: string;
}

export type CampoValidable = "tipoDocumento" | "numeroDocumento" | "nombre" | "correo" | "roles";

export type CampoError = CampoValidable | "general";

export type Resultado<T> =
  | { ok: true; valor: T }
  | { ok: false; errores: Partial<Record<CampoError, string>> };

export interface FiltrosTerceros {
  texto?: string;
  rol?: RolTercero;
  incluirInactivos?: boolean;
}

export type DatosTercero = Omit<Tercero, "id" | "activo" | "creadoEn" | "actualizadoEn">;

export type DatosActualizacion = Omit<Tercero, "id" | "creadoEn" | "actualizadoEn">;

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [
  "DNI",
  "RUC",
  "CARNET_EXTRANJERIA",
  "SIN_DOCUMENTO",
];

export const ROLES: readonly RolTercero[] = ["cliente", "proveedor"];

export const ETIQUETAS_TIPO_DOCUMENTO: Record<TipoDocumento, string> = {
  DNI: "DNI",
  RUC: "RUC",
  CARNET_EXTRANJERIA: "Carné de extranjería",
  SIN_DOCUMENTO: "Sin documento",
};

export const ETIQUETAS_ROL: Record<RolTercero, string> = {
  cliente: "Cliente",
  proveedor: "Proveedor",
};

const FORMATO_DOCUMENTO: Record<Exclude<TipoDocumento, "SIN_DOCUMENTO">, RegExp> = {
  DNI: /^\d{8}$/,
  RUC: /^\d{11}$/,
  CARNET_EXTRANJERIA: /^[A-Za-z0-9]{9,12}$/,
};

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function etiquetaNombre(tipoDocumento: TipoDocumento): string {
  return tipoDocumento === "RUC" ? "Razón social" : "Nombre completo";
}

export function esTipoDocumento(valor: unknown): valor is TipoDocumento {
  return typeof valor === "string" && (TIPOS_DOCUMENTO as readonly string[]).includes(valor);
}

export function esRol(valor: unknown): valor is RolTercero {
  return typeof valor === "string" && (ROLES as readonly string[]).includes(valor);
}

export function normalizarCampos(datos: DatosTercero): DatosTercero {
  const sinDocumento = datos.tipoDocumento === "SIN_DOCUMENTO";
  const numeroBruto = sinDocumento ? "" : (datos.numeroDocumento ?? "").trim().toUpperCase();
  return {
    tipoDocumento: datos.tipoDocumento,
    numeroDocumento: numeroBruto === "" ? null : numeroBruto,
    nombre: datos.nombre.trim(),
    domicilioFiscal: datos.domicilioFiscal.trim(),
    telefono: datos.telefono.trim(),
    correo: datos.correo.trim(),
    roles: [...new Set(datos.roles.filter(esRol))],
  };
}

function mensajeFormato(tipoDocumento: TipoDocumento): string {
  switch (tipoDocumento) {
    case "DNI":
      return "El DNI debe tener 8 dígitos.";
    case "RUC":
      return "El RUC debe tener 11 dígitos.";
    case "CARNET_EXTRANJERIA":
      return "El carné de extranjería debe tener entre 9 y 12 caracteres alfanuméricos.";
    default:
      return "Formato de documento inválido.";
  }
}

function existeDocumento(
  terceros: Tercero[],
  tipoDocumento: TipoDocumento,
  numeroDocumento: string,
  idExcluido?: string,
): boolean {
  return terceros.some(
    (tercero) =>
      tercero.id !== idExcluido &&
      tercero.tipoDocumento === tipoDocumento &&
      tercero.numeroDocumento === numeroDocumento,
  );
}

export function validar(
  datos: DatosTercero,
  terceros: Tercero[],
  idExcluido?: string,
): Partial<Record<CampoError, string>> {
  const errores: Partial<Record<CampoError, string>> = {};

  if (!esTipoDocumento(datos.tipoDocumento)) {
    errores.tipoDocumento = "Selecciona un tipo de documento válido.";
  } else if (datos.tipoDocumento !== "SIN_DOCUMENTO") {
    if (datos.numeroDocumento === null) {
      errores.numeroDocumento = "El número de documento es obligatorio.";
    } else if (!FORMATO_DOCUMENTO[datos.tipoDocumento].test(datos.numeroDocumento)) {
      errores.numeroDocumento = mensajeFormato(datos.tipoDocumento);
    } else if (
      existeDocumento(terceros, datos.tipoDocumento, datos.numeroDocumento, idExcluido)
    ) {
      errores.numeroDocumento = "Ya existe un Tercero con ese tipo y número de documento.";
    }
  }

  if (datos.nombre.length < 2) {
    errores.nombre = "El nombre debe tener al menos 2 caracteres.";
  }

  if (datos.correo !== "" && !CORREO_RE.test(datos.correo)) {
    errores.correo = "Introduce un correo válido.";
  }

  if (datos.roles.length === 0) {
    errores.roles = "Selecciona al menos un rol.";
  }

  return errores;
}
