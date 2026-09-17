import {
  esRol,
  esTipoDocumento,
  normalizarCampos,
  validar,
  type DatosActualizacion,
  type DatosTercero,
  type FiltrosTerceros,
  type Resultado,
  type Tercero,
} from "@/lib/terceros/dominio";

const STORAGE_KEY = "gestion-pagos:terceros:v1";

function esTercero(valor: unknown): valor is Tercero {
  if (typeof valor !== "object" || valor === null) {
    return false;
  }
  const tercero = valor as Record<string, unknown>;
  return (
    typeof tercero.id === "string" &&
    esTipoDocumento(tercero.tipoDocumento) &&
    (tercero.numeroDocumento === null || typeof tercero.numeroDocumento === "string") &&
    typeof tercero.nombre === "string" &&
    typeof tercero.domicilioFiscal === "string" &&
    typeof tercero.telefono === "string" &&
    typeof tercero.correo === "string" &&
    Array.isArray(tercero.roles) &&
    tercero.roles.every(esRol) &&
    typeof tercero.activo === "boolean" &&
    typeof tercero.creadoEn === "string" &&
    typeof tercero.actualizadoEn === "string"
  );
}

function crearSemilla(): Tercero[] {
  return [
    {
      id: "semilla-01",
      tipoDocumento: "RUC",
      numeroDocumento: "20123456789",
      nombre: "Distribuidora Andina S.A.C.",
      domicilioFiscal: "Av. Los Próceres 1450, Lima",
      telefono: "+51 1 445 8890",
      correo: "contacto@distribuidoraandina.pe",
      roles: ["cliente"],
      activo: true,
      creadoEn: "2026-01-12T09:15:00.000Z",
      actualizadoEn: "2026-01-12T09:15:00.000Z",
    },
    {
      id: "semilla-02",
      tipoDocumento: "RUC",
      numeroDocumento: "20556677889",
      nombre: "Servicios Integrales del Pacífico S.R.L.",
      domicilioFiscal: "Calle Los Olivos 238, Miraflores, Lima",
      telefono: "+51 1 610 4477",
      correo: "ventas@serviciosdlepacifico.pe",
      roles: ["proveedor"],
      activo: true,
      creadoEn: "2026-02-03T11:40:00.000Z",
      actualizadoEn: "2026-02-03T11:40:00.000Z",
    },
    {
      id: "semilla-03",
      tipoDocumento: "DNI",
      numeroDocumento: "45678912",
      nombre: "María Fernanda Quispe Huamán",
      domicilioFiscal: "Jr. Ayacucho 812, Arequipa",
      telefono: "+51 954 221 780",
      correo: "mf.quispe@gmail.com",
      roles: ["cliente"],
      activo: true,
      creadoEn: "2026-03-18T15:05:00.000Z",
      actualizadoEn: "2026-03-18T15:05:00.000Z",
    },
    {
      id: "semilla-04",
      tipoDocumento: "DNI",
      numeroDocumento: "12345678",
      nombre: "Carlos Alberto Ríos Salazar",
      domicilioFiscal: "Av. Grau 1160, Trujillo",
      telefono: "+51 943 118 902",
      correo: "crios@outlook.com",
      roles: ["cliente", "proveedor"],
      activo: true,
      creadoEn: "2026-04-27T08:30:00.000Z",
      actualizadoEn: "2026-04-27T08:30:00.000Z",
    },
    {
      id: "semilla-05",
      tipoDocumento: "CARNET_EXTRANJERIA",
      numeroDocumento: "XA1234567",
      nombre: "John Alexander Smith",
      domicilioFiscal: "Calle Cantuarias 175, Miraflores, Lima",
      telefono: "+51 987 664 210",
      correo: "john.smith@consulting.com",
      roles: ["proveedor"],
      activo: true,
      creadoEn: "2026-05-09T13:20:00.000Z",
      actualizadoEn: "2026-05-09T13:20:00.000Z",
    },
    {
      id: "semilla-06",
      tipoDocumento: "SIN_DOCUMENTO",
      numeroDocumento: null,
      nombre: "Taller Los Andes",
      domicilioFiscal: "Pasaje Santa Rosa 45, Cusco",
      telefono: "+51 984 550 331",
      correo: "",
      roles: ["proveedor"],
      activo: false,
      creadoEn: "2026-06-14T10:00:00.000Z",
      actualizadoEn: "2026-07-02T16:45:00.000Z",
    },
  ];
}

function hayStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function leerAlmacen(): Tercero[] | null {
  try {
    const bruto = window.localStorage.getItem(STORAGE_KEY);
    if (bruto === null) {
      return null;
    }
    const parseado: unknown = JSON.parse(bruto);
    return Array.isArray(parseado) && parseado.every(esTercero) ? parseado : null;
  } catch {
    return null;
  }
}

function escribir(terceros: Tercero[]): void {
  if (!hayStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(terceros));
  } catch {
    return;
  }
}

function leer(): Tercero[] {
  if (!hayStorage()) {
    return crearSemilla();
  }
  const almacenado = leerAlmacen();
  if (almacenado !== null) {
    return almacenado;
  }
  const semilla = crearSemilla();
  if (window.localStorage.getItem(STORAGE_KEY) === null) {
    escribir(semilla);
  }
  return semilla;
}

export function listar(filtros: FiltrosTerceros = {}): Tercero[] {
  const { texto, rol, incluirInactivos = false } = filtros;
  const busqueda = texto?.trim().toLowerCase() ?? "";
  return leer()
    .filter((tercero) => incluirInactivos || tercero.activo)
    .filter((tercero) => (rol ? tercero.roles.includes(rol) : true))
    .filter((tercero) => {
      if (busqueda === "") {
        return true;
      }
      const nombre = tercero.nombre.toLowerCase();
      const numero = (tercero.numeroDocumento ?? "").toLowerCase();
      return nombre.includes(busqueda) || numero.includes(busqueda);
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
}

export function obtener(id: string): Tercero | null {
  return leer().find((tercero) => tercero.id === id) ?? null;
}

export function crear(datos: DatosTercero): Resultado<Tercero> {
  const terceros = leer();
  const normalizado = normalizarCampos(datos);
  const errores = validar(normalizado, terceros);
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }
  const ahora = new Date().toISOString();
  const tercero: Tercero = {
    id: crypto.randomUUID(),
    ...normalizado,
    activo: true,
    creadoEn: ahora,
    actualizadoEn: ahora,
  };
  escribir([...terceros, tercero]);
  return { ok: true, valor: tercero };
}

export function actualizar(id: string, datos: DatosActualizacion): Resultado<Tercero> {
  const terceros = leer();
  const indice = terceros.findIndex((tercero) => tercero.id === id);
  if (indice === -1) {
    return { ok: false, errores: { general: "Tercero no encontrado." } };
  }
  const normalizado = normalizarCampos(datos);
  const errores = validar(normalizado, terceros, id);
  if (Object.keys(errores).length > 0) {
    return { ok: false, errores };
  }
  const actualizado: Tercero = {
    ...terceros[indice],
    ...normalizado,
    activo: datos.activo,
    actualizadoEn: new Date().toISOString(),
  };
  const siguientes = [...terceros];
  siguientes[indice] = actualizado;
  escribir(siguientes);
  return { ok: true, valor: actualizado };
}

function cambiarActivo(id: string, activo: boolean): Resultado<Tercero> {
  const terceros = leer();
  const indice = terceros.findIndex((tercero) => tercero.id === id);
  if (indice === -1) {
    return { ok: false, errores: { general: "Tercero no encontrado." } };
  }
  const actualizado: Tercero = {
    ...terceros[indice],
    activo,
    actualizadoEn: new Date().toISOString(),
  };
  const siguientes = [...terceros];
  siguientes[indice] = actualizado;
  escribir(siguientes);
  return { ok: true, valor: actualizado };
}

export function desactivar(id: string): Resultado<Tercero> {
  return cambiarActivo(id, false);
}

export function reactivar(id: string): Resultado<Tercero> {
  return cambiarActivo(id, true);
}
