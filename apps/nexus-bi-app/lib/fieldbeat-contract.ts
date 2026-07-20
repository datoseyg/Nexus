import type {
  FieldbeatClientPartsRow,
  FieldbeatClientReportRow,
  FieldbeatDashboardResponse,
  FieldbeatDataQualityRow,
  FieldbeatEquipmentPartsRow,
  FieldbeatKpis
} from "@/types/fieldbeat";

// ETAPA 5 - parser/normalizador del contrato real de
// GET /api/dashboard/fieldbeat. No es un simple type guard: valida la
// forma completa Y convierte cada valor numérico (columnas BIGINT de
// Postgres, confirmado que llegan como string decimal, ver
// verificación real hecha antes de escribir este archivo) a `number`
// UNA SOLA VEZ, acá - los componentes/hooks nunca ven el string crudo ni
// hacen su propio Number(value || 0).
export class FieldbeatContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldbeatContractError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Acepta number o string decimal estricto (sin cero a la izquierda salvo
// "0", sin signo, sin decimales, sin notación científica) - nunca
// `Number(value)` sin validar antes la representación original, para no
// colar "1e3"/"12abc"/" 12" como si fueran conteos válidos.
export function parseCount(value: unknown, fieldName: string): number {
  let parsed: number;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    parsed = Number(value);
  } else {
    throw new FieldbeatContractError(`Campo numérico inválido: ${fieldName}`);
  }

  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed) || parsed < 0) {
    throw new FieldbeatContractError(`Conteo fuera de rango: ${fieldName}`);
  }

  return parsed;
}

const PERCENT_TEXT_PATTERN = /^\d+(\.\d+)?%$/;

// Los 4 campos TEXT de tasa (zendesk_link_rate, used_parts_match_rate,
// review_required_rate, percent_of_total_reports) se validan por formato
// pero se conservan como string - nunca se usan como fuente visual (ver
// lib/fieldbeat-metrics.ts), solo quedan disponibles para una
// comprobación de consistencia en tests.
function parsePercentText(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || !PERCENT_TEXT_PATTERN.test(value)) {
    throw new FieldbeatContractError(`Porcentaje inválido: ${fieldName}`);
  }
  return value;
}

// Usado para report_quality_status/client_name/equipment_internal_id -
// cualquier string no vacío después de trim() es válido a nivel de
// transporte. report_quality_status NO se restringe acá a las 6
// categorías canónicas - eso es una invariante del dataset (ver
// lib/fieldbeat-invariants.ts), nunca un requisito estructural del parser.
function parseNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new FieldbeatContractError(`Campo de texto inválido o vacío: ${fieldName}`);
  }
  return value;
}

function parseKpis(value: unknown): FieldbeatKpis {
  if (!isRecord(value)) throw new FieldbeatContractError("kpis: forma inválida");
  return {
    total_fieldbeat_reports: parseCount(value.total_fieldbeat_reports, "kpis.total_fieldbeat_reports"),
    reports_no_ticket_reported: parseCount(value.reports_no_ticket_reported, "kpis.reports_no_ticket_reported"),
    reports_linked_to_accessible_zendesk: parseCount(value.reports_linked_to_accessible_zendesk, "kpis.reports_linked_to_accessible_zendesk"),
    reports_linked_to_missing_or_restricted_zendesk: parseCount(
      value.reports_linked_to_missing_or_restricted_zendesk,
      "kpis.reports_linked_to_missing_or_restricted_zendesk"
    ),
    reports_with_used_parts: parseCount(value.reports_with_used_parts, "kpis.reports_with_used_parts"),
    reports_ok: parseCount(value.reports_ok, "kpis.reports_ok"),
    reports_review_required: parseCount(value.reports_review_required, "kpis.reports_review_required"),
    total_used_parts: parseCount(value.total_used_parts, "kpis.total_used_parts"),
    matched_used_parts: parseCount(value.matched_used_parts, "kpis.matched_used_parts"),
    placeholder_used_parts: parseCount(value.placeholder_used_parts, "kpis.placeholder_used_parts"),
    unmatched_used_parts: parseCount(value.unmatched_used_parts, "kpis.unmatched_used_parts"),
    ambiguous_used_parts: parseCount(value.ambiguous_used_parts, "kpis.ambiguous_used_parts"),
    zendesk_link_rate: parsePercentText(value.zendesk_link_rate, "kpis.zendesk_link_rate"),
    used_parts_match_rate: parsePercentText(value.used_parts_match_rate, "kpis.used_parts_match_rate"),
    review_required_rate: parsePercentText(value.review_required_rate, "kpis.review_required_rate")
  };
}

function parseDataQualityRow(value: unknown, index: number): FieldbeatDataQualityRow {
  if (!isRecord(value)) throw new FieldbeatContractError(`dataQuality[${index}]: forma inválida`);
  return {
    report_quality_status: parseNonEmptyString(value.report_quality_status, `dataQuality[${index}].report_quality_status`),
    report_count: parseCount(value.report_count, `dataQuality[${index}].report_count`),
    percent_of_total_reports: parsePercentText(value.percent_of_total_reports, `dataQuality[${index}].percent_of_total_reports`),
    used_parts_count: parseCount(value.used_parts_count, `dataQuality[${index}].used_parts_count`),
    matched_used_parts_count: parseCount(value.matched_used_parts_count, `dataQuality[${index}].matched_used_parts_count`),
    placeholder_used_parts_count: parseCount(value.placeholder_used_parts_count, `dataQuality[${index}].placeholder_used_parts_count`),
    unmatched_used_parts_count: parseCount(value.unmatched_used_parts_count, `dataQuality[${index}].unmatched_used_parts_count`),
    ambiguous_used_parts_count: parseCount(value.ambiguous_used_parts_count, `dataQuality[${index}].ambiguous_used_parts_count`)
  };
}

function parseClientReportRow(value: unknown, index: number): FieldbeatClientReportRow {
  if (!isRecord(value)) throw new FieldbeatContractError(`reportsByClient[${index}]: forma inválida`);
  return {
    client_name: parseNonEmptyString(value.client_name, `reportsByClient[${index}].client_name`),
    total_reports: parseCount(value.total_reports, `reportsByClient[${index}].total_reports`)
  };
}

function parseClientPartsRow(value: unknown, index: number): FieldbeatClientPartsRow {
  if (!isRecord(value)) throw new FieldbeatContractError(`partsConsumptionByClient[${index}]: forma inválida`);
  return {
    client_name: parseNonEmptyString(value.client_name, `partsConsumptionByClient[${index}].client_name`),
    used_parts_count: parseCount(value.used_parts_count, `partsConsumptionByClient[${index}].used_parts_count`)
  };
}

function parseEquipmentPartsRow(value: unknown, index: number): FieldbeatEquipmentPartsRow {
  if (!isRecord(value)) throw new FieldbeatContractError(`topEquipmentByParts[${index}]: forma inválida`);
  return {
    equipment_internal_id: parseNonEmptyString(value.equipment_internal_id, `topEquipmentByParts[${index}].equipment_internal_id`),
    used_parts_count: parseCount(value.used_parts_count, `topEquipmentByParts[${index}].used_parts_count`)
  };
}

function parseArray<T>(value: unknown, fieldName: string, parseItem: (item: unknown, index: number) => T): T[] {
  if (!Array.isArray(value)) throw new FieldbeatContractError(`Campo array ausente o inválido: ${fieldName}`);
  return value.map((item, index) => parseItem(item, index));
}

export function parseFieldbeatDashboardResponse(value: unknown): FieldbeatDashboardResponse {
  if (!isRecord(value)) throw new FieldbeatContractError("Respuesta con forma inválida (no es un objeto)");

  for (const key of ["kpis", "dataQuality", "reportsByClient", "partsConsumptionByClient", "topEquipmentByParts"]) {
    if (!(key in value)) throw new FieldbeatContractError(`Falta el campo: ${key}`);
  }

  const kpis = value.kpis === null ? null : parseKpis(value.kpis);

  return {
    kpis,
    dataQuality: parseArray(value.dataQuality, "dataQuality", parseDataQualityRow),
    reportsByClient: parseArray(value.reportsByClient, "reportsByClient", parseClientReportRow),
    partsConsumptionByClient: parseArray(value.partsConsumptionByClient, "partsConsumptionByClient", parseClientPartsRow),
    topEquipmentByParts: parseArray(value.topEquipmentByParts, "topEquipmentByParts", parseEquipmentPartsRow)
  };
}
