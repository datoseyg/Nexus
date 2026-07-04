import { createParamPusher, type ParamPusher } from "./dashboard-filters";

// Filtros de /api/dashboard/after-hours/* - ver docs/AFTER_HOURS_METRICS.md.
// Reutiliza createParamPusher de dashboard-filters.ts para no duplicar el
// manejo de placeholders $N (mismo patrón que lib/audit-sql.ts).
export interface AfterHoursFilters {
  from?: string;
  to?: string;
  cliente?: string;
  tecnico?: string;
  tipoTarea?: string;
  confidenceLevel?: string;
  onlyAfterHours?: boolean;
  onlyLowConfidence?: boolean;
}

export function parseAfterHoursFilters(searchParams: URLSearchParams): AfterHoursFilters {
  return {
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    cliente: searchParams.get("client") || undefined,
    tecnico: searchParams.get("technician") || undefined,
    tipoTarea: searchParams.get("taskType") || undefined,
    confidenceLevel: searchParams.get("confidenceLevel") || undefined,
    onlyAfterHours: searchParams.get("onlyAfterHours") === "true",
    onlyLowConfidence: searchParams.get("onlyLowConfidence") === "true"
  };
}

export { createParamPusher, type ParamPusher };

// Condiciones sobre marts.fieldbeat_working_hours_analysis (alias "w" por
// convención en los endpoints de after-hours). onlyLowConfidence usa el
// mismo umbral (<65, límite Baja/Media) que la advertencia "Cálculo
// preliminar" en MetricCardWithConfidence.tsx.
export function buildAfterHoursMartConditions(filters: AfterHoursFilters, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];
  const col = (name: string) => (alias ? `${alias}.${name}` : name);

  if (filters.cliente) conditions.push(`${col("client_name")} = ${pusher.push(filters.cliente)}`);
  if (filters.tecnico) conditions.push(`${col("assigned_to")} = ${pusher.push(filters.tecnico)}`);
  if (filters.tipoTarea) conditions.push(`${col("task_type")} = ${pusher.push(filters.tipoTarea)}`);
  if (filters.from) conditions.push(`CAST(${col("start_time_local")} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (filters.to) conditions.push(`CAST(${col("start_time_local")} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  if (filters.confidenceLevel) conditions.push(`${col("confidence_label")} = ${pusher.push(filters.confidenceLevel)}`);
  if (filters.onlyAfterHours) conditions.push(`${col("is_after_hours_task")} = true`);
  if (filters.onlyLowConfidence) conditions.push(`${col("confidence_score")} < 65`);

  return conditions;
}
