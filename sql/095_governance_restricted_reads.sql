-- Auditoría escribible / Explorador de negocio - Gate B, Fase 3 cont.:
-- lectura gobernada de contenido restringido (B13/B72) - nunca SELECT directo
-- sobre las tablas base, aunque sea con un rol separado: cada función exige
-- una razón (NOT NULL, sin default), recibe un identificador exacto (nunca
-- permite enumerar/listar), y registra su propio evento confirmado antes de
-- devolver el resultado. Owner governance_owner, SECURITY DEFINER,
-- search_path fijo, REVOKE PUBLIC + GRANT exclusivo a nexus_audit_restricted_read.
-- fn_record_export_completed es la excepción: EXECUTE también para
-- nexus_app_read (B76), superficie mínima, no gobernada por las mismas
-- invariantes de corrección.

CREATE OR REPLACE FUNCTION governance.fn_read_restricted_evidence(
  p_actor_user_id uuid,
  p_actor_role text,
  p_evidence_id bigint,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_evidence governance.issue_evidence;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_evidence FROM governance.issue_evidence WHERE id = p_evidence_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: evidence_id %', p_evidence_id USING ERRCODE = 'P0003';
  END IF;

  v_result := jsonb_build_object(
    'id', v_evidence.id, 'issueId', v_evidence.issue_id, 'evidenceType', v_evidence.evidence_type,
    'ruleCode', v_evidence.rule_code, 'ruleVersion', v_evidence.rule_version, 'sourceObject', v_evidence.source_object,
    'sourceRecordKey', v_evidence.source_record_key, 'ruleInputs', v_evidence.rule_inputs,
    'observedValues', v_evidence.observed_values, 'effectiveValues', v_evidence.effective_values,
    'redactionLevel', v_evidence.redaction_level, 'capturedAt', v_evidence.captured_at
  );

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, issue_id, actor_type, actor_user_id, actor_role, reason, after_state, evidence_id)
    VALUES (gen_random_uuid(), 'RESTRICTED_EVIDENCE_ACCESSED', 'audit:evidence-restricted', v_evidence.issue_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('evidenceId', p_evidence_id), p_evidence_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_read_restricted_evidence(uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_read_restricted_evidence(uuid, text, bigint, text) TO nexus_audit_restricted_read;

CREATE OR REPLACE FUNCTION governance.fn_read_redacted_comment_original(
  p_actor_user_id uuid,
  p_actor_role text,
  p_comment_id bigint,
  p_reason text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_comment governance.review_case_comments;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_comment FROM governance.review_case_comments WHERE id = p_comment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: comment_id %', p_comment_id USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (gen_random_uuid(), 'REDACTED_COMMENT_ACCESSED', 'audit:evidence-restricted', v_comment.review_case_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('commentId', p_comment_id));

  RETURN v_comment.body;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_read_redacted_comment_original(uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_read_redacted_comment_original(uuid, text, bigint, text) TO nexus_audit_restricted_read;

CREATE OR REPLACE FUNCTION governance.fn_read_restricted_event_state(
  p_actor_user_id uuid,
  p_actor_role text,
  p_command_event_id bigint,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_event governance.command_events;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_event FROM governance.command_events WHERE id = p_command_event_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: command_event_id %', p_command_event_id USING ERRCODE = 'P0003';
  END IF;

  v_result := jsonb_build_object(
    'id', v_event.id, 'eventType', v_event.event_type, 'beforeState', v_event.before_state,
    'afterState', v_event.after_state, 'serviceActorKey', v_event.service_actor_key, 'createdAt', v_event.created_at
  );

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, issue_id, review_case_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (gen_random_uuid(), 'RESTRICTED_EVENT_STATE_ACCESSED', 'audit:evidence-restricted', v_event.issue_id, v_event.review_case_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('commandEventId', p_command_event_id));

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_read_restricted_event_state(uuid, text, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_read_restricted_event_state(uuid, text, bigint, text) TO nexus_audit_restricted_read;

-- fn_record_export_completed (B76): superficie mínima para que gerencia
-- (nexus_app_read, sin EXECUTE sobre las funciones de corrección) pueda
-- registrar una exportación sin recibir INSERT genérico sobre command_events.
CREATE OR REPLACE FUNCTION governance.fn_record_export_completed(
  p_actor_user_id uuid,
  p_actor_role text,
  p_entity_type text,
  p_filters_summary jsonb,
  p_row_count integer,
  p_format text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
BEGIN
  INSERT INTO governance.command_events (correlation_id, event_type, command_type, actor_type, actor_user_id, actor_role, after_state)
    VALUES (gen_random_uuid(), 'EXPORT_COMPLETED', 'export', 'HUMAN', p_actor_user_id, p_actor_role,
      jsonb_build_object('entityType', p_entity_type, 'filtersSummary', p_filters_summary, 'rowCount', p_row_count, 'format', p_format));
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_record_export_completed(uuid, text, text, jsonb, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_record_export_completed(uuid, text, text, jsonb, integer, text) TO nexus_app_read, nexus_app_corrections;
