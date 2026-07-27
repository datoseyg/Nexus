// Contrato ÚNICO de filtros para overview/quality (Phase 2 §8) - ambos
// endpoints importan este mismo módulo, nunca duplican su propia
// interpretación de un query param. Reglas: fechas parametrizadas (nunca
// concatenadas), enum allowlist con rechazo explícito de valores
// desconocidos (nunca "silently ignored" - un valor inválido es un 400,
// ver route.ts), strings normalizados (trim + tope de longitud, defensa
// contra payloads absurdos), sin SQL dinámico libre (todo condition string
// generado acá usa pusher.push() para el valor, nunca interpolación
// directa del input del usuario).
import type { ParamPusher } from "./dashboard-filters";
import type { FieldbeatOrigen } from "./fieldbeat-filters";
import { INCONSISTENCY_TAXONOMY, type InconsistencyCode, type InconsistencySeverity } from "./fieldbeat-inconsistency-taxonomy";
import { KNOWN_REPORT_QUALITY_STATUSES, type KnownReportQualityStatus } from "@/types/fieldbeat";

export type TicketStatusFilter = "accessible" | "missing_or_restricted" | "none";
export type PartStatusFilter = "fully_traceable" | "contains_placeholder" | "contains_no_match" | "contains_ambiguous";
// HOTFIX de integridad de datos FieldBeat (Stage 7) - distingue
// explícitamente a quién busca el filtro `technician`: 'primary' = SOLO el
// responsable principal (technician_names, comportamiento histórico
// intacto); 'additional' = SOLO participantes adicionales
// (quality.fieldbeat_report_participants, is_primary=false); 'any'
// (default) = cualquiera de los dos. Nunca se limita silenciosamente a
// 'primary' sin que el consumidor lo pida explícitamente.
export type TechnicianRoleFilter = "primary" | "additional" | "any";

const VALID_ORIGENES: readonly FieldbeatOrigen[] = ["APK", "WEB"];
const VALID_TICKET_STATUSES: readonly TicketStatusFilter[] = ["accessible", "missing_or_restricted", "none"];
const VALID_PART_STATUSES: readonly PartStatusFilter[] = ["fully_traceable", "contains_placeholder", "contains_no_match", "contains_ambiguous"];
const VALID_TECHNICIAN_ROLES: readonly TechnicianRoleFilter[] = ["primary", "additional", "any"];
const VALID_SEVERITIES: readonly InconsistencySeverity[] = ["Alta", "Media", "Baja", "Advertencia"];
const VALID_INCONSISTENCY_CODES: readonly InconsistencyCode[] = INCONSISTENCY_TAXONOMY.map(d => d.code);

const MAX_FREE_TEXT_LENGTH = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface FieldbeatQualityFilters {
  dateFrom?: string;
  dateTo?: string;
  technician?: string;
  technicianRole?: TechnicianRoleFilter;
  client?: string;
  equipment?: string;
  taskType?: string;
  origin?: FieldbeatOrigen;
  ticketStatus?: TicketStatusFilter;
  partStatus?: PartStatusFilter;
  qualityStatus?: KnownReportQualityStatus;
  inconsistencyCode?: InconsistencyCode;
  severity?: InconsistencySeverity;
}

export interface ParseFieldbeatQualityFiltersResult {
  filters: FieldbeatQualityFilters;
  errors: string[];
}

function normalizeFreeText(raw: string | null, field: string, errors: string[]): string | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (trimmed.length > MAX_FREE_TEXT_LENGTH) {
    errors.push(`${field}: excede el largo máximo (${MAX_FREE_TEXT_LENGTH} caracteres)`);
    return undefined;
  }
  return trimmed;
}

function normalizeDate(raw: string | null, field: string, errors: string[]): string | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!DATE_PATTERN.test(trimmed)) {
    errors.push(`${field}: formato inválido, se espera YYYY-MM-DD`);
    return undefined;
  }
  return trimmed;
}

function normalizeEnum<T extends string>(raw: string | null, field: string, allowlist: readonly T[], errors: string[]): T | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!(allowlist as readonly string[]).includes(trimmed)) {
    errors.push(`${field}: valor desconocido "${trimmed}" (permitidos: ${allowlist.join(", ")})`);
    return undefined;
  }
  return trimmed as T;
}

export function parseFieldbeatQualityFilters(searchParams: URLSearchParams): ParseFieldbeatQualityFiltersResult {
  const errors: string[] = [];

  const dateFrom = normalizeDate(searchParams.get("dateFrom"), "dateFrom", errors);
  const dateTo = normalizeDate(searchParams.get("dateTo"), "dateTo", errors);
  if (dateFrom && dateTo && dateFrom > dateTo) {
    errors.push("dateFrom no puede ser posterior a dateTo");
  }

  const filters: FieldbeatQualityFilters = {
    dateFrom,
    dateTo,
    technician: normalizeFreeText(searchParams.get("technician"), "technician", errors),
    technicianRole: normalizeEnum(searchParams.get("technicianRole"), "technicianRole", VALID_TECHNICIAN_ROLES, errors),
    client: normalizeFreeText(searchParams.get("client"), "client", errors),
    equipment: normalizeFreeText(searchParams.get("equipment"), "equipment", errors),
    taskType: normalizeFreeText(searchParams.get("taskType"), "taskType", errors),
    origin: normalizeEnum(searchParams.get("origin"), "origin", VALID_ORIGENES, errors),
    ticketStatus: normalizeEnum(searchParams.get("ticketStatus"), "ticketStatus", VALID_TICKET_STATUSES, errors),
    partStatus: normalizeEnum(searchParams.get("partStatus"), "partStatus", VALID_PART_STATUSES, errors),
    qualityStatus: normalizeEnum(searchParams.get("qualityStatus"), "qualityStatus", KNOWN_REPORT_QUALITY_STATUSES, errors),
    inconsistencyCode: normalizeEnum(searchParams.get("inconsistencyCode"), "inconsistencyCode", VALID_INCONSISTENCY_CODES, errors),
    severity: normalizeEnum(searchParams.get("severity"), "severity", VALID_SEVERITIES, errors)
  };

  return { filters, errors };
}

function col(alias: string, name: string): string {
  return alias ? `${alias}.${name}` : name;
}

/**
 * Condiciones SQL parametrizadas sobre quality.fieldbeat_report_quality
 * (alias obligatorio). dateTo es inclusivo del día completo (< dateTo +
 * 1 día), nunca trunca la última fecha del rango.
 */
export function buildFieldbeatQualityConditions(filters: FieldbeatQualityFilters, alias: string, pusher: ParamPusher): string[] {
  const conditions: string[] = [];

  if (filters.dateFrom) conditions.push(`${col(alias, "fieldbeat_task_date")} >= ${pusher.push(filters.dateFrom)}::date`);
  if (filters.dateTo) conditions.push(`${col(alias, "fieldbeat_task_date")} < (${pusher.push(filters.dateTo)}::date + INTERVAL '1 day')`);
  if (filters.technician) {
    const technician = filters.technician;
    const role = filters.technicianRole ?? "any";
    // 'primary': EXACTAMENTE la condición histórica (technician_names,
    // derivado únicamente de assigned_to) - comportamiento nunca alterado
    // para no romper consumidores existentes que no piden explícitamente
    // considerar participantes adicionales.
    const primaryCondition = () => `${col(alias, "technician_names")} ILIKE ${pusher.push(`%${technician}%`)}`;
    // 'additional': SOLO participantes no-principales (quality.fieldbeat_report_participants,
    // is_primary=false) - busca por nombre crudo Y normalizado (cubre tanto
    // texto libre no resuelto, ej. "Alexis Acevedo", como estructurados
    // resueltos contra el roster). Funciones (nunca strings precomputados):
    // cada rama empuja SOLO los parámetros que realmente usa - empujar
    // ambas incondicionalmente desalinea pusher.params con los placeholders
    // $N que terminan apareciendo en el SQL de la rama elegida.
    const additionalCondition = () => `${col(alias, "fieldbeat_task_id")} IN (
      SELECT fieldbeat_task_id FROM quality.fieldbeat_report_participants
      WHERE is_primary = false AND (raw_name ILIKE ${pusher.push(`%${technician}%`)} OR normalized_name ILIKE ${pusher.push(`%${technician.toUpperCase()}%`)})
    )`;

    if (role === "primary") conditions.push(primaryCondition());
    else if (role === "additional") conditions.push(additionalCondition());
    else conditions.push(`(${primaryCondition()} OR ${additionalCondition()})`);
  }
  if (filters.client) conditions.push(`${col(alias, "client_name")} = ${pusher.push(filters.client)}`);
  if (filters.equipment) conditions.push(`${col(alias, "equipment_internal_ids")} ILIKE ${pusher.push(`%${filters.equipment}%`)}`);
  if (filters.taskType) conditions.push(`${col(alias, "task_type")} = ${pusher.push(filters.taskType)}`);
  if (filters.origin) conditions.push(`${col(alias, "origen")} = ${pusher.push(filters.origin)}`);
  if (filters.qualityStatus) conditions.push(`${col(alias, "report_quality_status")} = ${pusher.push(filters.qualityStatus)}`);

  if (filters.ticketStatus === "accessible") conditions.push(`${col(alias, "ticket_accessible")} = true`);
  if (filters.ticketStatus === "missing_or_restricted") conditions.push(`${col(alias, "ticket_missing_or_restricted")} = true`);
  if (filters.ticketStatus === "none") conditions.push(`${col(alias, "has_ticket_reported")} = false`);

  if (filters.partStatus === "fully_traceable") conditions.push(`${col(alias, "part_total_lines")} > 0 AND ${col(alias, "part_fully_traceable")} = true`);
  if (filters.partStatus === "contains_placeholder") conditions.push(`${col(alias, "part_placeholders")} > 0`);
  if (filters.partStatus === "contains_no_match") conditions.push(`${col(alias, "part_no_match")} > 0`);
  if (filters.partStatus === "contains_ambiguous") conditions.push(`${col(alias, "part_ambiguous")} > 0`);

  if (filters.inconsistencyCode) {
    conditions.push(
      `${col(alias, "fieldbeat_task_id")} IN (SELECT fieldbeat_task_id FROM quality.fieldbeat_report_inconsistencies WHERE code = ${pusher.push(filters.inconsistencyCode)})`
    );
  }
  if (filters.severity) {
    conditions.push(
      `${col(alias, "fieldbeat_task_id")} IN (SELECT fieldbeat_task_id FROM quality.fieldbeat_report_primary_inconsistency WHERE severity = ${pusher.push(filters.severity)})`
    );
  }

  return conditions;
}

export function filtersAppliedForMetadata(filters: FieldbeatQualityFilters): Record<string, string> {
  const applied: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined) applied[key] = String(value);
  }
  return applied;
}
