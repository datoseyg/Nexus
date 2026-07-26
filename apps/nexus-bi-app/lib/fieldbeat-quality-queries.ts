// Ejecuta los 6 KPI de FieldBeat contra quality.fieldbeat_report_quality /
// quality.fieldbeat_report_inconsistencies / quality.fieldbeat_report_primary_inconsistency
// (sql/086_fieldbeat_quality.sql) - la fuente de verdad de las reglas de
// negocio es esa vista SQL (espejo 1:1 de lib/fieldbeat-*.ts, ver matriz de
// consistencia en el header de sql/086_fieldbeat_quality.sql). Este módulo
// NO reimplementa ninguna regla de clasificación - solo agrega/filtra.
//
// Phase 3 preflight §1.1 - ANTES, /overview corría 6 `runQuery()`
// independientes en paralelo (en realidad 8: KPI2 y KPI6 hacían 2 cada
// una) contra el pool compartido de 5 conexiones de lib/db.ts - 8
// adquisiciones simultáneas sobre un pool de 5, y el reporte de Phase 2
// llamaba a eso "1 round-trip" incorrectamente (era 1 REQUEST HTTP, pero 8
// round-trips de red a Postgres). Medido con --test-name-pattern y logging
// de pool.totalCount/waitingCount: confirmado que la 6ta-8va query
// esperaba una conexión libre.
//
// AHORA: computeOverviewBundle() y computeQualityBundle() son UNA sola
// consulta SQL cada una (1 round-trip = 1 adquisición de conexión = 1
// mensaje de red), con los 6 (u 4) KPI como CTEs sobre una única base
// `universe` MATERIALIZED, empaquetados en columnas JSON vía
// row_to_json/json_agg. /quality nunca paga el costo de KPI2/KPI6 (que no
// muestra) porque tiene su propia consulta separada, no la de /overview.
import { runQuery } from "./db";
import { createParamPusher } from "./dashboard-filters";
import { buildFieldbeatQualityConditions, type FieldbeatQualityFilters } from "./fieldbeat-quality-filters";
import { INCONSISTENCY_TAXONOMY, type InconsistencyCode, type InconsistencySeverity } from "./fieldbeat-inconsistency-taxonomy";
import type {
  Kpi1StructuralCompleteness,
  Kpi2TicketLinkage,
  Kpi3TeamIdentification,
  Kpi4PartsTraceability,
  Kpi5TemporalConsistency,
  Kpi6InformationInconsistencies,
  FieldbeatQualityEvolutionPoint,
  FieldbeatTeamIdentificationEvolutionPoint
} from "@/types/fieldbeat-quality";

export const HISTORICAL_ALIAS_LIMITATION_MESSAGE = "Equivalencias históricas disponibles solo cuando existe alias validado";

// Exportadas (Phase 3 reapertura §4 - coverage tras eliminar contract.test.ts/
// metrics.test.ts): estas dos son la ÚNICA capa de coerción numérica que le
// queda a FieldBeat (row_to_json ya entrega JSON numérico real desde
// Postgres, a diferencia del viejo parseFieldbeatDashboardResponse() que
// parseaba strings BIGINT crudos desde HTTP) - riesgo distinto (valores ya
// tipados por pg/JSON, no input adversarial de red), pero igual merecen
// prueba directa en vez de solo indirecta vía los adapters de vista.
export function percentage(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10000) / 100;
}

export function n(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function buildWhere(filters: FieldbeatQualityFilters): { whereSql: string; params: unknown[] } {
  const pusher = createParamPusher();
  const conditions = buildFieldbeatQualityConditions(filters, "q", pusher);
  return { whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", params: pusher.params };
}

// CTEs compartidas por overview y quality - universe (base filtrada, UNA
// sola vez, MATERIALIZED) + KPI1/KPI3/KPI4/KPI5. Nunca se duplica esta
// lógica: cambiar una fórmula acá cambia ambos endpoints a la vez.
const CORE_KPI_CTES = `
  universe AS MATERIALIZED (
    SELECT * FROM quality.fieldbeat_report_quality q
    __WHERE__
  ),
  kpi1 AS (
    SELECT
      COUNT(*) FILTER (WHERE is_closed) AS denominator,
      COUNT(*) FILTER (WHERE is_closed AND structurally_complete) AS numerator,
      COUNT(*) FILTER (WHERE is_closed AND NOT has_technician) AS missing_technician,
      COUNT(*) FILTER (WHERE is_closed AND NOT has_client) AS missing_client,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status NOT IN ('STRUCTURED_IDENTIFIED', 'TEXT_CONFIDENT_IDENTIFIED')) AS missing_equipment,
      COUNT(*) FILTER (WHERE is_closed AND (
        (NOT has_technician)::int + (NOT has_client)::int +
        (team_identification_status NOT IN ('STRUCTURED_IDENTIFIED', 'TEXT_CONFIDENT_IDENTIFIED'))::int
      ) >= 2) AS multiple_missing
    FROM universe
  ),
  kpi3 AS (
    SELECT
      COUNT(*) FILTER (WHERE is_closed) AS denominator,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'STRUCTURED_IDENTIFIED') AS structured,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'TEXT_CONFIDENT_IDENTIFIED') AS text_confident,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'TEXT_AMBIGUOUS') AS text_ambiguous,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'MISSING') AS missing,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'NOT_APPLICABLE') AS not_applicable
    FROM universe
  ),
  kpi4 AS (
    SELECT
      COUNT(*) FILTER (WHERE part_total_lines > 0) AS report_universe,
      COUNT(*) FILTER (WHERE part_total_lines > 0 AND part_fully_traceable) AS fully_traceable,
      COUNT(*) FILTER (WHERE part_total_lines > 0 AND part_placeholders > 0) AS contains_placeholder,
      COUNT(*) FILTER (WHERE part_total_lines > 0 AND part_no_match > 0) AS contains_no_match,
      COUNT(*) FILTER (WHERE part_total_lines > 0 AND part_ambiguous > 0) AS contains_ambiguous,
      COUNT(*) FILTER (WHERE part_total_lines > 0 AND (
        (part_placeholders > 0)::int + (part_no_match > 0)::int + (part_ambiguous > 0)::int
      ) >= 2) AS combined_problems,
      COALESCE(SUM(part_total_lines) FILTER (WHERE part_total_lines > 0), 0) AS total_lines,
      COALESCE(SUM(part_direct_matches) FILTER (WHERE part_total_lines > 0), 0) AS direct_matches,
      COALESCE(SUM(part_historical_alias_matches) FILTER (WHERE part_total_lines > 0), 0) AS historical_alias_matches,
      COALESCE(SUM(part_description_matches) FILTER (WHERE part_total_lines > 0), 0) AS description_matches,
      COALESCE(SUM(part_ambiguous) FILTER (WHERE part_total_lines > 0), 0) AS ambiguous,
      COALESCE(SUM(part_placeholders) FILTER (WHERE part_total_lines > 0), 0) AS placeholders,
      COALESCE(SUM(part_no_match) FILTER (WHERE part_total_lines > 0), 0) AS no_match
    FROM universe
  ),
  kpi5 AS (
    SELECT
      COUNT(*) FILTER (WHERE has_sufficient_timestamps) AS evaluable,
      COUNT(*) FILTER (WHERE has_sufficient_timestamps AND NOT chronology_impossible) AS consistent,
      COUNT(*) FILTER (WHERE chronology_impossible) AS impossible_chronology,
      COUNT(*) FILTER (WHERE finished_zero_duration) AS zero_duration,
      COUNT(*) FILTER (WHERE finished_null_duration) AS null_duration,
      PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (start_time - created_at)) / 60.0)
        FILTER (WHERE start_time IS NOT NULL AND created_at IS NOT NULL) AS lag_median_minutes,
      PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (start_time - created_at)) / 60.0)
        FILTER (WHERE start_time IS NOT NULL AND created_at IS NOT NULL) AS lag_p90_minutes
    FROM universe
  )
`;

const CORE_KPI_SELECT_COLUMNS = `
  (SELECT row_to_json(kpi1) FROM kpi1) AS kpi1,
  (SELECT row_to_json(kpi3) FROM kpi3) AS kpi3,
  (SELECT row_to_json(kpi4) FROM kpi4) AS kpi4,
  (SELECT row_to_json(kpi5) FROM kpi5) AS kpi5
`;

// KPI2 (tickets) es liviano (a diferencia de KPI6) - Phase 3 §8 exige
// mostrarlo en la pestaña Calidad además de Visión ejecutiva, así que se
// comparte vía sus propias CTEs/columnas en vez de vivir solo dentro de
// computeOverviewBundle() como en la primera versión de Phase 2.
const TICKET_KPI_CTES = `
  kpi2_summary AS (
    SELECT
      COUNT(*) FILTER (WHERE ticket_accessible) AS accessible,
      COUNT(*) FILTER (WHERE ticket_missing_or_restricted) AS missing_or_restricted,
      COUNT(*) FILTER (WHERE NOT has_ticket_reported) AS no_ticket
    FROM universe
  ),
  kpi2_distribution AS (
    SELECT accessible_ticket_count, COUNT(*) AS report_count
    FROM universe
    WHERE has_ticket_reported
    GROUP BY accessible_ticket_count
    ORDER BY accessible_ticket_count
  )
`;

const TICKET_KPI_SELECT_COLUMNS = `
  (SELECT row_to_json(kpi2_summary) FROM kpi2_summary) AS kpi2_summary,
  (SELECT COALESCE(json_agg(kpi2_distribution), '[]'::json) FROM kpi2_distribution) AS kpi2_distribution
`;

// Evolución estructurado-vs-texto (Phase 3 §8) - liviana (solo toca
// `universe`, sin depender de la cadena cara de KPI6) así que vive en
// AMBOS bundles (quality Y overview podrían usarla; hoy solo /quality la
// expone, ver tipo FieldbeatQualityResponse).
const TEAM_EVOLUTION_CTES = `
  team_evolution AS (
    SELECT
      TO_CHAR(fieldbeat_task_date, 'YYYY-MM') AS period,
      COUNT(*) FILTER (WHERE is_closed) AS closed_den,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'STRUCTURED_IDENTIFIED') AS structured_n,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'TEXT_CONFIDENT_IDENTIFIED') AS text_confident_n,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'TEXT_AMBIGUOUS') AS text_ambiguous_n,
      COUNT(*) FILTER (WHERE is_closed AND team_identification_status = 'MISSING') AS missing_n
    FROM universe
    WHERE fieldbeat_task_date IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  )
`;
const TEAM_EVOLUTION_SELECT_COLUMN = `(SELECT COALESCE(json_agg(team_evolution), '[]'::json) FROM team_evolution) AS team_evolution`;

interface TeamEvolutionRow {
  period: string;
  closed_den: string;
  structured_n: string;
  text_confident_n: string;
  text_ambiguous_n: string;
  missing_n: string;
}

function shapeTeamEvolution(rows: TeamEvolutionRow[]): FieldbeatTeamIdentificationEvolutionPoint[] {
  return rows.map(r => {
    const den = n(r.closed_den);
    return {
      period: r.period,
      structured: { numerator: n(r.structured_n), denominator: den, percentage: percentage(n(r.structured_n), den) },
      textConfident: { numerator: n(r.text_confident_n), denominator: den, percentage: percentage(n(r.text_confident_n), den) },
      textAmbiguous: { numerator: n(r.text_ambiguous_n), denominator: den, percentage: percentage(n(r.text_ambiguous_n), den) },
      missing: { numerator: n(r.missing_n), denominator: den, percentage: percentage(n(r.missing_n), den) }
    };
  });
}

interface Kpi2SummaryRow {
  accessible: string;
  missing_or_restricted: string;
  no_ticket: string;
}
interface Kpi2DistributionRow {
  accessible_ticket_count: string;
  report_count: string;
}

function shapeKpi2(summary: Kpi2SummaryRow, distribution: Kpi2DistributionRow[]): Kpi2TicketLinkage {
  const accessible = n(summary.accessible);
  const missingOrRestricted = n(summary.missing_or_restricted);
  const evaluableReports = accessible + missingOrRestricted;
  return {
    reportsWithAccessibleTicket: accessible,
    reportsWithMissingOrRestrictedTicket: missingOrRestricted,
    reportsWithoutReportedTicket: n(summary.no_ticket),
    evaluableReports,
    percentage: percentage(accessible, evaluableReports),
    distributionByTicketCount: distribution.map(d => ({
      accessibleTicketCount: n(d.accessible_ticket_count),
      reportCount: n(d.report_count)
    })),
    drillDownFilter: { ticketStatus: "missing_or_restricted" }
  };
}

interface Kpi1Row {
  denominator: string;
  numerator: string;
  missing_technician: string;
  missing_client: string;
  missing_equipment: string;
  multiple_missing: string;
}

interface Kpi3Row {
  denominator: string;
  structured: string;
  text_confident: string;
  text_ambiguous: string;
  missing: string;
  not_applicable: string;
}

interface Kpi4Row {
  report_universe: string;
  fully_traceable: string;
  contains_placeholder: string;
  contains_no_match: string;
  contains_ambiguous: string;
  combined_problems: string;
  total_lines: string;
  direct_matches: string;
  historical_alias_matches: string;
  description_matches: string;
  ambiguous: string;
  placeholders: string;
  no_match: string;
}

interface Kpi5Row {
  evaluable: string;
  consistent: string;
  impossible_chronology: string;
  zero_duration: string;
  null_duration: string;
  lag_median_minutes: string | null;
  lag_p90_minutes: string | null;
}

function shapeKpi1(row: Kpi1Row): Kpi1StructuralCompleteness {
  const numerator = n(row.numerator);
  const denominator = n(row.denominator);
  return {
    numerator,
    denominator,
    percentage: percentage(numerator, denominator),
    missingTechnician: n(row.missing_technician),
    missingClient: n(row.missing_client),
    missingEquipment: n(row.missing_equipment),
    multipleMissing: n(row.multiple_missing),
    drillDownFilter: { qualityStatus: null, note: "Usar severity=Media + inconsistencyCode=MIN_FIELDS_INCOMPLETE|TEAM_MISSING para el detalle" }
  };
}

function shapeKpi3(row: Kpi3Row): Kpi3TeamIdentification {
  const denominator = n(row.denominator);
  const structured = n(row.structured);
  const textConfident = n(row.text_confident);
  const textAmbiguous = n(row.text_ambiguous);
  const missing = n(row.missing);
  const notApplicable = n(row.not_applicable);
  const numerator = structured + textConfident;
  return {
    numerator,
    denominator,
    percentage: percentage(numerator, denominator),
    structured,
    textConfident,
    textAmbiguous,
    missing,
    notApplicable,
    sumMatchesDenominator: structured + textConfident + textAmbiguous + missing + notApplicable === denominator,
    drillDownFilter: { teamIdentificationStatus: "MISSING" }
  };
}

function shapeKpi4(row: Kpi4Row): Kpi4PartsTraceability {
  return {
    reportGrain: {
      universe: n(row.report_universe),
      fullyTraceable: n(row.fully_traceable),
      containsPlaceholder: n(row.contains_placeholder),
      containsNoMatch: n(row.contains_no_match),
      containsAmbiguous: n(row.contains_ambiguous),
      combinedProblems: n(row.combined_problems)
    },
    lineGrain: {
      totalLines: n(row.total_lines),
      directMatches: n(row.direct_matches),
      historicalAliasMatches: n(row.historical_alias_matches),
      descriptionMatches: n(row.description_matches),
      ambiguous: n(row.ambiguous),
      placeholders: n(row.placeholders),
      noMatch: n(row.no_match)
    },
    historicalAliasLimitation: HISTORICAL_ALIAS_LIMITATION_MESSAGE
  };
}

function shapeKpi5(row: Kpi5Row): Kpi5TemporalConsistency {
  const evaluable = n(row.evaluable);
  const consistent = n(row.consistent);
  return {
    evaluableReports: evaluable,
    consistentReports: consistent,
    impossibleChronology: n(row.impossible_chronology),
    zeroDurationWarnings: n(row.zero_duration),
    nullDurationWarnings: n(row.null_duration),
    percentage: percentage(consistent, evaluable),
    apparentCreationLagMedian: row.lag_median_minutes === null ? null : Math.round(Number(row.lag_median_minutes) * 100) / 100,
    apparentCreationLagP90: row.lag_p90_minutes === null ? null : Math.round(Number(row.lag_p90_minutes) * 100) / 100,
    apparentCreationLagDisclaimer: "Proxy exploratorio (created_at vs start_time) - nunca un SLA ni una medida de oportunidad de registro confirmada."
  };
}

export interface FieldbeatQualityCoreKpis {
  kpi1: Kpi1StructuralCompleteness;
  kpi2: Kpi2TicketLinkage;
  kpi3: Kpi3TeamIdentification;
  kpi4: Kpi4PartsTraceability;
  kpi5: Kpi5TemporalConsistency;
  teamEvolution: FieldbeatTeamIdentificationEvolutionPoint[];
}

/**
 * 1 query SQL = 1 round-trip = 1 adquisición de conexión. Usada por
 * /quality - incluye KPI2 (liviano, Phase 3 §8 lo exige en esta pestaña)
 * pero NUNCA KPI6 (el más pesado de los 6, ver medición al cierre de
 * Phase 2 - vive solo en /overview).
 */
export async function computeQualityBundle(filters: FieldbeatQualityFilters): Promise<FieldbeatQualityCoreKpis> {
  const { whereSql, params } = buildWhere(filters);
  const sql = `
    WITH ${CORE_KPI_CTES.replace("__WHERE__", whereSql)},
    ${TICKET_KPI_CTES},
    ${TEAM_EVOLUTION_CTES}
    SELECT ${CORE_KPI_SELECT_COLUMNS}, ${TICKET_KPI_SELECT_COLUMNS}, ${TEAM_EVOLUTION_SELECT_COLUMN}
  `;
  const rows = await runQuery<{
    kpi1: Kpi1Row;
    kpi3: Kpi3Row;
    kpi4: Kpi4Row;
    kpi5: Kpi5Row;
    kpi2_summary: Kpi2SummaryRow;
    kpi2_distribution: Kpi2DistributionRow[];
    team_evolution: TeamEvolutionRow[];
  }>(sql, params);
  const row = rows[0];
  return {
    kpi1: shapeKpi1(row.kpi1),
    kpi2: shapeKpi2(row.kpi2_summary, row.kpi2_distribution),
    kpi3: shapeKpi3(row.kpi3),
    kpi4: shapeKpi4(row.kpi4),
    teamEvolution: shapeTeamEvolution(row.team_evolution),
    kpi5: shapeKpi5(row.kpi5)
  };
}

export interface FieldbeatOverviewKpis extends FieldbeatQualityCoreKpis {
  kpi6: Kpi6InformationInconsistencies;
  evolution: FieldbeatQualityEvolutionPoint[];
}

/**
 * 1 query SQL = 1 round-trip = 1 adquisición de conexión, para los 6 KPI
 * completos. Reemplaza las 8 queries independientes de la primera versión
 * de Phase 2 (ver preflight §1.1 en el header del archivo).
 */
export async function computeOverviewBundle(filters: FieldbeatQualityFilters): Promise<FieldbeatOverviewKpis> {
  const { whereSql, params } = buildWhere(filters);
  const severityByCode = new Map<InconsistencyCode, InconsistencySeverity>(INCONSISTENCY_TAXONOMY.map(d => [d.code, d.severity]));

  const sql = `
    WITH ${CORE_KPI_CTES.replace("__WHERE__", whereSql)},
    ${TICKET_KPI_CTES},
    ${TEAM_EVOLUTION_CTES},
    affected AS MATERIALIZED (
      SELECT DISTINCT ri.fieldbeat_task_id
      FROM quality.fieldbeat_report_inconsistencies ri
      JOIN universe u ON u.fieldbeat_task_id = ri.fieldbeat_task_id
    ),
    primary_sev AS MATERIALIZED (
      SELECT pi.fieldbeat_task_id, pi.severity, pi.code
      FROM quality.fieldbeat_report_primary_inconsistency pi
      WHERE pi.fieldbeat_task_id IN (SELECT fieldbeat_task_id FROM affected)
    ),
    kpi6_summary AS (
      SELECT
        (SELECT COUNT(*) FROM affected) AS affected_reports,
        (SELECT COUNT(*) FROM universe) AS evaluable_reports,
        (SELECT COUNT(*) FROM primary_sev WHERE severity = 'Alta') AS high,
        (SELECT COUNT(*) FROM primary_sev WHERE severity = 'Media') AS medium,
        (SELECT COUNT(*) FROM primary_sev WHERE severity = 'Baja') AS low,
        (SELECT COUNT(*) FROM primary_sev WHERE severity = 'Advertencia') AS warning_only,
        (SELECT code FROM primary_sev GROUP BY code ORDER BY COUNT(*) DESC, code ASC LIMIT 1) AS dominant_code,
        (SELECT MIN(u2.fieldbeat_task_date) FROM universe u2 WHERE u2.fieldbeat_task_id IN (SELECT fieldbeat_task_id FROM affected)) AS oldest_date,
        (SELECT COUNT(*) FROM quality.fieldbeat_report_inconsistencies ri2 WHERE ri2.fieldbeat_task_id IN (SELECT fieldbeat_task_id FROM affected)) AS total_finding_rows
    ),
    kpi6_distribution AS (
      SELECT ri.code, COUNT(*) AS report_count
      FROM quality.fieldbeat_report_inconsistencies ri
      JOIN universe u ON u.fieldbeat_task_id = ri.fieldbeat_task_id
      GROUP BY ri.code
      ORDER BY report_count DESC, ri.code ASC
    ),
    evolution AS (
      -- Selector de evolución (parrafo 7): las 4 series comparten esta
      -- única agregación mensual - nunca se recarga al cambiar de serie en
      -- el selector (el payload ya las trae todas). Reutiliza la CTE
      -- affected (ya MATERIALIZED arriba) vía LEFT JOIN en vez de un
      -- EXISTS correlacionado por fila.
      SELECT
        TO_CHAR(u.fieldbeat_task_date, 'YYYY-MM') AS period,
        COUNT(*) AS total_den,
        COUNT(*) FILTER (WHERE u.is_closed) AS closed_den,
        COUNT(*) FILTER (WHERE u.is_closed AND u.structurally_complete) AS completeness_num,
        COUNT(*) FILTER (WHERE u.is_closed AND u.team_identification_status IN ('STRUCTURED_IDENTIFIED', 'TEXT_CONFIDENT_IDENTIFIED')) AS team_id_num,
        COUNT(*) FILTER (WHERE u.part_total_lines > 0) AS parts_den,
        COUNT(*) FILTER (WHERE u.part_total_lines > 0 AND u.part_fully_traceable) AS traceability_num,
        COUNT(*) FILTER (WHERE a.fieldbeat_task_id IS NOT NULL) AS inconsistencies_num
      FROM universe u
      LEFT JOIN affected a ON a.fieldbeat_task_id = u.fieldbeat_task_id
      WHERE u.fieldbeat_task_date IS NOT NULL
      GROUP BY 1
      ORDER BY 1
    )
    SELECT
      ${CORE_KPI_SELECT_COLUMNS},
      ${TICKET_KPI_SELECT_COLUMNS},
      (SELECT row_to_json(kpi6_summary) FROM kpi6_summary) AS kpi6_summary,
      (SELECT COALESCE(json_agg(kpi6_distribution), '[]'::json) FROM kpi6_distribution) AS kpi6_distribution,
      (SELECT COALESCE(json_agg(evolution), '[]'::json) FROM evolution) AS evolution,
      ${TEAM_EVOLUTION_SELECT_COLUMN}
  `;

  const rows = await runQuery<{
    kpi1: Kpi1Row;
    kpi3: Kpi3Row;
    kpi4: Kpi4Row;
    kpi5: Kpi5Row;
    kpi2_summary: Kpi2SummaryRow;
    kpi2_distribution: Kpi2DistributionRow[];
    kpi6_summary: {
      affected_reports: string;
      evaluable_reports: string;
      high: string;
      medium: string;
      low: string;
      warning_only: string;
      dominant_code: InconsistencyCode | null;
      oldest_date: string | null;
      total_finding_rows: string;
    };
    kpi6_distribution: Array<{ code: InconsistencyCode; report_count: string }>;
    evolution: Array<{
      period: string;
      total_den: string;
      closed_den: string;
      completeness_num: string;
      team_id_num: string;
      parts_den: string;
      traceability_num: string;
      inconsistencies_num: string;
    }>;
    team_evolution: TeamEvolutionRow[];
  }>(sql, params);

  const row = rows[0];
  const k6 = row.kpi6_summary;
  const affectedReports = n(k6.affected_reports);
  const totalFindingRows = n(k6.total_finding_rows);

  return {
    kpi1: shapeKpi1(row.kpi1),
    kpi2: shapeKpi2(row.kpi2_summary, row.kpi2_distribution),
    kpi3: shapeKpi3(row.kpi3),
    kpi4: shapeKpi4(row.kpi4),
    kpi5: shapeKpi5(row.kpi5),
    kpi6: {
      affectedReports,
      evaluableReports: n(k6.evaluable_reports),
      percentage: percentage(affectedReports, n(k6.evaluable_reports)),
      highSeverityReports: n(k6.high),
      mediumSeverityReports: n(k6.medium),
      lowSeverityReports: n(k6.low),
      warningOnlyReports: n(k6.warning_only),
      dominantCode: k6.dominant_code,
      oldestAffectedReportDate: k6.oldest_date ? String(k6.oldest_date) : null,
      totalSecondaryIssues: Math.max(0, totalFindingRows - affectedReports),
      distributionByCode: row.kpi6_distribution.map(d => ({
        code: d.code,
        severity: severityByCode.get(d.code) ?? "Advertencia",
        reportCount: n(d.report_count)
      }))
    },
    evolution: row.evolution.map(e => {
      const closedDen = n(e.closed_den);
      const totalDen = n(e.total_den);
      const partsDen = n(e.parts_den);
      return {
        period: e.period,
        completeness: { numerator: n(e.completeness_num), denominator: closedDen, percentage: percentage(n(e.completeness_num), closedDen) },
        inconsistencies: { numerator: n(e.inconsistencies_num), denominator: totalDen, percentage: percentage(n(e.inconsistencies_num), totalDen) },
        traceability: { numerator: n(e.traceability_num), denominator: partsDen, percentage: percentage(n(e.traceability_num), partsDen) },
        teamIdentification: { numerator: n(e.team_id_num), denominator: closedDen, percentage: percentage(n(e.team_id_num), closedDen) }
      };
    }),
    teamEvolution: shapeTeamEvolution(row.team_evolution)
  };
}
