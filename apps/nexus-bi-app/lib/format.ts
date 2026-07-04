// Formato compacto para stat tiles (1284 -> "1,284"; 12900 -> "12.9K").
export function formatCompactNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";

  return new Intl.NumberFormat("es-CL", {
    notation: value >= 100000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

export function formatPercent(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return String(value);
}
