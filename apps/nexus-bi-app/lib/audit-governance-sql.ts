import { runGovernanceQuery } from "./governance-db";

// Gate B - Familia 4: consultas de lectura para las pestañas Bandeja/Casos/
// Historial de Auditoría. governance.issues/review_cases/review_case_issues
// solo tienen grant para los roles de gobierno (nexus_app_read/...), nunca
// para el pool genérico - por eso todo acá usa runGovernanceQuery("app_read",
// ...). Las vistas *_business_safe/current protegen la redacción (B54) - esta
// capa nunca hace SELECT directo sobre issue_evidence/command_events/
// review_case_comments crudas.

function serializeRows<T extends Record<string, unknown>>(rows: T[]): Record<string, unknown>[] {
  return rows.map(row => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = typeof value === "bigint" ? value.toString() : value;
    }
    return out;
  });
}

export interface BandejaFilters {
  status?: string;
  severity?: string;
  ruleCode?: string;
  entityType?: string;
  hasCase?: "yes" | "no";
  verification?: "pending" | "still_detected" | "passed" | "dead_letter" | "none";
  q?: string;
  // Bug real encontrado en revisión visual (2026-07-30): la Bandeja filtraba
  // solo por `status` (OPEN/IN_REVIEW/...), un campo de ciclo de vida
  // persistente que NUNCA se toca cuando una regla simplemente deja de
  // detectar una entidad (ver governance._publish_rule_evaluation - marca
  // is_currently_detected=false/disappeared_at, nunca status). Resultado: una
  // incidencia reclasificada como NO_PART_USED (o cualquier otra que
  // desapareciera sin una corrección humana que la resuelva vía el outbox de
  // verificación) permanecía en status='OPEN' para siempre, visible en la
  // bandeja activa como si siguiera pendiente. Default = solo lo
  // efectivamente detectado ahora ("current"); "all" es la única forma
  // explícita de ver también lo histórico/desaparecido desde acá.
  detection?: "current" | "all";
}

// Condiciones estáticas (sin parámetro) - solo alcanzables si el caller ya
// restringió el valor al tipo de arriba (la ruta API valida contra este mismo
// set de claves antes de invocar la función, nunca pasa un string libre).
const VERIFICATION_FILTER_SQL: Record<NonNullable<BandejaFilters["verification"]>, string> = {
  pending: "lv.processing_status IN ('PENDING','RUNNING')",
  still_detected: "lv.verification_outcome = 'STILL_DETECTED'",
  passed: "lv.verification_outcome = 'PASSED'",
  dead_letter: "lv.processing_status = 'DEAD_LETTERED'",
  none: "lv.processing_status IS NULL"
};

// FROM/JOIN compartido entre la query de filas y la de conteo - el filtro de
// verificación referencia el alias `lv` (última verification_requests_current
// por issue, B90 - nunca la tabla base con claim_token/lease), así que el
// COUNT necesita el mismo LATERAL, no solo `governance.issues`.
const BANDEJA_FROM_JOINS = `
  FROM governance.issues i
  LEFT JOIN governance.review_case_issues rci ON rci.issue_id = i.id AND rci.membership_ended_at IS NULL
  LEFT JOIN governance.review_cases rc ON rc.id = rci.review_case_id
  LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version
  LEFT JOIN LATERAL (
    SELECT vr.processing_status, vr.verification_outcome
    FROM governance.verification_requests_current vr
    WHERE vr.issue_id = i.id
    ORDER BY vr.created_at DESC, vr.id DESC
    LIMIT 1
  ) lv ON true
`;

export async function fetchIssuesBandeja(
  filters: BandejaFilters,
  page: number,
  pageSize: number
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  // Default = solo lo actualmente detectado por la regla (nunca solo
  // status, ver comentario en BandejaFilters.detection más arriba).
  // "all" es la única forma de incluir lo históricamente detectado/
  // desaparecido en esta lista - explícito, nunca el comportamiento
  // implícito por defecto.
  if (filters.detection !== "all") {
    conditions.push(`i.is_currently_detected = true`);
  }
  if (filters.status) {
    params.push(filters.status);
    conditions.push(`i.status = $${params.length}`);
  }
  if (filters.severity) {
    params.push(filters.severity);
    conditions.push(`i.severity = $${params.length}`);
  }
  if (filters.ruleCode) {
    params.push(filters.ruleCode);
    conditions.push(`i.rule_code = $${params.length}`);
  }
  if (filters.entityType) {
    params.push(filters.entityType);
    conditions.push(`i.entity_type = $${params.length}`);
  }
  if (filters.hasCase === "yes") {
    conditions.push(`rci.review_case_id IS NOT NULL`);
  } else if (filters.hasCase === "no") {
    conditions.push(`rci.review_case_id IS NULL`);
  }
  if (filters.verification) {
    conditions.push(VERIFICATION_FILTER_SQL[filters.verification]);
  }
  if (filters.q) {
    params.push(`%${filters.q}%`);
    conditions.push(`i.entity_key ILIKE $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [rows, countRows] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT i.id, i.rule_code, coalesce(rd.title, i.rule_code) AS rule_title, i.severity, i.status, i.entity_type, i.entity_key, i.occurrence_key,
              i.first_seen_at, i.last_seen_at, i.version, i.is_currently_detected,
              rci.review_case_id AS active_review_case_id, rc.status AS active_review_case_status,
              lv.processing_status AS verification_processing_status, lv.verification_outcome AS verification_outcome
       ${BANDEJA_FROM_JOINS}
       ${whereClause}
       ORDER BY i.last_seen_at DESC, i.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    runGovernanceQuery<{ n: string }>("app_read", `SELECT COUNT(*) AS n ${BANDEJA_FROM_JOINS} ${whereClause}`, params)
  ]);

  return { rows: serializeRows(rows), total: Number(countRows[0]?.n ?? 0) };
}

export interface ReviewCasesListFilters {
  status?: string;
}

export async function fetchReviewCasesStatusCounts(): Promise<Record<string, unknown>[]> {
  const rows = await runGovernanceQuery<Record<string, unknown>>(
    "app_read",
    `SELECT status, count(*) AS n FROM governance.review_cases GROUP BY status ORDER BY status`
  );
  return serializeRows(rows);
}

export async function fetchReviewCasesList(
  filters: ReviewCasesListFilters,
  page: number,
  pageSize: number
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    conditions.push(`rc.status = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [rows, countRows] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT rc.id, rc.status, rc.assigned_to, rc.opened_at, rc.closed_at, rc.version,
              (SELECT COUNT(*) FROM governance.review_case_issues rci WHERE rci.review_case_id = rc.id AND rci.membership_ended_at IS NULL) AS active_issue_count,
              (SELECT COUNT(*) FROM governance.review_case_comments_current cm WHERE cm.review_case_id = rc.id) AS comment_count
       FROM governance.review_cases rc
       ${whereClause}
       ORDER BY rc.updated_at DESC, rc.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    runGovernanceQuery<{ n: string }>("app_read", `SELECT COUNT(*) AS n FROM governance.review_cases rc ${whereClause}`, params)
  ]);

  return { rows: serializeRows(rows), total: Number(countRows[0]?.n ?? 0) };
}

export async function fetchReviewCaseDetail(id: string): Promise<{
  case: Record<string, unknown>;
  activeIssues: Record<string, unknown>[];
  endedIssues: Record<string, unknown>[];
  comments: Record<string, unknown>[];
} | null> {
  if (!/^\d+$/.test(id)) return null;

  const caseRows = await runGovernanceQuery<Record<string, unknown>>(
    "app_read",
    `SELECT id, status, assigned_to, opened_at, closed_at, version, created_at, updated_at FROM governance.review_cases WHERE id = $1`,
    [id]
  );
  if (caseRows.length === 0) return null;

  const [membershipRows, commentRows] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT rci.id AS membership_id, rci.issue_id, rci.membership_started_at, rci.membership_ended_at, rci.membership_end_reason,
              i.rule_code, coalesce(rd.title, i.rule_code) AS rule_title, i.severity, i.status AS issue_status, i.entity_type, i.entity_key
       FROM governance.review_case_issues rci
       JOIN governance.issues i ON i.id = rci.issue_id
       LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version
       WHERE rci.review_case_id = $1
       ORDER BY rci.membership_started_at DESC`,
      [id]
    ),
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT id, review_case_id, actor_user_id, supersedes_comment_id, created_at, body, is_redacted
       FROM governance.review_case_comments_current
       WHERE review_case_id = $1
       ORDER BY created_at ASC`,
      [id]
    )
  ]);

  const membership = serializeRows(membershipRows);
  return {
    case: serializeRows(caseRows)[0],
    activeIssues: membership.filter(row => row.membership_ended_at == null),
    endedIssues: membership.filter(row => row.membership_ended_at != null),
    comments: serializeRows(commentRows)
  };
}

export interface HistoryFilters {
  reviewCaseId?: string;
  issueId?: string;
}

export async function fetchHistory(
  filters: HistoryFilters,
  page: number,
  pageSize: number
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.reviewCaseId) {
    params.push(filters.reviewCaseId);
    conditions.push(`review_case_id = $${params.length}`);
  }
  if (filters.issueId) {
    params.push(filters.issueId);
    conditions.push(`issue_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [rows, countRows] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT id, correlation_id, event_type, issue_id, review_case_id, command_type, actor_role, reason, evidence_id, created_at
       FROM governance.command_events_business_safe
       ${whereClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    runGovernanceQuery<{ n: string }>("app_read", `SELECT COUNT(*) AS n FROM governance.command_events_business_safe ${whereClause}`, params)
  ]);

  return { rows: serializeRows(rows), total: Number(countRows[0]?.n ?? 0) };
}

// =============================================================================
// Gate B - Familia 8: KPIs de la pestaña "Resumen" (governance.issues/
// verification_requests/correction_versions) - complementa, nunca reemplaza,
// el resumen de calidad existente basado en marts (gold.fieldbeat_data_quality,
// QualitySummarySection/GET /api/audit/summary, que también alimenta el
// contador del NavBar - no se toca). Cada widget viene de una consulta real;
// nunca se inventa una serie/gráfico sin datos que lo respalden.
// =============================================================================
export async function fetchGovernanceKpis(): Promise<{
  byStatus: Record<string, unknown>[];
  bySeverity: Record<string, unknown>[];
  byRule: Record<string, unknown>[];
  byEntityType: Record<string, unknown>[];
  verification: Record<string, unknown>[];
  recentCorrections: Record<string, unknown>[];
  dailyDetections: Record<string, unknown>[];
}> {
  // bySeverity/byRule/byEntityType representan "trabajo abierto ahora" - filtran
  // is_currently_detected=true ADEMÁS de status (bug real, ver comentario en
  // BandejaFilters.detection): status por sí solo nunca baja cuando una regla
  // deja de detectar una entidad sin una corrección humana que dispare
  // verificación (ej. la reclasificación NO_PART_USED) - esas incidencias
  // seguían contando como "abiertas" en los KPI aunque la regla ya no las
  // detectara. byStatus es la única excepción deliberada: es la distribución
  // completa del campo de ciclo de vida, incluye TODO a propósito.
  const [byStatus, bySeverity, byRule, byEntityType, verification, recentCorrections, dailyDetections] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>("app_read", `SELECT status, count(*) AS n FROM governance.issues GROUP BY status ORDER BY status`),
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT severity, count(*) AS n FROM governance.issues WHERE is_currently_detected = true AND status IN ('OPEN','IN_REVIEW') GROUP BY severity ORDER BY severity`
    ),
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT i.rule_code, coalesce(max(rd.title), i.rule_code) AS rule_title, count(*) AS n
       FROM governance.issues i
       LEFT JOIN governance.rule_definitions rd ON rd.rule_code = i.rule_code AND rd.rule_version = i.last_evaluated_rule_version
       WHERE i.is_currently_detected = true AND i.status IN ('OPEN','IN_REVIEW') GROUP BY i.rule_code ORDER BY n DESC`
    ),
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT entity_type, count(*) AS n FROM governance.issues WHERE is_currently_detected = true AND status IN ('OPEN','IN_REVIEW') GROUP BY entity_type ORDER BY n DESC`
    ),
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT processing_status, verification_outcome, count(*) AS n FROM governance.verification_requests_current GROUP BY processing_status, verification_outcome ORDER BY processing_status`
    ),
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT id, correction_type, target_type, actor_type, reason, created_at FROM governance.correction_versions ORDER BY created_at DESC LIMIT 10`
    ),
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT date_trunc('day', first_seen_at) AS day, count(*) AS n FROM governance.issues WHERE first_seen_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1`
    )
  ]);

  return {
    byStatus: serializeRows(byStatus),
    bySeverity: serializeRows(bySeverity),
    byRule: serializeRows(byRule),
    byEntityType: serializeRows(byEntityType),
    verification: serializeRows(verification),
    recentCorrections: serializeRows(recentCorrections),
    dailyDetections: serializeRows(dailyDetections)
  };
}

// =============================================================================
// Gate B - Familia 8: pestaña "Correcciones" - historial de versiones
// (governance.correction_versions/correction_targets), estado efectivo
// (current_correction_version_id), versión, actor, fecha, razón, y la
// verificación asociada cuando exista (por correlation_id de eventos de
// verificación - dejado a un query separado si se necesita en detalle;
// aquí solo la lista de versiones, ya suficiente para "estado efectivo").
// =============================================================================
export interface CorrectionVersionsFilters {
  correctionType?: string;
}

export async function fetchCorrectionVersionsList(
  filters: CorrectionVersionsFilters,
  page: number,
  pageSize: number
): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.correctionType) {
    params.push(filters.correctionType);
    conditions.push(`cv.correction_type = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limitParam = params.length + 1;
  const offsetParam = params.length + 2;

  const [rows, countRows] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT cv.id, cv.correction_type, cv.target_type, cv.target_key, cv.payload, cv.version, cv.actor_type, cv.actor_user_id,
              cv.reason, cv.created_at, cv.superseded_by, cv.reversal_of,
              (ct.current_correction_version_id = cv.id) AS is_effective
       FROM governance.correction_versions cv
       LEFT JOIN governance.correction_targets ct ON ct.target_type = cv.target_type AND ct.target_key = cv.target_key
       ${whereClause}
       ORDER BY cv.created_at DESC, cv.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, pageSize, (page - 1) * pageSize]
    ),
    runGovernanceQuery<{ n: string }>("app_read", `SELECT COUNT(*) AS n FROM governance.correction_versions cv ${whereClause}`, params)
  ]);

  return { rows: serializeRows(rows), total: Number(countRows[0]?.n ?? 0) };
}

// =============================================================================
// Gate B - Familia 8: pestaña "Reglas" - catálogo de reglas
// (governance.rule_definitions/rule_registry), versión activa, severidad,
// entidad, estado, última evaluación (rule_evaluation_run_items), conteo de
// issues. NUNCA un editor de reglas (Gate A: explícitamente excluido) - solo
// lectura del catálogo ya definido en sql/089/090.
// =============================================================================
export async function fetchRulesList(): Promise<Record<string, unknown>[]> {
  const rows = await runGovernanceQuery<Record<string, unknown>>(
    "app_read",
    `SELECT rr.rule_code, rr.active_rule_version, rr.is_active, rd.entity_type, rd.title, rd.description,
            rd.default_severity, rd.created_at AS rule_defined_at, rd.retired_at,
            (SELECT count(*) FROM governance.issues i WHERE i.rule_code = rr.rule_code AND i.is_currently_detected = true AND i.status IN ('OPEN','IN_REVIEW')) AS open_issue_count,
            (SELECT max(rer.finished_at) FROM governance.rule_evaluation_run_items rei
               JOIN governance.rule_evaluation_runs rer ON rer.evaluation_run_id = rei.evaluation_run_id
             WHERE rei.rule_code = rr.rule_code AND rei.status = 'SUCCEEDED') AS last_evaluated_at
     FROM governance.rule_registry rr
     JOIN governance.rule_definitions rd ON rd.rule_code = rr.rule_code AND rd.rule_version = rr.active_rule_version
     ORDER BY rr.rule_code`
  );
  return serializeRows(rows);
}

// =============================================================================
// Gate B - Familia 8: pestaña "Fuentes y pipeline" - frescura/estado del
// evaluador de reglas (governance.rule_evaluation_runs) - corridas recientes,
// errores operacionales resumidos. Nunca un botón de "actualizar" falso: el
// mecanismo de actualización de datos (Sección 23 del diseño) sigue fuera de
// alcance de este tramo (data-refresh, prioridad más baja, explícitamente
// diferido).
// =============================================================================
export async function fetchPipelineRuns(page: number, pageSize: number): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const [rows, countRows] = await Promise.all([
    runGovernanceQuery<Record<string, unknown>>(
      "app_read",
      `SELECT r.evaluation_run_id, r.rule_set_version, r.scope_mode, r.scope_rule_code, coalesce(rd.title, r.scope_rule_code) AS scope_rule_title,
              r.status, r.triggered_by, r.started_at, r.finished_at, r.rows_evaluated, r.issues_detected, r.issues_new,
              r.issues_persistent, r.issues_disappeared, r.error_message
       FROM governance.rule_evaluation_runs r
       LEFT JOIN governance.rule_registry rr ON rr.rule_code = r.scope_rule_code
       LEFT JOIN governance.rule_definitions rd ON rd.rule_code = rr.rule_code AND rd.rule_version = rr.active_rule_version
       ORDER BY r.started_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize]
    ),
    runGovernanceQuery<{ n: string }>("app_read", `SELECT COUNT(*) AS n FROM governance.rule_evaluation_runs`)
  ]);
  return { rows: serializeRows(rows), total: Number(countRows[0]?.n ?? 0) };
}
