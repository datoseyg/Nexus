-- Auditoría escribible / Explorador de negocio - Gate B, Fase 2 (funciones).
-- Funciones SECURITY DEFINER: ejecutor de reglas (staging + publicación),
-- outbox de verificación con fencing token, primer comando de corrección
-- (alias de repuesto) y logger de intentos fallidos.
--
-- Convenciones (B14, ya corregidas): owner dedicado `governance_owner`
-- (NOLOGIN); search_path fijo sin `public`; REVOKE EXECUTE FROM PUBLIC +
-- GRANT explícito y mínimo por función; argumentos de actor son metadata
-- auditada, nunca autorización (la autorización real es el rol de conexión
-- + el GRANT EXECUTE); ninguna función acepta nombre de tabla/columna desde
-- el caller. Aditivo, sin DROP - CREATE OR REPLACE en todo.

-- =============================================================================
-- Helpers privados (prefijo _, nunca EXECUTE otorgado a roles de app)
-- =============================================================================

CREATE OR REPLACE FUNCTION governance._fingerprint(p_entity_key text, p_entity_type text, p_occurrence_key text, p_rule_code text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog
AS $$
  -- pgcrypto (digest()) vive en el schema `extensions` (Supabase la instala
  -- ahí por defecto; sql/000_roles_and_schemas.sql la coloca ahí también en
  -- cualquier otro Postgres) - se califica explícitamente en vez de agregar
  -- `extensions`/`public` al search_path, consistente con B73 (nunca
  -- resolver por búsqueda implícita).
  SELECT encode(extensions.digest(
    format('{"entityKey":"%s","entityType":"%s","occurrenceKey":"%s","ruleCode":"%s"}',
      p_entity_key, p_entity_type, p_occurrence_key, p_rule_code),
    'sha256'), 'hex');
$$;

-- Evalúa una regla activa hacia staging (rule_evaluation_detections +
-- rule_evaluation_coverage). Dispatch explícito por evaluator_key - nunca
-- SQL dinámico ni nombre de vista suministrado en runtime (B30).
CREATE OR REPLACE FUNCTION governance._evaluate_rule_into_staging(
  p_run_id uuid, p_rule_code text, p_rule_version integer, p_evaluator_key text,
  p_scope_entity_key text, p_scope_occurrence_key text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance, marts, quality, processed
AS $$
BEGIN
  -- Los 3 evaluadores de repuestos leen quality.fieldbeat_used_part_match
  -- (historical_match_status), NUNCA marts.used_parts_dolibarr_match.match_status
  -- directo - ese mart es estático y no refleja un alias recién creado; la
  -- vista quality.* SÍ aplica manual_review.part_aliases en vivo vía
  -- LEFT JOIN LATERAL (hotfix FieldBeat, confirmado). Esta es exactamente la
  -- corrección de Gate A Riesgo 1 / Sección 7.9 - sin esto, una corrección de
  -- alias nunca podría pasar a VERIFICATION_PASSED. Los campos descriptivos
  -- (raw/normalized identifier, dolibarr_ref) sí se toman del mart, solo para
  -- evidencia legible - la DETECCIÓN depende únicamente de la vista quality.
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

  ELSIF p_evaluator_key = 'PART_PLACEHOLDER_VALUE_V1' THEN
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
    -- Predicado exacto de /api/audit/summary (gold.fieldbeat_data_quality,
    -- reportsReviewRequired=1329): 'OK' y 'NO_USED_PARTS' NO cuentan como
    -- degradados (NO_USED_PARTS = nada que revisar, no un problema) - solo
    -- los otros 4 estados. Confirmado por conteo exacto contra el mart real
    -- (696+460+117+56=1329) antes de fijar este predicado.
    WHERE v.report_quality_status IN ('HAS_PLACEHOLDERS','HAS_UNMATCHED_PARTS','REVIEW_REQUIRED','HAS_AMBIGUOUS_PARTS')
      AND (p_scope_entity_key IS NULL OR v.fieldbeat_task_id::text = p_scope_entity_key)
    ON CONFLICT (evaluation_run_id, fingerprint) DO NOTHING;

  ELSIF p_evaluator_key = 'TICKET_LINK_RESTRICTED_OR_MISSING_V1' THEN
    INSERT INTO governance.rule_evaluation_coverage (evaluation_run_id, rule_code, rule_version, entity_type, entity_key, occurrence_key, coverage_key)
    SELECT p_run_id, p_rule_code, p_rule_version, 'ticket_link', v.fieldbeat_task_id::text, v.fieldbeat_task_id::text,
      jsonb_build_object('entityType','ticket_link','entityKey',v.fieldbeat_task_id::text,'occurrenceKey',v.fieldbeat_task_id::text)
    FROM marts.fieldbeat_report_dolibarr_operational_view v
    WHERE (p_scope_entity_key IS NULL OR v.fieldbeat_task_id::text = p_scope_entity_key);

    -- Lee quality.fieldbeat_ticket_linkage.effective_zendesk_join_status
    -- (sql/086), NUNCA v.zendesk_join_status directo - ese mart es estático y
    -- no refleja manual_review.ticket_link_overrides recién escrito, mismo
    -- Riesgo 1 de Gate A ya corregido para los 3 evaluadores de repuestos.
    -- zendeskJoinStatus (evidencia) sigue mostrando el valor crudo del mart
    -- para trazabilidad, la DETECCIÓN depende únicamente de la vista quality.
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

-- Publica una corrida ya evaluada: UPSERT de issues/evidence, marca
-- desapariciones SOLO dentro de la cobertura evaluada (B51), emite eventos
-- materiales, actualiza estado de corrida - todo en la misma transacción
-- que la llamó (B52: nunca un paso separado posterior).
CREATE OR REPLACE FUNCTION governance._publish_rule_evaluation(p_run_id uuid, p_scope_mode text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_pub_state governance.evaluation_publication_state;
  v_run governance.rule_evaluation_runs;
  v_was_inserted boolean;
  v_disappeared_count integer := 0;
  v_detected_count integer := 0;
  v_row record;
  v_issue_id bigint;
  v_evidence_id bigint;
BEGIN
  SELECT * INTO v_run FROM governance.rule_evaluation_runs WHERE evaluation_run_id = p_run_id;

  SELECT * INTO v_pub_state FROM governance.evaluation_publication_state WHERE environment_key = 'default' FOR UPDATE;
  IF v_run.evaluation_generation <= v_pub_state.latest_published_generation THEN
    UPDATE governance.rule_evaluation_runs SET status='SUPERSEDED_NOT_PUBLISHED', finished_at=now() WHERE evaluation_run_id=p_run_id;
    RETURN;
  END IF;

  -- UPSERT de issues detectados en esta corrida
  FOR v_row IN SELECT * FROM governance.rule_evaluation_detections WHERE evaluation_run_id = p_run_id LOOP
    INSERT INTO governance.issues (fingerprint, rule_code, first_detected_rule_version, last_evaluated_rule_version,
      entity_type, entity_key, occurrence_key, severity, first_seen_at, last_seen_at, last_evaluated_at, is_currently_detected)
    SELECT v_row.fingerprint, v_row.rule_code, v_row.rule_version, v_row.rule_version,
      v_row.entity_type, v_row.entity_key, v_row.occurrence_key,
      (SELECT default_severity FROM governance.rule_definitions WHERE rule_code = v_row.rule_code AND rule_version = v_row.rule_version),
      now(), now(), now(), true
    ON CONFLICT (fingerprint) DO UPDATE SET
      last_seen_at = now(), last_evaluated_at = now(), last_evaluated_rule_version = v_row.rule_version,
      is_currently_detected = true, disappeared_at = NULL, updated_at = now()
    RETURNING id, (xmax = 0) INTO v_issue_id, v_was_inserted;
    -- was_inserted vía xmax=0 (fila recién insertada, nunca actualizada por
    -- el ON CONFLICT) - se usa solo para decidir si emitir ISSUE_DETECTED abajo.

    INSERT INTO governance.issue_evidence (issue_id, evaluation_run_id, evidence_type, rule_code, rule_version,
      source_object, source_record_key, rule_inputs, observed_values, evidence_hash, schema_version)
    VALUES (v_issue_id, p_run_id, 'RULE_DETECTION', v_row.rule_code, v_row.rule_version,
      'marts', jsonb_build_object('entityKey', v_row.entity_key, 'occurrenceKey', v_row.occurrence_key),
      v_row.evidence_payload, v_row.evidence_payload,
      -- B42: hash sobre el payload canónico completo, no solo observed_values.
      encode(extensions.digest(
        v_row.rule_code || '|' || v_row.rule_version || '|' || v_row.entity_key || '|' || v_row.occurrence_key || '|' || v_row.evidence_payload::text,
        'sha256'), 'hex'),
      '1.0.0')
    RETURNING id INTO v_evidence_id;

    IF v_was_inserted THEN
      INSERT INTO governance.command_events (correlation_id, event_type, issue_id, actor_type, service_actor_key, after_state, evidence_id)
      VALUES (gen_random_uuid(), 'ISSUE_DETECTED', v_issue_id, 'SERVICE', 'nexus_rule_evaluator',
        jsonb_build_object('status','OPEN','fingerprint', v_row.fingerprint), v_evidence_id);
      v_detected_count := v_detected_count + 1;
    END IF;
  END LOOP;

  -- Marcar desapariciones SOLO dentro de la cobertura de esta corrida (B51).
  -- También registra evidencia CORRECTION_VERIFICATION por cada desaparición:
  -- sin esto, resolution_evidence_id quedaría NULL y violaría el CHECK
  -- lifecycle_resolved (B60) en cuanto fn_complete_verification_request
  -- intente marcar el issue RESOLVED - la verificación necesita su propia
  -- evidencia real (que la cobertura fue evaluada y ya no hay detección),
  -- nunca reutilizar la evidencia de detección original (que describe el
  -- problema, no su ausencia).
  FOR v_row IN
    SELECT i.id AS issue_id, i.rule_code, i.entity_type, i.entity_key, i.occurrence_key, c.rule_version, c.coverage_key
    FROM governance.issues i
    JOIN governance.rule_evaluation_coverage c ON c.evaluation_run_id = p_run_id
      AND i.rule_code = c.rule_code AND i.entity_type = c.entity_type AND i.entity_key = c.entity_key
      AND i.occurrence_key IS NOT DISTINCT FROM c.occurrence_key
    WHERE i.is_currently_detected = true
      AND NOT EXISTS (
        SELECT 1 FROM governance.rule_evaluation_detections d
        WHERE d.evaluation_run_id = p_run_id AND d.rule_code = i.rule_code AND d.entity_key = i.entity_key AND d.occurrence_key = i.occurrence_key
      )
  LOOP
    UPDATE governance.issues SET is_currently_detected = false, disappeared_at = now(), last_evaluated_at = now(),
      last_evaluated_rule_version = v_row.rule_version, updated_at = now()
      WHERE id = v_row.issue_id;

    INSERT INTO governance.issue_evidence (issue_id, evaluation_run_id, evidence_type, rule_code, rule_version,
      source_object, source_record_key, rule_inputs, observed_values, evidence_hash, schema_version)
    VALUES (v_row.issue_id, p_run_id, 'CORRECTION_VERIFICATION', v_row.rule_code, v_row.rule_version,
      'governance.rule_evaluation_coverage', v_row.coverage_key,
      jsonb_build_object('coverageKey', v_row.coverage_key),
      jsonb_build_object('stillDetected', false),
      encode(extensions.digest(
        v_row.rule_code || '|' || v_row.rule_version || '|' || v_row.entity_key || '|' || coalesce(v_row.occurrence_key,'') || '|verification-not-detected|' || p_run_id::text,
        'sha256'), 'hex'),
      '1.0.0')
    RETURNING id INTO v_evidence_id;

    v_disappeared_count := v_disappeared_count + 1;
  END LOOP;

  UPDATE governance.evaluation_publication_state
    SET latest_published_generation = v_run.evaluation_generation, latest_published_run_id = p_run_id, updated_at = now()
    WHERE environment_key = 'default';

  UPDATE governance.rule_evaluation_runs SET
    status = 'SUCCEEDED', finished_at = now(), published_at = now(), publication_generation = v_run.evaluation_generation,
    issues_new = v_detected_count, issues_disappeared = v_disappeared_count
  WHERE evaluation_run_id = p_run_id;
END;
$$;

CREATE OR REPLACE FUNCTION governance.fn_run_rule_evaluation(
  p_scope_mode text,
  p_scope_rule_code text DEFAULT NULL,
  p_scope_entity_key text DEFAULT NULL,
  p_scope_occurrence_key text DEFAULT NULL,
  p_triggered_by text DEFAULT 'MANUAL_ADMIN'
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_run_id uuid;
  v_rule record;
  v_rule_set_version text;
  v_lock_key bigint := hashtext('governance.rule_evaluator.global');
  v_any_failed boolean := false;
BEGIN
  IF p_scope_mode NOT IN ('FULL','SCOPED') THEN
    RAISE EXCEPTION 'scope_mode no soportado en esta versión: % (INCREMENTAL diferido a la fase de data-refresh)', p_scope_mode;
  END IF;
  IF p_scope_mode = 'SCOPED' AND p_scope_rule_code IS NULL THEN
    RAISE EXCEPTION 'SCOPED requiere p_scope_rule_code';
  END IF;

  -- Lock exclusivo global durante toda la evaluación+publicación (B37/B50 v1 simplificado).
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT string_agg(rule_code || ':' || active_rule_version, ',' ORDER BY rule_code)
    INTO v_rule_set_version FROM governance.rule_registry WHERE is_active;

  INSERT INTO governance.rule_evaluation_runs (rule_set_version, scope_mode, scope_rule_code, scope_entity_type, scope_entity_key, scope_occurrence_key, triggered_by)
  VALUES (coalesce(v_rule_set_version, ''), p_scope_mode, p_scope_rule_code, NULL, p_scope_entity_key, p_scope_occurrence_key, p_triggered_by)
  RETURNING evaluation_run_id INTO v_run_id;

  FOR v_rule IN
    SELECT rd.rule_code, rd.rule_version, rd.evaluator_key
    FROM governance.rule_registry rr
    JOIN governance.rule_definitions rd ON rd.rule_code = rr.rule_code AND rd.rule_version = rr.active_rule_version
    WHERE rr.is_active AND (p_scope_mode = 'FULL' OR rr.rule_code = p_scope_rule_code)
  LOOP
    INSERT INTO governance.rule_evaluation_run_items (evaluation_run_id, rule_code, rule_version, status, started_at)
    VALUES (v_run_id, v_rule.rule_code, v_rule.rule_version, 'RUNNING', now());

    BEGIN
      PERFORM governance._evaluate_rule_into_staging(v_run_id, v_rule.rule_code, v_rule.rule_version, v_rule.evaluator_key, p_scope_entity_key, p_scope_occurrence_key);
      UPDATE governance.rule_evaluation_run_items SET status='SUCCEEDED', finished_at=now(),
        detections_count = (SELECT count(*) FROM governance.rule_evaluation_detections WHERE evaluation_run_id=v_run_id AND rule_code=v_rule.rule_code)
      WHERE evaluation_run_id=v_run_id AND rule_code=v_rule.rule_code AND rule_version=v_rule.rule_version;
    EXCEPTION WHEN OTHERS THEN
      UPDATE governance.rule_evaluation_run_items SET status='FAILED', finished_at=now(), error_message=SQLERRM
      WHERE evaluation_run_id=v_run_id AND rule_code=v_rule.rule_code AND rule_version=v_rule.rule_version;
      v_any_failed := true;
    END;
  END LOOP;

  IF v_any_failed THEN
    UPDATE governance.rule_evaluation_runs SET status='PARTIAL_FAILED_NOT_PUBLISHED', finished_at=now() WHERE evaluation_run_id=v_run_id;
    RETURN v_run_id;
  END IF;

  PERFORM governance._publish_rule_evaluation(v_run_id, p_scope_mode);
  RETURN v_run_id;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_run_rule_evaluation(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_run_rule_evaluation(text, text, text, text, text) TO nexus_rule_evaluator;

-- =============================================================================
-- Comando de corrección: alias de repuesto (primer vertical slice)
-- =============================================================================

CREATE OR REPLACE FUNCTION governance.fn_apply_part_alias(
  p_actor_user_id uuid,
  p_actor_role text,          -- metadata auditada, NO autoriza (B34)
  p_alias_value text,
  p_alias_type text,
  p_dolibarr_product_id bigint,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance, manual_review
AS $$
DECLARE
  v_target_type text := 'PART_ALIAS';
  v_target_key jsonb := jsonb_build_object('aliasType', p_alias_type, 'aliasValue', p_alias_value);
  v_request_payload jsonb := jsonb_build_object(
    'commandType', 'correction:part-alias', 'aliasValue', p_alias_value, 'aliasType', p_alias_type,
    'dolibarrProductId', p_dolibarr_product_id, 'expectedVersion', p_expected_version, 'reason', p_reason
  );
  v_existing_idem governance.idempotency_keys;
  v_current_version integer;
  v_current_correction_id bigint;
  v_alias_id bigint;
  v_correction_version_id bigint;
  v_issue_id bigint;
  v_verification_request_id bigint;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_alias_type NOT IN ('RAW','NORMALIZED') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: alias_type inválido' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotencia: request_payload es la única fuente autoritativa (B57), nunca body_hash.
  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'correction:part-alias' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- Lock por target: crea el target si no existe (ON CONFLICT DO NOTHING) y
  -- luego SELECT ... FOR UPDATE - un FOR UPDATE solo no basta cuando la fila
  -- todavía no existe (B71).
  INSERT INTO governance.correction_targets (target_type, target_key, current_version)
    VALUES (v_target_type, v_target_key, 0) ON CONFLICT (target_type, target_key) DO NOTHING;
  SELECT current_version, current_correction_version_id INTO v_current_version, v_current_correction_id
    FROM governance.correction_targets WHERE target_type = v_target_type AND target_key = v_target_key FOR UPDATE;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_current_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_current_version USING ERRCODE = 'P0002';
  END IF;

  -- Escritura efectiva (fila vigente, sin cambiar su forma actual - B5/B40).
  INSERT INTO manual_review.part_aliases (alias_value, alias_type, dolibarr_product_id, reason, created_by, active)
    VALUES (p_alias_value, p_alias_type, p_dolibarr_product_id, p_reason, coalesce(p_actor_user_id::text, 'unknown'), true)
    ON CONFLICT (alias_value, alias_type) DO UPDATE SET
      dolibarr_product_id = EXCLUDED.dolibarr_product_id, reason = EXCLUDED.reason, updated_at = now(), active = true
    RETURNING id INTO v_alias_id;

  INSERT INTO governance.correction_versions (correction_type, target_type, target_key, version, payload,
    actor_type, actor_user_id, reason, correlation_id)
    VALUES ('part-alias', v_target_type, v_target_key, v_current_version + 1,
      jsonb_build_object('partAliasId', v_alias_id, 'aliasValue', p_alias_value, 'aliasType', p_alias_type, 'dolibarrProductId', p_dolibarr_product_id),
      'HUMAN', p_actor_user_id, p_reason, p_correlation_id)
    RETURNING id INTO v_correction_version_id;

  UPDATE governance.correction_targets SET current_version = v_current_version + 1, current_correction_version_id = v_correction_version_id
    WHERE target_type = v_target_type AND target_key = v_target_key;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'CORRECTION_APPLIED', 'correction:part-alias', 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('correctionVersionId', v_correction_version_id, 'partAliasId', v_alias_id));

  -- Verification request: cancelar activas previas para el mismo target de
  -- regla (B80/B89 - orden implementable: cancelar -> insertar -> actualizar)
  -- + crear una nueva por cada issue PART_NO_MATCH/AMBIGUOUS de este código.
  FOR v_issue_id IN
    SELECT i.id FROM governance.issues i
    WHERE i.rule_code IN ('PART_NO_MATCH','PART_AMBIGUOUS_MATCH')
      AND i.occurrence_key IN (
        SELECT used_part_id FROM marts.used_parts_dolibarr_match
        WHERE upper(btrim(coalesce(normalized_part_identifier, raw_part_identifier))) = upper(btrim(p_alias_value))
      )
      AND i.status IN ('OPEN','IN_REVIEW')
  LOOP
    UPDATE governance.verification_requests SET processing_status='CANCELLED', superseded_at=now(), cancellation_reason='MANUAL_CANCEL'
      WHERE issue_id = v_issue_id AND processing_status IN ('PENDING','RUNNING');

    INSERT INTO governance.verification_requests (issue_id, correlation_id, correction_version_id, expected_correction_version_id,
      rule_code, entity_type, entity_key, occurrence_key)
    SELECT v_issue_id, p_correlation_id, v_correction_version_id, v_correction_version_id, i.rule_code, i.entity_type, i.entity_key, i.occurrence_key
    FROM governance.issues i WHERE i.id = v_issue_id
    RETURNING id INTO v_verification_request_id;

    UPDATE governance.issues SET status = 'IN_REVIEW', updated_at = now() WHERE id = v_issue_id AND status = 'OPEN';
  END LOOP;

  v_result := jsonb_build_object(
    'commandId', p_correlation_id,
    'result', 'APPLIED',
    'target', jsonb_build_object('type', v_target_type, 'key', v_target_key),
    'correctionVersionId', v_correction_version_id,
    'verification', CASE WHEN v_verification_request_id IS NOT NULL THEN 'PENDING' ELSE 'NOT_APPLICABLE' END,
    'verificationRequestId', v_verification_request_id,
    'replay', false
  );

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'correction:part-alias', p_idempotency_key, v_request_payload,
      encode(extensions.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_apply_part_alias(uuid, text, text, text, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_apply_part_alias(uuid, text, text, text, bigint, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- Worker de verificación (outbox con lease + fencing token)
-- =============================================================================

CREATE OR REPLACE FUNCTION governance.fn_claim_verification_requests(p_service_key text, p_limit integer, p_lease_seconds integer DEFAULT 60)
RETURNS TABLE(request_id bigint, claim_token uuid, issue_id bigint, rule_code text, entity_type text, entity_key text, occurrence_key text, expected_correction_version_id bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_ids bigint[];
BEGIN
  SELECT array_agg(id) INTO v_ids FROM (
    SELECT id FROM governance.verification_requests
    WHERE (processing_status = 'PENDING' OR (processing_status = 'RUNNING' AND lease_expires_at < now()))
      AND next_attempt_at <= now()
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  ) s;

  IF v_ids IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE governance.verification_requests v SET
    claim_token = gen_random_uuid(),
    claim_generation = v.claim_generation + 1,
    attempt_count = v.attempt_count + 1,
    locked_by_service_key = p_service_key,
    lease_expires_at = now() + make_interval(secs => p_lease_seconds),
    heartbeat_at = now(),
    processing_status = 'RUNNING',
    started_at = coalesce(v.started_at, now())
  WHERE v.id = ANY(v_ids)
  RETURNING v.id, v.claim_token, v.issue_id, v.rule_code, v.entity_type, v.entity_key, v.occurrence_key, v.expected_correction_version_id;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_claim_verification_requests(text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_claim_verification_requests(text, integer, integer) TO nexus_rule_evaluator;

CREATE OR REPLACE FUNCTION governance.fn_heartbeat_verification_request(p_service_key text, p_request_id bigint, p_claim_token uuid, p_lease_seconds integer DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE v_updated integer;
BEGIN
  UPDATE governance.verification_requests SET heartbeat_at = now(), lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  WHERE id = p_request_id AND processing_status = 'RUNNING' AND claim_token = p_claim_token AND superseded_at IS NULL;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0; -- false => CLAIM_LOST
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_heartbeat_verification_request(text, bigint, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_heartbeat_verification_request(text, bigint, uuid, integer) TO nexus_rule_evaluator;

CREATE OR REPLACE FUNCTION governance.fn_reschedule_verification_request(p_service_key text, p_request_id bigint, p_claim_token uuid, p_error_code text, p_backoff_seconds integer DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE v_updated integer; v_req governance.verification_requests;
BEGIN
  SELECT * INTO v_req FROM governance.verification_requests
    WHERE id = p_request_id AND processing_status = 'RUNNING' AND claim_token = p_claim_token AND superseded_at IS NULL
    FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF v_req.attempt_count >= v_req.max_attempts THEN
    UPDATE governance.verification_requests SET processing_status = 'DEAD_LETTERED', verification_outcome = 'OPERATIONAL_ERROR',
      last_error_code = p_error_code, finished_at = now() WHERE id = p_request_id;
    INSERT INTO governance.command_events (correlation_id, event_type, issue_id, actor_type, service_actor_key, after_state)
      VALUES (v_req.correlation_id, 'VERIFICATION_DEAD_LETTERED', v_req.issue_id, 'SERVICE', p_service_key, jsonb_build_object('errorCode', p_error_code));
  ELSE
    UPDATE governance.verification_requests SET processing_status = 'PENDING', next_attempt_at = now() + make_interval(secs => p_backoff_seconds),
      last_error_code = p_error_code, claim_token = NULL, locked_by_service_key = NULL, lease_expires_at = NULL
    WHERE id = p_request_id;
    INSERT INTO governance.command_events (correlation_id, event_type, issue_id, actor_type, service_actor_key, after_state)
      VALUES (v_req.correlation_id, 'VERIFICATION_OPERATIONAL_ERROR', v_req.issue_id, 'SERVICE', p_service_key, jsonb_build_object('errorCode', p_error_code));
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_reschedule_verification_request(text, bigint, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_reschedule_verification_request(text, bigint, uuid, text, integer) TO nexus_rule_evaluator;

CREATE OR REPLACE FUNCTION governance.fn_dead_letter_verification_request(p_service_key text, p_request_id bigint, p_claim_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE v_req governance.verification_requests;
BEGIN
  SELECT * INTO v_req FROM governance.verification_requests
    WHERE id = p_request_id AND processing_status = 'RUNNING' AND claim_token = p_claim_token AND superseded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE governance.verification_requests SET processing_status = 'DEAD_LETTERED', verification_outcome = 'OPERATIONAL_ERROR', finished_at = now()
    WHERE id = p_request_id;
  INSERT INTO governance.command_events (correlation_id, event_type, issue_id, actor_type, service_actor_key, after_state)
    VALUES (v_req.correlation_id, 'VERIFICATION_DEAD_LETTERED', v_req.issue_id, 'SERVICE', p_service_key, '{}'::jsonb);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_dead_letter_verification_request(text, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_dead_letter_verification_request(text, bigint, uuid) TO nexus_rule_evaluator;

-- fn_complete_verification_request: ejecuta la reevaluación SCOPED de la
-- regla y decide PASSED/STILL_DETECTED - la reevaluación en sí ocurre
-- llamando fn_run_rule_evaluation en modo SCOPED (misma función que el
-- worker ya usa), no una segunda implementación paralela de las reglas.
CREATE OR REPLACE FUNCTION governance.fn_complete_verification_request(p_service_key text, p_request_id bigint, p_claim_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_req governance.verification_requests;
  v_scoped_run_id uuid;
  v_still_detected boolean;
  v_evidence_id bigint;
BEGIN
  SELECT * INTO v_req FROM governance.verification_requests
    WHERE id = p_request_id AND processing_status = 'RUNNING' AND claim_token = p_claim_token AND superseded_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'CLAIM_LOST');
  END IF;

  IF v_req.expected_correction_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM governance.correction_versions cv
      JOIN governance.correction_targets ct ON ct.current_correction_version_id = cv.id
      WHERE cv.id = v_req.expected_correction_version_id
    ) THEN
      UPDATE governance.verification_requests SET processing_status='CANCELLED', superseded_at=now(), cancellation_reason='SUPERSEDED' WHERE id = p_request_id;
      RETURN jsonb_build_object('result', 'SUPERSEDED');
    END IF;
  END IF;

  v_scoped_run_id := governance.fn_run_rule_evaluation('SCOPED', v_req.rule_code, v_req.entity_key, v_req.occurrence_key, 'CORRECTION_VERIFICATION');

  v_still_detected := EXISTS (
    SELECT 1 FROM governance.issues WHERE id = v_req.issue_id AND is_currently_detected = true
  );

  SELECT id INTO v_evidence_id FROM governance.issue_evidence WHERE issue_id = v_req.issue_id AND evaluation_run_id = v_scoped_run_id
    ORDER BY id DESC LIMIT 1;

  IF v_still_detected THEN
    UPDATE governance.verification_requests SET processing_status='COMPLETED', verification_outcome='STILL_DETECTED', evaluation_run_id = v_scoped_run_id, finished_at = now()
      WHERE id = p_request_id;
    INSERT INTO governance.command_events (correlation_id, event_type, issue_id, actor_type, service_actor_key, evidence_id, after_state)
      VALUES (v_req.correlation_id, 'VERIFICATION_STILL_DETECTED', v_req.issue_id, 'SERVICE', p_service_key, v_evidence_id, jsonb_build_object('requestId', p_request_id));
    RETURN jsonb_build_object('result', 'STILL_DETECTED');
  ELSE
    UPDATE governance.verification_requests SET processing_status='COMPLETED', verification_outcome='PASSED', evaluation_run_id = v_scoped_run_id, finished_at = now()
      WHERE id = p_request_id;
    UPDATE governance.issues SET status = 'RESOLVED', resolution_type = 'VERIFIED', resolved_rule_version = last_evaluated_rule_version,
      resolution_evaluation_run_id = v_scoped_run_id, resolution_evidence_id = v_evidence_id,
      resolution_triggered_by_correlation_id = v_req.correlation_id, closed_at = now(), version = version + 1
      WHERE id = v_req.issue_id;
    INSERT INTO governance.command_events (correlation_id, event_type, issue_id, actor_type, service_actor_key, evidence_id, after_state)
      VALUES (v_req.correlation_id, 'ISSUE_RESOLVED_VERIFIED', v_req.issue_id, 'SERVICE', p_service_key, v_evidence_id, jsonb_build_object('requestId', p_request_id));
    RETURN jsonb_build_object('result', 'PASSED');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_complete_verification_request(text, bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_complete_verification_request(text, bigint, uuid) TO nexus_rule_evaluator;

-- =============================================================================
-- Logger de intentos fallidos (B84/B93)
-- =============================================================================

CREATE OR REPLACE FUNCTION governance.fn_record_command_attempt(
  p_correlation_id uuid, p_command_type text, p_actor_type text, p_actor_user_id uuid, p_service_actor_key text,
  p_result text, p_error_code text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
BEGIN
  IF p_result NOT IN ('REJECTED','ERROR') THEN
    RAISE EXCEPTION 'p_result inválido: %', p_result;
  END IF;
  INSERT INTO governance.command_attempts (correlation_id, command_type, actor_type, actor_user_id, service_actor_key, result, error_code)
    VALUES (p_correlation_id, p_command_type, p_actor_type, p_actor_user_id, p_service_actor_key, p_result, p_error_code);
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_record_command_attempt(uuid, text, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_record_command_attempt(uuid, text, text, uuid, text, text, text) TO nexus_command_attempt_logger;

-- =============================================================================
-- Owner de las funciones: governance_owner (NOLOGIN) - se reasigna al final
-- para que el bloque de creación de arriba no requiera SET ROLE previo.
-- =============================================================================

-- Defensivo: sql/089 ya otorga esta misma membresía (SESSION_USER de
-- entonces) una sola vez, pero si este archivo se reintenta de forma
-- aislada -ej. justo el escenario real que motivó este fix, "090 falló,
-- reintentar 090"- sin haber vuelto a aplicar 089 primero, el ALTER
-- FUNCTION de abajo necesita esta membresía IGUAL. Repetir el mismo GRANT
-- acá es seguro e idempotente (ver comentario completo en sql/089).
GRANT governance_owner TO SESSION_USER WITH INHERIT FALSE, SET TRUE;

DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'governance'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO governance_owner', v_fn.sig);
  END LOOP;
END
$$;

-- governance_owner necesita poder resolver extensions.digest(...) dentro de
-- estas funciones SECURITY DEFINER (ver governance._fingerprint arriba y
-- fn_record_command_attempt): antes, con public.digest(...), esto nunca
-- hacía falta -toda base tiene USAGE en `public` otorgado a PUBLIC por
-- defecto. `extensions` no lo tiene, así que se otorga explícitamente acá,
-- una sola vez -este GRANT es por rol, no por función, así que también
-- cubre las funciones de sql/092 en adelante (mismo owner governance_owner,
-- misma llamada a extensions.digest, corridas después de este archivo).
-- Nunca se otorga EXECUTE sobre funciones de `extensions` ni se toca ningún
-- search_path -solo USAGE en el schema, imprescindible para poder siquiera
-- calificar `extensions.digest(...)` en una sentencia.
GRANT USAGE ON SCHEMA extensions TO governance_owner;
