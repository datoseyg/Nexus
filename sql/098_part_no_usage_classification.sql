-- Gate B - Auditoría: diferenciar una declaración VÁLIDA de "no se utilizó
-- repuesto" (N/A, no aplica, NC, sin repuesto...) de un PLACEHOLDER real
-- (dato incompleto/inválido que sí requiere revisión, ej. "sin numero"/"S/N"
-- - esos hablan de NÚMERO DE SERIE ausente, nunca de ausencia de repuesto,
-- y quedan deliberadamente FUERA del catálogo de abajo).
--
-- Decisión de dominio: "N/A" no es un repuesto placeholder, es una
-- declaración de cero repuestos. El texto original NUNCA se modifica -
-- marts.used_parts_dolibarr_match.match_status sigue siendo PLACEHOLDER_VALUE
-- tal cual el pipeline lo calculó (src/resolvers/part-identity-resolver.js,
-- fuera de esta migración a propósito - un cambio ahí solo afectaría la
-- PRÓXIMA corrida del pipeline, nunca los datos ya cargados, y esta
-- corrección no dispara ningún refresh de datos). La reclasificación ocurre
-- enteramente en la capa de consulta (quality.classify_part_declaration),
-- así que aplica de inmediato a los datos ya existentes sin reprocesar nada
-- fila por fila.
--
-- Catálogo en el schema `quality` (no `config`, que ya está reservado para
-- datos administrativos de contratos, ver sql/070) - "el mecanismo
-- equivalente ya existente": quality ya tiene GRANT SELECT/EXECUTE por
-- default a nexus_app (sql/086), evita REVOKE/SECURITY DEFINER que
-- necesitaría config.* para las mismas tablas base.
--
-- ============================================================================
-- 1. Catálogo central de declaraciones de "sin repuesto" - ÚNICA fuente de
--    verdad, nunca duplicado en SQL/TypeScript/componentes/tests/exportadores.
--    Semillas: comparadas contra un inventario real de
--    marts.used_parts_dolibarr_match WHERE match_status='PLACEHOLDER_VALUE'
--    (722 filas, 26 valores crudos distintos) - "na"/"nc"/"noaplica"
--    confirmados directamente en ese inventario; "no"/"nohay"/
--    "nocorresponde"/"sinrepuesto"/"sinrepuestos"/"ninguno"/"ninguna" son los
--    ejemplos de negocio entregados como valores reales observados, no
--    presentes en la muestra local pero de significado inequívoco. Variantes
--    de serie/código ("sn", "s/n", "sin numero", "sin número") y valores
--    ambiguos de baja frecuencia ("no tiene", 1 ocurrencia) quedan
--    deliberadamente FUERA - siguen clasificando como PLACEHOLDER_VALUE real.
-- ============================================================================
CREATE TABLE IF NOT EXISTS quality.part_no_usage_markers (
  id bigserial PRIMARY KEY,
  normalized_value text NOT NULL UNIQUE,
  business_label text NOT NULL DEFAULT 'Sin repuesto utilizado',
  active boolean NOT NULL DEFAULT true,
  source text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO quality.part_no_usage_markers (normalized_value, source) VALUES
  ('na', 'observado en dataset local: N/A (182), NA (69), n/a (33), na (2), Na (2), n/A (1)'),
  ('no', 'ejemplo de negocio confirmado: No, NO, no, No.'),
  ('nohay', 'ejemplo de negocio confirmado: No hay'),
  ('noaplica', 'observado en dataset local: no aplica (6), No aplica (2), NO APLICA (1)'),
  ('nocorresponde', 'ejemplo de negocio confirmado: no corresponde'),
  ('nc', 'observado en dataset local: N/C (44), NC (11), n/c (5), nc (3)'),
  ('sinrepuesto', 'ejemplo de negocio confirmado: sin repuesto'),
  ('sinrepuestos', 'ejemplo de negocio confirmado: sin repuestos'),
  ('ninguno', 'ejemplo de negocio confirmado: ninguno'),
  ('ninguna', 'ejemplo de negocio confirmado: ninguna')
ON CONFLICT (normalized_value) DO NOTHING;

-- El GRANT de sql/086 (ALTER DEFAULT PRIVILEGES ... TO nexus_app) solo cubre
-- nexus_app - y el de sql/089 (GRANT SELECT ON ALL TABLES IN SCHEMA quality
-- TO governance_owner) solo alcanzó a las tablas que YA existían cuando esa
-- migración corrió, nunca a una tabla nueva creada después por esta
-- migración. Sin este GRANT explícito, governance._evaluate_rule_into_staging
-- (SECURITY DEFINER, corre con los privilegios de su dueño = governance_owner)
-- falla con "permission denied for table part_no_usage_markers" en cuanto
-- intenta leer quality.fieldbeat_used_part_match (que ahora depende de esta
-- tabla vía quality.classify_part_declaration) - bug real, confirmado
-- ejecutando governance.fn_run_rule_evaluation('FULL', ...) contra la base
-- local antes de agregar este GRANT.
GRANT SELECT ON quality.part_no_usage_markers TO governance_owner, nexus_rule_evaluator, nexus_app_read;

-- ============================================================================
-- 2. Normalización de campo completo - mismo estilo que
--    quality.normalize_engineer_name (sql/088): sin extensión `unaccent`
--    (política ya establecida en este repo), translate() explícito de
--    vocales/ñ/ç acentuadas, colapsa CUALQUIER caracter no alfanumérico
--    (espacios, barras, puntos, comas) - "N/A", "n / a", "N.A." y "na"
--    normalizan TODOS a "na". Comparación de campo completo únicamente
--    (ver quality.classify_part_declaration) - NUNCA ILIKE/substring, para
--    que "No aplica filtro de condensado" jamás se confunda con "No aplica".
-- ============================================================================
CREATE OR REPLACE FUNCTION quality.normalize_part_declaration(raw_value TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT regexp_replace(
    LOWER(translate(COALESCE(raw_value, ''),
      'áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC')),
    '[^a-z0-9]+', '', 'g'
  )
$$;

-- ============================================================================
-- 3. Clasificación de una declaración de repuesto - ÚNICA función de verdad,
--    consumida por quality.fieldbeat_used_part_match (governance, FieldBeat,
--    Search, PDF, exportación CSV) Y por las rutas de Auditoría
--    (parts-review/placeholders) - nunca reimplementada dos veces.
--
--    Pasa MATCHED/NO_MATCH/AMBIGUOUS_MATCH sin tocar. Solo reclasifica
--    PLACEHOLDER_VALUE, y solo en dos condiciones A LA VEZ:
--      a) el valor completo normalizado es vacío (solo puntuación/espacios,
--         o NULL) O calza EXACTO contra quality.part_no_usage_markers;
--      b) la cantidad declarada es NULL o 0 (sin evidencia contradictoria).
--    Cualquier otro caso -incluida cantidad POSITIVA con valor vacío/
--    coincidente, la anomalía real a revisar- deja PLACEHOLDER_VALUE
--    intacto. raw_part_identifier nunca se modifica, esta función solo lee.
-- ============================================================================
CREATE OR REPLACE FUNCTION quality.classify_part_declaration(
  p_raw_part_identifier TEXT, p_match_status TEXT, p_quantity BIGINT
) RETURNS TEXT LANGUAGE SQL STABLE PARALLEL SAFE AS $$
  SELECT CASE
    WHEN p_match_status IS DISTINCT FROM 'PLACEHOLDER_VALUE' THEN p_match_status
    WHEN (p_quantity IS NULL OR p_quantity = 0)
      AND (
        quality.normalize_part_declaration(p_raw_part_identifier) = ''
        OR EXISTS (
          SELECT 1 FROM quality.part_no_usage_markers m
          WHERE m.active AND m.normalized_value = quality.normalize_part_declaration(p_raw_part_identifier)
        )
      )
      THEN 'NO_PART_USED'
    ELSE 'PLACEHOLDER_VALUE'
  END
$$;

-- ============================================================================
-- 4. quality.fieldbeat_used_part_match - misma forma de columnas (CREATE OR
--    REPLACE VIEW válido, ninguna columna se quita/reordena/retipa), solo
--    cambia la rama PLACEHOLDER_VALUE del CASE y agrega el join a
--    processed.fieldbeat_used_parts (cantidad) que antes no traía. Todo
--    consumidor de historical_match_status (quality.fieldbeat_report_part_occurrences,
--    quality.fieldbeat_report_parts_summary, los 3 evaluadores de gobierno
--    de repuestos) ve NO_PART_USED de inmediato, sin reprocesar nada.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_used_part_match AS
SELECT
  m.used_part_id,
  m.fieldbeat_task_id,
  m.match_status,
  CASE
    WHEN m.match_status = 'AMBIGUOUS_MATCH' THEN 'AMBIGUOUS_MATCH'
    WHEN m.match_status = 'PLACEHOLDER_VALUE' THEN quality.classify_part_declaration(m.raw_part_identifier, m.match_status, p.quantity)
    WHEN m.match_status = 'MATCHED' THEN 'CURRENT_DIRECT_MATCH'
    WHEN m.match_status = 'NO_MATCH' AND alias.dolibarr_product_id IS NOT NULL THEN 'HISTORICAL_ALIAS_MATCH'
    ELSE 'NO_MATCH'
  END AS historical_match_status,
  alias.dolibarr_product_id AS alias_resolved_dolibarr_product_id
FROM marts.used_parts_dolibarr_match m
LEFT JOIN processed.fieldbeat_used_parts p ON p.used_part_id = m.used_part_id
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
-- 5. quality.fieldbeat_report_parts_summary - fully_traceable ahora también
--    acepta NO_PART_USED como "nada pendiente de resolver" (un reporte cuyas
--    líneas son solo declaraciones válidas de ausencia de repuesto, o una
--    mezcla de esas y matches reales, no tiene ninguna ambigüedad real que
--    revisar). placeholders/no_match siguen contando SOLO placeholders
--    reales/no-match reales - NO_PART_USED nunca incrementa esos contadores.
--
--    La definición de esta vista vive en
--    sql/086_fieldbeat_quality.sql (ya incluye no_part_used_declarations y
--    'NO_PART_USED' en fully_traceable), NO acá - un CREATE OR REPLACE VIEW
--    en ESTE archivo que agregara la columna rompía la idempotencia de una
--    reaplicación completa de sql/000-098: en la segunda pasada, 086 vuelve
--    a ejecutarse ANTES que este archivo y Postgres rechaza recrear la vista
--    con menos columnas de las que ya tiene ("cannot drop columns from
--    view"). Confirmado con
--    test/fieldbeat/sql-migration-idempotency.integration.test.ts. La
--    columna no depende de quality.classify_part_declaration (arriba en
--    este archivo) - es un COUNT(*) FILTER sobre historical_match_status,
--    que solo empieza a valer 'NO_PART_USED' una vez que la vista
--    quality.fieldbeat_used_part_match (sección 4, arriba) se actualiza.
-- ============================================================================

-- ============================================================================
-- 6. governance.rule_definitions - nueva versión de PART_PLACEHOLDER_VALUE
--    (nunca se muta la fila v1 existente, B5/append-only ya establecido en
--    todo este schema): la semántica de la regla cambia (ya no incluye
--    declaraciones válidas de "sin repuesto"), así que corresponde una
--    versión nueva, no un UPDATE de la v1. El evaluador SQL en sí no
--    necesita lógica nueva (ya filtra por historical_match_status =
--    'PLACEHOLDER_VALUE', que ahora excluye NO_PART_USED automáticamente
--    vía la vista corregida arriba) - solo se registra la v2 y se activa en
--    rule_registry.
-- ============================================================================
INSERT INTO governance.rule_definitions (rule_code, rule_version, entity_type, title, description, default_severity, evaluator_key)
SELECT 'PART_PLACEHOLDER_VALUE', 2, 'part_occurrence', 'Valor provisional de repuesto',
  'Ocurrencia de repuesto cuyo identificador crudo es un valor placeholder real que requiere revisión (match_status = PLACEHOLDER_VALUE tras excluir declaraciones válidas de "sin repuesto utilizado", ver quality.classify_part_declaration). Una declaración negativa válida (N/A, no aplica, NC, sin repuesto...) nunca activa esta regla.',
  'LOW', 'PART_PLACEHOLDER_VALUE_V2'
WHERE NOT EXISTS (
  SELECT 1 FROM governance.rule_definitions WHERE rule_code = 'PART_PLACEHOLDER_VALUE' AND rule_version = 2
);

UPDATE governance.rule_registry SET active_rule_version = 2 WHERE rule_code = 'PART_PLACEHOLDER_VALUE' AND active_rule_version = 1;

-- ============================================================================
-- 7. governance._evaluate_rule_into_staging - agrega el dispatch para
--    PART_PLACEHOLDER_VALUE_V2 (idéntico al de V1: mismo WHERE
--    historical_match_status='PLACEHOLDER_VALUE', que ahora ya excluye
--    NO_PART_USED vía la vista corregida arriba - la regla no necesita SQL
--    distinto, solo existir bajo el evaluator_key nuevo para que
--    rule_registry pueda apuntar a una versión con descripción vigente).
--    CREATE OR REPLACE de la función completa (git-versionada, no un dato) -
--    se copian las ramas existentes tal cual, nunca se reescriben.
-- ============================================================================
-- governance._evaluate_rule_into_staging ya existe (sql/090) y quedó owned
-- por governance_owner (sweep de ownership al final de ese archivo).
-- CREATE OR REPLACE FUNCTION sobre una función existente exige ser su owner
-- -el migrador que aplica este script solo tiene membresía SET-only, sin
-- herencia automática (sql/089: "GRANT governance_owner TO SESSION_USER
-- WITH INHERIT FALSE, SET TRUE"), así que sin elevar explícitamente el rol
-- de la sesión ANTES de este statement, el replace falla con
-- "must be owner of function _evaluate_rule_into_staging" (42501) - error
-- real confirmado contra Supabase. Elevación mínima y acotada a este único
-- statement: SET ROLE justo antes, RESET ROLE justo después -nunca
-- INHERIT, nunca una membresía nueva, nunca un cambio de ownership. Misma
-- mecánica ya usada por el ownership-transfer de sql/090, aplicada acá al
-- caso distinto de re-crear (no transferir) un objeto ya owned por
-- governance_owner. Funciona igual bajo superusuario local (SET ROLE
-- siempre permitido), bajo el migrador local con la membresía SET TRUE, y
-- bajo el `postgres` administrado de Supabase (misma membresía, ya
-- otorgada por sql/089/090 antes de llegar acá). Idempotente: reaplicar
-- este archivo repite el mismo SET ROLE/RESET ROLE sin efecto acumulativo.
SET ROLE governance_owner;

CREATE OR REPLACE FUNCTION governance._evaluate_rule_into_staging(
  p_run_id uuid, p_rule_code text, p_rule_version integer, p_evaluator_key text,
  p_scope_entity_key text, p_scope_occurrence_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance, marts, quality, processed
AS $$
BEGIN
  IF p_evaluator_key = 'PART_NO_MATCH_V1' THEN
    INSERT INTO governance.rule_evaluation_coverage (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, coverage_key)
    SELECT p_run_id, p_rule_code, p_rule_version, 'part_occurrence', q.fieldbeat_task_id::text, q.used_part_id,
      jsonb_build_object('entityType','part_occurrence','entityKey',q.fieldbeat_task_id::text,'occurrenceKey',q.used_part_id)
    FROM quality.fieldbeat_used_part_match q
    WHERE (p_scope_occurrence_key IS NULL OR q.used_part_id = p_scope_occurrence_key)
      AND (p_scope_entity_key IS NULL OR q.fieldbeat_task_id::text = p_scope_entity_key);

    INSERT INTO governance.rule_evaluation_detections (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, fingerprint, evidence_payload)
    SELECT p_run_id, p_rule_code, p_rule_version, 'part_occurrence', q.fieldbeat_task_id::text, q.used_part_id,
      governance._fingerprint(q.fieldbeat_task_id::text, 'part_occurrence', q.used_part_id, p_rule_code),
      jsonb_build_object('matchStatus', q.match_status, 'historicalMatchStatus', q.historical_match_status,
        'rawPartIdentifier', m.raw_part_identifier, 'normalizedPartIdentifier', m.normalized_part_identifier, 'dolibarrRef', m.dolibarr_ref)
    FROM quality.fieldbeat_used_part_match q
    JOIN marts.used_parts_dolibarr_match m ON m.used_part_id = q.used_part_id
    WHERE q.historical_match_status = 'NO_MATCH'
      AND (p_scope_occurrence_key IS NULL OR q.used_part_id = p_scope_occurrence_key)
      AND (p_scope_entity_key IS NULL OR q.fieldbeat_task_id::text = p_scope_entity_key)
    ON CONFLICT (evaluation_run_id, fingerprint) DO NOTHING;

  ELSIF p_evaluator_key = 'PART_AMBIGUOUS_MATCH_V1' THEN
    INSERT INTO governance.rule_evaluation_coverage (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, coverage_key)
    SELECT p_run_id, p_rule_code, p_rule_version, 'part_occurrence', q.fieldbeat_task_id::text, q.used_part_id,
      jsonb_build_object('entityType','part_occurrence','entityKey',q.fieldbeat_task_id::text,'occurrenceKey',q.used_part_id)
    FROM quality.fieldbeat_used_part_match q
    WHERE (p_scope_occurrence_key IS NULL OR q.used_part_id = p_scope_occurrence_key)
      AND (p_scope_entity_key IS NULL OR q.fieldbeat_task_id::text = p_scope_entity_key);

    INSERT INTO governance.rule_evaluation_detections (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, fingerprint, evidence_payload)
    SELECT p_run_id, p_rule_code, p_rule_version, 'part_occurrence', q.fieldbeat_task_id::text, q.used_part_id,
      governance._fingerprint(q.fieldbeat_task_id::text, 'part_occurrence', q.used_part_id, p_rule_code),
      jsonb_build_object('matchStatus', q.match_status, 'historicalMatchStatus', q.historical_match_status, 'candidateDolibarrProductIds', m.candidate_dolibarr_product_ids)
    FROM quality.fieldbeat_used_part_match q
    JOIN marts.used_parts_dolibarr_match m ON m.used_part_id = q.used_part_id
    WHERE q.historical_match_status = 'AMBIGUOUS_MATCH'
      AND (p_scope_occurrence_key IS NULL OR q.used_part_id = p_scope_occurrence_key)
      AND (p_scope_entity_key IS NULL OR q.fieldbeat_task_id::text = p_scope_entity_key)
    ON CONFLICT (evaluation_run_id, fingerprint) DO NOTHING;

  ELSIF p_evaluator_key IN ('PART_PLACEHOLDER_VALUE_V1', 'PART_PLACEHOLDER_VALUE_V2') THEN
    INSERT INTO governance.rule_evaluation_coverage (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, coverage_key)
    SELECT p_run_id, p_rule_code, p_rule_version, 'part_occurrence', q.fieldbeat_task_id::text, q.used_part_id,
      jsonb_build_object('entityType','part_occurrence','entityKey',q.fieldbeat_task_id::text,'occurrenceKey',q.used_part_id)
    FROM quality.fieldbeat_used_part_match q
    WHERE (p_scope_occurrence_key IS NULL OR q.used_part_id = p_scope_occurrence_key)
      AND (p_scope_entity_key IS NULL OR q.fieldbeat_task_id::text = p_scope_entity_key);

    INSERT INTO governance.rule_evaluation_detections (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, fingerprint, evidence_payload)
    SELECT p_run_id, p_rule_code, p_rule_version, 'part_occurrence', q.fieldbeat_task_id::text, q.used_part_id,
      governance._fingerprint(q.fieldbeat_task_id::text, 'part_occurrence', q.used_part_id, p_rule_code),
      jsonb_build_object('matchStatus', q.match_status, 'historicalMatchStatus', q.historical_match_status, 'rawPartIdentifier', m.raw_part_identifier)
    FROM quality.fieldbeat_used_part_match q
    JOIN marts.used_parts_dolibarr_match m ON m.used_part_id = q.used_part_id
    WHERE q.historical_match_status = 'PLACEHOLDER_VALUE'
      AND (p_scope_occurrence_key IS NULL OR q.used_part_id = p_scope_occurrence_key)
      AND (p_scope_entity_key IS NULL OR q.fieldbeat_task_id::text = p_scope_entity_key)
    ON CONFLICT (evaluation_run_id, fingerprint) DO NOTHING;

  ELSIF p_evaluator_key = 'REPORT_QUALITY_DEGRADED_V1' THEN
    INSERT INTO governance.rule_evaluation_coverage (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, coverage_key)
    SELECT p_run_id, p_rule_code, p_rule_version, 'report', v.fieldbeat_task_id::text, v.fieldbeat_task_id::text,
      jsonb_build_object('entityType','report','entityKey',v.fieldbeat_task_id::text,'occurrenceKey',v.fieldbeat_task_id::text)
    FROM marts.fieldbeat_report_dolibarr_operational_view v
    WHERE (p_scope_entity_key IS NULL OR v.fieldbeat_task_id::text = p_scope_entity_key);

    INSERT INTO governance.rule_evaluation_detections (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, fingerprint, evidence_payload)
    SELECT p_run_id, p_rule_code, p_rule_version, 'report', v.fieldbeat_task_id::text, v.fieldbeat_task_id::text,
      governance._fingerprint(v.fieldbeat_task_id::text, 'report', v.fieldbeat_task_id::text, p_rule_code),
      jsonb_build_object('reportQualityStatus', v.report_quality_status)
    FROM marts.fieldbeat_report_dolibarr_operational_view v
    WHERE v.report_quality_status IN ('HAS_PLACEHOLDERS','HAS_UNMATCHED_PARTS','REVIEW_REQUIRED','HAS_AMBIGUOUS_PARTS')
      AND (p_scope_entity_key IS NULL OR v.fieldbeat_task_id::text = p_scope_entity_key)
    ON CONFLICT (evaluation_run_id, fingerprint) DO NOTHING;

  ELSIF p_evaluator_key = 'TICKET_LINK_RESTRICTED_OR_MISSING_V1' THEN
    INSERT INTO governance.rule_evaluation_coverage (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, coverage_key)
    SELECT p_run_id, p_rule_code, p_rule_version, 'ticket_link', v.fieldbeat_task_id::text, v.fieldbeat_task_id::text,
      jsonb_build_object('entityType','ticket_link','entityKey',v.fieldbeat_task_id::text,'occurrenceKey',v.fieldbeat_task_id::text)
    FROM marts.fieldbeat_report_dolibarr_operational_view v
    WHERE (p_scope_entity_key IS NULL OR v.fieldbeat_task_id::text = p_scope_entity_key);

    INSERT INTO governance.rule_evaluation_detections (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, fingerprint, evidence_payload)
    SELECT p_run_id, p_rule_code, p_rule_version, 'ticket_link', v.fieldbeat_task_id::text, v.fieldbeat_task_id::text,
      governance._fingerprint(v.fieldbeat_task_id::text, 'ticket_link', v.fieldbeat_task_id::text, p_rule_code),
      jsonb_build_object('zendeskJoinStatus', v.zendesk_join_status, 'effectiveZendeskJoinStatus', q.effective_zendesk_join_status)
    FROM marts.fieldbeat_report_dolibarr_operational_view v
    JOIN quality.fieldbeat_ticket_linkage q ON q.fieldbeat_task_id = v.fieldbeat_task_id
    WHERE q.effective_zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK'
      AND (p_scope_entity_key IS NULL OR v.fieldbeat_task_id::text = p_scope_entity_key)
    ON CONFLICT (evaluation_run_id, fingerprint) DO NOTHING;

  ELSE
    RAISE EXCEPTION 'evaluator_key desconocido: % (allowlist agotada, no se ejecuta SQL dinámico)', p_evaluator_key;
  END IF;
END;
$$;

-- Restaura la identidad de sesión del migrador inmediatamente después de
-- terminar esta única definición -nunca se queda elevado para el resto del
-- archivo/sesión (ningún statement posterior de este archivo necesita ser
-- governance_owner: las funciones quality.* de arriba las crea el migrador
-- mismo, sin conflicto de ownership).
RESET ROLE;
