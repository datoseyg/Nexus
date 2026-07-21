-- ETAPA 6.6B0 -- Vista de transición marts.fieldbeat_working_hours_analysis_current.
-- Único objeto "contrato público" de esta subetapa -los 7 endpoints de
-- /dashboard/after-hours repuntan acá en 6.6C, nunca directo a Capa B/C ni
-- al mart legado. Archivo separado a propósito de sql/081: 6.6C muy
-- probablemente solo necesite reabrir este archivo (o crear sql/083_... si
-- la vista cambia de forma) sin reabrir el DDL de las tablas base.
--
-- Deriva minutos desde los segundos canónicos de Capa C (unidad de
-- almacenamiento, ver sql/081) UNA SOLA VEZ, acá -nunca de forma
-- acumulativa. Resuelve el equipo "primario" multi-equipo vía JOIN a la
-- tabla puente filtrado por is_primary, nunca desde un escalar de Capa C
-- (esa tabla ya no tiene esos escalares -ver sql/081 sección 2).
--
-- NO filtra las filas de Capa C por calculation_status: Capa C ya resolvió
-- su propia cascada interna (CONTRACTUAL -> LEGACY_SCHEDULE -> NONE) antes
-- de persistir, así que se usa la fila tal cual, incluyendo el caso NONE
-- (que preserva contractual_attempt_status/_coverage_classification/
-- _reason_code -el motivo del fallo, nunca descartado). El mart legado
-- (`l`) SOLO actúa como relleno transitorio cuando Capa C aún no tiene fila
-- para esa tarea (backfill incompleto, ver 6.6B2) -nunca compite con una
-- fila de Capa C ya resuelta.
--
-- calculated_at es NULL explícito cuando la fuente es el mart legado (no
-- tiene esa columna, confirmado en sql/020_marts.sql) o cuando no hay
-- ninguna fuente -NUNCA now(), que fabricaría una marca de tiempo falsa
-- para una fila que en realidad nunca fue calculada por este pipeline.
--
-- CRÍTICO para 6.6B2: una vista de Postgres se resuelve por OID de la
-- relación subyacente, no por nombre. Cualquier estrategia de publicación
-- de Capa B/C que renombre tablas (RENAME-swap) debe recrear esta vista
-- (CREATE OR REPLACE VIEW, este mismo archivo) en la MISMA transacción del
-- swap, o la vista queda silenciosamente desactualizada, sin error visible.
-- Esto es una de las razones por las que 6.6B2 compara RENAME-swap contra
-- staging+TRUNCATE/INSERT transaccional antes de elegir un método por
-- defecto (ver plan de 6.6B2).

CREATE OR REPLACE VIEW marts.fieldbeat_working_hours_analysis_current AS
SELECT
  t.fieldbeat_task_id,
  COALESCE(c.client_key, l.client_key) AS client_key,
  COALESCE(c.client_rut, l.client_rut) AS client_rut,
  COALESCE(c.client_name, l.client_name) AS client_name,
  COALESCE(c.task_type, l.task_type) AS task_type,
  COALESCE(c.assigned_to, l.assigned_to) AS assigned_to,
  COALESCE(c.equipment_internal_ids, l.equipment_internal_ids) AS equipment_internal_ids,
  COALESCE(c.start_time_utc, l.start_time_utc) AS start_time_utc,
  COALESCE(c.start_time_local, l.start_time_local) AS start_time_local,
  c.end_time_utc, c.end_time_local,
  COALESCE(c.reported_end_raw, l.reported_end_raw) AS reported_end_raw,

  -- Derivación segundos -> minutos, una sola vez, acá:
  COALESCE(c.duration_seconds / 60.0, l.duration_minutes) AS duration_minutes,
  COALESCE(c.covered_seconds / 60.0, l.business_minutes) AS business_minutes,   -- nombre legado preservado para paridad de endpoint
  c.outside_coverage_seconds / 60.0 AS outside_coverage_minutes,
  COALESCE(c.after_hours_weekday_seconds / 60.0, l.after_hours_weekday_minutes) AS after_hours_weekday_minutes,
  COALESCE(c.weekend_seconds / 60.0, l.weekend_minutes) AS weekend_minutes,
  COALESCE(c.holiday_seconds / 60.0, l.holiday_minutes) AS holiday_minutes,
  COALESCE(c.after_hours_total_seconds / 60.0, l.after_hours_total_minutes) AS after_hours_total_minutes,
  COALESCE(c.after_hours_rate, l.after_hours_rate::numeric) AS after_hours_rate,
  COALESCE(c.is_after_hours_task, l.is_after_hours_task) AS is_after_hours_task,

  COALESCE(c.calculation_status, l.calculation_status, 'NOT_CALCULABLE') AS calculation_status,
  c.coverage_classification, c.coverage_reason_code,
  c.contractual_attempt_status, c.contractual_coverage_classification, c.contractual_reason_code, c.fallback_used,

  -- Multi-equipo: vía JOIN al equipo primario (Capa C ya no tiene estos
  -- escalares, ver sql/081 sección 2).
  pe.fieldbeat_equipment_key AS primary_equipment_key,
  pe.contract_valid_from, pe.contract_valid_to, pe.match_status, pe.parse_status,

  COALESCE(c.confidence_score, l.confidence_score) AS confidence_score,
  COALESCE(c.confidence_label, l.confidence_label) AS confidence_label,
  COALESCE(c.confidence_factors, l.confidence_factors) AS confidence_factors,
  COALESCE(c.calculation_method, l.calculation_method) AS calculation_method,
  c.contract_resolution_confidence, c.contract_resolution_label, c.confidence_model_version,

  CASE
    WHEN c.fieldbeat_task_id IS NOT NULL THEN c.data_basis
    WHEN l.fieldbeat_task_id IS NOT NULL THEN 'LEGACY_SCHEDULE'
    ELSE 'NONE'
  END AS data_basis,
  c.calculated_at,   -- NOT NULL en Capa C siempre que exista fila (ver sql/081); NULL natural vía LEFT JOIN cuando c no existe (relleno transitorio del mart legado o NONE puro)
  c.builder_run_id

FROM processed.fieldbeat_tasks t
LEFT JOIN marts.fieldbeat_working_hours_analysis_v2 c ON c.fieldbeat_task_id = t.fieldbeat_task_id
LEFT JOIN marts.fieldbeat_working_hours_equipment_links pe ON pe.working_hours_id = c.working_hours_id AND pe.is_primary
LEFT JOIN marts.fieldbeat_working_hours_analysis l ON l.fieldbeat_task_id = t.fieldbeat_task_id AND c.fieldbeat_task_id IS NULL;

GRANT SELECT ON marts.fieldbeat_working_hours_analysis_current TO nexus_app;
