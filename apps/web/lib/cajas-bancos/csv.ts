// Exportacion CSV del reporte de cuadre (C5 del vertical de cajas-bancos).
//
// Port de `lib/caja/csv.ts` del origen (30 lineas) completo, con la misma idea: sin dependencias
// externas, dos funciones y nada mas. `toCsv` es serializacion pura; `downloadCsv` toca el DOM
// (Blob + un `<a download>`), asi que solo se puede probar en un navegador y no lleva test
// unitario: el unico riesgo real (comillas y comas dentro de una celda) vive en `toCsv`.
//
// El BOM (`\uFEFF`) se antepone a proposito: sin el, Excel en Windows abre el archivo como ANSI y
// los acentos y la "ñ" de los nombres de cuenta salen rotos.

export type CsvValue = string | number | null | undefined;

function escapeCell(value: CsvValue): string {
  const text = value === null || value === undefined ? "" : String(value);

  // Escapa comillas dobles y envuelve si el valor contiene separadores.
  if (/[",\n;]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/** Filas -> CSV con separador coma y fin de linea CRLF (el que espera Excel). */
export function toCsv(rows: CsvValue[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n");
}

/** Descarga el CSV en el navegador con el nombre indicado. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\uFEFF${csv}`], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
