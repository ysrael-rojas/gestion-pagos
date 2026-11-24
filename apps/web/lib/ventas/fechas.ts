// Fechas del comprobante de venta (T4 del port, S9).
//
// `due_date` es columna GENERADA por la base (`issue_date + credit_days`, solo en CREDITO): la app
// no la escribe. Lo que hay aca es la VISTA PREVIA que el formulario muestra mientras el usuario
// tipea los dias de credito, y la aritmetica es sobre `Date.UTC` con texto `YYYY-MM-DD` de punta a
// punta.
//
// El origen (`lib/ventas/amounts.ts:calculateDueDate`) armaba `new Date(year, month - 1, day + n)`,
// o sea hora LOCAL del navegador: un usuario en Madrid y uno en Lima podian ver vencimientos
// distintos para la misma venta. Es la misma clase de bug que cerro
// `odd/tasks/hoy-en-zona-del-negocio.md`, y el mismo criterio que `addDays` de
// `lib/cajas-bancos/periodo.ts` (otro vertical, misma razon: no se importa entre verticales).
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Fecha `YYYY-MM-DD` a `Date` en UTC, o `null` si el texto no es una fecha real. */
function parseIsoDate(value: string): Date | null {
  const match = ISO_DATE_PATTERN.exec(value);

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // `2026-02-30` se desborda a marzo en silencio: si los componentes no coinciden, no es una fecha.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }

  return date;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Suma (o resta, con dias negativos) dias a una fecha `YYYY-MM-DD`; `""` si no es una fecha. */
export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);

  if (!date || !Number.isFinite(days)) {
    return "";
  }

  date.setUTCDate(date.getUTCDate() + days);

  return toIsoDate(date);
}

/**
 * Vencimiento previsto a partir de la emision y los dias de credito.
 *
 * Devuelve `""` cuando no hay nada que previsualizar (sin fecha, sin dias, dias no enteros o
 * menores a 1): medio dia de credito no existe y media fecha de vencimiento tampoco. Es la misma
 * guarda que el formulario del origen aplicaba antes de llamar al calculo.
 */
export function calculateDueDate(
  issueDate: string,
  creditDays: number | null | undefined
): string {
  if (creditDays == null || !Number.isInteger(creditDays) || creditDays < 1) {
    return "";
  }

  return addDays(issueDate, creditDays);
}
