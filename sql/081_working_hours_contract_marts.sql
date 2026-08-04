-- ETAPA 6.6B0 -- Capa B (segmentos de cobertura) + Capa C (mart funcional
-- por tarea) + tabla puente multi-equipo. Migración autocontenida, aplicada
-- después de sql/070_config.sql y sql/080_holiday_calendar.sql (referencia
-- config.contract_equipment_versions/contract_service_schedules y
-- audit.pipeline_runs).
--
-- Unidad temporal canónica: SEGUNDOS enteros, nunca minutos con redondeo
-- por segmento -la suma de segment_seconds de una tarea es EXACTAMENTE su
-- duración en segundos. Los minutos se derivan solo en la vista de
-- transición (sql/082), nunca acá. Todo timestamptz se normaliza
-- explícitamente a whole-seconds antes de persistir (CHECK date_trunc
-- abajo) -evita ambigüedad de sub-segundo en vez de asumir milisegundos
-- fantasma.

-- ============================================================
-- 1. Capa B -- marts.fieldbeat_contract_coverage_segments
-- ============================================================
-- Grano: tarea x equipo FieldBeat x fuente-de-horario x segmento temporal
-- homogéneo. Cada fila tiene EXACTAMENTE un segment_coverage_state -nunca
-- mezcla minutos cubiertos y fuera de cobertura en la misma fila (para eso
-- se particiona en cada límite relevante: inicio/fin de tarea, medianoche
-- local, apertura/cierre de ventana, límite de vigencia contractual,
-- transición de feriado, transición DST).
CREATE TABLE IF NOT EXISTS marts.fieldbeat_contract_coverage_segments (
  segment_id bigserial PRIMARY KEY,

  fieldbeat_task_id bigint NOT NULL,   -- sin FK: processed.* no tiene PK/UNIQUE explotable (mismo motivo que config.contract_equipment_match_overrides)
  fieldbeat_equipment_key text,        -- NULL si y solo si schedule_source='LEGACY_GLOBAL'
  fieldbeat_equipment_internal_id text,

  schedule_source text NOT NULL CHECK (schedule_source IN ('CONTRACT', 'LEGACY_GLOBAL')),
  contract_equipment_key text,
  contract_version_id bigint REFERENCES config.contract_equipment_versions(contract_version_id),
  schedule_id bigint REFERENCES config.contract_service_schedules(schedule_id),
  match_status text CHECK (match_status IN ('MATCHED', 'UNMATCHED', 'AMBIGUOUS')),
  coverage_type text CHECK (coverage_type IN (
    'FULL_24X7', 'CRITICAL_ONLY_24X7', 'FIXED_WINDOW', 'BUSINESS_HOURS_UNDEFINED',
    'ON_DEMAND', 'NOT_COVERED', 'NOT_APPLICABLE', 'UNKNOWN'
  )),
  parse_status text CHECK (parse_status IN ('OK', 'REVIEW_REQUIRED')),

  segment_start_utc timestamptz NOT NULL,
  segment_end_utc timestamptz NOT NULL,
  segment_local_date date NOT NULL,
  day_of_week text NOT NULL CHECK (day_of_week IN ('MON','TUE','WED','THU','FRI','SAT','SUN')),
  boundary_reasons text[] NOT NULL,

  -- is_holiday es NULL bajo COVERAGE_UNKNOWN (nunca false por default) -
  -- distingue explícitamente "no sabemos" de "sabemos que no es feriado".
  is_holiday boolean,
  holiday_coverage_status text NOT NULL CHECK (holiday_coverage_status IN
    ('CONFIRMED_NOT_HOLIDAY', 'CONFIRMED_HOLIDAY', 'COVERAGE_UNKNOWN')),

  segment_seconds integer NOT NULL CHECK (segment_seconds >= 0),
  segment_calculation_status text NOT NULL CHECK (segment_calculation_status IN ('CALCULATED', 'NOT_CALCULABLE')),
  segment_coverage_state text NOT NULL CHECK (segment_coverage_state IN ('COVERED', 'OUTSIDE_COVERAGE', 'NOT_CALCULABLE')),
  segment_reason_code text NOT NULL CHECK (segment_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'WITHIN_LEGACY_SCHEDULE', 'NO_CONTRACT_AT_TASK_DATE',
    'EQUIPMENT_UNMATCHED', 'EQUIPMENT_AMBIGUOUS', 'NO_CONTRACT_STATUS', 'ON_DEMAND_UNDEFINED',
    'CONTRACT_STATUS_DEINSTALLED', 'SCHEDULE_REVIEW_REQUIRED', 'CRITICALITY_UNKNOWN',
    'HOLIDAY_COVERAGE_UNKNOWN'
  )),
  outside_coverage_bucket text CHECK (outside_coverage_bucket IN ('HOLIDAY', 'WEEKEND', 'AFTER_HOURS_WEEKDAY')),
  covered_seconds integer,
  outside_coverage_seconds integer,

  builder_run_id uuid NOT NULL REFERENCES audit.pipeline_runs(run_id),
  created_at timestamptz NOT NULL DEFAULT now(),

  -- Normalización explícita a whole-seconds (punto 1 de la corrección
  -- final): nunca se asume que un timestamptz con sub-segundo "ya viene
  -- bien" -se rechaza en el DDL, y segment_seconds se verifica EXACTO
  -- contra la resta real de los timestamps (no una constante aparte que
  -- pudiera divergir).
  CHECK (date_trunc('second', segment_start_utc) = segment_start_utc),
  CHECK (date_trunc('second', segment_end_utc) = segment_end_utc),
  CHECK (segment_seconds = EXTRACT(EPOCH FROM (segment_end_utc - segment_start_utc))::integer),

  CHECK ((segment_calculation_status = 'CALCULATED') = (segment_coverage_state <> 'NOT_CALCULABLE')),
  CHECK ((segment_calculation_status = 'NOT_CALCULABLE') = (segment_reason_code NOT IN ('WITHIN_MATCHED_CONTRACT','WITHIN_LEGACY_SCHEDULE'))),

  -- Matriz de segment_reason_code por schedule_source: LEGACY_GLOBAL no
  -- tiene equipos/contratos/matching -solo horario fijo + calendario.
  CHECK (schedule_source = 'LEGACY_GLOBAL' OR segment_reason_code <> 'WITHIN_LEGACY_SCHEDULE'),
  CHECK (schedule_source = 'CONTRACT' OR segment_reason_code IN ('WITHIN_LEGACY_SCHEDULE', 'HOLIDAY_COVERAGE_UNKNOWN')),
  CHECK (schedule_source = 'CONTRACT' OR fieldbeat_equipment_key IS NULL),
  CHECK (schedule_source = 'LEGACY_GLOBAL' OR fieldbeat_equipment_key IS NOT NULL),

  CHECK (
    (segment_coverage_state = 'COVERED' AND covered_seconds = segment_seconds AND outside_coverage_seconds = 0) OR
    (segment_coverage_state = 'OUTSIDE_COVERAGE' AND covered_seconds = 0 AND outside_coverage_seconds = segment_seconds) OR
    (segment_coverage_state = 'NOT_CALCULABLE' AND covered_seconds IS NULL AND outside_coverage_seconds IS NULL)
  ),
  CHECK ((outside_coverage_bucket IS NOT NULL) = (segment_coverage_state = 'OUTSIDE_COVERAGE')),

  -- is_holiday NULL <=> COVERAGE_UNKNOWN; y coherente con el estado
  -- confirmado cuando SÍ hay cobertura (punto 6 de la corrección final).
  CHECK ((holiday_coverage_status = 'COVERAGE_UNKNOWN') = (is_holiday IS NULL)),
  CHECK (holiday_coverage_status <> 'CONFIRMED_HOLIDAY' OR is_holiday = true),
  CHECK (holiday_coverage_status <> 'CONFIRMED_NOT_HOLIDAY' OR is_holiday = false),

  -- Un segmento NOT_CALCULABLE por cobertura de feriado desconocida nunca
  -- debe traer holiday_coverage_status distinto de COVERAGE_UNKNOWN.
  CHECK (segment_coverage_state <> 'NOT_CALCULABLE' OR holiday_coverage_status <> 'COVERAGE_UNKNOWN' OR segment_reason_code = 'HOLIDAY_COVERAGE_UNKNOWN'),

  -- Matriz estricta de outside_coverage_bucket (punto 6 de la corrección
  -- final): HOLIDAY solo con CONFIRMED_HOLIDAY; WEEKEND solo con
  -- CONFIRMED_NOT_HOLIDAY + SAT/SUN; AFTER_HOURS_WEEKDAY solo con
  -- CONFIRMED_NOT_HOLIDAY + MON-FRI.
  CHECK (outside_coverage_bucket <> 'HOLIDAY' OR holiday_coverage_status = 'CONFIRMED_HOLIDAY'),
  CHECK (outside_coverage_bucket <> 'WEEKEND' OR (holiday_coverage_status = 'CONFIRMED_NOT_HOLIDAY' AND day_of_week IN ('SAT','SUN'))),
  CHECK (outside_coverage_bucket <> 'AFTER_HOURS_WEEKDAY' OR (holiday_coverage_status = 'CONFIRMED_NOT_HOLIDAY' AND day_of_week NOT IN ('SAT','SUN')))
);

-- Unicidad real incluso con fieldbeat_equipment_key NULL: un índice único
-- funcional con COALESCE evita el problema de "NULL nunca es igual a NULL"
-- de un UNIQUE de columna simple -funciona en cualquier versión de
-- Postgres, sin depender de `UNIQUE NULLS NOT DISTINCT` (sintaxis de PG 15+,
-- no confirmada disponible en el proyecto).
CREATE UNIQUE INDEX IF NOT EXISTS fbchs_dedup_uidx ON marts.fieldbeat_contract_coverage_segments
  (fieldbeat_task_id, schedule_source, COALESCE(fieldbeat_equipment_key, '__LEGACY_GLOBAL__'), segment_start_utc, builder_run_id);

CREATE INDEX IF NOT EXISTS fbchs_task_idx ON marts.fieldbeat_contract_coverage_segments (fieldbeat_task_id);
CREATE INDEX IF NOT EXISTS fbchs_equipment_idx ON marts.fieldbeat_contract_coverage_segments (fieldbeat_equipment_key);
CREATE INDEX IF NOT EXISTS fbchs_reason_idx ON marts.fieldbeat_contract_coverage_segments (segment_reason_code);
CREATE INDEX IF NOT EXISTS fbchs_source_idx ON marts.fieldbeat_contract_coverage_segments (schedule_source);
CREATE INDEX IF NOT EXISTS fbchs_run_idx ON marts.fieldbeat_contract_coverage_segments (builder_run_id);

ALTER TABLE marts.fieldbeat_contract_coverage_segments
  DROP CONSTRAINT IF EXISTS fieldbeat_contract_coverage_segments_check;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'marts.fieldbeat_contract_coverage_segments'::regclass
      AND conname = 'fieldbeat_contract_coverage_segments_nonnegative_interval'
  ) THEN
    ALTER TABLE marts.fieldbeat_contract_coverage_segments
      ADD CONSTRAINT fieldbeat_contract_coverage_segments_nonnegative_interval
      CHECK (segment_end_utc >= segment_start_utc);
  END IF;
END $$;

-- ============================================================
-- 2. Capa C -- marts.fieldbeat_working_hours_analysis_v2
-- ============================================================
-- Grano: 1 fila por fieldbeat_task_id. Resolución interna del builder:
-- intenta CONTRACTUAL -> si no calculable, intenta LEGACY_SCHEDULE
-- (fallback reproducible) -> si tampoco, NONE. Preserva SIEMPRE el
-- resultado del intento contractual (contractual_attempt_status/
-- _coverage_classification/_reason_code), incluso cuando el fallback
-- legado reemplaza la base final.
CREATE TABLE IF NOT EXISTS marts.fieldbeat_working_hours_analysis_v2 (
  working_hours_id bigserial PRIMARY KEY,
  fieldbeat_task_id bigint NOT NULL,

  client_key text, client_rut text, client_name text, task_type text, assigned_to text,
  equipment_internal_ids text,   -- string descriptivo plano (paridad con el mart legado), no identity-bearing

  start_time_utc timestamptz, start_time_local timestamp,
  end_time_utc timestamptz, end_time_local timestamp,
  duration_seconds integer,

  -- Modelo temporal FieldBeat: start/end son SIEMPRE el intervalo analítico
  -- resuelto. Los valores informados y la entrega conservan procedencia y
  -- estado de parseo por separado; nunca se infieren desde agenda.
  analysis_interval_basis text NOT NULL DEFAULT 'SCHEDULED_ESTIMATE' CHECK (analysis_interval_basis IN (
    'REPORTED_WORK_INTERVAL', 'DELIVERY_FALLBACK', 'TASK_TRANSITIONS', 'SCHEDULED_ESTIMATE', 'INSUFFICIENT_DATA'
  )),
  analysis_fallback_used boolean NOT NULL DEFAULT true,
  analysis_fallback_reason text,
  reported_work_start_utc timestamptz, reported_work_start_local timestamp, reported_work_start_raw text,
  reported_work_start_parse_status text NOT NULL DEFAULT 'MISSING' CHECK (reported_work_start_parse_status IN ('PARSED','MISSING','INVALID','AMBIGUOUS')),
  reported_work_end_utc timestamptz, reported_work_end_local timestamp, reported_work_end_raw text,
  reported_work_end_parse_status text NOT NULL DEFAULT 'MISSING' CHECK (reported_work_end_parse_status IN ('PARSED','MISSING','INVALID','AMBIGUOUS')),
  delivered_at_utc timestamptz, delivered_at_local timestamp, delivered_raw text,
  delivered_parse_status text NOT NULL DEFAULT 'MISSING' CHECK (delivered_parse_status IN ('PARSED','MISSING','INVALID','AMBIGUOUS')),
  temporal_issue_codes text[] NOT NULL DEFAULT ARRAY[]::text[],

  covered_seconds integer,
  outside_coverage_seconds integer,
  after_hours_weekday_seconds integer,
  weekend_seconds integer,
  holiday_seconds integer,
  after_hours_total_seconds integer,
  after_hours_rate numeric(6,4) CHECK (after_hours_rate IS NULL OR after_hours_rate BETWEEN 0 AND 1),
  is_after_hours_task boolean,

  calculation_status text NOT NULL CHECK (calculation_status IN ('CALCULATED', 'CALCULATED_WITH_WARNINGS', 'NOT_CALCULABLE')),
  coverage_classification text NOT NULL CHECK (coverage_classification IN ('FULLY_COVERED', 'PARTIALLY_COVERED', 'NOT_COVERED', 'NOT_CALCULABLE')),
  coverage_reason_code text NOT NULL CHECK (coverage_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'WITHIN_LEGACY_SCHEDULE', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE',
    'MULTIPLE_EQUIPMENT_CONFLICT', 'NO_EQUIPMENT', 'EQUIPMENT_UNMATCHED', 'EQUIPMENT_AMBIGUOUS',
    'NO_CONTRACT_AT_TASK_DATE', 'NO_CONTRACT_STATUS', 'ON_DEMAND_UNDEFINED', 'CONTRACT_STATUS_DEINSTALLED',
    'SCHEDULE_REVIEW_REQUIRED', 'CRITICALITY_UNKNOWN', 'HOLIDAY_COVERAGE_UNKNOWN',
    'INVALID_START_TIME', 'INVALID_DURATION', 'INSUFFICIENT_DATA'
  )),

  -- contract_valid_from/contract_valid_to/match_status/parse_status/
  -- primary_equipment_key NO viven acá (serían ambiguos para tareas
  -- multi-equipo: ¿de cuál equipo?) -viven SOLO en la tabla puente (sección
  -- 3), obtenidos vía JOIN filtrado por is_primary. Esto también elimina la
  -- necesidad de verificar consistencia entre un escalar redundante y la
  -- tabla puente: no hay escalar que pueda divergir.

  contractual_attempt_status text NOT NULL CHECK (contractual_attempt_status IN ('CALCULATED', 'NOT_CALCULABLE')),
  contractual_coverage_classification text NOT NULL CHECK (contractual_coverage_classification IN ('FULLY_COVERED', 'PARTIALLY_COVERED', 'NOT_COVERED', 'NOT_CALCULABLE')),
  contractual_reason_code text NOT NULL CHECK (contractual_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE', 'MULTIPLE_EQUIPMENT_CONFLICT',
    'NO_EQUIPMENT', 'EQUIPMENT_UNMATCHED', 'EQUIPMENT_AMBIGUOUS', 'NO_CONTRACT_AT_TASK_DATE',
    'NO_CONTRACT_STATUS', 'ON_DEMAND_UNDEFINED', 'CONTRACT_STATUS_DEINSTALLED',
    'SCHEDULE_REVIEW_REQUIRED', 'CRITICALITY_UNKNOWN', 'HOLIDAY_COVERAGE_UNKNOWN',
    'INVALID_START_TIME', 'INVALID_DURATION', 'INSUFFICIENT_DATA'
  )),
  fallback_used boolean NOT NULL,

  confidence_score integer CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 100),
  confidence_label text,
  confidence_factors text,
  calculation_method text,

  contract_resolution_confidence integer CHECK (contract_resolution_confidence IS NULL OR contract_resolution_confidence BETWEEN 0 AND 100),
  contract_resolution_label text,
  confidence_model_version text NOT NULL DEFAULT 'contract-v1',

  data_basis text NOT NULL CHECK (data_basis IN ('CONTRACTUAL', 'LEGACY_SCHEDULE', 'NONE')),
  calculated_at timestamptz NOT NULL DEFAULT now(),   -- siempre real: el builder corrió sobre esta tarea, incluso si el resultado es NONE
  builder_run_id uuid NOT NULL REFERENCES audit.pipeline_runs(run_id),

  UNIQUE (fieldbeat_task_id),

  -- === Normalización whole-seconds (punto 1) ===
  CHECK (start_time_utc IS NULL OR date_trunc('second', start_time_utc) = start_time_utc),
  CHECK (end_time_utc IS NULL OR date_trunc('second', end_time_utc) = end_time_utc),
  CHECK (start_time_utc IS NULL OR end_time_utc IS NULL OR duration_seconds = EXTRACT(EPOCH FROM (end_time_utc - start_time_utc))::integer),

  -- === Matriz estricta de Capa C (CONTRACTUAL/LEGACY_SCHEDULE/NONE) ===
  CHECK (data_basis <> 'CONTRACTUAL' OR (
    contractual_attempt_status = 'CALCULATED' AND
    fallback_used = false AND
    coverage_reason_code IN ('WITHIN_MATCHED_CONTRACT', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE') AND
    coverage_reason_code = contractual_reason_code AND
    coverage_classification = contractual_coverage_classification
  )),
  CHECK (data_basis <> 'LEGACY_SCHEDULE' OR (
    contractual_attempt_status = 'NOT_CALCULABLE' AND
    fallback_used = true AND
    coverage_reason_code = 'WITHIN_LEGACY_SCHEDULE' AND
    calculation_status IN ('CALCULATED', 'CALCULATED_WITH_WARNINGS')
  )),
  CHECK (data_basis <> 'NONE' OR (
    calculation_status = 'NOT_CALCULABLE' AND
    fallback_used = false AND
    coverage_reason_code NOT IN ('WITHIN_MATCHED_CONTRACT', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE', 'WITHIN_LEGACY_SCHEDULE')
  )),
  CHECK ((data_basis = 'NONE') = (calculation_status = 'NOT_CALCULABLE')),
  CHECK ((calculation_status = 'NOT_CALCULABLE') = (coverage_classification = 'NOT_CALCULABLE')),

  -- Completa la matriz contractual (punto 7 de la corrección final):
  -- contractual_attempt_status=CALCULATED <=> clasificación no-NOT_CALCULABLE
  -- Y reason es un código de éxito; =NOT_CALCULABLE <=> clasificación
  -- NOT_CALCULABLE Y reason no es un código de éxito.
  CHECK (
    (contractual_attempt_status = 'CALCULATED') = (
      contractual_coverage_classification <> 'NOT_CALCULABLE' AND
      contractual_reason_code IN ('WITHIN_MATCHED_CONTRACT', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE')
    )
  ),

  -- === Bicondicional real del intervalo (ambas direcciones) ===
  CHECK ((coverage_reason_code IN ('INVALID_START_TIME','INVALID_DURATION','INSUFFICIENT_DATA')) = (start_time_utc IS NULL)),
  CHECK ((start_time_utc IS NULL) = (end_time_utc IS NULL)),
  CHECK ((start_time_utc IS NULL) = (duration_seconds IS NULL)),

  -- Métricas de cobertura: NULL si y solo si NONE.
  CHECK (data_basis <> 'NONE' OR (
    covered_seconds IS NULL AND outside_coverage_seconds IS NULL AND
    after_hours_weekday_seconds IS NULL AND weekend_seconds IS NULL AND
    holiday_seconds IS NULL AND after_hours_total_seconds IS NULL AND
    after_hours_rate IS NULL AND is_after_hours_task IS NULL)),

  -- === Invariantes completas de métricas (punto 8: IS NOT NULL Y >=0
  -- EXPLÍCITOS -nunca depender solo de una expresión aritmética con NULL,
  -- que en Postgres un CHECK con resultado NULL se trata como satisfecho) ===
  CHECK (coverage_classification <> 'FULLY_COVERED' OR outside_coverage_seconds = 0),
  CHECK (coverage_classification <> 'NOT_COVERED' OR covered_seconds = 0),
  CHECK (coverage_classification <> 'PARTIALLY_COVERED' OR (covered_seconds > 0 AND outside_coverage_seconds > 0)),

  CHECK (data_basis = 'CONTRACTUAL' OR contract_resolution_confidence IS NULL),
  CHECK (data_basis <> 'CONTRACTUAL' OR contract_resolution_confidence IS NOT NULL)
);

-- Evolución idempotente de instalaciones existentes. La columna legado
-- reported_end_raw representaba exactamente el término informado y se
-- renombra en vez de duplicarla.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'marts' AND table_name = 'fieldbeat_working_hours_analysis_v2' AND column_name = 'reported_end_raw'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'marts' AND table_name = 'fieldbeat_working_hours_analysis_v2' AND column_name = 'reported_work_end_raw'
  ) THEN
    ALTER TABLE marts.fieldbeat_working_hours_analysis_v2 RENAME COLUMN reported_end_raw TO reported_work_end_raw;
  END IF;
END $$;

ALTER TABLE marts.fieldbeat_working_hours_analysis_v2
  ADD COLUMN IF NOT EXISTS analysis_interval_basis text NOT NULL DEFAULT 'SCHEDULED_ESTIMATE',
  ADD COLUMN IF NOT EXISTS analysis_fallback_used boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS analysis_fallback_reason text,
  ADD COLUMN IF NOT EXISTS reported_work_start_utc timestamptz,
  ADD COLUMN IF NOT EXISTS reported_work_start_local timestamp,
  ADD COLUMN IF NOT EXISTS reported_work_start_raw text,
  ADD COLUMN IF NOT EXISTS reported_work_start_parse_status text NOT NULL DEFAULT 'MISSING',
  ADD COLUMN IF NOT EXISTS reported_work_end_utc timestamptz,
  ADD COLUMN IF NOT EXISTS reported_work_end_local timestamp,
  ADD COLUMN IF NOT EXISTS reported_work_end_raw text,
  ADD COLUMN IF NOT EXISTS reported_work_end_parse_status text NOT NULL DEFAULT 'MISSING',
  ADD COLUMN IF NOT EXISTS delivered_at_utc timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at_local timestamp,
  ADD COLUMN IF NOT EXISTS delivered_raw text,
  ADD COLUMN IF NOT EXISTS delivered_parse_status text NOT NULL DEFAULT 'MISSING',
  ADD COLUMN IF NOT EXISTS temporal_issue_codes text[] NOT NULL DEFAULT ARRAY[]::text[];

-- Un intervalo informado con inicio=término es coherente (duración cero) y
-- no debe sustituirse por agenda. La tasa fuera de cobertura se define como
-- cero, igual que en aggregateSegments().
ALTER TABLE marts.fieldbeat_working_hours_analysis_v2
  DROP CONSTRAINT IF EXISTS fieldbeat_working_hours_analysis_v2_check11;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'marts.fieldbeat_working_hours_analysis_v2'::regclass
      AND conname = 'fieldbeat_working_hours_analysis_v2_metrics_consistent'
  ) THEN
    ALTER TABLE marts.fieldbeat_working_hours_analysis_v2
      ADD CONSTRAINT fieldbeat_working_hours_analysis_v2_metrics_consistent CHECK (data_basis = 'NONE' OR (
        duration_seconds IS NOT NULL AND duration_seconds >= 0 AND
        covered_seconds IS NOT NULL AND covered_seconds >= 0 AND
        outside_coverage_seconds IS NOT NULL AND outside_coverage_seconds >= 0 AND
        after_hours_weekday_seconds IS NOT NULL AND after_hours_weekday_seconds >= 0 AND
        weekend_seconds IS NOT NULL AND weekend_seconds >= 0 AND
        holiday_seconds IS NOT NULL AND holiday_seconds >= 0 AND
        after_hours_total_seconds IS NOT NULL AND after_hours_total_seconds >= 0 AND
        after_hours_rate IS NOT NULL AND is_after_hours_task IS NOT NULL AND
        covered_seconds + outside_coverage_seconds = duration_seconds AND
        after_hours_weekday_seconds + weekend_seconds + holiday_seconds = after_hours_total_seconds AND
        outside_coverage_seconds = after_hours_total_seconds AND
        is_after_hours_task = (after_hours_total_seconds > 0) AND
        after_hours_rate = CASE WHEN duration_seconds = 0 THEN 0 ELSE ROUND(after_hours_total_seconds::numeric / duration_seconds, 4) END
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS fbwha_v2_client_idx ON marts.fieldbeat_working_hours_analysis_v2 (client_key);
CREATE INDEX IF NOT EXISTS fbwha_v2_status_idx ON marts.fieldbeat_working_hours_analysis_v2 (calculation_status);
CREATE INDEX IF NOT EXISTS fbwha_v2_classification_idx ON marts.fieldbeat_working_hours_analysis_v2 (coverage_classification);
CREATE INDEX IF NOT EXISTS fbwha_v2_databasis_idx ON marts.fieldbeat_working_hours_analysis_v2 (data_basis);
CREATE INDEX IF NOT EXISTS fbwha_v2_run_idx ON marts.fieldbeat_working_hours_analysis_v2 (builder_run_id);

-- ============================================================
-- 3. Tabla puente multi-equipo -- marts.fieldbeat_working_hours_equipment_links
-- ============================================================
CREATE TABLE IF NOT EXISTS marts.fieldbeat_working_hours_equipment_links (
  link_id bigserial PRIMARY KEY,
  working_hours_id bigint NOT NULL REFERENCES marts.fieldbeat_working_hours_analysis_v2(working_hours_id) ON DELETE CASCADE,
  fieldbeat_equipment_key text NOT NULL,
  fieldbeat_equipment_internal_id text,
  contract_equipment_key text,
  contract_version_id bigint REFERENCES config.contract_equipment_versions(contract_version_id),
  schedule_id bigint REFERENCES config.contract_service_schedules(schedule_id),
  contract_valid_from date,
  contract_valid_to date,
  match_status text CHECK (match_status IN ('MATCHED', 'UNMATCHED', 'AMBIGUOUS')),
  parse_status text CHECK (parse_status IN ('OK', 'REVIEW_REQUIRED')),
  equipment_coverage_classification text NOT NULL CHECK (equipment_coverage_classification IN ('FULLY_COVERED', 'PARTIALLY_COVERED', 'NOT_COVERED', 'NOT_CALCULABLE')),
  equipment_reason_code text NOT NULL CHECK (equipment_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'NO_CONTRACT_AT_TASK_DATE', 'EQUIPMENT_UNMATCHED', 'EQUIPMENT_AMBIGUOUS',
    'NO_CONTRACT_STATUS', 'ON_DEMAND_UNDEFINED', 'CONTRACT_STATUS_DEINSTALLED', 'SCHEDULE_REVIEW_REQUIRED',
    'CRITICALITY_UNKNOWN', 'HOLIDAY_COVERAGE_UNKNOWN'
  )),
  coverage_fingerprint text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (working_hours_id, fieldbeat_equipment_key),
  CHECK ((coverage_fingerprint IS NULL) = (equipment_coverage_classification = 'NOT_CALCULABLE'))
);
CREATE INDEX IF NOT EXISTS fbwhel_wh_idx ON marts.fieldbeat_working_hours_equipment_links (working_hours_id);
CREATE INDEX IF NOT EXISTS fbwhel_fingerprint_idx ON marts.fieldbeat_working_hours_equipment_links (coverage_fingerprint);

-- A lo sumo UN equipo primario por tarea.
CREATE UNIQUE INDEX IF NOT EXISTS fbwhel_one_primary_uidx
  ON marts.fieldbeat_working_hours_equipment_links (working_hours_id) WHERE is_primary;

-- ============================================================
-- 4. Validación pre-publicación de cardinalidad de is_primary (punto 10 de
-- la corrección final) -función que el builder de 6.6B2 debe invocar antes
-- de dar por completa una publicación: exactamente 1 primario en tareas
-- contractuales calculables (WITHIN_MATCHED_CONTRACT o
-- MULTIPLE_EQUIPMENT_SAME_COVERAGE); cero en conflicto o sin equipo. No es
-- un CHECK de fila porque depende de comparar Capa C contra la tabla puente
-- (relación entre tablas, no expresable en un CHECK de una sola tabla).
-- ============================================================
CREATE OR REPLACE FUNCTION marts.validate_equipment_links_cardinality(p_working_hours_id bigint)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  v_contractual_reason_code text;
  v_primary_count integer;
BEGIN
  SELECT contractual_reason_code INTO v_contractual_reason_code
  FROM marts.fieldbeat_working_hours_analysis_v2
  WHERE working_hours_id = p_working_hours_id;

  SELECT COUNT(*) INTO v_primary_count
  FROM marts.fieldbeat_working_hours_equipment_links
  WHERE working_hours_id = p_working_hours_id AND is_primary;

  IF v_contractual_reason_code IN ('WITHIN_MATCHED_CONTRACT', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE') THEN
    RETURN v_primary_count = 1;
  ELSIF v_contractual_reason_code IN ('MULTIPLE_EQUIPMENT_CONFLICT', 'NO_EQUIPMENT') THEN
    RETURN v_primary_count = 0;
  END IF;

  -- Otros casos (ej. un único equipo EQUIPMENT_UNMATCHED) no tienen una
  -- regla de cardinalidad estricta definida todavía -no bloquea.
  RETURN true;
END;
$$;

-- ============================================================
-- 5. Revokes -defensa en profundidad: marts hereda GRANT SELECT
-- automático para nexus_app vía ALTER DEFAULT PRIVILEGES de sql/000 (ver
-- comentario en sql/000_roles_and_schemas.sql:43-50) -este REVOKE explícito
-- NO es opcional, es la única protección real para forzar TODO el tráfico
-- de aplicación a pasar por marts.fieldbeat_working_hours_analysis_current
-- (sql/082).
-- ============================================================
REVOKE ALL ON marts.fieldbeat_contract_coverage_segments, marts.fieldbeat_working_hours_analysis_v2, marts.fieldbeat_working_hours_equipment_links FROM nexus_app;
REVOKE ALL ON SEQUENCE marts.fieldbeat_contract_coverage_segments_segment_id_seq FROM nexus_app;
REVOKE ALL ON SEQUENCE marts.fieldbeat_working_hours_analysis_v2_working_hours_id_seq FROM nexus_app;
REVOKE ALL ON SEQUENCE marts.fieldbeat_working_hours_equipment_links_link_id_seq FROM nexus_app;
REVOKE ALL ON FUNCTION marts.validate_equipment_links_cardinality(bigint) FROM PUBLIC, nexus_app;
