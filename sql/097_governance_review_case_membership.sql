-- Auditoría escribible - Gate B, Familia 4 cont.: completa el ciclo de vida
-- de review cases que sql/094 dejó pendiente - agregar un issue a un caso ya
-- existente (no solo al crearlo), terminar una membresía individual sin
-- cerrar el caso completo, y reabrir un caso ya cerrado. Mismas convenciones
-- que sql/090/092/094: SECURITY DEFINER, search_path fijo, REVOKE PUBLIC +
-- GRANT mínimo a nexus_app_corrections, idempotencia por request_payload,
-- versión optimista vía FOR UPDATE, actor como metadata auditada (B34).
-- Aditivo, sin DROP.

-- =============================================================================
-- fn_add_issue_to_review_case: agrega un issue a un caso OPEN/IN_REVIEW ya
-- existente. Un issue solo puede tener una membresía ACTIVA a la vez
-- (review_case_issues_one_active_membership, B53/sql/089) - se valida
-- explícitamente antes del INSERT para devolver un VALIDATION_ERROR legible
-- en vez de depender solo de la violación del índice único parcial.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_add_issue_to_review_case(
  p_actor_user_id uuid,
  p_actor_role text,
  p_review_case_id bigint,
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
  v_request_payload jsonb := jsonb_build_object('commandType', 'review-case:add-issue', 'reviewCaseId', p_review_case_id, 'issueId', p_issue_id, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_case governance.review_cases;
  v_result jsonb;
BEGIN
  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:add-issue' AND idempotency_key = p_idempotency_key;
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
    RAISE EXCEPTION 'VALIDATION_ERROR: no se puede agregar un issue a un caso ya cerrado (%)', v_case.status USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_case.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_case.version USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM governance.issues WHERE id = p_issue_id) THEN
    RAISE EXCEPTION 'NOT_FOUND: issue_id %', p_issue_id USING ERRCODE = 'P0003';
  END IF;
  IF EXISTS (SELECT 1 FROM governance.review_case_issues WHERE issue_id = p_issue_id AND membership_ended_at IS NULL) THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: el issue % ya tiene una membresía activa en otro caso', p_issue_id USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO governance.review_case_issues (review_case_id, issue_id, added_by_actor_id)
    VALUES (p_review_case_id, p_issue_id, p_actor_user_id);

  UPDATE governance.review_cases SET version = version + 1, updated_at = now() WHERE id = p_review_case_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, issue_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'REVIEW_CASE_UPDATED', 'review-case:add-issue', p_review_case_id, p_issue_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('reviewCaseId', p_review_case_id, 'issueId', p_issue_id));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'reviewCaseId', p_review_case_id, 'issueId', p_issue_id, 'version', v_case.version + 1, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'review-case:add-issue', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_add_issue_to_review_case(uuid, text, bigint, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_add_issue_to_review_case(uuid, text, bigint, bigint, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_end_review_case_membership: desvincula UN issue de un caso sin cerrar
-- el caso completo (membership_end_reason='REMOVED_BY_ACTOR', B4) - nunca un
-- DELETE físico. Deja el caso abierto para el resto de sus issues.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_end_review_case_membership(
  p_actor_user_id uuid,
  p_actor_role text,
  p_review_case_id bigint,
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
  v_request_payload jsonb := jsonb_build_object('commandType', 'review-case:end-membership', 'reviewCaseId', p_review_case_id, 'issueId', p_issue_id, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_case governance.review_cases;
  v_membership governance.review_case_issues;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:end-membership' AND idempotency_key = p_idempotency_key;
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

  SELECT * INTO v_membership FROM governance.review_case_issues
    WHERE review_case_id = p_review_case_id AND issue_id = p_issue_id AND membership_ended_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: no hay una membresía activa del issue % en el caso %', p_issue_id, p_review_case_id USING ERRCODE = 'P0003';
  END IF;

  UPDATE governance.review_case_issues SET membership_ended_at = now(), membership_end_reason = 'REMOVED_BY_ACTOR', removed_by_actor_id = p_actor_user_id
    WHERE id = v_membership.id;

  UPDATE governance.review_cases SET version = version + 1, updated_at = now() WHERE id = p_review_case_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, issue_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'REVIEW_CASE_UPDATED', 'review-case:end-membership', p_review_case_id, p_issue_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('reviewCaseId', p_review_case_id, 'issueId', p_issue_id, 'membershipEndReason', 'REMOVED_BY_ACTOR'));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'reviewCaseId', p_review_case_id, 'issueId', p_issue_id, 'version', v_case.version + 1, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'review-case:end-membership', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_end_review_case_membership(uuid, text, bigint, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_end_review_case_membership(uuid, text, bigint, bigint, text, text, uuid, integer) TO nexus_app_corrections;

-- =============================================================================
-- fn_reopen_review_case: reabre un caso RESOLVED/DISMISSED -> IN_REVIEW.
-- Nunca restaura las membresías que el cierre en cascada ya terminó (B53) -
-- issues nuevos se agregan explícitamente vía fn_add_issue_to_review_case.
-- =============================================================================
CREATE OR REPLACE FUNCTION governance.fn_reopen_review_case(
  p_actor_user_id uuid,
  p_actor_role text,
  p_review_case_id bigint,
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
  v_request_payload jsonb := jsonb_build_object('commandType', 'review-case:reopen', 'reviewCaseId', p_review_case_id, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_case governance.review_cases;
  v_result jsonb;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'review-case:reopen' AND idempotency_key = p_idempotency_key;
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
  IF v_case.status NOT IN ('RESOLVED','DISMISSED') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: solo se puede reabrir un caso RESOLVED/DISMISSED (actual=%)', v_case.status USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_case.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_case.version USING ERRCODE = 'P0002';
  END IF;

  UPDATE governance.review_cases SET status = 'IN_REVIEW', closed_at = NULL, version = version + 1, updated_at = now()
    WHERE id = p_review_case_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, review_case_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'REVIEW_CASE_UPDATED', 'review-case:reopen', p_review_case_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('reviewCaseId', p_review_case_id, 'status', 'IN_REVIEW'));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'reviewCaseId', p_review_case_id, 'status', 'IN_REVIEW', 'version', v_case.version + 1, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'review-case:reopen', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_reopen_review_case(uuid, text, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_reopen_review_case(uuid, text, bigint, text, text, uuid, integer) TO nexus_app_corrections;
