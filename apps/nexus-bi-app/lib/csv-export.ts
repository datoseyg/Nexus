// Prefijo defensivo ('} contra CSV/formula injection (OWASP): un valor que
// empieza con = + - @ o tab es interpretado como fórmula por Excel/Sheets
// al abrir el CSV - se antepone un apóstrofe para forzarlo a texto plano.
// Compartido por todo exportador CSV de la app (Explorador, Auditoría,
// Reportes FieldBeat) - una sola implementación, nunca reescapada por cada
// consumidor.
const FORMULA_TRIGGER_PATTERN = /^[=+\-@\t]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let str = String(value);
  if (FORMULA_TRIGGER_PATTERN.test(str)) str = `'${str}`;

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

// Mecánica de descarga compartida (ancla temporal + revocar el object URL) -
// única implementación para cualquier Blob que la app necesite entregar
// como descarga (export client-side de esta función y el export
// server-streamed de Reportes FieldBeat en FieldbeatReportsTab.tsx).
export function triggerBlobDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// Exporta solo la página actual ya cargada en el cliente - no pide más
// datos al servidor. Coherente con "explorador de solo lectura, sin
// escritura de ningún tipo".
export function downloadRowsAsCsv(fileName: string, columnNames: string[], rows: Array<Record<string, unknown>>) {
  const lines = [
    columnNames.map(escapeCsvCell).join(","),
    ...rows.map(row => columnNames.map(col => escapeCsvCell(row[col])).join(","))
  ];

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  triggerBlobDownload(blob, fileName);
}
