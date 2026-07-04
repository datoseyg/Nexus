function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  const str = String(value);

  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
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
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
