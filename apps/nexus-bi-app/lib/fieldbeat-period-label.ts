// Extraído (Phase 3 reapertura §4) - estaba duplicado idéntico en
// FieldbeatEvolutionChart.tsx y FieldbeatQualityTab.tsx, sin test directo
// en ninguno de los dos. "YYYY-MM" -> "mmm YY" en es-CL, mismo formato que
// el viejo toEvolutionRankingRows() retirado (fieldbeat-activity-view.ts),
// pero sobre el período de quality.fieldbeat_report_quality, no de
// actividad bruta.
export function periodLabel(period: string): string {
  const [year, month] = period.split("-");
  if (!year || !month) return period;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  return date.toLocaleDateString("es-CL", { month: "short", year: "2-digit", timeZone: "UTC" });
}
