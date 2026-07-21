// Helpers puros compartidos por AfterHoursDetailTable.tsx y
// AfterHoursDrawer.tsx (ETAPA 6.6D §11/§12) - extraídos a lib/ para quedar
// testeables con node --test (los .tsx con JSX no pueden importarse en el
// runner de tests, que solo despoja tipos, no transforma JSX).

// Divide un valor "YYYY-MM-DD HH:mm:ss" (o con 'T') en fecha/hora legibles.
// Nunca lanza con null/valores mal formados - degrada a "-".
export function splitDateTime(value: string | null): { date: string; time: string } {
  if (!value) return { date: "-", time: "-" };
  const [date, time] = value.replace(" ", "T").split("T");
  return { date: date ?? "-", time: time ? time.slice(0, 5) : "-" };
}

interface AfterHoursBreakdownFields {
  business_hours: number | null;
  after_hours: number | null;
  weekend_hours: number | null;
  holiday_hours: number | null;
}

// Suma weekday+weekend+holiday fuera de horario. Retorna null cuando
// business_hours es null (cobertura no calculable, data_basis=NONE) - la UI
// debe pintar "—", NUNCA "0 min" para una tarea no calculable (§11).
export function totalAfterHoursHours(row: AfterHoursBreakdownFields): number | null {
  if (row.business_hours === null) return null;
  return (row.after_hours ?? 0) + (row.weekend_hours ?? 0) + (row.holiday_hours ?? 0);
}

// Formato es-CL con 1 decimal + unidad "h"; null -> "—" (nunca "0 h").
export function formatHoursOrDash(value: number | null): string {
  return value === null ? "—" : `${(Math.round(value * 10) / 10).toLocaleString("es-CL")} h`;
}
