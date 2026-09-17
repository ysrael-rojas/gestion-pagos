import type { PostgrestError } from "@supabase/supabase-js";

import type { Database, Tables, TablesInsert } from "@/lib/database.types";
import type { CampoError, DatosActualizacion, DatosTercero, RolTercero, Tercero, TipoDocumento } from "@/lib/terceros/dominio";

type TipoDocumentoBase = Database["public"]["Enums"]["document_type"];
type RolBase = Database["public"]["Enums"]["third_party_role"];

export type FilaTercero = Tables<"third_parties">;
export type FilaTerceroInsert = TablesInsert<"third_parties">;

const TIPO_DOCUMENTO_A_BASE: Record<TipoDocumento, TipoDocumentoBase> = {
  DNI: "dni",
  RUC: "ruc",
  CARNET_EXTRANJERIA: "foreigner_card",
  SIN_DOCUMENTO: "no_document",
};

const TIPO_DOCUMENTO_DESDE_BASE: Record<TipoDocumentoBase, TipoDocumento> = {
  dni: "DNI",
  ruc: "RUC",
  foreigner_card: "CARNET_EXTRANJERIA",
  no_document: "SIN_DOCUMENTO",
};

const ROL_A_BASE: Record<RolTercero, RolBase> = {
  cliente: "customer",
  proveedor: "supplier",
};

const ROL_DESDE_BASE: Record<RolBase, RolTercero> = {
  customer: "cliente",
  supplier: "proveedor",
};

function aNulo(valor: string): string | null {
  return valor === "" ? null : valor;
}

function aTexto(valor: string | null): string {
  return valor ?? "";
}

export function aTercero(fila: FilaTercero): Tercero {
  return {
    id: fila.id,
    tipoDocumento: TIPO_DOCUMENTO_DESDE_BASE[fila.document_type],
    numeroDocumento: fila.document_number,
    nombre: fila.name,
    domicilioFiscal: aTexto(fila.fiscal_address),
    telefono: aTexto(fila.phone),
    correo: aTexto(fila.email),
    roles: fila.roles.map((rol) => ROL_DESDE_BASE[rol]),
    activo: fila.active,
    creadoEn: fila.created_at,
    actualizadoEn: fila.updated_at,
  };
}

export function aFila(datos: DatosTercero | DatosActualizacion): FilaTerceroInsert {
  const fila: FilaTerceroInsert = {
    document_type: TIPO_DOCUMENTO_A_BASE[datos.tipoDocumento],
    document_number: datos.numeroDocumento,
    name: datos.nombre,
    fiscal_address: aNulo(datos.domicilioFiscal),
    phone: aNulo(datos.telefono),
    email: aNulo(datos.correo),
    roles: datos.roles.map((rol) => ROL_A_BASE[rol]),
  };

  if ("activo" in datos) {
    fila.active = datos.activo;
  }

  return fila;
}

interface ReglaConstraint {
  codigo: string;
  constraint: string;
  campo: CampoError;
  mensaje: string;
}

const ERROR_GENERAL = "No se pudo completar la operación.";

const REGLAS_CONSTRAINT: readonly ReglaConstraint[] = [
  {
    codigo: "23505",
    constraint: "third_parties_document_unique",
    campo: "numeroDocumento",
    mensaje: "Ya existe un Tercero con ese tipo y número de documento.",
  },
  {
    codigo: "23514",
    constraint: "third_parties_document_format",
    campo: "numeroDocumento",
    mensaje: "El número de documento no tiene un formato válido.",
  },
  {
    codigo: "23514",
    constraint: "third_parties_email_format",
    campo: "correo",
    mensaje: "Introduce un correo válido.",
  },
  {
    codigo: "23514",
    constraint: "third_parties_name_min_length",
    campo: "nombre",
    mensaje: "El nombre debe tener al menos 2 caracteres.",
  },
  {
    codigo: "23514",
    constraint: "third_parties_roles_not_empty",
    campo: "roles",
    mensaje: "Selecciona al menos un rol.",
  },
  {
    codigo: "23514",
    constraint: "third_parties_roles_no_nulls",
    campo: "roles",
    mensaje: "Selecciona al menos un rol.",
  },
];

export function erroresDesdePostgrest(
  error: PostgrestError | null,
): Partial<Record<CampoError, string>> {
  if (error === null) {
    return { general: ERROR_GENERAL };
  }

  console.error("Error de PostgREST al operar sobre third_parties:", error);

  const regla = REGLAS_CONSTRAINT.find(
    (candidata) =>
      candidata.codigo === error.code && error.message.includes(candidata.constraint),
  );

  return regla ? { [regla.campo]: regla.mensaje } : { general: ERROR_GENERAL };
}
