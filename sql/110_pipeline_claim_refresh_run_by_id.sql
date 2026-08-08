-- NEXUS V3 - Reclamo EXACTO por refresh_run_id (aditiva sobre sql/101/102).
--
-- Blocker de revisión de producto: el puente POST /api/data-refresh/runs ->
-- workflow_dispatch (sql/101 + lib/github-actions-dispatch.ts) pasaba
-- refresh_run_id como input del workflow, pero el worker automático seguía
-- usando pipeline.fn_claim_next_refresh_run (cola genérica) y solo
-- COMPARABA el resultado contra ese id DESPUÉS de reclamar (ver
-- scripts/pipeline/run-data-refresh.mjs::checkRefreshRunClaimMatchesExpectation).
-- Eso evitaba EJECUTAR el pipeline equivocado, pero ya había reclamado/
-- modificado (CLAIMED + claimed_by/claimed_at) una corrida que no
-- correspondía a este dispatch - un efecto secundario real sobre una fila
-- que nada tenía que ver.
--
-- pipeline.fn_claim_refresh_run_by_id reclama EXACTAMENTE el UUID pedido -
-- estructuralmente no puede tocar ninguna otra fila, porque el único WHERE
-- de todo el cuerpo de la función es por refresh_run_id (primary key). El
-- dispatch automático (workflow con refresh_run_id, ver data-refresh.yml)
-- pasa a usar esta función como mecanismo PRINCIPAL; fn_claim_next_refresh_run
-- (sql/101) se conserva sin cambios para el dispatch manual/emergencia SIN
-- refresh_run_id (workflow_dispatch llenado a mano en GitHub, mismo
-- comportamiento de siempre: toma lo próximo en cola).
-- checkRefreshRunClaimMatchesExpectation en run-data-refresh.mjs se
-- conserva también, como defensa en profundidad (nunca el mecanismo
-- principal) - con el claim exacto, esa comparación pasa a ser
-- tautológicamente cierta en el camino automático; sigue protegiendo contra
-- una futura regresión que reintroduzca claim-next ahí sin darse cuenta.
--
-- FOR UPDATE SKIP LOCKED sobre una búsqueda por PRIMARY KEY (en vez de por
-- un conjunto, como en fn_claim_next_refresh_run) da exactamente la
-- semántica de "doble dispatch inocuo" que pide el requisito: si dos
-- llamadas concurrentes piden el MISMO refresh_run_id, la primera en llegar
-- toma el lock de esa fila y la reclama; la segunda, mientras la primera
-- todavía no libera el lock (transacción en vuelo), la encuentra
-- bloqueada y SKIP LOCKED hace que la vea como "no encontrada" -> sale
-- limpia con claimed:false sin esperar ni bloquear. Si la segunda llega
-- DESPUÉS de que la primera ya confirmó (commit), encuentra la fila libre
-- pero con status<>'QUEUED' -> también sale limpia con claimed:false. En
-- ningún caso hay una segunda fila involucrada: la función jamás hace un
-- SELECT/UPDATE por environment/executor_type solos, siempre acota primero
-- por refresh_run_id exacto.
--
-- p_environment/p_executor_type: el caller (run-data-refresh.mjs, con los
-- mismos --environment/--executor-type que ya recibía) declara qué esperaba
-- encontrar; la función los VERIFICA contra la fila real antes de reclamar
-- -un id válido pero de otro entorno/ejecutor nunca se reclama por
-- accidente, incluso si alguien pasara un UUID ajeno a mano.
--
-- Mismo patrón que pipeline.fn_claim_next_refresh_run (sql/101): SECURITY
-- DEFINER, search_path fijo, mismas columnas de fencing (claimed_by/
-- claimed_at/last_heartbeat_at) - así fn_heartbeat_refresh_run,
-- fn_reap_stale_refresh_runs (sql/102), fn_update_refresh_run_stage y
-- fn_complete_refresh_run/fn_fail_refresh_run siguen funcionando sin ningún
-- cambio sobre una fila reclamada por acá; para esas funciones, una fila
-- CLAIMED por fn_claim_refresh_run_by_id es indistinguible de una CLAIMED
-- por fn_claim_next_refresh_run. La invariante "una corrida activa por
-- environment" (refresh_runs_one_active_per_environment, sql/101) tampoco
-- se ve afectada: esta función nunca inserta filas, solo transiciona una
-- fila YA QUEUED (ya contada como activa) a CLAIMED (sigue activa) - el
-- conteo de filas activas por entorno no cambia.
CREATE OR REPLACE FUNCTION pipeline.fn_claim_refresh_run_by_id(
  p_refresh_run_id uuid,
  p_environment text,
  p_executor_type text,
  p_claimed_by text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
DECLARE
  v_run pipeline.refresh_runs%ROWTYPE;
BEGIN
  SELECT * INTO v_run FROM pipeline.refresh_runs
    WHERE refresh_run_id = p_refresh_run_id
    FOR UPDATE SKIP LOCKED;

  -- No encontrada: o el id no existe (dispatch corrupto/reintento
  -- disparatado), o otra transacción concurrente ya tiene el lock de ESTA
  -- MISMA fila en vuelo (SKIP LOCKED) - en ambos casos, salida limpia sin
  -- tocar nada.
  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'NOT_FOUND_OR_LOCKED');
  END IF;

  IF v_run.status <> 'QUEUED' THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'NOT_QUEUED', 'status', v_run.status);
  END IF;

  IF v_run.environment <> p_environment THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'ENVIRONMENT_MISMATCH', 'environment', v_run.environment);
  END IF;

  IF v_run.executor_type <> p_executor_type THEN
    RETURN jsonb_build_object('claimed', false, 'reason', 'EXECUTOR_TYPE_MISMATCH', 'executorType', v_run.executor_type);
  END IF;

  UPDATE pipeline.refresh_runs
    SET status = 'CLAIMED', claimed_by = p_claimed_by, claimed_at = now(), last_heartbeat_at = now(), updated_at = now()
    WHERE refresh_run_id = v_run.refresh_run_id;

  RETURN jsonb_build_object('claimed', true, 'refreshRunId', v_run.refresh_run_id, 'mode', v_run.mode, 'environment', v_run.environment);
END;
$$;

-- Mismo rol que fn_claim_next_refresh_run: solo el worker reclama (nunca el
-- requester, que solo crea/lee corridas) - grant mínimo, un único rol.
REVOKE ALL ON FUNCTION pipeline.fn_claim_refresh_run_by_id(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_claim_refresh_run_by_id(uuid, text, text, text) TO nexus_pipeline_worker;

-- Owner - mismo mecanismo que sql/101 sección 5 / sql/102 sección 3,
-- reaplicado (idempotente, compatible con un migrador no-superuser: la
-- membresía SET ROLE governance_owner y el GRANT CREATE ON SCHEMA pipeline
-- ya quedaron establecidos por sql/089/101, nunca se repiten acá). Vuelve a
-- barrer TODO pipeline.* - sin efecto adicional sobre las funciones ya
-- transferidas por 101/102, transfiere la nueva de este archivo.
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
