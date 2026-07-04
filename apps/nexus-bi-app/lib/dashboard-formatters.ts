// Chart.js dibuja en <canvas>, no soporta var(--css-custom-property) como
// las series SVG de Recharts (ver components/HorizontalBarChart.tsx) -
// necesita valores literales. Paleta alineada a la identidad E&G Medical
// Systems (ver docs/VISUAL_REDESIGN_EYG.md): verde E&G como color
// principal (nunca azul genérico), teal como secundario; el resto son
// tonos de apoyo para distinguir categorías sin saturar el gráfico.
// Amarillo/rojo quedan al final de la secuencia - se reservan
// semánticamente para advertencia/error en el resto de la UI.
export const DASHBOARD_PALETTE = {
  green: "#3c8c2e",
  teal: "#1f8a8a",
  lime: "#8fbe3f",
  info: "#2d9cdb",
  purple: "#7c5cbf",
  orange: "#e8873a",
  gray: "#5e6b70",
  cyan: "#38b6c9",
  warning: "#f4b740",
  danger: "#d9534f"
} as const;

export const DASHBOARD_PALETTE_SEQUENCE = [
  DASHBOARD_PALETTE.green,
  DASHBOARD_PALETTE.teal,
  DASHBOARD_PALETTE.lime,
  DASHBOARD_PALETTE.info,
  DASHBOARD_PALETTE.purple,
  DASHBOARD_PALETTE.orange,
  DASHBOARD_PALETTE.gray,
  DASHBOARD_PALETTE.cyan,
  DASHBOARD_PALETTE.warning,
  DASHBOARD_PALETTE.danger
];

// Convierte un hex "#3b6fd6" a "rgba(59,111,214,alpha)" - usado para
// atenuar las categorías no seleccionadas de un gráfico cuando el
// cross-filter tiene un valor activo en su propio eje de identidad (ver
// docs/DASHBOARD_VISUAL_STYLE.md § Cross-filter). La categoría
// seleccionada mantiene su color íntegro; no se repinta el resto con un
// color distinto, solo se atenúa.
export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Dado un arreglo de colores base y las etiquetas correspondientes,
// atenúa todas las que no coincidan con `selected` (si hay alguna
// seleccionada). Sin selección, retorna los colores tal cual.
export function highlightColors(labels: string[], colors: string[], selected: string | undefined | null): string[] {
  if (!selected) return labels.map((_, i) => colors[i % colors.length]);
  return labels.map((label, i) => (label === selected ? colors[i % colors.length] : withAlpha(colors[i % colors.length], 0.25)));
}

export function formatNumberEsCl(value: number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString("es-CL", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function formatPercent(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${value.toFixed(decimals).replace(".", ",")} %`;
}

// duration_minutes -> "hh:mm" (formato del dashboard de referencia,
// columna "Downtime (Formato hora)" / "Duración registrada").
export function formatMinutesAsHhMm(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return "-";

  const totalMinutes = Math.round(minutes);
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`;
}

export function formatDateTimeEsCl(value: string | null | undefined): string {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return date.toLocaleString("es-CL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

// "2026-03" -> "mar 2026" para ejes de gráfico.
export function formatPeriodLabel(period: string): string {
  const [year, month] = period.split("-");
  if (!year || !month) return period;

  const date = new Date(Number(year), Number(month) - 1, 1);
  return date.toLocaleDateString("es-CL", { month: "short", year: "numeric" });
}
