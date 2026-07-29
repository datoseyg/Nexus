-- Gate B - implementación (tramo "AUDIT_WRITE_SURFACES"): "iniciar revisión"
-- no tenía función propia - un issue solo llegaba a IN_REVIEW como efecto
-- lateral de aplicar una corrección (fn_apply_part_alias/fn_apply_ticket_link
-- crean verification_request y transicionan el issue). Esta función cubre el
-- caso de un humano marcando "estoy revisando esto" ANTES de decidir qué
-- corrección aplicar (o si aplica ninguna) - sin eso no había forma de
-- distinguir "nadie lo ha mirado" de "alguien lo está evaluando" fuera del
-- ciclo de vida de review cases (Familia 4, alcance distinto y posterior).
-- Reutiliza el evento ISSUE_ASSIGNED ya existente en el catálogo (B3) -
-- iniciar revisión es, en efecto, autoasignación implícita - en vez de
-- inventar un event_type nuevo no aprobado.
CREATE OR REPLACE FUNCTION governance.fn_start_review(
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
  v_request_payload jsonb := jsonb_build_object('commandType', 'issue:start-review', 'issueId', p_issue_id, 'expectedVersion', p_expected_version, 'reason', p_reason);
  v_existing_idem governance.idempotency_keys;
  v_issue governance.issues;
  v_result jsonb;
BEGIN
  SELECT * INTO v_existing_idem FROM governance.idempotency_keys
    WHERE actor_type = 'HUMAN' AND actor_key = p_actor_user_id::text AND command_type = 'issue:start-review' AND idempotency_key = p_idempotency_key;
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
  IF v_issue.status <> 'OPEN' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: solo se puede iniciar revisión de un issue OPEN (actual=%)', v_issue.status USING ERRCODE = 'P0001';
  END IF;
  IF p_expected_version IS NOT NULL AND p_expected_version <> v_issue.version THEN
    RAISE EXCEPTION 'VERSION_CONFLICT: esperado %, actual %', p_expected_version, v_issue.version USING ERRCODE = 'P0002';
  END IF;

  UPDATE governance.issues SET status = 'IN_REVIEW', version = version + 1, updated_at = now() WHERE id = p_issue_id;

  INSERT INTO governance.command_events (correlation_id, event_type, command_type, issue_id, actor_type, actor_user_id, actor_role, reason, after_state)
    VALUES (p_correlation_id, 'ISSUE_ASSIGNED', 'issue:start-review', p_issue_id, 'HUMAN', p_actor_user_id, p_actor_role, p_reason,
      jsonb_build_object('issueId', p_issue_id, 'status', 'IN_REVIEW'));

  v_result := jsonb_build_object('commandId', p_correlation_id, 'result', 'APPLIED', 'issueId', p_issue_id, 'status', 'IN_REVIEW', 'version', v_issue.version + 1, 'replay', false);

  INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
    VALUES ('HUMAN', p_actor_user_id::text, 'issue:start-review', p_idempotency_key, v_request_payload,
      encode(public.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, p_correlation_id);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION governance.fn_start_review(uuid, text, bigint, text, text, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION governance.fn_start_review(uuid, text, bigint, text, text, uuid, integer) TO nexus_app_corrections;

ALTER FUNCTION governance.fn_start_review(uuid, text, bigint, text, text, uuid, integer) OWNER TO governance_owner;
