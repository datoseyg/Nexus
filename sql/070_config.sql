-- Schema config: fuente administrativa contractual (ETAPA 6.5) -detalles de
-- contrato/SPA/horarios de atención por equipo, cargados de forma versionada
-- y trazable desde data/manual/contracts/*.csv, nunca como parche directo a
-- un mart. Migración AUTOCONTENIDA: no modifica sql/000_roles_and_schemas.sql
-- ni sql/050_manual_review.sql (ambos ya tienen cambios pendientes de otra
-- etapa) -todo lo nuevo (incluida manual_review.contract_data_issues) vive
-- en este único archivo. Se aplica a mano, después de sql/060, vía el SQL
-- editor de Supabase o psql contra la conexión DIRECTA -igual que el resto
-- de sql/*.
--
-- El schema manual_review ya existe (creado por sql/000, que corre antes) -
-- acá solo se agrega una tabla nueva dentro de ese schema, calificada.
--
-- Orden de este archivo (referencial, cada objeto depende solo de lo que ya
-- existe más arriba): schema -> contract_import_runs -> contract_source_rows
-- -> contract_equipment_versions -> contract_equipment_observations ->
-- contract_service_schedules -> contract_service_windows ->
-- contract_equipment_matches -> contract_equipment_match_overrides ->
-- manual_review.contract_data_issues -> índices -> vistas -> revokes -> grants.

CREATE SCHEMA IF NOT EXISTS config;

-- ============================================================
-- 1. config.contract_import_runs
-- ============================================================
-- Una fila por corrida de importación (dry-run nunca escribe acá, solo
-- --apply). Idempotencia por SHA-256 de archivo completo vía índice único
-- PARCIAL (no UNIQUE de columna): un intento FAILED nunca bloquea
-- reintentar el mismo archivo, solo un SUCCESS previo cuenta como
-- "already imported". El CHECK de abajo impide que una corrida quede
-- SUCCESS con filas erroradas -atomicidad de snapshot: o se procesa el
-- archivo completo (aunque algunas filas queden NEEDS_REVIEW), o se
-- revierte todo.
CREATE TABLE IF NOT EXISTS config.contract_import_runs (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename text NOT NULL,
  source_sha256 text NOT NULL,
  source_sheet text,
  source_received_at timestamptz,
  effective_date date NOT NULL,
  rows_read integer NOT NULL,
  rows_accepted integer NOT NULL,
  rows_ignored integer NOT NULL,
  rows_errored integer NOT NULL,
  import_status text NOT NULL CHECK (import_status IN ('SUCCESS', 'FAILED')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb,
  CHECK (rows_read = rows_accepted + rows_ignored + rows_errored),
  CHECK (import_status <> 'SUCCESS' OR rows_errored = 0)
);

-- ============================================================
-- 2. config.contract_source_rows
-- ============================================================
-- Archivo permanente de TODAS las filas lógicas leídas (aceptadas E
-- ignoradas) de cada importación -nunca se actualizan ni eliminan filas de
-- importaciones anteriores (disciplina de código, el rol que escribe acá
-- es `postgres`, no hay enforcement de rol posible).
CREATE TABLE IF NOT EXISTS config.contract_source_rows (
  source_row_id bigserial PRIMARY KEY,
  import_id uuid NOT NULL REFERENCES config.contract_import_runs(import_id),
  source_row_number integer NOT NULL,
  source_row_hash text NOT NULL,
  cliente_raw text,
  abreviacion_raw text,
  equipo_raw text,
  serie_raw text,
  anio_instalacion_raw text,
  estado_contrato_raw text,
  spa_elekta_raw text,
  lun_vie_raw text,
  sab_dom_raw text,
  soporte_elekta_raw text,
  horarios_atencion_raw text,
  hw_refresh_raw text,
  updates_raw text,
  upgrades_raw text,
  situacion_repuestos_raw text,
  q_mant_prev_anio_raw text,
  notas_raw text,
  raw_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (import_id, source_row_number)
);

-- ============================================================
-- 3. config.contract_equipment_versions
-- ============================================================
-- Vigencia temporal como intervalo semiabierto [valid_from, valid_to).
-- contract_fingerprint (no source_row_hash) es lo que decide NEW/UNCHANGED/
-- SUPERSEDE -un cambio cosmético en el CSV (espacios, firma distinta en
-- Notas) nunca dispara una versión nueva.
CREATE TABLE IF NOT EXISTS config.contract_equipment_versions (
  contract_version_id bigserial PRIMARY KEY,
  equipment_key text NOT NULL,
  client_name_canonical text NOT NULL,
  client_name_raw text NOT NULL,
  site_abbreviation text,
  equipment_model text NOT NULL,
  serial_number text,
  installation_month date,
  installation_date_precision text NOT NULL CHECK (installation_date_precision IN ('MONTH', 'YEAR', 'UNKNOWN')),
  contract_status_code text NOT NULL CHECK (contract_status_code IN (
    'ACTIVE_AUTO_RENEW', 'ACTIVE_FIXED_TERM', 'WARRANTY_ELEKTA', 'DIRECT_WITH_ELEKTA',
    'NO_CONTRACT', 'ON_DEMAND', 'DEINSTALLED', 'UNKNOWN'
  )),
  contract_status_raw text,
  spa_tier_code text NOT NULL CHECK (spa_tier_code IN (
    'GOLD', 'WARRANTY_FULL', 'SILVER', 'WARRANTY_GOLD', 'NO_SPA',
    'SILVER_WITH_SOURCES', 'SILVER_NO_SOURCE', 'UNKNOWN'
  )),
  spa_raw text,
  weekday_service boolean,
  weekend_service boolean,
  support_mode_code text NOT NULL CHECK (support_mode_code IN ('ONSITE_AND_REMOTE', 'REMOTE', 'NOT_APPLICABLE', 'UNKNOWN')),
  support_mode_raw text,
  attention_schedule_raw text,
  parts_coverage_code text NOT NULL CHECK (parts_coverage_code IN (
    'FULL_COVERAGE', 'PARTIAL_EXCLUDES_PANELS_MAGNETRON_THYRATRON', 'NOT_INCLUDED', 'PARTIAL_UNDER_THRESHOLD', 'UNKNOWN'
  )),
  parts_coverage_raw text,
  hw_refresh_code text NOT NULL CHECK (hw_refresh_code IN ('YES', 'NO', 'SW_ONLY', 'CONDITIONAL_SW', 'UNKNOWN')),
  updates_code text NOT NULL CHECK (updates_code IN ('YES', 'NO', 'SW_ONLY', 'CONDITIONAL_SW', 'UNKNOWN')),
  upgrades_code text NOT NULL CHECK (upgrades_code IN ('YES', 'NO', 'SW_ONLY', 'CONDITIONAL_SW', 'UNKNOWN')),
  preventive_maintenance_min integer,
  preventive_maintenance_max integer,
  preventive_maintenance_rule text,
  warranty_end_date date,
  warranty_end_date_source text NOT NULL DEFAULT 'NONE' CHECK (warranty_end_date_source IN ('NOTES_PATTERN_MATCH', 'NONE')),
  valid_from date NOT NULL,
  valid_to date,
  is_current boolean NOT NULL DEFAULT true,
  requires_review boolean NOT NULL DEFAULT false,
  normalization_status text NOT NULL DEFAULT 'OK' CHECK (normalization_status IN ('OK', 'NEEDS_REVIEW')),
  source_import_id uuid NOT NULL REFERENCES config.contract_import_runs(import_id),
  source_row_number integer NOT NULL,
  source_row_hash text NOT NULL,
  contract_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (is_current = (valid_to IS NULL)),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  UNIQUE (equipment_key, valid_from)
);

-- ============================================================
-- 4. config.contract_equipment_observations
-- ============================================================
-- Vincula CADA fila aceptada de CADA importación con la versión que la
-- resolvió, exista o no una versión nueva (UNCHANGED apunta a la versión ya
-- existente). Esto es lo que permite demostrar qué versión resolvió cada
-- fila de cada archivo sin generar versiones contractuales cosméticas.
CREATE TABLE IF NOT EXISTS config.contract_equipment_observations (
  observation_id bigserial PRIMARY KEY,
  import_id uuid NOT NULL REFERENCES config.contract_import_runs(import_id),
  source_row_id bigint NOT NULL REFERENCES config.contract_source_rows(source_row_id),
  equipment_key text NOT NULL,
  contract_version_id bigint NOT NULL REFERENCES config.contract_equipment_versions(contract_version_id),
  source_row_hash text NOT NULL,
  contract_fingerprint text NOT NULL,
  effective_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. config.contract_service_schedules
-- ============================================================
-- Perfil horario -exactamente 1 fila por contract_version_id, creada SOLO
-- cuando esa versión es nueva (una versión UNCHANGED reutiliza el schedule
-- ya existente).
CREATE TABLE IF NOT EXISTS config.contract_service_schedules (
  schedule_id bigserial PRIMARY KEY,
  contract_version_id bigint NOT NULL UNIQUE REFERENCES config.contract_equipment_versions(contract_version_id),
  coverage_type text NOT NULL CHECK (coverage_type IN (
    'FULL_24X7', 'CRITICAL_ONLY_24X7', 'FIXED_WINDOW', 'BUSINESS_HOURS_UNDEFINED',
    'ON_DEMAND', 'NOT_COVERED', 'NOT_APPLICABLE', 'UNKNOWN'
  )),
  coverage_condition text,
  parse_status text NOT NULL CHECK (parse_status IN ('OK', 'REVIEW_REQUIRED')),
  timezone text NOT NULL DEFAULT 'America/Santiago',
  source_schedule_raw text
);

-- ============================================================
-- 6. config.contract_service_windows
-- ============================================================
-- Cero o más ventanas concretas por schedule -para BUSINESS_HOURS_UNDEFINED/
-- UNKNOWN/NOT_APPLICABLE o vacío se persiste el schedule igual, con CERO
-- ventanas (nunca se inventa un horario).
CREATE TABLE IF NOT EXISTS config.contract_service_windows (
  service_window_id bigserial PRIMARY KEY,
  schedule_id bigint NOT NULL REFERENCES config.contract_service_schedules(schedule_id),
  day_of_week text NOT NULL CHECK (day_of_week IN ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN')),
  start_time time,
  end_time time,
  all_day boolean NOT NULL DEFAULT false,
  includes_holidays boolean NOT NULL DEFAULT false,
  CHECK (
    (all_day AND start_time IS NULL AND end_time IS NULL) OR
    (NOT all_day AND start_time IS NOT NULL AND end_time IS NOT NULL)
  )
);

-- ============================================================
-- 7. config.contract_equipment_matches
-- ============================================================
-- Resultados de matching persistidos POR OBSERVACIÓN (no por versión):
-- cada importación exitosa reintenta el matching y genera su propio
-- resultado, incluso si la versión contractual no cambió, porque el
-- maestro FieldBeat pudo cambiar entre importaciones. Append-only -nunca
-- se sobrescribe un resultado histórico; la vista segura elige el más
-- reciente.
CREATE TABLE IF NOT EXISTS config.contract_equipment_matches (
  match_id bigserial PRIMARY KEY,
  observation_id bigint NOT NULL UNIQUE REFERENCES config.contract_equipment_observations(observation_id),
  match_status text NOT NULL CHECK (match_status IN ('MATCHED', 'UNMATCHED', 'AMBIGUOUS')),
  match_method text NOT NULL CHECK (match_method IN ('OVERRIDE', 'SERIAL_SUFFIX', 'CLIENT_SITE_MODEL', 'NONE')),
  fieldbeat_equipment_key text,
  fieldbeat_equipment_uuid text,
  fieldbeat_internal_id text,
  candidate_count integer NOT NULL DEFAULT 0,
  match_details jsonb,
  matched_at timestamptz NOT NULL DEFAULT now(),
  CHECK (match_status <> 'MATCHED' OR fieldbeat_equipment_key IS NOT NULL),
  CHECK (match_status <> 'UNMATCHED' OR candidate_count = 0),
  CHECK (match_status <> 'AMBIGUOUS' OR (candidate_count > 1 AND fieldbeat_equipment_key IS NULL))
);

-- ============================================================
-- 8. config.contract_equipment_match_overrides
-- ============================================================
-- Nunca se borra físicamente -active=false en su lugar. Nunca se crea
-- automáticamente (siempre una acción manual/administrativa). Sin FK hacia
-- processed.fieldbeat_equipments (sin PK/UNIQUE explotable, se
-- trunca/recarga en un ciclo independiente) ni hacia equipment_key de
-- versions (su UNIQUE es parcial, Postgres no permite un FK ahí) -
-- validación de referencia a nivel de aplicación únicamente.
CREATE TABLE IF NOT EXISTS config.contract_equipment_match_overrides (
  override_id bigserial PRIMARY KEY,
  fieldbeat_equipment_id text NOT NULL,
  equipment_key text NOT NULL,
  reason text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 9. manual_review.contract_data_issues
-- ============================================================
-- El schema manual_review ya existe (sql/000, corre antes) -esta tabla se
-- crea acá, calificada, para no tener que modificar sql/050_manual_review.sql
-- (que ya tiene cambios pendientes de otra etapa). Mismo shape que
-- audit.data_quality_events, con `status` (OPEN/IN_REVIEW/RESOLVED/
-- DISMISSED) en vez de `resolved boolean`. Nunca expuesta vía rutas
-- públicas ni SELECT a nexus_app (ver REVOKE más abajo).
CREATE TABLE IF NOT EXISTS manual_review.contract_data_issues (
  id bigserial PRIMARY KEY,
  source_import_id uuid REFERENCES config.contract_import_runs(import_id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  issue_type text NOT NULL CHECK (issue_type IN (
    'MISSING_SERIAL_NUMBER', 'MISSING_CONTRACT_STATUS', 'MISSING_ATTENTION_SCHEDULE',
    'AMBIGUOUS_BUSINESS_HOURS', 'INVALID_INSTALLATION_DATE', 'NON_SCALAR_PREVENTIVE_QUOTA',
    'CLIENT_NAME_VARIANT', 'WARRANTY_END_DATE_PASSED', 'DEINSTALLED_WITH_COVERAGE_DATA',
    'UNMATCHED_FIELDBEAT_EQUIPMENT', 'AMBIGUOUS_FIELDBEAT_MATCH',
    'UNMAPPED_ENUM_VALUE'
  )),
  severity text NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO', 'WARNING', 'ERROR')),
  details jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED')),
  resolved_at timestamptz
);

-- ============================================================
-- 10. Índices
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS contract_import_runs_success_sha_uidx
  ON config.contract_import_runs (source_sha256) WHERE import_status = 'SUCCESS';

CREATE UNIQUE INDEX IF NOT EXISTS contract_equipment_versions_current_key_uidx
  ON config.contract_equipment_versions (equipment_key) WHERE is_current = true;

CREATE UNIQUE INDEX IF NOT EXISTS contract_equipment_match_overrides_active_fb_uidx
  ON config.contract_equipment_match_overrides (fieldbeat_equipment_id) WHERE active = true;

-- ============================================================
-- 11. Vistas seguras (únicos objetos de config visibles para nexus_app)
-- ============================================================
-- Excluye explícitamente: *_raw, client_name_raw, notas, nombres de
-- persona, hashes (source_row_hash Y contract_fingerprint), raw_payload,
-- metadatos de import, warranty_end_date_source, y match_details/
-- fieldbeat_equipment_uuid/candidate_count de la tabla de matches. El match
-- expuesto es el MÁS RECIENTE por equipment_key (nunca uno viejo
-- silenciosamente vigente).
CREATE OR REPLACE VIEW config.contract_equipment_analysis AS
SELECT
  v.contract_version_id,
  v.equipment_key,
  v.client_name_canonical,
  v.site_abbreviation,
  v.equipment_model,
  v.serial_number,
  v.installation_month,
  v.installation_date_precision,
  v.contract_status_code,
  v.spa_tier_code,
  v.weekday_service,
  v.weekend_service,
  v.support_mode_code,
  v.parts_coverage_code,
  v.hw_refresh_code,
  v.updates_code,
  v.upgrades_code,
  v.preventive_maintenance_min,
  v.preventive_maintenance_max,
  v.preventive_maintenance_rule,
  v.warranty_end_date,
  v.valid_from,
  v.valid_to,
  v.is_current,
  v.requires_review,
  v.normalization_status,
  v.updated_at,
  latest_match.match_status,
  latest_match.match_method,
  latest_match.fieldbeat_equipment_key,
  latest_match.fieldbeat_internal_id
FROM config.contract_equipment_versions v
LEFT JOIN LATERAL (
  SELECT m.match_status, m.match_method, m.fieldbeat_equipment_key, m.fieldbeat_internal_id
  FROM config.contract_equipment_matches m
  JOIN config.contract_equipment_observations o ON o.observation_id = m.observation_id
  WHERE o.equipment_key = v.equipment_key
  ORDER BY o.effective_date DESC, m.matched_at DESC
  LIMIT 1
) latest_match ON true;

CREATE OR REPLACE VIEW config.contract_service_window_analysis AS
SELECT
  w.service_window_id,
  s.contract_version_id,
  w.day_of_week,
  w.start_time,
  w.end_time,
  w.all_day,
  w.includes_holidays,
  s.coverage_type,
  s.coverage_condition,
  s.parse_status,
  s.timezone
FROM config.contract_service_windows w
JOIN config.contract_service_schedules s ON s.schedule_id = w.schedule_id;

-- ============================================================
-- 12. Revokes -defensa en profundidad más allá de "no otorgar a nexus_app"
-- ============================================================
REVOKE ALL ON SCHEMA config FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA config FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA config FROM PUBLIC;
REVOKE ALL ON manual_review.contract_data_issues FROM PUBLIC;
REVOKE ALL ON SEQUENCE manual_review.contract_data_issues_id_seq FROM PUBLIC;

-- El bloque `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ...
-- manual_review ... GRANT SELECT, INSERT, UPDATE, DELETE ... TO nexus_app`
-- de sql/000_roles_and_schemas.sql es RETROACTIVO a cualquier tabla nueva
-- de manual_review creada por postgres, sin importar en qué archivo físico
-- vive el CREATE TABLE -por eso este REVOKE puntual es obligatorio, no
-- opcional, para esta tabla específica.
REVOKE ALL ON manual_review.contract_data_issues FROM nexus_app;
REVOKE ALL ON SEQUENCE manual_review.contract_data_issues_id_seq FROM nexus_app;

-- ============================================================
-- 13. Grants -únicamente USAGE de schema + SELECT sobre las vistas seguras
-- ============================================================
GRANT USAGE ON SCHEMA config TO nexus_app;
GRANT SELECT ON config.contract_equipment_analysis TO nexus_app;
GRANT SELECT ON config.contract_service_window_analysis TO nexus_app;
