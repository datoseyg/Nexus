import type { DuckDBValue } from "@duckdb/node-api";
import { createParamPusher, type ParamPusher } from "./dashboard-filters";

// Filtros comunes a los 6 endpoints de auditoría — ver
// docs/MANUAL_REVIEW_VIEW.md. Reutiliza createParamPusher de
// dashboard-filters.ts para no duplicar el manejo de placeholders $N.
export interface AuditFilters {
  cliente?: string;
  maquina?: string;
  from?: string;
  to?: string;
  matchStatus?: string;
  reportQuality?: string;
  q?: string;
}

export function parseAuditFilters(searchParams: URLSearchParams): AuditFilters {
  return {
    cliente: searchParams.get("cliente") || undefined,
    maquina: searchParams.get("maquina") || undefined,
    from: searchParams.get("from") || undefined,
    to: searchParams.get("to") || undefined,
    matchStatus: searchParams.get("matchStatus") || undefined,
    reportQuality: searchParams.get("reportQuality") || undefined,
    q: searchParams.get("q") || undefined
  };
}

export { createParamPusher, type ParamPusher };

// Condiciones sobre marts.fieldbeat_report_dolibarr_operational_view
// (alias "r" por convención en los endpoints de auditoría, para no
// confundir con el alias "m" de match usado en parts-review).
export function buildAuditMartConditions(filters: AuditFilters, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];
  const col = (name: string) => (alias ? `${alias}.${name}` : name);

  if (filters.cliente) conditions.push(`${col("client_name")} = ${pusher.push(filters.cliente)}`);
  if (filters.maquina) conditions.push(`${col("equipment_internal_ids")} ILIKE ${pusher.push(`%${filters.maquina}%`)}`);
  if (filters.from) conditions.push(`CAST(${col("fieldbeat_task_date")} AS DATE) >= ${pusher.push(filters.from)}::DATE`);
  if (filters.to) conditions.push(`CAST(${col("fieldbeat_task_date")} AS DATE) <= ${pusher.push(filters.to)}::DATE`);
  if (filters.reportQuality) conditions.push(`${col("report_quality_status")} = ${pusher.push(filters.reportQuality)}`);

  return conditions;
}

const ACTION_SUGGESTIONS: Record<string, string> = {
  PLACEHOLDER_VALUE: "Marcar como placeholder válido o crear regla de exclusión",
  NO_MATCH: "Buscar producto Dolibarr y crear alias",
  AMBIGUOUS_MATCH: "Elegir producto candidato correcto"
};

// Acción sugerida por fila — ver PARTE 4.A del pedido original y
// docs/MANUAL_REVIEW_VIEW.md. Ninguna de estas acciones se ejecuta
// todavía (ver StatusBadge / botones deshabilitados en la UI).
export function suggestAction(matchStatus: string, needsManualReview: boolean): string {
  if (ACTION_SUGGESTIONS[matchStatus]) return ACTION_SUGGESTIONS[matchStatus];
  if (matchStatus === "MATCHED" && needsManualReview) return "Validar match de baja confianza";
  return "Sin acción sugerida";
}

export function round2(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(value * 100) / 100;
}

export function toParams(pusher: ParamPusher): DuckDBValue[] {
  return pusher.params;
}
