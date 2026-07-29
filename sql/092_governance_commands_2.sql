-- Auditoría escribible / Explorador de negocio - Gate B, Fase 3: comandos de
-- corrección restantes del catálogo mínimo (B8/B10 de Codigo\eyg-nexus-local
-- plan Gate B) - identidad de técnico, vínculo reporte-ticket, identificación
-- de equipo, y reversión genérica. Mismo patrón que fn_apply_part_alias
-- (sql/090): idempotencia por request_payload (B57), lock por target vía
-- correction_targets (B58/B71), actor tri-modal como metadata auditada nunca
-- autorización (B34), verification_requests solo cuando hay regla asociada
-- (B81). Aditivo, sin DROP.

-- =============================================================================
-- fn_apply_technician_identity: promueve una representación de origen a
-- identidad canónica verificada manualmente. Sin rule_code asociado en el
-- catálogo mínimo v1 (B8/B81) - nunca crea verification_request.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_apply_technician_identity(
  p_actor_user_id uuid,
  p_actor_role text,
  p_source_type text,
  p_source_value_normalized text,
  p_canonical_person_key text,
  p_canonical_display_name text,
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
  v_target_type text := 'TECHNICIAN_IDENTITY';
  v_target_key jsonb := jsonb_build_object('sourceType', p_source_type, 'sourceValueNormalized', p_source_value_normalized);
  v_request_payload jsonb := jsonb_build_object(
    'commandType', 'correction:technician-identity', 'sourceType', p_source_type, 'sourceValueNormalized', p_source_value_normalized,
    'canonicalPersonKey', p_canonical_person_key, 'canonicalDisplayName', p_canonical_display_name, 'expectedVersion', p_expected_version, 'reason', p_reason
  );
  v_existing_idem governance.idempotency_keys;
  v_current_version integer;
  v_current_correction_id bigint;
  v_map_id bigint;
  v_correction_version_id bigint;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_source_type NOT IN ('ASSIGNED_TO_USERNAME','SIGNATURE_NAME','ADDITIONAL_FIELD_TOKEN') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: source_type inválido' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'correction:technician-identity' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO governance.correction_targets (target_type, target_key, current_version)
    VALUES (v_target_type, v_target_key, 0) ON CONFLICT (target_type, target_key) DO NOTHING;
  SELECT current_version, current_correction_version_id INTO v_current_version, v_current_correction_id
    FROM governance.correction_targets WHERE target_type = v_target_type AND target_key = v_target_key FOR UPDATE;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_current_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_current_version USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO manual_review.fieldbeat_engineer_identity_map
    (source_type, source_value_normalized, canonical_person_key, canonical_display_name, verification_method, confidence, reason, verified_at, verified_by, created_by)
    VALUES (p_source_type, p_source_value_normalized, p_canonical_person_key, p_canonical_display_name, 'MANUALLY_VERIFIED', 'HIGH', p_reason, now(), p_actor_user_id::text, coalesce(p_actor_user_id::text, 'unknown'))
    ON CONFLICT (source_type, source_value_normalized) DO UPDATE SET
      canonical_person_key = EXCLUDED.canonical_person_key, canonical_display_name = EXCLUDED.canonical_display_name,
      verification_method = 'MANUALLY_VERIFIED', confidence = 'HIGH', reason = EXCLUDED.reason,
      verified_at = now(), verified_by = EXCLUDED.verified_by, is_active = true
    RETURNING id INTO v_map_id;

  INSERT INTO governance.correction_versions (correction_type, target_type, target_key, version, payload,
    actor_type, actor_user_id, reason, correlation_id)
    VALUES ('technician-identity', v_target_type, v_target_key, v_current_version + 1,
      jsonb_build_object('identityMapId', v_map_id, 'canonicalPersonKey', p_canonical_person_key, 'canonicalDisplayName', p_canonical_display_name),
      'HUMAN', p_actor_user_id, p_reason, p_correlation_id)
    RETURNING id INTO v_correction_version_id;

  UPDATE governance.correction_targets SET current_version = v_current_version + 1, current_correction_version_id = v_correction_version_id
    WHERE target_type = v_target_type AND target_key = v_target_key;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'CORRECTION_APPLIED', 'correction:technician-identity', 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('correctionVersionId', v_correction_version_id, 'identityMapId', v_map_id));

  v_result := jsonb_build_object(
    'commandId', p_correlation_id, 'result', 'APPLIED',
    'target', jsonb_build_object('type', v_target_type, 'key', v_target_key),
    'correctionVersionId', v_correction_version_id,
    'verification', 'NOT_APPLICABLE', 'verificationRequestId', NULL,
    'replay', false
  );

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'correction:technician-identity', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_apply_technician_identity(uuid, text, text, text, text, text, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_apply_technician_identity(uuid, text, text, text, text, text, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_apply_ticket_link: crea/corrige el vínculo efectivo reporte-ticket.
-- Único rule_code asociado: TICKET_LINK_RESTRICTED_OR_MISSING.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_apply_ticket_link(
  p_actor_user_id uuid,
  p_actor_role text,
  p_fieldbeat_task_id bigint,
  p_override_type text,
  p_corrected_zendesk_ticket_id bigint,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance, manual_review, marts
AS $$
DECLARE
  v_target_type text := 'TICKET_LINK';
  v_target_key jsonb := jsonb_build_object('fieldbeatTaskId', p_fieldbeat_task_id);
  v_request_payload jsonb := jsonb_build_object(
    'commandType', 'correction:ticket-link', 'fieldbeatTaskId', p_fieldbeat_task_id, 'overrideType', p_override_type,
    'correctedZendeskTicketId', p_corrected_zendesk_ticket_id, 'expectedVersion', p_expected_version, 'reason', p_reason
  );
  v_existing_idem governance.idempotency_keys;
  v_current_version integer;
  v_current_correction_id bigint;
  v_override_id bigint;
  v_correction_version_id bigint;
  v_issue_id bigint;
  v_verification_request_id bigint;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_override_type NOT IN ('CONFIRMED_NO_TICKET','CORRECTED','DUPLICATE') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: override_type inválido' USING ERRCODE = 'P0001';
  END IF;
  IF p_override_type <> 'CONFIRMED_NO_TICKET' AND p_corrected_zendesk_ticket_id IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: corrected_zendesk_ticket_id requerido salvo CONFIRMED_NO_TICKET' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'correction:ticket-link' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO governance.correction_targets (target_type, target_key, current_version)
    VALUES (v_target_type, v_target_key, 0) ON CONFLICT (target_type, target_key) DO NOTHING;
  SELECT current_version, current_correction_version_id INTO v_current_version, v_current_correction_id
    FROM governance.correction_targets WHERE target_type = v_target_type AND target_key = v_target_key FOR UPDATE;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_current_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_current_version USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO manual_review.ticket_link_overrides (fieldbeat_task_id, corrected_zendesk_ticket_id, override_type, reason, created_by)
    VALUES (p_fieldbeat_task_id, p_corrected_zendesk_ticket_id, p_override_type, p_reason, coalesce(p_actor_user_id::text, 'unknown'))
    ON CONFLICT (fieldbeat_task_id) DO UPDATE SET
      corrected_zendesk_ticket_id = EXCLUDED.corrected_zendesk_ticket_id, override_type = EXCLUDED.override_type, reason = EXCLUDED.reason
    RETURNING id INTO v_override_id;

  INSERT INTO governance.correction_versions (correction_type, target_type, target_key, version, payload,
    actor_type, actor_user_id, reason, correlation_id)
    VALUES ('ticket-link', v_target_type, v_target_key, v_current_version + 1,
      jsonb_build_object('ticketLinkOverrideId', v_override_id, 'overrideType', p_override_type, 'correctedZendeskTicketId', p_corrected_zendesk_ticket_id),
      'HUMAN', p_actor_user_id, p_reason, p_correlation_id)
    RETURNING id INTO v_correction_version_id;

  UPDATE governance.correction_targets SET current_version = v_current_version + 1, current_correction_version_id = v_correction_version_id
    WHERE target_type = v_target_type AND target_key = v_target_key;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'CORRECTION_APPLIED', 'correction:ticket-link', 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('correctionVersionId', v_correction_version_id, 'ticketLinkOverrideId', v_override_id));

  -- Reevaluación SCOPED (B39) del issue de vínculo de ticket de este reporte,
  -- si existe uno activo - mismo orden de supersición que fn_apply_part_alias
  -- (B80/B89: cancelar -> insertar -> IN_REVIEW).
  FOR v_issue_id IN
    SELECT i.id FROM governance.issues i
    WHERE i.rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING'
      AND i.entity_key = p_fieldbeat_task_id::text
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
    'commandId', p_correlation_id, 'result', 'APPLIED',
    'target', jsonb_build_object('type', v_target_type, 'key', v_target_key),
    'correctionVersionId', v_correction_version_id,
    'verification', CASE WHEN v_verification_request_id IS NOT NULL THEN 'PENDING' ELSE 'NOT_APPLICABLE' END,
    'verificationRequestId', v_verification_request_id,
    'replay', false
  );

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'correction:ticket-link', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_apply_ticket_link(uuid, text, bigint, text, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_apply_ticket_link(uuid, text, bigint, text, bigint, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_apply_equipment_identification: overlay aditivo (sql/091), sin regla de
-- calidad asociada en v1 (B8) - nunca crea verification_request.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_apply_equipment_identification(
  p_actor_user_id uuid,
  p_actor_role text,
  p_fieldbeat_task_id bigint,
  p_raw_equipment_reference text,
  p_corrected_equipment_internal_id text,
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
  v_target_type text := 'EQUIPMENT_IDENTIFICATION';
  v_target_key jsonb := jsonb_build_object('fieldbeatTaskId', p_fieldbeat_task_id, 'rawEquipmentReference', p_raw_equipment_reference);
  v_request_payload jsonb := jsonb_build_object(
    'commandType', 'correction:equipment-identification', 'fieldbeatTaskId', p_fieldbeat_task_id,
    'rawEquipmentReference', p_raw_equipment_reference, 'correctedEquipmentInternalId', p_corrected_equipment_internal_id,
    'expectedVersion', p_expected_version, 'reason', p_reason
  );
  v_existing_idem governance.idempotency_keys;
  v_current_version integer;
  v_current_correction_id bigint;
  v_override_id bigint;
  v_correction_version_id bigint;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_corrected_equipment_internal_id IS NULL OR btrim(p_corrected_equipment_internal_id) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: corrected_equipment_internal_id requerido' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'correction:equipment-identification' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  INSERT INTO governance.correction_targets (target_type, target_key, current_version)
    VALUES (v_target_type, v_target_key, 0) ON CONFLICT (target_type, target_key) DO NOTHING;
  SELECT current_version, current_correction_version_id INTO v_current_version, v_current_correction_id
    FROM governance.correction_targets WHERE target_type = v_target_type AND target_key = v_target_key FOR UPDATE;

  IF p_expected_version IS NOT NULL AND p_expected_version <> v_current_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_current_version USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO manual_review.equipment_identification_overrides (fieldbeat_task_id, raw_equipment_reference, corrected_equipment_internal_id, reason, created_by)
    VALUES (p_fieldbeat_task_id, p_raw_equipment_reference, p_corrected_equipment_internal_id, p_reason, coalesce(p_actor_user_id::text, 'unknown'))
    ON CONFLICT (fieldbeat_task_id, raw_equipment_reference) DO UPDATE SET
      corrected_equipment_internal_id = EXCLUDED.corrected_equipment_internal_id, reason = EXCLUDED.reason, updated_at = now(), active = true
    RETURNING id INTO v_override_id;

  INSERT INTO governance.correction_versions (correction_type, target_type, target_key, version, payload,
    actor_type, actor_user_id, reason, correlation_id)
    VALUES ('equipment-identification', v_target_type, v_target_key, v_current_version + 1,
      jsonb_build_object('equipmentOverrideId', v_override_id, 'correctedEquipmentInternalId', p_corrected_equipment_internal_id),
      'HUMAN', p_actor_user_id, p_reason, p_correlation_id)
    RETURNING id INTO v_correction_version_id;

  UPDATE governance.correction_targets SET current_version = v_current_version + 1, current_correction_version_id = v_correction_version_id
    WHERE target_type = v_target_type AND target_key = v_target_key;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'CORRECTION_APPLIED', 'correction:equipment-identification', 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('correctionVersionId', v_correction_version_id, 'equipmentOverrideId', v_override_id));

  v_result := jsonb_build_object(
    'commandId', p_correlation_id, 'result', 'APPLIED',
    'target', jsonb_build_object('type', v_target_type, 'key', v_target_key),
    'correctionVersionId', v_correction_version_id,
    'verification', 'NOT_APPLICABLE', 'verificationRequestId', NULL,
    'replay', false
  );

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'correction:equipment-identification', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_apply_equipment_identification(uuid, text, bigint, text, text, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_apply_equipment_identification(uuid, text, bigint, text, text, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_reverse_correction: reversión genérica por tipo de corrección (B5/B8) -
-- solo puede revertir la versión VIGENTE de un target (correction_targets.
-- current_correction_version_id), nunca una ya superada. Escritura efectiva
-- reutiliza el patrón ya existente en el repo (Gate A Sección 6/9): baja
-- lógica para alias, baja física ("revertir a no resuelto") para vínculo de
-- ticket, desactivación para identidad de técnico/equipo. Nunca borra
-- evidencia histórica de governance.correction_versions.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_reverse_correction(
  p_actor_user_id uuid,
  p_actor_role text,
  p_correction_version_id bigint,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance, manual_review, marts
AS $$
DECLARE
  v_original governance.correction_versions;
  v_target_type text;
  v_target_key jsonb;
  v_request_payload jsonb;
  v_existing_idem governance.idempotency_keys;
  v_current_version integer;
  v_current_correction_id bigint;
  v_new_version_id bigint;
  v_issue_id bigint;
  v_verification_request_id bigint;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_original FROM governance.correction_versions WHERE id = p_correction_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: correction_version_id %', p_correction_version_id USING ERRCODE = 'P0003';
  END IF;
  v_target_type := v_original.target_type;
  v_target_key := v_original.target_key;

  v_request_payload := jsonb_build_object(
    'commandType', 'correction:reverse', 'reversedCorrectionVersionId', p_correction_version_id, 'expectedVersion', p_expected_version, 'reason', p_reason
  );

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'correction:reverse' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT current_version, current_correction_version_id INTO v_current_version, v_current_correction_id
    FROM governance.correction_targets WHERE target_type = v_target_type AND target_key = v_target_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: target sin correction_targets' USING ERRCODE = 'P0003';
  END IF;
  IF v_current_correction_id IS DISTINCT FROM p_correction_version_id THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: solo se puede revertir la versión vigente (actual=%, solicitada=%)', v_current_correction_id, p_correction_version_id USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_current_version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_current_version USING ERRCODE = 'P0002';
  END IF;

  IF v_original.correction_type = 'part-alias' THEN
    UPDATE manual_review.part_aliases SET active = false, updated_at = now()
      WHERE alias_value = v_target_key->>'aliasValue' AND alias_type = v_target_key->>'aliasType';
  ELSIF v_original.correction_type = 'ticket-link' THEN
    DELETE FROM manual_review.ticket_link_overrides WHERE fieldbeat_task_id = (v_target_key->>'fieldbeatTaskId')::bigint;
  ELSIF v_original.correction_type = 'technician-identity' THEN
    UPDATE manual_review.fieldbeat_engineer_identity_map SET is_active = false
      WHERE source_type = v_target_key->>'sourceType' AND source_value_normalized = v_target_key->>'sourceValueNormalized';
  ELSIF v_original.correction_type = 'equipment-identification' THEN
    UPDATE manual_review.equipment_identification_overrides SET active = false, updated_at = now()
      WHERE fieldbeat_task_id = (v_target_key->>'fieldbeatTaskId')::bigint
        AND raw_equipment_reference IS NOT DISTINCT FROM (v_target_key->>'rawEquipmentReference');
  ELSE
    RAISE EXCEPTION 'VALIDATION_ERROR: tipo de corrección sin reversión soportada: %', v_original.correction_type USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO governance.correction_versions (correction_type, target_type, target_key, version, payload,
    actor_type, actor_user_id, reason, correlation_id, reversal_of)
    VALUES (v_original.correction_type, v_target_type, v_target_key, v_current_version + 1,
      jsonb_build_object('reversedCorrectionVersionId', p_correction_version_id),
      'HUMAN', p_actor_user_id, p_reason, p_correlation_id, p_correction_version_id)
    RETURNING id INTO v_new_version_id;

  UPDATE governance.correction_targets SET current_version = v_current_version + 1, current_correction_version_id = v_new_version_id
    WHERE target_type = v_target_type AND target_key = v_target_key;

  UPDATE governance.correction_versions SET superseded_by = v_new_version_id WHERE id = p_correction_version_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'CORRECTION_REVERSED', 'correction:reverse', 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('correctionVersionId', v_new_version_id, 'reversedCorrectionVersionId', p_correction_version_id));

  -- Reevaluación SCOPED (B39) solo para tipos con regla asociada (B81).
  IF v_original.correction_type IN ('part-alias','ticket-link') THEN
    FOR v_issue_id IN
      SELECT i.id FROM governance.issues i
      WHERE i.status IN ('OPEN','IN_REVIEW')
        AND (
          (v_original.correction_type = 'ticket-link' AND i.rule_code = 'TICKET_LINK_RESTRICTED_OR_MISSING' AND i.entity_key = (v_target_key->>'fieldbeatTaskId'))
          OR
          (v_original.correction_type = 'part-alias' AND i.rule_code IN ('PART_NO_MATCH','PART_AMBIGUOUS_MATCH') AND i.occurrence_key IN (
            SELECT used_part_id FROM marts.used_parts_dolibarr_match
            WHERE upper(btrim(coalesce(normalized_part_identifier, raw_part_identifier))) = upper(btrim(v_target_key->>'aliasValue'))
          ))
        )
    LOOP
      UPDATE governance.verification_requests SET processing_status='CANCELLED', superseded_at=now(), cancellation_reason='MANUAL_CANCEL'
        WHERE issue_id = v_issue_id AND processing_status IN ('PENDING','RUNNING');

      INSERT INTO governance.verification_requests (issue_id, correlation_id, correction_version_id, expected_correction_version_id,
        rule_code, entity_type, entity_key, occurrence_key)
      SELECT v_issue_id, p_correlation_id, v_new_version_id, v_new_version_id, i.rule_code, i.entity_type, i.entity_key, i.occurrence_key
      FROM governance.issues i WHERE i.id = v_issue_id
      RETURNING id INTO v_verification_request_id;

      UPDATE governance.issues SET status = 'IN_REVIEW', updated_at = now() WHERE id = v_issue_id AND status = 'OPEN';
    END LOOP;
  END IF;

  v_result := jsonb_build_object(
    'commandId', p_correlation_id, 'result', 'APPLIED',
    'target', jsonb_build_object('type', v_target_type, 'key', v_target_key),
    'correctionVersionId', v_new_version_id,
    'verification', CASE WHEN v_verification_request_id IS NOT NULL THEN 'PENDING' ELSE 'NOT_APPLICABLE' END,
    'verificationRequestId', v_verification_request_id,
    'replay', false
  );

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'correction:reverse', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_reverse_correction(uuid, text, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_reverse_correction(uuid, text, bigint, text, text, uuid, integer) TO nexus_app_corrections;
