-- Auditoría escribible / Explorador de negocio - Gate B, Fase 3 cont.: ciclo
-- de vida de review cases (B4) y descarte/reapertura de issues (B1/B9
-- Sección 9 - REOPENED es un evento, nunca un quinto estado persistente).
-- Mismas convenciones que sql/090/092: SECURITY DEFINER, search_path fijo,
-- REVOKE PUBLIC + GRANT mínimo a nexus_app_corrections, idempotencia por
-- request_payload, versión optimista via FOR UPDATE, actor como metadata
-- auditada (B34). Aditivo, sin DROP.

-- =============================================================================
-- fn_create_review_case: agrupa 1+ issues bajo revisión activa (B4).
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_create_review_case(
  p_actor_user_id uuid,
  p_actor_role text,
  p_issue_ids bigint[],
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_request_payload jsonb := jsonb_build_object('commandType', 'review-case:create', 'issueIds', to_jsonb(p_issue_ids), 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_case_id bigint;
  v_issue_id bigint;
  v_result jsonb;
BEGIN
  IF p_issue_ids IS NULL OR array_length(p_issue_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: se requiere al menos un issue_id' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:create' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_issue_ids) x(id) WHERE NOT EXISTS (SELECT 1 FROM governance.issues WHERE id = x.id)) THEN
    RAISE EXCEPTION 'NOT_FOUND: uno o más issue_ids no existen' USING ERRCODE = 'P0003';
  END IF;

  INSERT INTO governance.review_cases (status) VALUES ('OPEN') RETURNING id INTO v_case_id;

  FOREACH v_issue_id IN ARRAY p_issue_ids LOOP
    INSERT INTO governance.review_case_issues (review_case_id, issue_id, added_by_actor_id)
      VALUES (v_case_id, v_issue_id, p_actor_user_id);
  END LOOP;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'REVIEW_CASE_CREATED', 'review-case:create', v_case_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('reviewCaseId', v_case_id, 'issueIds', to_jsonb(p_issue_ids)));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'reviewCaseId', v_case_id, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'review-case:create', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_create_review_case(uuid, text, bigint[], text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_create_review_case(uuid, text, bigint[], text, text, uuid) TO nexus_app_corrections;

-- =============================================================================
-- fn_assign_review_case: asigna (o reasigna) un caso a un actor administracion.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_assign_review_case(
  p_actor_user_id uuid,
  p_actor_role text,
  p_review_case_id bigint,
  p_assignee_user_id uuid,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_request_payload jsonb := jsonb_build_object('commandType', 'review-case:assign', 'reviewCaseId', p_review_case_id, 'assigneeUserId', p_assignee_user_id, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_case governance.review_cases;
  v_result jsonb;
BEGIN
  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:assign' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_case FROM governance.review_cases WHERE id = p_review_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: review_case_id %', p_review_case_id USING ERRCODE = 'P0003';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_case.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_case.version USING ERRCODE = 'P0002';
  END IF;

  UPDATE governance.review_cases SET assigned_to = p_assignee_user_id, status = CASE WHEN status = 'OPEN' THEN 'IN_REVIEW' ELSE status END,
    version = version + 1, updated_at = now()
    WHERE id = p_review_case_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'ISSUE_ASSIGNED', 'review-case:assign', p_review_case_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('reviewCaseId', p_review_case_id, 'assigneeUserId', p_assignee_user_id));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'reviewCaseId', p_review_case_id, 'version', v_case.version + 1, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'review-case:assign', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_assign_review_case(uuid, text, bigint, uuid, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_assign_review_case(uuid, text, bigint, uuid, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_add_review_case_comment: comentario inmutable (B4/B33) - "editar" es un
-- comentario nuevo con supersedes_comment_id, nunca UPDATE del body.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_add_review_case_comment(
  p_actor_user_id uuid,
  p_actor_role text,
  p_review_case_id bigint,
  p_body text,
  p_supersedes_comment_id bigint DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_request_payload jsonb;
  v_existing_idem governance.idempotency_keys;
  v_comment_id bigint;
  v_result jsonb;
BEGIN
  IF p_body IS NULL OR btrim(p_body) = '' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: body requerido' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM governance.review_cases WHERE id = p_review_case_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: review_case_id %', p_review_case_id USING ERRCODE = 'P0003';
  END IF;
  IF p_supersedes_comment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM governance.review_case_comments WHERE id = p_supersedes_comment_id AND review_case_id = p_review_case_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: supersedes_comment_id % no pertenece a este caso', p_supersedes_comment_id USING ERRCODE = 'P0003';
  END IF;

  v_request_payload := jsonb_build_object('commandType', 'review-case:comment', 'reviewCaseId', p_review_case_id, 'body', p_body, 'supersedesCommentId', p_supersedes_comment_id);

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_idem FROM governance.idempotency_keys
      WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:comment' AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing_idem.request_payload = v_request_payload THEN
        RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
      ELSE
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  INSERT INTO governance.review_case_comments (review_case_id, actor_user_id, body, supersedes_comment_id)
    VALUES (p_review_case_id, p_actor_user_id, p_body, p_supersedes_comment_id)
    RETURNING id INTO v_comment_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, actor_type, actor_user_id, actor_role, after_state)
    VALUES (coalesce(p_correlation_id, gen_random_uuid()), 'COMMENT_ADDED', 'review-case:comment', p_review_case_id, 'HUMAN', p_actor_user_id, p_actor_role,
      jsonb_build_object('commentId', v_comment_id));

  v_result := jsonb_build_object('commandId', coalesce(p_correlation_id, gen_random_uuid()), 'result', 'APPLIED', 'commentId', v_comment_id, 'replay', false);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
      VALUES ('HUMAN', p_actor_user_id::text, 'review-case:comment', p_idempotency_key, v_request_payload,
        encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, coalesce(p_correlation_id, gen_random_uuid()));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_add_review_case_comment(uuid, text, bigint, text, bigint, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_add_review_case_comment(uuid, text, bigint, text, bigint, text, uuid) TO nexus_app_corrections;

-- =============================================================================
-- fn_redact_review_case_comment: capacidad separada correction:redact-comment
-- (B4/B33) - nunca toca `body`, solo las columnas de redacción.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_redact_review_case_comment(
  p_actor_user_id uuid,
  p_actor_role text,
  p_comment_id bigint,
  p_redaction_reason text,
  p_idempotency_key text,
  p_correlation_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_request_payload jsonb := jsonb_build_object('commandType', 'review-case:redact-comment', 'commentId', p_comment_id, 'redactionReason', p_redaction_reason);
  v_existing_idem governance.idempotency_keys;
  v_comment governance.review_case_comments;
  v_result jsonb;
BEGIN
  IF p_redaction_reason IS NULL OR btrim(p_redaction_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:redact-comment' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_comment FROM governance.review_case_comments WHERE id = p_comment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: comment_id %', p_comment_id USING ERRCODE = 'P0003';
  END IF;

  UPDATE governance.review_case_comments SET is_redacted = true, redaction_reason = p_redaction_reason,
    redacted_by_actor_id = p_actor_user_id, redacted_at = now()
    WHERE id = p_comment_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'COMMENT_REDACTED', 'review-case:redact-comment', v_comment.review_case_id, 'HUMAN', p_actor_user_id, p_actor_role, p_redaction_reason,
      jsonb_build_object('commentId', p_comment_id));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'commentId', p_comment_id, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'review-case:redact-comment', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_redact_review_case_comment(uuid, text, bigint, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_redact_review_case_comment(uuid, text, bigint, text, text, uuid) TO nexus_app_corrections;

-- =============================================================================
-- fn_close_review_case: RESOLVED o DISMISSED - cierra en cascada TODAS las
-- membresías activas en la misma transacción (B53), nunca deja una membresía
-- activa asociada a un caso ya cerrado.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_close_review_case(
  p_actor_user_id uuid,
  p_actor_role text,
  p_review_case_id bigint,
  p_final_status text,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_request_payload jsonb := jsonb_build_object('commandType', 'review-case:close', 'reviewCaseId', p_review_case_id, 'finalStatus', p_final_status, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_case governance.review_cases;
  v_membership_end_reason text;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_final_status NOT IN ('RESOLVED','DISMISSED') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: final_status debe ser RESOLVED o DISMISSED' USING ERRCODE = 'P0001';
  END IF;
  v_membership_end_reason := CASE WHEN p_final_status = 'RESOLVED' THEN 'CASE_CLOSED' ELSE 'CASE_DISMISSED' END;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:close' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_case FROM governance.review_cases WHERE id = p_review_case_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: review_case_id %', p_review_case_id USING ERRCODE = 'P0003';
  END IF;
  IF v_case.status IN ('RESOLVED','DISMISSED') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: el caso ya está cerrado (%)', v_case.status USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_case.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_case.version USING ERRCODE = 'P0002';
  END IF;

  UPDATE governance.review_cases SET status = p_final_status, closed_at = now(), version = version + 1, updated_at = now()
    WHERE id = p_review_case_id;

  UPDATE governance.review_case_issues SET membership_ended_at = now(), membership_end_reason = v_membership_end_reason
    WHERE review_case_id = p_review_case_id AND membership_ended_at IS NULL;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'REVIEW_CASE_UPDATED', 'review-case:close', p_review_case_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('reviewCaseId', p_review_case_id, 'finalStatus', p_final_status));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'reviewCaseId', p_review_case_id, 'status', p_final_status, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'review-case:close', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_close_review_case(uuid, text, bigint, text, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_close_review_case(uuid, text, bigint, text, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_dismiss_issue: descarte justificado (B1/B9) - terminal hasta reapertura
-- explícita, la regla puede seguir detectando (lifecycle_dismissed, B60 no lo
-- prohíbe). Cancela verification_requests activas (ya no aplica verificarlas).
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_dismiss_issue(
  p_actor_user_id uuid,
  p_actor_role text,
  p_issue_id bigint,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_request_payload jsonb := jsonb_build_object('commandType', 'issue:dismiss', 'issueId', p_issue_id, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_issue governance.issues;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'issue:dismiss' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_issue FROM governance.issues WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: issue_id %', p_issue_id USING ERRCODE = 'P0003';
  END IF;
  IF v_issue.status NOT IN ('OPEN','IN_REVIEW') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: solo se puede descartar un issue OPEN/IN_REVIEW (actual=%)', v_issue.status USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_issue.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_issue.version USING ERRCODE = 'P0002';
  END IF;

  UPDATE governance.verification_requests SET processing_status='CANCELLED', superseded_at=now(), cancellation_reason='ISSUE_DISMISSED'
    WHERE issue_id = p_issue_id AND processing_status IN ('PENDING','RUNNING');

  UPDATE governance.issues SET status = 'DISMISSED', resolution_type = 'DISMISSED', dismissed_by_actor_id = p_actor_user_id,
    closed_at = now(), closed_reason = p_reason, version = version + 1, updated_at = now()
    WHERE id = p_issue_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, issue_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'ISSUE_DISMISSED', 'issue:dismiss', p_issue_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('issueId', p_issue_id, 'status', 'DISMISSED'));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'issueId', p_issue_id, 'status', 'DISMISSED', 'version', v_issue.version + 1, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'issue:dismiss', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_dismiss_issue(uuid, text, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_dismiss_issue(uuid, text, bigint, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_reopen_issue: REOPENED es un evento de transición, nunca un quinto
-- estado persistente (B1/B9) - el estado resultante es siempre IN_REVIEW.
-- Se reevalúa en el siguiente ciclo global, nunca dispara una verificación
-- SCOPED inmediata (decisión ya cerrada en B8).
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_reopen_issue(
  p_actor_user_id uuid,
  p_actor_role text,
  p_issue_id bigint,
  p_reason text,
  p_idempotency_key text,
  p_correlation_id uuid,
  p_expected_version integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, governance
AS $$
DECLARE
  v_request_payload jsonb := jsonb_build_object('commandType', 'issue:reopen', 'issueId', p_issue_id, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_issue governance.issues;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'issue:reopen' AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_idem.request_payload = v_request_payload THEN
      RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
    ELSE
      RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT * INTO v_issue FROM governance.issues WHERE id = p_issue_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: issue_id %', p_issue_id USING ERRCODE = 'P0003';
  END IF;
  IF v_issue.status NOT IN ('RESOLVED','DISMISSED') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: solo se puede reabrir un issue RESOLVED/DISMISSED (actual=%)', v_issue.status USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_issue.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_issue.version USING ERRCODE = 'P0002';
  END IF;

  UPDATE governance.issues SET status = 'IN_REVIEW', resolution_type = NULL, resolved_rule_version = NULL,
    resolution_evaluation_run_id = NULL, resolution_evidence_id = NULL, resolution_triggered_by_correlation_id = NULL,
    dismissed_by_actor_id = NULL, closed_at = NULL, closed_reason = NULL, version = version + 1, updated_at = now()
    WHERE id = p_issue_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, issue_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'ISSUE_REOPENED', 'issue:reopen', p_issue_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('issueId', p_issue_id, 'status', 'IN_REVIEW'));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'issueId', p_issue_id, 'status', 'IN_REVIEW', 'version', v_issue.version + 1, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'issue:reopen', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_reopen_issue(uuid, text, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_reopen_issue(uuid, text, bigint, text, text, uuid, integer) TO nexus_app_corrections;
