export { cn } from "cn";

export type Currency = "PEN" | "USD";

export function formatCurrency(value: number, currency: Currency = "PEN"): string {
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency,
    // narrowSymbol: USD se muestra como "$" y PEN como "S/" en todo ICU.
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value;
  }

  return `${day}/${month}/${year}`;
}

// "Hoy" es la fecha del NEGOCIO (`America/Lima`), no la del proceso.
//
// Sacarla del reloj del proceso hacia que, con el host en UTC (el runner de CI), el "hoy" del API
// fuera un dia adelante del "hoy" de los seeds y fixtures —que escriben
// `(now() at time zone 'America/Lima')::date`— entre las 00:00 y las 05:00 UTC. En esa ventana todo
// comprobante `CONTADO` que vencia hoy aparecia como vencido, con su monto.
//
// Se usa `Intl` y no un offset fijo de -5: el offset escrito a mano se rompe el dia que el huso
// cambie, y la semantica tiene que venir de la misma zona que usan los seeds.
const businessDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Lima",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function getTodayLocalDate(): string {
  const parts = businessDateFormatter.formatToParts(new Date());
  const valueOf = (type: "year" | "month" | "day"): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")}`;
}

/** Redondea a 2 decimales para no arrastrar ruido de punto flotante. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
