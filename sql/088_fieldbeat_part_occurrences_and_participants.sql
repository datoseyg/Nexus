-- HOTFIX de integridad de datos FieldBeat (post-Phase 6) - modelo canónico
-- de ocurrencias de repuesto y participantes 0..N por reporte. Idempotente
-- (CREATE OR REPLACE VIEW / IF NOT EXISTS en todo), 100% de solo lectura
-- sobre processed/marts/manual_review ya sincronizados - esta migración
-- NUNCA escribe en esos schemas ni se toca desde db:pg:migrate.js
-- (SYNC_SCHEMAS = ["processed", "marts", "gold"], "quality"/"manual_review"
-- quedan fuera de su alcance a propósito, mismo patrón que sql/086).
--
-- Caso de regresión verificado: reporte FieldBeat #3453 (Thyratron/CX1551G
-- sin match de catálogo, Manuel Reyes responsable principal, Alexis Acevedo
-- adicional vía "OTROS (COMENTE)", intervalo declarado 09:50-12:00 = 130
-- minutos reales vs duration=120 minutos ESTIMADO de agenda) - usado SOLO
-- como fixture verificable en tests, nunca como excepción hardcodeada acá.
--
-- Separa dos conceptos que antes estaban mezclados:
--   1. Presencia/declaración de un repuesto en el reporte (declaration_status)
--      vs. correspondencia con el catálogo Dolibarr (catalog_match_status) -
--      NO_MATCH significa "declarado, sin correspondencia validada", NUNCA
--      "no existe" ni "no fue declarado".
--   2. Responsable principal (assigned_to, sin cambios) vs. participantes
--      0..N (nuevo) - un reporte puede tener colaboradores adicionales
--      capturados en el campo "NOMBRE DEL INGENIERO ADICIONAL" (selección
--      estructurada + comentario libre asociado a "OTROS (COMENTE)").
--
-- Política de duración (ver quality.fieldbeat_report_labor_summary más
-- abajo): duration/duration_minutes es SIEMPRE una estimación de agenda
-- (confirmado empíricamente: valores repetidos idénticos - ej. 120 - para
-- intervalos declarados totalmente distintos entre sí, incluso para un
-- intervalo que abarca varios días - y un conjunto de valores discreto por
-- tipo de tarea, nunca una medición continua) - NUNCA se usa como duración
-- real ni alimenta horas-persona. La duración real solo puede venir del
-- intervalo de inicio/término declarado en el formulario (validado), o de
-- transiciones INICIADA->TERMINADA cuando se demuestre que representan
-- trabajo efectivo (no se ha encontrado evidencia de esto para NINGÚN tipo
-- de reporte en el dataset actual - para el 3453, las transiciones miden
-- ~16 min de interacción con la app, no las 130 min de trabajo real
-- declarado - por lo que esta fuente queda documentada pero sin datos que
-- la disparen hoy).
CREATE SCHEMA IF NOT EXISTS quality;

-- ============================================================================
-- 0. Funciones de normalización/parseo - sin extensión unaccent (mismo estilo
--    que sql/080_holiday_calendar.sql), sin lógica de negocio fuera de acá.
-- ============================================================================

-- Espejo de la normalización usada en src/qa/analyze-fieldbeat-engineer-identity.js
-- y en lib/fieldbeat-participants.ts (ver prueba de equivalencia SQL<->TS).
CREATE OR REPLACE FUNCTION quality.normalize_engineer_name(raw_name TEXT)
RETURNS TEXT LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(TRIM(regexp_replace(
    UPPER(translate(COALESCE(raw_name, ''),
      'áàäâãÁÀÄÂÃéèëêÉÈËÊíìïîÍÌÏÎóòöôõÓÒÖÔÕúùüûÚÙÜÛñÑçÇ',
      'aaaaaAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC')),
    '\s+', ' ', 'g')), '')
$$;

-- Cubre las 3 grafías reales confirmadas en el dataset: "OTRO (COMENTE)",
-- "OTROS (COMENTE)", "OTROS(COMENTE)".
CREATE OR REPLACE FUNCTION quality.is_otros_comente_token(token TEXT)
RETURNS BOOLEAN LANGUAGE SQL IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(UPPER(TRIM(token)) ~ '^OTROS?\s*\(\s*COMENTE\s*\)$', false)
$$;

-- Parsea "DD/MM/YYYY HH:mm" (formato real de HORA DE INICIO/TERMINO DEL
-- TRABAJO) interpretando el wall-clock como America/Santiago (zona IANA,
-- NUNCA un offset fijo - Chile ha cambiado sus reglas de horario de verano
-- varias veces históricamente; AT TIME ZONE con nombre de zona usa el
-- tzdata real de Postgres, que ya conoce esas reglas, sin necesidad de
-- codificarlas acá). STABLE (no IMMUTABLE): depende del tzdata del sistema,
-- que en teoría podría actualizarse entre versiones de Postgres.
-- Nunca lanza un error hacia el caller - un valor ausente/ambiguo/inválido
-- se resuelve a NULL (sin duración confiable), nunca tumba la query.
CREATE OR REPLACE FUNCTION quality.parse_fieldbeat_santiago_timestamp(raw_value TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  IF raw_value IS NULL OR btrim(raw_value) = '' THEN
    RETURN NULL;
  END IF;
  RETURN (to_timestamp(btrim(raw_value), 'DD/MM/YYYY HH24:MI')::timestamp) AT TIME ZONE 'America/Santiago';
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- ============================================================================
-- 1. Mapa de identidad de ingenieros - AUTO_EVIDENCED (nunca "verificado
--    manualmente" a menos que un humano lo revise después, ver columnas).
--    Sembrado por un análisis offline persistido y reproducible
--    (src/qa/analyze-fieldbeat-engineer-identity.js + su
--    .output.txt), NUNCA ejecutado en este bootstrap - las filas de abajo
--    son estáticas y revisables en este mismo diff.
-- ============================================================================
CREATE TABLE IF NOT EXISTS manual_review.fieldbeat_engineer_identity_map (
  id bigserial PRIMARY KEY,
  source_type text NOT NULL CHECK (source_type IN ('ASSIGNED_TO_USERNAME','SIGNATURE_NAME','ADDITIONAL_FIELD_TOKEN')),
  source_value_normalized text NOT NULL,
  canonical_person_key text NOT NULL,
  canonical_display_name text NOT NULL,
  verification_method text NOT NULL CHECK (verification_method IN ('AUTO_EVIDENCED','MANUALLY_VERIFIED')),
  confidence text NOT NULL CHECK (confidence IN ('HIGH','MEDIUM')),
  reason text NOT NULL,
  evidence text,
  is_active boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  verified_by text,
  created_by text NOT NULL DEFAULT 'migration-088-evidence-seed',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_value_normalized)
);

-- ON CONFLICT DO NOTHING: reaplicar esta migración NUNCA sobrescribe una
-- fila que un humano haya corregido después de la siembra inicial (ej.
-- cambiando canonical_display_name y poniendo verification_method a
-- 'MANUALLY_VERIFIED' + verified_at). Evidencia real (conteos exactos, no
-- aproximados) de src/qa/analyze-fieldbeat-engineer-identity.output.txt,
-- snapshot data/raw/fieldbeat/all_tasks_latest.json extracted_at=2026-07-01T16:07:21.256Z.
INSERT INTO manual_review.fieldbeat_engineer_identity_map
  (source_type, source_value_normalized, canonical_person_key, canonical_display_name, verification_method, confidence, reason, evidence, created_by)
VALUES
  ('ASSIGNED_TO_USERNAME', 'acorbea', 'acorbea', 'ALEJANDRO CORBEA', 'AUTO_EVIDENCED', 'HIGH', '369/384 ocurrencias de sign.worker.name normalizan (primeros 2 tokens: nombre + primer apellido) a este nombre; coincide con el roster de NOMBRE DEL INGENIERO ADICIONAL', 'ALEJANDRO CORBEA=307, ALEJANDRO CORBEA SILVESTRE=62, NOMBRE TRABAJADOR=4, otros=11', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'adiaz', 'adiaz', 'ANDREE DIAZ', 'AUTO_EVIDENCED', 'HIGH', '51/89 ocurrencias de sign.worker.name normalizan (primeros 2 tokens) a este nombre; coincide con el roster', 'ANDREE DIAZ=51, ANDREE DIAZ.=28, otros=10', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'aecheverria', 'aecheverria', 'ALEXIS ECHEVERRIA', 'AUTO_EVIDENCED', 'HIGH', '164/165 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'ALEXIS ECHEVERRIA=164, ALEXI ECHEVERRIA=1', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'ccarrasquel', 'ccarrasquel', 'CARLOS CARRASQUEL', 'AUTO_EVIDENCED', 'HIGH', '449/454 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'CARLOS CARRASQUEL=449, otros=5', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'ebecker', 'ebecker', 'EDUARDO BECKER', 'AUTO_EVIDENCED', 'HIGH', '213/216 ocurrencias de sign.worker.name normalizan (primeros 2 tokens) a este nombre; coincide con el roster', 'EDUARDO BECKER TRONCOSO=208, EDUARDO BECKER T=2, otros=6', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'glopez', 'glopez', 'GONZALO LOPEZ', 'AUTO_EVIDENCED', 'HIGH', '68/71 ocurrencias de sign.worker.name normalizan (primeros 2 tokens) a este nombre; coincide con el roster', 'GONZALO LOPEZ=24, GONZALO LOPEZ CORDERO=22, GONZALO LOPEZ C=18, otros=7', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'jacuna', 'jacuna', 'JORGE ACUÑA', 'AUTO_EVIDENCED', 'HIGH', '2/3 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'JORGE ACUNA=2, RIXY PLATA=1', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'jbustamante', 'jbustamante', 'JAIME BUSTAMANTE', 'AUTO_EVIDENCED', 'HIGH', '50/50 ocurrencias de sign.worker.name normalizan (primeros 2 tokens) a este nombre; coincide con el roster', 'JAIME BUSTAMANTE P=41, JAIME BUSTAMANTE P.=8, JAIME BUSTAMANTE=1', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'jecheverria', 'jecheverria', 'JOSE ECHEVERRIA', 'AUTO_EVIDENCED', 'HIGH', '370/372 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'JOSE ECHEVERRIA=370, JECHEVERRIA=1, MANUEL REYES=1', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'mabreu', 'mabreu', 'MAURICIO ABREU', 'AUTO_EVIDENCED', 'HIGH', '211/219 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'MAURICIO ABREU=211, otros=8', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'mcaballero', 'mcaballero', 'MANUEL CABALLERO', 'AUTO_EVIDENCED', 'HIGH', '1/1 ocurrencias de sign.worker.name normalizan (primeros 2 tokens) a este nombre; coincide con el roster', 'MANUEL CABALLERO PARDO=1', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'mreyes', 'mreyes', 'MANUEL REYES', 'AUTO_EVIDENCED', 'HIGH', '232/236 ocurrencias de sign.worker.name normalizan (primeros 2 tokens: nombre + primer apellido) a este nombre; coincide con el roster. "I"/"Irrazaval" es un segundo apellido abreviado, no una persona distinta (confirmado: "Manuel Reyes Irrazaval" aparece explícito 16 veces)', 'MANUEL REYES I=110, MANUEL REYES=101, MANUEL REYES IRRAZAVAL=16, MANUEL REYES I.=5, otros=4', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'rcammalleri', 'rcammalleri', 'RUBEN CAMMALLERI', 'AUTO_EVIDENCED', 'HIGH', '240/247 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'RUBEN CAMMALLERI=240, otros=7', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'rguapache', 'rguapache', 'RAFAEL GUAPACHE', 'AUTO_EVIDENCED', 'HIGH', '388/391 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'RAFAEL GUAPACHE=388, otros=3', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'scarcamo', 'scarcamo', 'SEBASTIAN CARCAMO', 'AUTO_EVIDENCED', 'HIGH', '99/134 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'SEBASTIAN CARCAMO=99, SC=16, otros=19', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'ssalice', 'ssalice', 'SEBASTIAN SALICE', 'AUTO_EVIDENCED', 'HIGH', '95/95 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'SEBASTIAN SALICE=95', 'migration-088-evidence-seed'),
  ('ASSIGNED_TO_USERNAME', 'varenas', 'varenas', 'VICTOR ARENAS', 'AUTO_EVIDENCED', 'HIGH', '50/51 ocurrencias de sign.worker.name normalizan a este nombre; coincide con el roster', 'VICTOR ARENAS=50, HERNAN BARRIGA=1', 'migration-088-evidence-seed')
ON CONFLICT (source_type, source_value_normalized) DO NOTHING;

-- Nunca se generó mapping para 'raguila' (top candidato "ING. ROBERTO",
-- prefijo de título profesional pegado al nombre - no calza con el roster
-- "ROBERTO AGUILA", ambigüedad no resuelta automáticamente) ni 'rsaez'
-- (1 sola firma, evidencia insuficiente) - quedan sin mapping a propósito,
-- ver src/qa/analyze-fieldbeat-engineer-identity.output.txt.

-- ============================================================================
-- 2. Roster de ingenieros - unión de TODOS los possible_values históricos
--    del campo "NOMBRE DEL INGENIERO ADICIONAL" (el dropdown creció de ~9 a
--    16 nombres con el tiempo - una vista sobre solo el snapshot más
--    reciente clasificaría mal selecciones válidas de reportes antiguos).
-- ============================================================================
-- HOTFIX de integridad de datos FieldBeat - separador CORREGIDO: verificado
-- contra las 3773 filas reales de este campo en processed.fieldbeat_report_fields
-- (16 valores distintos de possible_values, 0 contienen '|') que
-- possible_values SIEMPRE usa coma, igual que field_value (ver
-- fieldbeat_report_additional_field_tokens más abajo y
-- src/qa/analyze-fieldbeat-engineer-identity.js, que ya usaba coma
-- correctamente) - la versión anterior de esta vista usaba '\|' por error,
-- lo que hacía que CADA possible_values completo (una sola cadena larga,
-- nunca partida) normalizara a un único "nombre" nunca coincidente con
-- ningún candidato real, clasificando casi TODAS las selecciones
-- estructuradas como UNRESOLVED_UNKNOWN_TOKEN en vez de RESOLVED_ROSTER_MATCH
-- (defecto real encontrado al reprocesar el universo completo de 3747
-- reportes, nunca visible con el fixture propio del test porque ese fixture
-- también usaba '|' por error, replicando el mismo bug en vez de los datos reales).
CREATE OR REPLACE VIEW quality.fieldbeat_engineer_roster AS
SELECT DISTINCT quality.normalize_engineer_name(token) AS normalized_name
FROM processed.fieldbeat_report_fields,
LATERAL regexp_split_to_table(possible_values, ',') AS token
WHERE field_name = 'NOMBRE DEL INGENIERO ADICIONAL'
  AND NOT quality.is_otros_comente_token(token)
  AND quality.normalize_engineer_name(token) <> '';

-- ============================================================================
-- 3. Tokens del campo de ingeniero adicional - 1 fila por selección (valor
--    separado por coma, único separador real confirmado en el dataset) más
--    el comentario libre asociado cuando existe.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_additional_field_tokens AS
SELECT
  rf.fieldbeat_task_id,
  rf.report_field_id,
  rf.field_name AS source_field,
  btrim(token) AS raw_token,
  quality.normalize_engineer_name(token) AS normalized_token,
  quality.is_otros_comente_token(token) AS is_otros_marker,
  rf.field_comment
FROM processed.fieldbeat_report_fields rf,
LATERAL regexp_split_to_table(rf.field_value, ',') AS token
WHERE rf.field_name = 'NOMBRE DEL INGENIERO ADICIONAL'
  AND rf.field_value IS NOT NULL
  AND btrim(rf.field_value) <> ''
  AND btrim(token) <> '';

-- ============================================================================
-- 4. Participantes 0..N por reporte. Grano: 1 fila por (reporte, persona
--    resuelta-o-no-resuelta). El responsable principal NUNCA se duplica
--    como adicional (deduplicación por nombre normalizado, DESPUÉS de
--    resolver identidad vía el mapa - nunca antes).
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_participants AS
WITH primary_assignee AS (
  SELECT
    t.fieldbeat_task_id,
    t.assigned_to AS raw_name,
    eim.canonical_display_name,
    eim.verification_method,
    COALESCE(
      quality.normalize_engineer_name(eim.canonical_display_name),
      quality.normalize_engineer_name(t.assigned_to)
    ) AS resolved_normalized_name
  FROM processed.fieldbeat_tasks t
  LEFT JOIN manual_review.fieldbeat_engineer_identity_map eim
    ON eim.source_type = 'ASSIGNED_TO_USERNAME'
   AND eim.source_value_normalized = t.assigned_to
   AND eim.is_active
  WHERE t.assigned_to IS NOT NULL AND btrim(t.assigned_to) <> ''
),
structured_candidates AS (
  SELECT DISTINCT fieldbeat_task_id, raw_token AS raw_name, normalized_token AS normalized_name, source_field
  FROM quality.fieldbeat_report_additional_field_tokens
  WHERE NOT is_otros_marker
),
free_text_candidates AS (
  SELECT DISTINCT fieldbeat_task_id, btrim(field_comment) AS raw_name, quality.normalize_engineer_name(field_comment) AS normalized_name, source_field
  FROM quality.fieldbeat_report_additional_field_tokens
  WHERE is_otros_marker AND field_comment IS NOT NULL AND btrim(field_comment) <> ''
)
SELECT
  pa.fieldbeat_task_id,
  pa.raw_name,
  pa.resolved_normalized_name AS normalized_name,
  'PRIMARY_ASSIGNEE'::text AS role,
  'assigned_to'::text AS source_field,
  'TASK_ASSIGNED_TO'::text AS source_type,
  -- Evidencia automática != verificación manual (§ mapa de identidad): un
  -- humano que confirma manual_review.fieldbeat_engineer_identity_map
  -- (verification_method='MANUALLY_VERIFIED') se distingue explícitamente
  -- de una fila solo AUTO_EVIDENCED (o sin mapping en absoluto, que sigue
  -- resolviendo por el username crudo) - nunca la misma etiqueta para
  -- ambos casos.
  CASE WHEN pa.verification_method = 'MANUALLY_VERIFIED' THEN 'RESOLVED_CURATED_IDENTITY' ELSE 'RESOLVED_ASSIGNED_TO' END::text AS resolution_status,
  true AS is_primary
FROM primary_assignee pa

UNION ALL

SELECT
  sc.fieldbeat_task_id,
  sc.raw_name,
  sc.normalized_name,
  CASE WHEN r.normalized_name IS NOT NULL THEN 'ADDITIONAL_STRUCTURED' ELSE 'UNRESOLVED_ADDITIONAL' END,
  sc.source_field,
  'REPORT_FIELD_STRUCTURED_VALUE',
  CASE WHEN r.normalized_name IS NOT NULL THEN 'RESOLVED_ROSTER_MATCH' ELSE 'UNRESOLVED_UNKNOWN_TOKEN' END,
  false
FROM structured_candidates sc
LEFT JOIN quality.fieldbeat_engineer_roster r ON r.normalized_name = sc.normalized_name
LEFT JOIN primary_assignee pa
  ON pa.fieldbeat_task_id = sc.fieldbeat_task_id
 AND pa.resolved_normalized_name = sc.normalized_name
WHERE pa.fieldbeat_task_id IS NULL -- suprime: ya es el principal, evidencia de redundancia se pierde a propósito de simplicidad (ver nota abajo)

UNION ALL

SELECT
  ftc.fieldbeat_task_id,
  ftc.raw_name,
  ftc.normalized_name,
  'ADDITIONAL_FREE_TEXT',
  ftc.source_field,
  'REPORT_FIELD_FREE_TEXT_COMMENT',
  CASE WHEN r.normalized_name IS NOT NULL THEN 'RESOLVED_ROSTER_MATCH' ELSE 'UNRESOLVED_FREE_TEXT' END,
  false
FROM free_text_candidates ftc
LEFT JOIN quality.fieldbeat_engineer_roster r ON r.normalized_name = ftc.normalized_name
LEFT JOIN primary_assignee pa
  ON pa.fieldbeat_task_id = ftc.fieldbeat_task_id
 AND pa.resolved_normalized_name = ftc.normalized_name
WHERE pa.fieldbeat_task_id IS NULL;

-- ============================================================================
-- 5. Resumen laboral por reporte - duración REAL (declarada o transición
--    validada) SEPARADA de la estimación de agenda. Nunca rellena
--    total_labor_minutes multiplicando una estimación cuando no hay
--    duración real confiable.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_labor_summary AS
WITH declared_interval AS (
  SELECT
    t.fieldbeat_task_id,
    quality.parse_fieldbeat_santiago_timestamp(sf.field_value) AS declared_start,
    quality.parse_fieldbeat_santiago_timestamp(ef.field_value) AS declared_end
  FROM processed.fieldbeat_tasks t
  LEFT JOIN processed.fieldbeat_report_fields sf
    ON sf.fieldbeat_task_id = t.fieldbeat_task_id AND sf.field_name = 'HORA DE INICIO DEL TRABAJO'
  LEFT JOIN processed.fieldbeat_report_fields ef
    ON ef.fieldbeat_task_id = t.fieldbeat_task_id AND ef.field_name = 'HORA DE TERMINO DEL TRABAJO'
),
declared_minutes AS (
  SELECT
    fieldbeat_task_id,
    CASE
      WHEN declared_start IS NOT NULL AND declared_end IS NOT NULL
        AND declared_end > declared_start
        -- Máximo razonable: 1200 min (20h) - cubre turnos largos inusuales,
        -- rechaza intervalos de varios DÍAS (confirmado real en el
        -- dataset, ej. una tarea con intervalo declarado que abarca desde
        -- el 25/01 hasta el 03/02 - claramente no es una sesión de trabajo
        -- única, nunca se usa como duración real).
        AND EXTRACT(EPOCH FROM (declared_end - declared_start)) / 60 <= 1200
      THEN EXTRACT(EPOCH FROM (declared_end - declared_start)) / 60
      ELSE NULL
    END AS minutes
  FROM declared_interval
),
resolved_duration AS (
  SELECT
    t.fieldbeat_task_id,
    t.duration_minutes AS scheduled_estimate_minutes,
    dm.minutes AS actual_report_duration_minutes,
    CASE WHEN dm.minutes IS NOT NULL THEN 'FORM_DECLARED_INTERVAL' ELSE 'UNAVAILABLE' END AS actual_duration_source
  FROM processed.fieldbeat_tasks t
  LEFT JOIN declared_minutes dm ON dm.fieldbeat_task_id = t.fieldbeat_task_id
),
participant_counts AS (
  SELECT fieldbeat_task_id, count(*) AS participant_count
  FROM quality.fieldbeat_report_participants
  GROUP BY fieldbeat_task_id
)
SELECT
  rd.fieldbeat_task_id,
  rd.actual_report_duration_minutes,
  rd.actual_duration_source,
  rd.scheduled_estimate_minutes,
  COALESCE(pc.participant_count, 0) AS participant_count,
  CASE
    WHEN rd.actual_report_duration_minutes IS NULL THEN NULL
    ELSE rd.actual_report_duration_minutes * COALESCE(pc.participant_count, 0)
  END AS total_labor_minutes,
  false AS individual_time_available -- FieldBeat nunca capta fichaje individual por participante hoy
FROM resolved_duration rd
LEFT JOIN participant_counts pc ON pc.fieldbeat_task_id = rd.fieldbeat_task_id;

-- ============================================================================
-- 6. Ocurrencia canónica de repuesto - fuente ÚNICA compartida por FieldBeat,
--    Búsqueda, PDF y exportación CSV. 1 fila por used_part_id (1:1 con
--    processed.fieldbeat_used_parts) - la existencia de una fila YA implica
--    declaration_status='DECLARED_IN_REPORT'; no existe (ni se materializa
--    acá) una fila NOT_DECLARED_IN_REPORT - ese estado vive solo en el tipo
--    TypeScript, documentado como rama no alcanzable hoy.
-- ============================================================================
CREATE OR REPLACE VIEW quality.fieldbeat_report_part_occurrences AS
SELECT
  m.used_part_id,
  m.fieldbeat_task_id,
  m.part_name,
  m.raw_part_identifier,
  m.normalized_part_identifier,
  p.quantity,
  p.origin_location,
  p.origin_comment,
  p.photo_ref,
  'DECLARED_IN_REPORT'::text AS declaration_status,
  hpm.historical_match_status AS catalog_match_status,
  COALESCE(m.dolibarr_product_id, hpm.alias_resolved_dolibarr_product_id) AS matched_product_id,
  dp.ref AS matched_sku,
  dp.label AS matched_label,
  dp.barcode AS matched_barcode,
  m.candidate_dolibarr_product_ids,
  m.match_method,
  alias.alias_value,
  alias.reason AS alias_reason,
  alias.created_by AS alias_created_by
FROM marts.used_parts_dolibarr_match m
LEFT JOIN processed.fieldbeat_used_parts p ON p.used_part_id = m.used_part_id
LEFT JOIN quality.fieldbeat_used_part_match hpm ON hpm.used_part_id = m.used_part_id
LEFT JOIN processed.dolibarr_products dp ON dp.dolibarr_product_id = COALESCE(m.dolibarr_product_id, hpm.alias_resolved_dolibarr_product_id)
LEFT JOIN LATERAL (
  SELECT pa.alias_value, pa.reason, pa.created_by
  FROM manual_review.part_aliases pa
  WHERE pa.active = true AND (
    (pa.alias_type = 'RAW' AND lower(pa.alias_value) = lower(coalesce(m.raw_part_identifier, ''))) OR
    (pa.alias_type = 'NORMALIZED' AND lower(pa.alias_value) = lower(coalesce(m.normalized_part_identifier, '')))
  )
  LIMIT 1
) alias ON true;
