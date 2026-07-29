-- Auditoría escribible / Explorador de negocio - Gate B, Fase 2.
-- Fundación de gobierno: issue store, evidence, event log append-only,
-- review cases, correction versions/targets, idempotency, ejecutor de
-- reglas (staging + publicación), outbox de verificación con fencing.
--
-- Aditivo, idempotente (CREATE ... IF NOT EXISTS / CREATE OR REPLACE),
-- sin DROP destructivo, probado en base fresca y en segunda aplicación
-- contra Postgres local desechable (nunca remoto). Orden de creación por
-- dependencias: catálogos -> runs -> issues -> evidence -> review cases ->
-- correction versions/targets -> command events/attempts -> idempotency ->
-- verification requests -> capabilities -> FKs circulares (ALTER TABLE) ->
-- índices -> vistas curadas -> roles -> grants.
--
-- Todo lo nuevo vive en el schema `governance` (nunca en `audit`, que se
-- conserva como legado sin nuevos escritores) + `pipeline` (para el futuro
-- worker de actualización de datos, Sección 23 del plan). Este archivo
-- crea SOLO estructura (tablas/vistas/roles/grants) - las funciones
-- SECURITY DEFINER (comandos, evaluador, worker de verificación) viven en
-- sql/090_governance_functions.sql, aplicado después.

CREATE SCHEMA IF NOT EXISTS governance;
CREATE SCHEMA IF NOT EXISTS pipeline;

-- =============================================================================
-- 1. Catálogos independientes
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.event_types (
  event_type      text PRIMARY KEY,
  category        text NOT NULL,
  emitter_policy  text NOT NULL CHECK (emitter_policy IN ('HUMAN_ONLY','SERVICE_ONLY','HUMAN_OR_SERVICE','LEGACY_IMPORT_ONLY')),
  is_active       boolean NOT NULL DEFAULT true
);

INSERT INTO governance.event_types (event_type, category, emitter_policy) VALUES
  ('ISSUE_DETECTED',                 'ISSUE_LIFECYCLE', 'SERVICE_ONLY'),
  ('ISSUE_REAPPEARED',               'ISSUE_LIFECYCLE', 'SERVICE_ONLY'),
  ('ISSUE_ASSIGNED',                 'ISSUE_LIFECYCLE', 'HUMAN_ONLY'),
  ('ISSUE_DISMISSED',                'ISSUE_LIFECYCLE', 'HUMAN_ONLY'),
  ('ISSUE_REOPENED',                 'ISSUE_LIFECYCLE', 'HUMAN_ONLY'),
  ('ISSUE_RESOLVED_VERIFIED',        'ISSUE_LIFECYCLE', 'SERVICE_ONLY'),
  ('COMMENT_ADDED',                  'COMMENT',          'HUMAN_ONLY'),
  ('COMMENT_REDACTED',               'COMMENT',          'HUMAN_ONLY'),
  ('CORRECTION_APPLIED',             'CORRECTION',       'HUMAN_ONLY'),
  ('CORRECTION_REVERSED',            'CORRECTION',       'HUMAN_ONLY'),
  ('VERIFICATION_PASSED',            'VERIFICATION',     'SERVICE_ONLY'),
  ('VERIFICATION_STILL_DETECTED',    'VERIFICATION',     'SERVICE_ONLY'),
  ('VERIFICATION_OPERATIONAL_ERROR', 'VERIFICATION',     'SERVICE_ONLY'),
  ('VERIFICATION_DEAD_LETTERED',     'VERIFICATION',     'SERVICE_ONLY'),
  ('REVIEW_CASE_CREATED',            'REVIEW_CASE',      'HUMAN_ONLY'),
  ('REVIEW_CASE_UPDATED',            'REVIEW_CASE',      'HUMAN_ONLY'),
  ('LEGACY_CORRECTION_IMPORTED',     'LEGACY_IMPORT',    'LEGACY_IMPORT_ONLY'),
  ('EXPORT_COMPLETED',               'EXPORT',           'HUMAN_ONLY'),
  ('RESTRICTED_EVIDENCE_ACCESSED',   'CORRECTION',       'HUMAN_ONLY'),
  ('REDACTED_COMMENT_ACCESSED',      'COMMENT',          'HUMAN_ONLY'),
  ('RESTRICTED_EVENT_STATE_ACCESSED','CORRECTION',       'HUMAN_ONLY')
ON CONFLICT (event_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS governance.rule_definitions (
  rule_code               text NOT NULL,
  rule_version             integer NOT NULL CHECK (rule_version > 0),
  entity_type               text NOT NULL,
  title                       text NOT NULL,
  description                   text NOT NULL,
  default_severity               text NOT NULL CHECK (default_severity IN ('LOW','MEDIUM','HIGH','WARNING')),
  evaluator_key                    text NOT NULL,
  evidence_schema_version            text NOT NULL DEFAULT '1.0.0',
  created_at                          timestamptz NOT NULL DEFAULT now(),
  retired_at                            timestamptz NULL,
  PRIMARY KEY (rule_code, rule_version)
);

CREATE TABLE IF NOT EXISTS governance.rule_registry (
  rule_code             text PRIMARY KEY,
  active_rule_version    integer NOT NULL,
  is_active               boolean NOT NULL DEFAULT true,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (rule_code, active_rule_version) REFERENCES governance.rule_definitions(rule_code, rule_version)
);

-- Semilla del catálogo mínimo de reglas (Gate B, Sección B6). evaluator_key
-- es una clave allowlisted que el ejecutor (sql/090 + worker Node.js)
-- resuelve por código conocido - nunca SQL dinámico ni nombre de vista
-- suministrado en runtime.
INSERT INTO governance.rule_definitions (rule_code, rule_version, entity_type, title, description, default_severity, evaluator_key) VALUES
  ('PART_NO_MATCH', 1, 'part_occurrence', 'Repuesto sin coincidencia',
   'Ocurrencia de repuesto declarada en un reporte FieldBeat sin match contra el catálogo Dolibarr (quality.fieldbeat_used_part_match.match_status = NO_MATCH).',
   'MEDIUM', 'PART_NO_MATCH_V1'),
  ('PART_AMBIGUOUS_MATCH', 1, 'part_occurrence', 'Coincidencia ambigua de repuesto',
   'Ocurrencia de repuesto con más de un candidato posible en el catálogo Dolibarr (match_status = AMBIGUOUS_MATCH).',
   'MEDIUM', 'PART_AMBIGUOUS_MATCH_V1'),
  ('PART_PLACEHOLDER_VALUE', 1, 'part_occurrence', 'Valor provisional de repuesto',
   'Ocurrencia de repuesto cuyo identificador crudo es un valor placeholder conocido (match_status = PLACEHOLDER_VALUE).',
   'LOW', 'PART_PLACEHOLDER_VALUE_V1'),
  ('REPORT_QUALITY_DEGRADED', 1, 'report', 'Calidad degradada del reporte',
   'Reporte FieldBeat cuyo report_quality_status indica revisión requerida (marts.fieldbeat_report_dolibarr_operational_view).',
   'MEDIUM', 'REPORT_QUALITY_DEGRADED_V1'),
  ('TICKET_LINK_RESTRICTED_OR_MISSING', 1, 'ticket_link', 'Vínculo de ticket faltante o restringido',
   'Reporte FieldBeat vinculado a un ticket Zendesk inaccesible/restringido, o sin ningún ticket vinculado (zendesk_join_status).',
   'MEDIUM', 'TICKET_LINK_RESTRICTED_OR_MISSING_V1')
ON CONFLICT (rule_code, rule_version) DO NOTHING;

-- Corrige el título de negocio de las 5 filas semilla de arriba cuando ya
-- existían de una aplicación anterior de esta migración (el INSERT de
-- arriba es ON CONFLICT DO NOTHING - nunca actualiza una fila ya sembrada).
-- Idempotente: siempre deja el título en el valor correcto vigente, nunca
-- toca description/severity/evaluator_key.
UPDATE governance.rule_definitions SET title = 'Repuesto sin coincidencia' WHERE rule_code = 'PART_NO_MATCH' AND rule_version = 1;
UPDATE governance.rule_definitions SET title = 'Coincidencia ambigua de repuesto' WHERE rule_code = 'PART_AMBIGUOUS_MATCH' AND rule_version = 1;
UPDATE governance.rule_definitions SET title = 'Valor provisional de repuesto' WHERE rule_code = 'PART_PLACEHOLDER_VALUE' AND rule_version = 1;
UPDATE governance.rule_definitions SET title = 'Calidad degradada del reporte' WHERE rule_code = 'REPORT_QUALITY_DEGRADED' AND rule_version = 1;
UPDATE governance.rule_definitions SET title = 'Vínculo de ticket faltante o restringido' WHERE rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND rule_version = 1;

INSERT INTO governance.rule_registry (rule_code, active_rule_version, is_active) VALUES
  ('PART_NO_MATCH', 1, true),
  ('PART_AMBIGUOUS_MATCH', 1, true),
  ('PART_PLACEHOLDER_VALUE', 1, true),
  ('REPORT_QUALITY_DEGRADED', 1, true),
  ('TICKET_LINK_RESTRICTED_OR_MISSING', 1, true)
ON CONFLICT (rule_code) DO NOTHING;

-- =============================================================================
-- 2. Ejecutor de reglas: runs, staging, cobertura, publicación
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS governance.evaluation_generation_seq;

CREATE TABLE IF NOT EXISTS governance.rule_evaluation_runs (
  evaluation_run_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_generation          bigint NOT NULL DEFAULT nextval('governance.evaluation_generation_seq'),
  rule_set_version                  text NOT NULL,
  scope_mode                          text NOT NULL CHECK (scope_mode IN ('FULL','INCREMENTAL_SINCE_LAST_REFRESH','SCOPED')),
  scope_rule_code                       text NULL,
  scope_entity_type                       text NULL,
  scope_entity_key                          text NULL,
  scope_occurrence_key                        text NULL,
  source_snapshot_id                            text NULL,
  source_snapshot_captured_at                     timestamptz NULL,
  published_data_generation                         bigint NULL,
  started_at                                          timestamptz NOT NULL DEFAULT now(),
  finished_at                                           timestamptz NULL,
  published_at                                            timestamptz NULL,
  publication_generation                                    bigint NULL,
  status                                                      text NOT NULL DEFAULT 'RUNNING' CHECK (status IN
                           ('RUNNING','SUCCEEDED','PARTIAL_FAILED_NOT_PUBLISHED','FAILED','SUPERSEDED_NOT_PUBLISHED','CANCELLED')),
  rows_evaluated                                                integer NULL,
  issues_detected                                                 integer NULL,
  issues_new                                                        integer NULL,
  issues_persistent                                                   integer NULL,
  issues_disappeared                                                    integer NULL,
  error_message                                                           text NULL,
  triggered_by                                                              text NOT NULL CHECK (triggered_by IN
                           ('BATCH_SCHEDULE','DATA_REFRESH_PUBLISH','MANUAL_ADMIN','CORRECTION_VERIFICATION'))
);

CREATE TABLE IF NOT EXISTS governance.rule_evaluation_run_items (
  evaluation_run_id    uuid NOT NULL REFERENCES governance.rule_evaluation_runs(evaluation_run_id),
  rule_code              text NOT NULL,
  rule_version             integer NOT NULL,
  status                     text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  started_at                   timestamptz NOT NULL DEFAULT now(),
  finished_at                    timestamptz NULL,
  rows_evaluated                   bigint NULL,
  detections_count                    bigint NULL,
  error_message                         text NULL,
  PRIMARY KEY (evaluation_run_id, rule_code, rule_version)
);

CREATE TABLE IF NOT EXISTS governance.rule_evaluation_detections (
  evaluation_run_id    uuid NOT NULL REFERENCES governance.rule_evaluation_runs(evaluation_run_id),
  rule_code              text NOT NULL,
  rule_version             integer NOT NULL,
  entity_type                text NOT NULL,
  entity_key                   text NOT NULL,
  occurrence_key                  text NOT NULL,
  fingerprint                       text NOT NULL,
  evidence_payload                    jsonb NOT NULL,
  PRIMARY KEY (evaluation_run_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS governance.rule_evaluation_coverage (
  id                     bigserial PRIMARY KEY,
  evaluation_run_id       uuid NOT NULL REFERENCES governance.rule_evaluation_runs(evaluation_run_id),
  rule_code                 text NOT NULL,
  rule_version                integer NOT NULL,
  entity_type                   text NOT NULL,
  entity_key                      text NOT NULL,
  occurrence_key                    text NULL,
  coverage_key                        jsonb NOT NULL,
  UNIQUE (evaluation_run_id, rule_code, rule_version, coverage_key)
);

CREATE TABLE IF NOT EXISTS governance.evaluation_publication_state (
  environment_key                text PRIMARY KEY,
  latest_published_generation      bigint NOT NULL DEFAULT 0,
  latest_published_run_id            uuid NULL,
  latest_source_snapshot_id            text NULL,
  updated_at                             timestamptz NOT NULL DEFAULT now()
);

INSERT INTO governance.evaluation_publication_state (environment_key) VALUES ('default')
ON CONFLICT (environment_key) DO NOTHING;

CREATE TABLE IF NOT EXISTS pipeline.published_dataset_state (
  environment_key                text PRIMARY KEY,
  published_data_generation        bigint NOT NULL DEFAULT 0,
  source_snapshot_id                 text NULL,
  published_refresh_run_id             uuid NULL,
  published_at                           timestamptz NULL
);

INSERT INTO pipeline.published_dataset_state (environment_key) VALUES ('default')
ON CONFLICT (environment_key) DO NOTHING;

-- =============================================================================
-- 3. Issue store (mutable) + evidence (append-only)
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.issues (
  id                          bigserial PRIMARY KEY,
  fingerprint                 text NOT NULL UNIQUE,
  rule_code                   text NOT NULL,
  first_detected_rule_version  integer NOT NULL,
  last_evaluated_rule_version   integer NOT NULL,
  resolved_rule_version          integer NULL,
  entity_type                  text NOT NULL,
  entity_key                   text NOT NULL,
  occurrence_key                text NOT NULL,
  severity                      text NOT NULL CHECK (severity IN ('LOW','MEDIUM','HIGH','WARNING')),
  status                        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','DISMISSED')),
  first_seen_at                  timestamptz NOT NULL,
  last_seen_at                    timestamptz NOT NULL,
  last_evaluated_at                timestamptz NOT NULL,
  is_currently_detected              boolean NOT NULL DEFAULT true,
  disappeared_at                      timestamptz NULL,
  resolution_type                      text NULL CHECK (resolution_type IN ('VERIFIED','DISMISSED')),
  resolution_evaluation_run_id          uuid NULL,
  resolution_evidence_id                 bigint NULL,
  resolution_triggered_by_correlation_id  uuid NULL,
  dismissed_by_actor_id                    uuid NULL,
  closed_at                                  timestamptz NULL,
  closed_reason                                text NULL,
  version                                       integer NOT NULL DEFAULT 1,
  created_at                                      timestamptz NOT NULL DEFAULT now(),
  updated_at                                        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_code, entity_type, entity_key, occurrence_key),
  CONSTRAINT lifecycle_resolved CHECK (status <> 'RESOLVED' OR (
    resolution_type = 'VERIFIED' AND resolved_rule_version IS NOT NULL
    AND resolution_evaluation_run_id IS NOT NULL AND resolution_evidence_id IS NOT NULL AND closed_at IS NOT NULL)),
  CONSTRAINT lifecycle_dismissed CHECK (status <> 'DISMISSED' OR (
    resolution_type = 'DISMISSED' AND dismissed_by_actor_id IS NOT NULL
    AND closed_reason IS NOT NULL AND closed_at IS NOT NULL)),
  CONSTRAINT lifecycle_open_or_review CHECK (status NOT IN ('OPEN','IN_REVIEW') OR (resolution_type IS NULL AND closed_at IS NULL)),
  CONSTRAINT lifecycle_detected_no_disappeared CHECK (NOT is_currently_detected OR disappeared_at IS NULL),
  CONSTRAINT lifecycle_not_detected_has_disappeared CHECK (is_currently_detected OR disappeared_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS governance.issue_evidence (
  id                       bigserial PRIMARY KEY,
  issue_id                 bigint NOT NULL REFERENCES governance.issues(id),
  evaluation_run_id        uuid NOT NULL REFERENCES governance.rule_evaluation_runs(evaluation_run_id),
  evidence_type             text NOT NULL CHECK (evidence_type IN ('RULE_DETECTION','CORRECTION_VERIFICATION')),
  rule_code                  text NOT NULL,
  rule_version                 integer NOT NULL,
  source_object                  text NOT NULL,
  source_record_key                jsonb NOT NULL,
  source_snapshot_id                 text NULL,
  rule_inputs                          jsonb NOT NULL,
  observed_values                        jsonb NOT NULL,
  effective_values                         jsonb NULL,
  evidence_hash                              text NOT NULL,
  redaction_level                              text NOT NULL DEFAULT 'BUSINESS_SAFE' CHECK (redaction_level IN ('RESTRICTED_STRUCTURED','BUSINESS_SAFE')),
  contains_personal_data                         boolean NOT NULL DEFAULT false,
  retention_class                                  text NOT NULL DEFAULT 'STANDARD',
  schema_version                                     text NOT NULL DEFAULT '1.0.0',
  captured_at                                          timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 4. Review cases y comentarios
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.review_cases (
  id              bigserial PRIMARY KEY,
  status          text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','RESOLVED','DISMISSED')),
  assigned_to     uuid NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz NULL,
  version         integer NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS governance.review_case_issues (
  id                          bigserial PRIMARY KEY,
  review_case_id                bigint NOT NULL REFERENCES governance.review_cases(id),
  issue_id                        bigint NOT NULL REFERENCES governance.issues(id),
  membership_started_at             timestamptz NOT NULL DEFAULT now(),
  added_by_actor_id                    uuid NULL,
  membership_ended_at                    timestamptz NULL,
  membership_end_reason                    text NULL CHECK (membership_end_reason IN ('REMOVED_BY_ACTOR','CASE_CLOSED','CASE_DISMISSED') OR membership_end_reason IS NULL),
  removed_by_actor_id                         uuid NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS review_case_issues_one_active_membership
  ON governance.review_case_issues (issue_id) WHERE membership_ended_at IS NULL;

CREATE TABLE IF NOT EXISTS governance.review_case_comments (
  id                        bigserial PRIMARY KEY,
  review_case_id             bigint NOT NULL REFERENCES governance.review_cases(id),
  actor_user_id                uuid NOT NULL,
  body                            text NOT NULL,
  supersedes_comment_id             bigint NULL REFERENCES governance.review_case_comments(id),
  is_redacted                         boolean NOT NULL DEFAULT false,
  redaction_reason                      text NULL,
  redacted_by_actor_id                    uuid NULL,
  redacted_at                               timestamptz NULL,
  created_at                                  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- 5. Migración de historial legacy: procedencia del backfill
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.legacy_import_runs (
  id                  bigserial PRIMARY KEY,
  import_type          text NOT NULL,
  source_description     text NOT NULL,
  rows_imported             integer NOT NULL,
  executed_by_actor_id        uuid NOT NULL,
  executed_at                    timestamptz NOT NULL DEFAULT now(),
  invalidated_at                    timestamptz NULL,
  invalidated_reason                   text NULL
);

-- =============================================================================
-- 6. Correction versions + correction targets (concurrencia por target)
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.correction_versions (
  id                        bigserial PRIMARY KEY,
  correction_type             text NOT NULL,
  target_type                   text NOT NULL,
  target_key                     jsonb NOT NULL,
  version                         integer NOT NULL,
  payload                           jsonb NOT NULL,
  effective_from                     timestamptz NOT NULL DEFAULT now(),
  effective_to                         timestamptz NULL,
  actor_type                             text NOT NULL CHECK (actor_type IN ('HUMAN','SERVICE','LEGACY_UNVERIFIED')),
  actor_user_id                            uuid NULL,
  service_actor_key                          text NULL,
  legacy_actor_metadata                        jsonb NULL,
  legacy_import_run_id                           bigint NULL REFERENCES governance.legacy_import_runs(id),
  source_effective_at                              timestamptz NULL,
  source_time_precision                              text NULL CHECK (source_time_precision IN ('EXACT','APPROXIMATE','UNKNOWN') OR source_time_precision IS NULL),
  reason                                          text NOT NULL,
  correlation_id                                    uuid NOT NULL,
  superseded_by                                       bigint NULL REFERENCES governance.correction_versions(id),
  reversal_of                                           bigint NULL REFERENCES governance.correction_versions(id),
  created_at                                              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_key, version),
  CONSTRAINT actor_shape CHECK (
    (actor_type = 'HUMAN'  AND actor_user_id IS NOT NULL AND service_actor_key IS NULL) OR
    (actor_type = 'SERVICE' AND actor_user_id IS NULL AND service_actor_key IS NOT NULL) OR
    (actor_type = 'LEGACY_UNVERIFIED' AND actor_user_id IS NULL AND service_actor_key IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS governance.correction_targets (
  target_type                    text NOT NULL,
  target_key                       jsonb NOT NULL,
  current_version                    integer NOT NULL,
  current_correction_version_id        bigint NULL REFERENCES governance.correction_versions(id),
  PRIMARY KEY (target_type, target_key)
);

-- =============================================================================
-- 7. Event log (append-only, solo transacciones confirmadas) + intentos
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.command_events (
  id                  bigserial PRIMARY KEY,
  correlation_id       uuid NOT NULL,
  idempotency_key       text NULL,
  event_type             text NOT NULL REFERENCES governance.event_types(event_type),
  issue_id                bigint NULL REFERENCES governance.issues(id),
  review_case_id            bigint NULL REFERENCES governance.review_cases(id),
  command_type                text NULL,
  actor_type                    text NOT NULL CHECK (actor_type IN ('HUMAN','SERVICE','LEGACY_UNVERIFIED')),
  actor_user_id                    uuid NULL,
  service_actor_key                  text NULL,
  actor_role                            text NULL,
  reason                                  text NULL,
  before_state                              jsonb NULL,
  after_state                                 jsonb NULL,
  evidence_id                                   bigint NULL REFERENCES governance.issue_evidence(id),
  created_at                                      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT actor_shape CHECK (
    (actor_type = 'HUMAN'  AND actor_user_id IS NOT NULL AND service_actor_key IS NULL) OR
    (actor_type = 'SERVICE' AND actor_user_id IS NULL AND service_actor_key IS NOT NULL) OR
    (actor_type = 'LEGACY_UNVERIFIED' AND actor_user_id IS NULL AND service_actor_key IS NULL)
  )
);

CREATE TABLE IF NOT EXISTS governance.command_attempts (
  id                  bigserial PRIMARY KEY,
  correlation_id       uuid NOT NULL,
  command_type          text NOT NULL,
  actor_type              text NOT NULL CHECK (actor_type IN ('HUMAN','SERVICE','LEGACY_UNVERIFIED')),
  actor_user_id             uuid NULL,
  service_actor_key           text NULL,
  result                        text NOT NULL CHECK (result IN ('REJECTED','ERROR')),
  error_code                      text NOT NULL,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT actor_shape CHECK (
    (actor_type = 'HUMAN'  AND actor_user_id IS NOT NULL AND service_actor_key IS NULL) OR
    (actor_type = 'SERVICE' AND actor_user_id IS NULL AND service_actor_key IS NOT NULL) OR
    (actor_type = 'LEGACY_UNVERIFIED' AND actor_user_id IS NULL AND service_actor_key IS NULL)
  )
);

-- =============================================================================
-- 8. Idempotencia (clave compuesta por actor, nunca global)
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.idempotency_keys (
  actor_type            text NOT NULL CHECK (actor_type IN ('HUMAN','SERVICE')),
  actor_key              text NOT NULL,
  command_type             text NOT NULL,
  idempotency_key            text NOT NULL,
  request_payload            jsonb NOT NULL,
  body_hash                    text NOT NULL,
  response_snapshot              jsonb NOT NULL,
  correlation_id                    uuid NOT NULL,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  expires_at                            timestamptz NULL,
  PRIMARY KEY (actor_type, actor_key, command_type, idempotency_key)
);

-- =============================================================================
-- 9. Outbox de verificación (lease + fencing token)
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.verification_requests (
  id                          bigserial PRIMARY KEY,
  issue_id                     bigint NOT NULL REFERENCES governance.issues(id),
  correlation_id                 uuid NOT NULL,
  correction_version_id            bigint NULL REFERENCES governance.correction_versions(id),
  expected_correction_version_id     bigint NULL REFERENCES governance.correction_versions(id),
  rule_code                            text NOT NULL,
  entity_type                            text NOT NULL,
  entity_key                               text NOT NULL,
  occurrence_key                             text NOT NULL,
  processing_status                            text NOT NULL DEFAULT 'PENDING' CHECK (processing_status IN ('PENDING','RUNNING','COMPLETED','CANCELLED','DEAD_LETTERED')),
  verification_outcome                           text NULL CHECK (verification_outcome IN ('PASSED','STILL_DETECTED','OPERATIONAL_ERROR') OR verification_outcome IS NULL),
  superseded_by_request_id                         bigint NULL REFERENCES governance.verification_requests(id),
  superseded_at                                      timestamptz NULL,
  cancellation_reason                                  text NULL CHECK (cancellation_reason IN ('SUPERSEDED','ISSUE_DISMISSED','MANUAL_CANCEL') OR cancellation_reason IS NULL),
  claim_token                                            uuid NULL,
  claim_generation                                         bigint NOT NULL DEFAULT 0,
  attempt_count                                              integer NOT NULL DEFAULT 0,
  max_attempts                                                 integer NOT NULL DEFAULT 5,
  next_attempt_at                                                timestamptz NOT NULL DEFAULT now(),
  locked_at                                                        timestamptz NULL,
  lease_expires_at                                                   timestamptz NULL,
  heartbeat_at                                                         timestamptz NULL,
  locked_by_service_key                                                  text NULL,
  evaluation_run_id                                                        uuid NULL REFERENCES governance.rule_evaluation_runs(evaluation_run_id),
  last_error_code                                                            text NULL,
  created_at                                                                   timestamptz NOT NULL DEFAULT now(),
  started_at                                                                     timestamptz NULL,
  finished_at                                                                      timestamptz NULL,
  UNIQUE (correlation_id, issue_id, rule_code, occurrence_key),
  CONSTRAINT lifecycle_pending_running CHECK (processing_status NOT IN ('PENDING','RUNNING') OR (verification_outcome IS NULL AND finished_at IS NULL)),
  CONSTRAINT lifecycle_completed CHECK (processing_status <> 'COMPLETED' OR (verification_outcome IN ('PASSED','STILL_DETECTED') AND finished_at IS NOT NULL)),
  CONSTRAINT lifecycle_dead_lettered CHECK (processing_status <> 'DEAD_LETTERED' OR (verification_outcome = 'OPERATIONAL_ERROR' AND finished_at IS NOT NULL)),
  CONSTRAINT lifecycle_cancelled CHECK (processing_status <> 'CANCELLED' OR (superseded_at IS NOT NULL OR cancellation_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS verification_requests_one_active
  ON governance.verification_requests (issue_id, rule_code, occurrence_key) WHERE processing_status IN ('PENDING','RUNNING');

-- =============================================================================
-- 10. Capacidades (rol -> capacidad, única fuente de verdad para requireCapability)
-- =============================================================================

CREATE TABLE IF NOT EXISTS governance.role_capabilities (
  role         text NOT NULL,
  capability   text NOT NULL,
  granted_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, capability)
);

INSERT INTO governance.role_capabilities (role, capability) VALUES
  ('gerencia', 'audit:read'), ('administracion', 'audit:read'),
  ('gerencia', 'explorer:read'), ('administracion', 'explorer:read'),
  ('gerencia', 'search:read'), ('administracion', 'search:read'),
  ('gerencia', 'data:refresh:observe'), ('administracion', 'data:refresh:observe'),
  ('administracion', 'audit:review'),
  ('administracion', 'audit:assign'),
  ('administracion', 'audit:comment'),
  ('administracion', 'audit:evidence-restricted'),
  ('administracion', 'correction:redact-comment'),
  ('administracion', 'correction:part-alias'),
  ('administracion', 'correction:technician-identity'),
  ('administracion', 'correction:ticket-link'),
  ('administracion', 'correction:equipment-identification'),
  ('administracion', 'correction:dismiss'),
  ('administracion', 'correction:reverse'),
  ('administracion', 'data:refresh:incremental'),
  ('administracion', 'data:refresh:full')
ON CONFLICT (role, capability) DO NOTHING;

-- =============================================================================
-- 11. Foreign keys circulares (agregadas después de crear todas las tablas)
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_rule_first_detected_fkey') THEN
    ALTER TABLE governance.issues ADD CONSTRAINT issues_rule_first_detected_fkey
      FOREIGN KEY (rule_code, first_detected_rule_version) REFERENCES governance.rule_definitions(rule_code, rule_version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_rule_last_evaluated_fkey') THEN
    ALTER TABLE governance.issues ADD CONSTRAINT issues_rule_last_evaluated_fkey
      FOREIGN KEY (rule_code, last_evaluated_rule_version) REFERENCES governance.rule_definitions(rule_code, rule_version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_rule_resolved_fkey') THEN
    ALTER TABLE governance.issues ADD CONSTRAINT issues_rule_resolved_fkey
      FOREIGN KEY (rule_code, resolved_rule_version) REFERENCES governance.rule_definitions(rule_code, rule_version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_resolution_run_fkey') THEN
    ALTER TABLE governance.issues ADD CONSTRAINT issues_resolution_run_fkey
      FOREIGN KEY (resolution_evaluation_run_id) REFERENCES governance.rule_evaluation_runs(evaluation_run_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'issues_resolution_evidence_fkey') THEN
    ALTER TABLE governance.issues ADD CONSTRAINT issues_resolution_evidence_fkey
      FOREIGN KEY (resolution_evidence_id) REFERENCES governance.issue_evidence(id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'run_items_rule_fkey') THEN
    ALTER TABLE governance.rule_evaluation_run_items ADD CONSTRAINT run_items_rule_fkey
      FOREIGN KEY (rule_code, rule_version) REFERENCES governance.rule_definitions(rule_code, rule_version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'detections_rule_fkey') THEN
    ALTER TABLE governance.rule_evaluation_detections ADD CONSTRAINT detections_rule_fkey
      FOREIGN KEY (rule_code, rule_version) REFERENCES governance.rule_definitions(rule_code, rule_version);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'coverage_rule_fkey') THEN
    ALTER TABLE governance.rule_evaluation_coverage ADD CONSTRAINT coverage_rule_fkey
      FOREIGN KEY (rule_code, rule_version) REFERENCES governance.rule_definitions(rule_code, rule_version);
  END IF;
END
$$;

-- =============================================================================
-- 12. Índices
-- =============================================================================

CREATE INDEX IF NOT EXISTS issues_status_entity_idx ON governance.issues (status, entity_type);
CREATE INDEX IF NOT EXISTS command_events_issue_created_idx ON governance.command_events (issue_id, created_at);
CREATE INDEX IF NOT EXISTS correction_versions_target_idx ON governance.correction_versions (target_type, target_key);
CREATE INDEX IF NOT EXISTS idempotency_keys_actor_created_idx ON governance.idempotency_keys (actor_type, actor_key, created_at);
CREATE INDEX IF NOT EXISTS rule_evaluation_coverage_run_idx ON governance.rule_evaluation_coverage (evaluation_run_id);
CREATE INDEX IF NOT EXISTS review_case_issues_case_started_idx ON governance.review_case_issues (review_case_id, membership_started_at);

-- =============================================================================
-- 13. Vistas curadas (protegen redacción/confidencialidad a nivel de grant)
-- =============================================================================

CREATE OR REPLACE VIEW governance.issue_evidence_business_safe AS
  SELECT id, issue_id, evaluation_run_id, evidence_type, rule_code, rule_version,
         source_object, rule_inputs, observed_values, effective_values, schema_version, captured_at
  FROM governance.issue_evidence WHERE redaction_level = 'BUSINESS_SAFE';

CREATE OR REPLACE VIEW governance.command_events_business_safe AS
  SELECT id, correlation_id, event_type, issue_id, review_case_id, command_type,
         actor_role, reason, evidence_id, created_at
  FROM governance.command_events;

CREATE OR REPLACE VIEW governance.review_case_comments_current AS
  SELECT id, review_case_id, actor_user_id, supersedes_comment_id, created_at,
         CASE WHEN is_redacted THEN NULL ELSE body END AS body,
         is_redacted
  FROM governance.review_case_comments;

CREATE OR REPLACE VIEW governance.verification_requests_current AS
  SELECT id, issue_id, correlation_id, rule_code, entity_type, entity_key, occurrence_key,
         processing_status, verification_outcome, attempt_count, max_attempts,
         created_at, started_at, finished_at, next_attempt_at
  FROM governance.verification_requests
  WHERE superseded_at IS NULL;

-- =============================================================================
-- 14. Roles PostgreSQL de mínimo privilegio
-- =============================================================================
-- governance_owner: NOLOGIN, dueño de las funciones SECURITY DEFINER
-- (sql/090). Los roles LOGIN de aplicación reciben contraseña placeholder
-- (mismo patrón que nexus_app en sql/000) - NUNCA una contraseña real
-- commiteada. Para desarrollo/test local, scripts/set-local-governance-role-passwords.mjs
-- las rota localmente después de aplicar este archivo (ver ese script).

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'governance_owner') THEN
    CREATE ROLE governance_owner WITH NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_app_read') THEN
    CREATE ROLE nexus_app_read WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_app_corrections') THEN
    CREATE ROLE nexus_app_corrections WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_audit_restricted_read') THEN
    CREATE ROLE nexus_audit_restricted_read WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_rule_evaluator') THEN
    CREATE ROLE nexus_rule_evaluator WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_command_attempt_logger') THEN
    CREATE ROLE nexus_command_attempt_logger WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
END
$$;

-- =============================================================================
-- 15. Grants
-- =============================================================================

GRANT USAGE ON SCHEMA governance TO nexus_app_read, nexus_app_corrections, nexus_audit_restricted_read, nexus_rule_evaluator, nexus_command_attempt_logger;
GRANT USAGE ON SCHEMA pipeline TO nexus_rule_evaluator;

-- governance_owner es la identidad EFECTIVA dentro de cada función
-- SECURITY DEFINER (B14) - necesita sus propios privilegios sobre lo que
-- esas funciones tocan, independientemente de qué rol las haya invocado
-- (el owner de un objeto no hereda privilegios de PUBLIC/otros roles).
GRANT USAGE, CREATE ON SCHEMA governance TO governance_owner;
GRANT USAGE ON SCHEMA pipeline TO governance_owner;
GRANT ALL ON ALL TABLES IN SCHEMA governance TO governance_owner;
GRANT ALL ON ALL SEQUENCES IN SCHEMA governance TO governance_owner;
GRANT SELECT, UPDATE ON pipeline.published_dataset_state TO governance_owner;
GRANT SELECT, INSERT, UPDATE, DELETE ON manual_review.part_aliases, manual_review.ticket_link_overrides, manual_review.fieldbeat_engineer_identity_map TO governance_owner;
GRANT USAGE, SELECT ON manual_review.part_aliases_id_seq, manual_review.fieldbeat_engineer_identity_map_id_seq, manual_review.ticket_link_overrides_id_seq TO governance_owner;
-- El evaluador de reglas (dentro de las funciones SECURITY DEFINER, efectivas
-- como governance_owner) lee las capas medallion/quality para detectar issues.
GRANT USAGE ON SCHEMA processed, marts, gold, quality, manual_review TO governance_owner;
GRANT SELECT ON ALL TABLES IN SCHEMA processed, marts, gold, quality TO governance_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA governance GRANT ALL ON TABLES TO governance_owner;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA governance GRANT ALL ON SEQUENCES TO governance_owner;

-- Lectura interactiva: catálogos + issues/review_cases (sin PII propia) +
-- vistas curadas únicamente para evidencia/eventos/comentarios/verificación
-- - NUNCA SELECT directo sobre las tablas base correspondientes.
GRANT SELECT ON governance.event_types, governance.rule_definitions, governance.rule_registry TO nexus_app_read, nexus_app_corrections, nexus_audit_restricted_read, nexus_rule_evaluator;
-- review_case_issues es metadata estructural de membresía (review_case_id/
-- issue_id/timestamps/razón) - sin contenido redactado ni sensible, a
-- diferencia de review_case_comments (por eso ESA sigue exigiendo pasar por
-- la vista curada review_case_comments_current, nunca SELECT directo).
GRANT SELECT ON governance.issues, governance.review_cases, governance.review_case_issues, governance.role_capabilities TO nexus_app_read, nexus_app_corrections, nexus_audit_restricted_read;
GRANT SELECT ON governance.issue_evidence_business_safe, governance.command_events_business_safe, governance.review_case_comments_current, governance.verification_requests_current TO nexus_app_read, nexus_app_corrections, nexus_audit_restricted_read;
-- Familia 8 (Gate B) - pestañas Correcciones/Reglas/Fuentes y pipeline:
-- correction_versions/correction_targets no llevan contenido antes/después
-- crudo de operación (a diferencia de command_events) ni body redactable (a
-- diferencia de review_case_comments) - B65 nunca las marca como
-- restringidas, mismo criterio que issues/review_cases (grant directo).
-- rule_evaluation_runs es metadata operacional de corridas (conteos,
-- estado, snapshot), no evidencia de negocio - mismo criterio.
GRANT SELECT ON governance.correction_versions, governance.correction_targets, governance.rule_evaluation_runs, governance.rule_evaluation_run_items TO nexus_app_read, nexus_app_corrections, nexus_audit_restricted_read;

-- Evaluador de reglas: lectura amplia sobre las capas medallion + manual_review
-- (para evaluar contra el overlay efectivo) + escritura acotada a sus propias
-- tablas de staging/publicación (nunca manual_review/correction_* directo).
GRANT SELECT ON ALL TABLES IN SCHEMA processed, marts, gold, quality TO nexus_rule_evaluator;
GRANT SELECT ON ALL TABLES IN SCHEMA manual_review TO nexus_rule_evaluator;
GRANT SELECT, INSERT, UPDATE ON governance.rule_evaluation_runs, governance.rule_evaluation_run_items,
  governance.rule_evaluation_detections, governance.rule_evaluation_coverage, governance.evaluation_publication_state,
  governance.issues, governance.issue_evidence, governance.command_events, governance.verification_requests
  TO nexus_rule_evaluator;
GRANT SELECT, UPDATE ON pipeline.published_dataset_state TO nexus_rule_evaluator;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA governance TO nexus_rule_evaluator;

-- Logger de intentos fallidos: solo su propia tabla (en la práctica, solo
-- vía función en sql/090 - este GRANT de tabla es la base sobre la que esa
-- función SECURITY DEFINER opera, no un acceso directo desde la app).
GRANT SELECT, INSERT ON governance.command_attempts TO nexus_command_attempt_logger;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA governance TO nexus_command_attempt_logger;

-- nexus_app_read/nexus_app_corrections/nexus_audit_restricted_read NO
-- reciben INSERT/UPDATE/DELETE directo sobre manual_review.*/governance.* -
-- toda escritura pasa por las funciones SECURITY DEFINER de sql/090
-- (EXECUTE otorgado ahí, no acá).
