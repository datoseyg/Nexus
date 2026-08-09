-- NEXUS V3 - Recuperación gobernada de corridas de refresh abandonadas
-- (sql/101 no cubría esto). Dos escenarios reales distintos, dos funciones
-- separadas:
--   1. QUEUED que nadie reclama (el worker local nunca arrancó, o crasheó
--      antes de reclamar) - requiere una decisión HUMANA explícita
--      (cancelar), nunca automática: "QUEUED hace rato" es ambiguo (puede
--      significar "el worker está ocupado con otra cosa" tanto como "el
--      worker nunca arrancó"), así que NUNCA se cancela sola.
--   2. CLAIMED/RUNNING sin heartbeat reciente - señal fuerte y objetiva de
--      abandono real (un worker vivo actualiza el heartbeat cada 15s, ver
--      scripts/pipeline/run-data-refresh.mjs::HEARTBEAT_INTERVAL_MS) - segura
--      de automatizar, el worker la corre sola en cada tick de polling
--      (scripts/pipeline/local-refresh-worker.mjs).
--
-- Ninguna de las dos se llama nunca desde el navegador ni actualiza
-- pipeline.refresh_runs por fuera de estas funciones SECURITY DEFINER -
-- misma disciplina que sql/101 (el índice único parcial
-- refresh_runs_one_active_per_environment es la garantía real de
-- concurrencia; liberar el "índice" de una corrida activa abandonada es
-- simplemente sacarla de {QUEUED,CLAIMED,RUNNING}, consecuencia natural de
-- marcarla CANCELLED/FAILED acá, no un mecanismo aparte).

-- =============================================================================
-- 1. Cancelar una corrida QUEUED - acción explícita, nunca automática.
-- =============================================================================
CREATE OR REPLACE FUNCTION pipeline.fn_cancel_queued_refresh_run(
  p_refresh_run_id uuid,
  p_actor_user_id uuid,
  p_actor_role text,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
DECLARE
  v_run pipeline.refresh_runs%ROWTYPE;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_run FROM pipeline.refresh_runs WHERE refresh_run_id = p_refresh_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: refresh_run_id %', p_refresh_run_id USING ERRCODE = 'P0001';
  END IF;

  -- Solo QUEUED - una vez CLAIMED, un worker puede estar escribiendo de
  -- verdad; cancelarla a mitad de camino es un problema distinto (ver
  -- fn_reap_stale_refresh_runs, que exige evidencia objetiva de abandono
  -- - heartbeat vencido - en vez de solo "alguien quiso cancelar").
  IF v_run.status <> 'QUEUED' THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: solo se puede cancelar una corrida QUEUED (estado actual: %)', v_run.status USING ERRCODE = 'P0001';
  END IF;

  UPDATE pipeline.refresh_runs
    SET status = 'CANCELLED', finished_at = now(), updated_at = now(),
        error_code = 'CANCELLED_BY_REQUEST',
        error_summary = format('Cancelada manualmente por %s (rol %s): %s', coalesce(p_actor_user_id::text, 'desconocido'), coalesce(p_actor_role, 'desconocido'), p_reason)
    WHERE refresh_run_id = p_refresh_run_id;

  RETURN jsonb_build_object('refreshRunId', p_refresh_run_id, 'status', 'CANCELLED');
END;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_cancel_queued_refresh_run(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_cancel_queued_refresh_run(uuid, uuid, text, text) TO nexus_pipeline_requester;

-- =============================================================================
-- 2. Reaper: CLAIMED/RUNNING sin heartbeat reciente -> FAILED (partial,
-- nunca SUCCEEDED) - el propio worker la corre en cada tick de polling
-- ANTES de intentar reclamar trabajo nuevo, así una corrida abandonada
-- libera el entorno automáticamente sin intervención humana. Idempotente:
-- si no hay nada que reparar, devuelve un array vacío.
-- =============================================================================
CREATE OR REPLACE FUNCTION pipeline.fn_reap_stale_refresh_runs(
  p_stale_after_interval interval DEFAULT '5 minutes',
  p_environment text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
DECLARE
  v_reaped jsonb;
BEGIN
  WITH stale AS (
    SELECT refresh_run_id, environment, current_stage, last_heartbeat_at
    FROM pipeline.refresh_runs
    WHERE status IN ('CLAIMED', 'RUNNING')
      AND (p_environment IS NULL OR environment = p_environment)
      -- CLAIMED sin RUNNING todavía puede no tener last_heartbeat_at más
      -- reciente que claimed_at (fn_claim_next_refresh_run ya fija
      -- last_heartbeat_at=now() al reclamar) - coalesce por defensa, nunca
      -- debería ser NULL en la práctica dado ese fn_claim, pero si lo
      -- fuera, cae a claimed_at/started_at antes que "siempre activo".
      AND coalesce(last_heartbeat_at, claimed_at, started_at) < now() - p_stale_after_interval
    FOR UPDATE SKIP LOCKED
  ),
  failed_stages AS (
    UPDATE pipeline.refresh_run_stages
      SET status = 'FAILED', finished_at = now(),
          error_message = format('Reap automático: sin heartbeat desde %s', now())
      WHERE refresh_run_id IN (SELECT refresh_run_id FROM stale) AND status = 'RUNNING'
  ),
  updated AS (
    UPDATE pipeline.refresh_runs r
      SET status = 'PARTIAL_FAILED', finished_at = now(), updated_at = now(),
          error_code = 'REAPED_STALE_HEARTBEAT',
          error_summary = format(
            'Reap automático: última señal de vida hace más de %s (última etapa vista: %s, último heartbeat: %s) - ningún worker sigue respondiendo por esta corrida.',
            p_stale_after_interval, coalesce(s.current_stage, '(ninguna)'), coalesce(s.last_heartbeat_at::text, '(nunca)')
          )
      FROM stale s
      WHERE r.refresh_run_id = s.refresh_run_id
      RETURNING r.refresh_run_id, r.environment
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('refreshRunId', refresh_run_id, 'environment', environment)), '[]'::jsonb)
    INTO v_reaped FROM updated;

  RETURN v_reaped;
END;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_reap_stale_refresh_runs(interval, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_reap_stale_refresh_runs(interval, text) TO nexus_pipeline_worker, nexus_pipeline_requester;

-- =============================================================================
-- 3. Owner - mismo mecanismo que sql/101 sección 5, reaplicado (idempotente,
-- vuelve a barrer TODO pipeline.* - incluidas las funciones de sql/101, sin
-- efecto adicional sobre ellas, y las 2 nuevas de este archivo).
-- =============================================================================
DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pipeline'
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO governance_owner', v_fn.sig);
  END LOOP;
END
$$;
