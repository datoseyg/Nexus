-- FieldBeat Phase 2 - modelo de calidad/trazabilidad. Idempotente (CREATE OR
-- REPLACE / IF NOT EXISTS en todo), 100% de solo lectura sobre processed/
-- marts/manual_review ya sincronizados - esta migración NUNCA escribe en
-- esos schemas ni se toca desde db:pg:migrate.js (SYNC_SCHEMAS = ["processed",
-- "marts", "gold"], "quality" queda fuera de su alcance a propósito). Cada
-- vista es la fuente ÚNICA que además consumen los tests de equivalencia
-- SQL<->TypeScript (ver test/fieldbeat/quality-sql-equivalence.integration.test.ts)
-- - las reglas de negocio viven acá y en lib/fieldbeat-*.ts, nunca solo en un
-- componente React.
--
-- Reglas espejadas 1:1 desde:
--   lib/fieldbeat-terminal-states.ts       -> quality.is_terminal_task_state()
--   lib/fieldbeat-team-identification.ts   -> quality.fieldbeat_team_identification
--   lib/fieldbeat-parts-history.ts         -> quality.fieldbeat_used_part_match
--   lib/fieldbeat-inconsistency-taxonomy.ts -> quality.fieldbeat_report_inconsistencies
--
-- Compatible con Postgres local Y Supabase Postgres (sin extensiones ni
-- sintaxis propietaria). No se aplicó a ningún host remoto - solo a
-- localhost:55480/nexus_bi_dev_local_test.
--
-- Phase 3 preflight §1.3 - la primera versión de este archivo usaba
-- `DROP SCHEMA quality CASCADE` + recreación completa en cada corrida.
-- Funcionaba en una base desechable (nada que perder), pero es exactamente
-- el patrón que NO puede aplicarse contra una base de producto ya
-- existente: un `DROP SCHEMA CASCADE` corrido ahí borraría grants futuros
-- u objetos que otra migración posterior haya agregado dentro de
-- "quality" sin que este archivo lo sepa. Reemplazado por
-- `CREATE SCHEMA IF NOT EXISTS` + `CREATE OR REPLACE VIEW/FUNCTION` en
-- todo - seguro de re-correr contra una base ya poblada. La única
-- restricción real de Postgres es que CREATE OR REPLACE VIEW no permite
-- reordenar/quitar columnas de una vista ya existente - la regla para
-- cualquier cambio futuro acá es SIEMPRE agregar columnas nuevas al FINAL
-- del SELECT de cada vista, nunca en el medio; si alguna vez hiciera falta
-- un cambio incompatible, la corrección es un `DROP VIEW IF EXISTS
-- quality.<vista_propia>` puntual (nunca del schema completo) seguido de
-- recrear esa vista y sus dependientes directos, documentado en el commit
-- que lo haga - no una práctica por defecto.
CREATE SCHEMA IF NOT EXISTS quality;

GRANT USAGE ON SCHEMA quality TO nexus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA quality
  GRANT SELECT ON TABLES TO nexus_app;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA quality
  GRANT EXECUTE ON FUNCTIONS TO nexus_app;

-- ============================================================================
-- 1. Estados terminales - espejo de KNOWN_FIELDBEAT_TASK_STATES /
--    TERMINAL_FIELDBEAT_TASK_STATES (lib/fieldbeat-terminal-states.ts).
--    Un estado no reconocido NUNCA cuenta como cerrado (mismo default seguro
--    que la función TS).
-- ============================================================================
CREATE OR REPLACE FUNCTION quality.is_terminal_task_state(state TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT state IN ('FINISHED', 'ARCHIVED')
$$;

-- ============================================================================
-- 2. Tokens de descripción - misma tokenización que
--    tokenizeDescription() en lib/fieldbeat-team-identification.ts:
--    minúsculas, split por no-alfanumérico EXCEPTO el guion (los
--    internal_id reales usan guion: "Linac-153935", "TPS-UC" - partirlos
--    ahí los volvía irrecuperables de texto libre), descarta tokens < 3
--    chars.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_description_tokens AS
SELECT t.fieldbeat_task_id, token
FROM processed.fieldbeat_tasks t,
LATERAL regexp_split_to_table(lower(coalesce(t.description, '')), '[^a-z0-9-]+') AS token
WHERE length(token) >= 3;

-- ============================================================================
-- 3. Identificación de equipo por reporte - mismas 4 ramas alcanzables que
--    classifyTeamIdentification() (NOT_APPLICABLE nunca se infiere acá,
--    igual que en TS - solo existe vía evidencia explícita, que hoy no hay
--    fuente de datos para suministrar en SQL).
--    Candidatos scoped al mismo client_key del reporte (nunca la flota
--    completa) para no inflar colisiones artificialmente.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_team_identification AS
WITH reports AS (
  SELECT v.fieldbeat_task_id, v.client_key, v.equipment_internal_ids
  FROM marts.fieldbeat_report_dolibarr_operational_view v
),
candidates AS (
  SELECT DISTINCT client_key, lower(internal_id) AS candidate_token, internal_id AS candidate_id
  FROM processed.fieldbeat_equipments
  WHERE internal_id IS NOT NULL AND length(internal_id) >= 3
),
matches AS (
  SELECT DISTINCT r.fieldbeat_task_id, c.candidate_id
  FROM reports r
  JOIN quality.fieldbeat_description_tokens dt ON dt.fieldbeat_task_id = r.fieldbeat_task_id
  JOIN candidates c ON c.client_key = r.client_key AND c.candidate_token = dt.token
  WHERE r.equipment_internal_ids IS NULL OR r.equipment_internal_ids = ''
),
matches_agg AS (
  SELECT fieldbeat_task_id, array_agg(candidate_id ORDER BY candidate_id) AS matched_candidate_ids, COUNT(*) AS matched_count
  FROM matches
  GROUP BY fieldbeat_task_id
)
SELECT
  r.fieldbeat_task_id,
  CASE
    WHEN r.equipment_internal_ids IS NOT NULL AND r.equipment_internal_ids <> '' THEN 'STRUCTURED_IDENTIFIED'
    WHEN ma.matched_count = 1 THEN 'TEXT_CONFIDENT_IDENTIFIED'
    WHEN ma.matched_count > 1 THEN 'TEXT_AMBIGUOUS'
    ELSE 'MISSING'
  END AS team_identification_status,
  ma.matched_candidate_ids
FROM reports r
LEFT JOIN matches_agg ma ON ma.fieldbeat_task_id = r.fieldbeat_task_id;

-- ============================================================================
-- 4. Match histórico de repuestos por línea - espejo de
--    classifyHistoricalPartMatch() (lib/fieldbeat-parts-history.ts).
--    manual_review.part_aliases está vacía hoy (0 filas) - esta vista queda
--    lista para cuando se cure un alias real, sin heurísticas inventadas.
--    DESCRIPTION_CONFIDENT_MATCH no tiene fuente en SQL (igual que en TS,
--    donde solo se alcanza vía descriptionConfidentOverride explícito) -
--    nunca aparece generado por esta vista.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_used_part_match AS
SELECT
  m.used_part_id,
  m.fieldbeat_task_id,
  m.match_status,
  CASE
    WHEN m.match_status = 'AMBIGUOUS_MATCH' THEN 'AMBIGUOUS_MATCH'
    WHEN m.match_status = 'PLACEHOLDER_VALUE' THEN 'PLACEHOLDER_VALUE'
    WHEN m.match_status = 'MATCHED' THEN 'CURRENT_DIRECT_MATCH'
    WHEN m.match_status = 'NO_MATCH' AND alias.dolibarr_product_id IS NOT NULL THEN 'HISTORICAL_ALIAS_MATCH'
    ELSE 'NO_MATCH'
  END AS historical_match_status,
  alias.dolibarr_product_id AS alias_resolved_dolibarr_product_id
FROM marts.used_parts_dolibarr_match m
LEFT JOIN LATERAL (
  SELECT pa.dolibarr_product_id
  FROM manual_review.part_aliases pa
  WHERE pa.active = true
    AND (
      (pa.alias_type = 'RAW' AND lower(pa.alias_value) = lower(coalesce(m.raw_part_identifier, '')))
      OR (pa.alias_type = 'NORMALIZED' AND lower(pa.alias_value) = lower(coalesce(m.normalized_part_identifier, '')))
    )
  LIMIT 1
) alias ON true;

-- ============================================================================
-- 5. Resumen de trazabilidad por reporte (grano reporte, nunca mezclado con
--    el grano línea - ver KPI4). Espejo de isFullyTraceableReport().
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_parts_summary AS
SELECT
  fieldbeat_task_id,
  COUNT(*) AS total_lines,
  COUNT(*) FILTER (WHERE historical_match_status = 'CURRENT_DIRECT_MATCH') AS direct_matches,
  COUNT(*) FILTER (WHERE historical_match_status = 'HISTORICAL_ALIAS_MATCH') AS historical_alias_matches,
  COUNT(*) FILTER (WHERE historical_match_status = 'DESCRIPTION_CONFIDENT_MATCH') AS description_matches,
  COUNT(*) FILTER (WHERE historical_match_status = 'AMBIGUOUS_MATCH') AS ambiguous,
  COUNT(*) FILTER (WHERE historical_match_status = 'PLACEHOLDER_VALUE') AS placeholders,
  COUNT(*) FILTER (WHERE historical_match_status = 'NO_MATCH') AS no_match,
  bool_and(historical_match_status IN ('CURRENT_DIRECT_MATCH', 'HISTORICAL_ALIAS_MATCH', 'DESCRIPTION_CONFIDENT_MATCH')) AS fully_traceable
FROM quality.fieldbeat_used_part_match
GROUP BY fieldbeat_task_id;

-- ============================================================================
-- 6. Vinculación de tickets por reporte - soporta 0..N vía COUNT sobre el
--    bridge real (marts.ticket_fieldbeat_report_detail), nunca un JOIN
--    directo que multiplique filas del reporte. "Accesible" = tiene >=1 fila
--    en el bridge (resuelto contra processed.zendesk_tickets real);
--    "informado pero inaccesible" = linked_zendesk_ticket_id no vacío pero
--    0 filas en el bridge.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_ticket_linkage AS
SELECT
  v.fieldbeat_task_id,
  (v.linked_zendesk_ticket_id IS NOT NULL AND v.linked_zendesk_ticket_id <> '') AS has_ticket_reported,
  COALESCE(b.accessible_ticket_count, 0) AS accessible_ticket_count
FROM marts.fieldbeat_report_dolibarr_operational_view v
LEFT JOIN (
  SELECT fieldbeat_task_id, COUNT(*) AS accessible_ticket_count
  FROM marts.ticket_fieldbeat_report_detail
  GROUP BY fieldbeat_task_id
) b ON b.fieldbeat_task_id = v.fieldbeat_task_id;

-- ============================================================================
-- 7. Vista maestra por reporte - une estado/tiempo/equipo/tickets/repuestos.
--    Fuente única para los 6 KPI y para la bandeja de inconsistencias.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_quality AS
WITH raw AS (
  SELECT
    t.fieldbeat_task_id,
    t.state,
    quality.is_terminal_task_state(t.state) AS is_closed,
    (t.state = 'FINISHED') AS is_finished,
    t.created_at,
    t.start_time,
    t.last_transition_at,
    t.duration_minutes,
    (t.last_transition_at IS NOT NULL AND t.start_time IS NOT NULL AND t.last_transition_at < t.start_time) AS chronology_impossible,
    (t.start_time IS NOT NULL AND t.last_transition_at IS NOT NULL) AS has_sufficient_timestamps,
    (t.state = 'FINISHED' AND t.duration_minutes = 0) AS finished_zero_duration,
    (t.state = 'FINISHED' AND t.duration_minutes IS NULL) AS finished_null_duration,
    v.client_key,
    v.client_name,
    v.technician_names,
    v.task_type,
    v.fieldbeat_task_date,
    v.equipment_internal_ids,
    v.report_quality_status,
    t.created_in AS origen,
    (v.technician_names IS NOT NULL AND v.technician_names <> '') AS has_technician,
    (v.client_key IS NOT NULL AND v.client_key <> '') AS has_client,
    ti.team_identification_status,
    tl.has_ticket_reported,
    tl.accessible_ticket_count,
    (tl.has_ticket_reported AND tl.accessible_ticket_count > 0) AS ticket_accessible,
    (tl.has_ticket_reported AND tl.accessible_ticket_count = 0) AS ticket_missing_or_restricted,
    COALESCE(ps.total_lines, 0) AS part_total_lines,
    COALESCE(ps.direct_matches, 0) AS part_direct_matches,
    COALESCE(ps.historical_alias_matches, 0) AS part_historical_alias_matches,
    COALESCE(ps.description_matches, 0) AS part_description_matches,
    COALESCE(ps.ambiguous, 0) AS part_ambiguous,
    COALESCE(ps.placeholders, 0) AS part_placeholders,
    COALESCE(ps.no_match, 0) AS part_no_match,
    COALESCE(ps.fully_traceable, false) AS part_fully_traceable
  FROM processed.fieldbeat_tasks t
  JOIN marts.fieldbeat_report_dolibarr_operational_view v ON v.fieldbeat_task_id = t.fieldbeat_task_id
  LEFT JOIN quality.fieldbeat_team_identification ti ON ti.fieldbeat_task_id = t.fieldbeat_task_id
  LEFT JOIN quality.fieldbeat_ticket_linkage tl ON tl.fieldbeat_task_id = t.fieldbeat_task_id
  LEFT JOIN quality.fieldbeat_report_parts_summary ps ON ps.fieldbeat_task_id = t.fieldbeat_task_id
)
SELECT
  raw.*,
  (has_technician AND has_client) AS minimum_fields_complete,
  (has_technician AND has_client AND team_identification_status IN ('STRUCTURED_IDENTIFIED', 'TEXT_CONFIDENT_IDENTIFIED')) AS structurally_complete
FROM raw;

-- ============================================================================
-- 8. Inconsistencias por reporte (grano: 1 fila por código disparado) -
--    espejo EXACTO de classifyReportInconsistencies() en
--    lib/fieldbeat-inconsistency-taxonomy.ts. Mismos códigos, misma
--    severidad, mismo priority_order de desempate (1..10, igual al orden de
--    declaración en INCONSISTENCY_TAXONOMY).
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_inconsistencies AS
SELECT q.fieldbeat_task_id, f.code, f.severity, f.priority_order
FROM quality.fieldbeat_report_quality q
CROSS JOIN LATERAL (
  VALUES
    ('TEMPORAL_IMPOSSIBLE_CHRONOLOGY'::text, 'Alta'::text, 1, q.chronology_impossible),
    ('PART_AMBIGUOUS_MATCH', 'Alta', 2, q.part_ambiguous > 0),
    ('TEAM_TEXT_AMBIGUOUS', 'Alta', 3, q.team_identification_status = 'TEXT_AMBIGUOUS'),
    ('PART_NO_MATCH', 'Media', 4, q.part_no_match > 0),
    ('TICKET_REPORTED_INACCESSIBLE', 'Media', 5, q.ticket_missing_or_restricted),
    ('TEAM_MISSING', 'Media', 6, q.is_closed AND q.team_identification_status = 'MISSING'),
    ('MIN_FIELDS_INCOMPLETE', 'Media', 7, q.is_closed AND NOT q.minimum_fields_complete),
    ('PART_PLACEHOLDER_ONLY', 'Baja', 8, q.part_total_lines > 0 AND q.part_placeholders > 0 AND q.part_no_match = 0 AND q.part_ambiguous = 0),
    ('FINISHED_ZERO_DURATION', 'Advertencia', 9, q.is_finished AND q.finished_zero_duration),
    ('FINISHED_NULL_DURATION', 'Advertencia', 10, q.is_finished AND q.finished_null_duration)
) AS f(code, severity, priority_order, triggered)
WHERE f.triggered;

-- ============================================================================
-- 9. Inconsistencia primaria por reporte - espejo de primaryInconsistency():
--    mayor severidad primero, empate por priority_order (orden de
--    declaración), nunca por frecuencia.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_primary_inconsistency AS
SELECT DISTINCT ON (fieldbeat_task_id)
  fieldbeat_task_id, code, severity
FROM quality.fieldbeat_report_inconsistencies
ORDER BY
  fieldbeat_task_id,
  CASE severity WHEN 'Alta' THEN 0 WHEN 'Media' THEN 1 WHEN 'Baja' THEN 2 WHEN 'Advertencia' THEN 3 ELSE 4 END,
  priority_order;
