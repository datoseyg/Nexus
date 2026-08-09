-- NEXUS V3 - Mecanismo de actualización manual de datos (secciones 1/2/6/7
-- del encargo). Modela una corrida gobernada del pipeline completo
-- (extraer -> normalizar -> cruzar -> GOLD -> sincronizar Postgres ->
-- validar -> promover snapshot -> reevaluar reglas), disparada
-- explícitamente por un usuario (nunca por el login, nunca automática -
-- trigger_type solo admite 'MANUAL' en esta versión).
--
-- Se evaluaron primero las estructuras existentes (audit.pipeline_runs,
-- audit.warehouse_sync_state, governance.command_events, sql/040/089) y
-- ninguna alcanza: audit.pipeline_runs es un log genérico de una sola etapa
-- (su único escritor real es build-working-hours.js, sin relación con
-- extracción de fuentes); audit.warehouse_sync_state solo modela la carga
-- DuckDB->Postgres, no el pipeline completo; governance.command_events es
-- un log de auditoría append-only de comandos de corrección, no una entidad
-- de seguimiento de corridas. governance.rule_evaluation_runs.triggered_by
-- y pipeline.published_dataset_state.published_refresh_run_id (sql/089) YA
-- estaban provisionados para esta tabla, sin usar hasta ahora - este
-- archivo los conecta.
--
-- "Cerberus" NO es un sistema aparte (confirmado leyendo docs/
-- Levantamiento_Maestro_NEXUS_v2.md): es el nombre conceptual del propio
-- motor de reglas de governance. "Reevaluar Cerberus" y "reevaluar reglas"
-- son la MISMA llamada a governance.fn_run_rule_evaluation - por eso esta
-- tabla tiene una sola columna rule_evaluation_run_id (nunca una
-- "cerberus_run_id" separada y redundante, que solo podría desincronizarse
-- del valor real con el tiempo).

-- =============================================================================
-- 1. pipeline.refresh_runs - una fila por corrida solicitada
-- =============================================================================

CREATE TABLE IF NOT EXISTS pipeline.refresh_runs (
  refresh_run_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment                 text NOT NULL CHECK (environment IN ('LOCAL','STAGING','PRODUCTION')),
  mode                          text NOT NULL CHECK (mode IN ('INCREMENTAL','FULL')),
  trigger_type                   text NOT NULL DEFAULT 'MANUAL' CHECK (trigger_type = 'MANUAL'),
  executor_type                    text NOT NULL CHECK (executor_type IN ('LOCAL','GITHUB')),
  status                             text NOT NULL DEFAULT 'QUEUED' CHECK (status IN
                       ('QUEUED','CLAIMED','RUNNING','SUCCEEDED','FAILED','PARTIAL_FAILED','CANCELLED','SUPERSEDED')),
  requested_by_user_id                 uuid NULL,
  requested_by_role                      text NULL,
  requested_at                             timestamptz NOT NULL DEFAULT now(),
  confirmed                                  boolean NOT NULL DEFAULT false,
  reason                                       text NULL,
  -- La idempotencia real vive en governance.idempotency_keys (mismo
  -- mecanismo que TODO comando de gobierno, ver fn_start_refresh_run) -
  -- nunca una columna/índice propio duplicando esa tabla.
  correlation_id                                   uuid NULL,
  external_workflow_run_id                           text NULL,
  claimed_by                                           text NULL,
  claimed_at                                             timestamptz NULL,
  started_at                                               timestamptz NULL,
  finished_at                                                timestamptz NULL,
  last_heartbeat_at                                            timestamptz NULL,
  current_stage                                                  text NULL,
  sources_requested                                                text[] NULL,
  sources_completed                                                  text[] NULL,
  rows_extracted                                                       integer NULL,
  rows_loaded                                                            integer NULL,
  validation_status                                                        text NULL CHECK (validation_status IS NULL OR validation_status IN ('PENDING','PASSED','FAILED')),
  rule_evaluation_run_id                                                     uuid NULL REFERENCES governance.rule_evaluation_runs(evaluation_run_id),
  source_snapshot_id                                                           text NULL,
  error_code                                                                     text NULL,
  -- Sanitizado SIEMPRE (nunca stack trace crudo, nunca connection string,
  -- nunca credencial) - ver pipeline.fn_fail_refresh_run.
  error_summary                                                                    text NULL,
  source_stats                                                                       jsonb NULL,
  metadata                                                                             jsonb NULL,
  created_at                                                                             timestamptz NOT NULL DEFAULT now(),
  updated_at                                                                               timestamptz NOT NULL DEFAULT now()
);

-- Protección contra concurrencia (sección 6) - un índice único parcial es la
-- garantía REAL (nunca vencible por saltarse la función gobernada), mismo
-- patrón que governance.verification_requests_one_active (sql/089:480-481).
CREATE UNIQUE INDEX IF NOT EXISTS refresh_runs_one_active_per_environment
  ON pipeline.refresh_runs (environment) WHERE status IN ('QUEUED','CLAIMED','RUNNING');

CREATE INDEX IF NOT EXISTS refresh_runs_environment_status_idx ON pipeline.refresh_runs (environment, status, requested_at DESC);

-- Cierra el placeholder ya reservado en sql/089:208 (published_refresh_run_id
-- uuid NULL, sin FK hasta que esta tabla existiera).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'published_dataset_state_refresh_run_fk'
  ) THEN
    ALTER TABLE pipeline.published_dataset_state
      ADD CONSTRAINT published_dataset_state_refresh_run_fk
      FOREIGN KEY (published_refresh_run_id) REFERENCES pipeline.refresh_runs(refresh_run_id);
  END IF;
END
$$;

-- Semilla de entornos (mismo criterio que governance.evaluation_publication_state/
-- pipeline.published_dataset_state ya seedeados con 'default', sql/089:201-213)
-- - 'LOCAL' es el único entorno real hoy (staging/production son proyectos
-- Supabase V3 todavía sin crear, ver reporte final sección 11); se seedean
-- igual para que el UNIQUE INDEX de concurrencia y las consultas de estado
-- funcionen sin una migración adicional el día que existan.
INSERT INTO pipeline.published_dataset_state (environment_key) VALUES ('LOCAL'), ('STAGING'), ('PRODUCTION')
ON CONFLICT (environment_key) DO NOTHING;

-- =============================================================================
-- 2. pipeline.refresh_run_stages - progreso por etapa (extraer/normalizar/
-- cruzar/gold/sincronizar/validar/promover/reevaluar reglas), mismo grano
-- que governance.rule_evaluation_run_items (sql/089:156-167) para el
-- ejecutor de reglas.
-- =============================================================================

CREATE TABLE IF NOT EXISTS pipeline.refresh_run_stages (
  refresh_run_id    uuid NOT NULL REFERENCES pipeline.refresh_runs(refresh_run_id),
  stage_name          text NOT NULL,
  status                 text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  started_at               timestamptz NOT NULL DEFAULT now(),
  finished_at                timestamptz NULL,
  error_message                 text NULL,
  PRIMARY KEY (refresh_run_id, stage_name)
);

-- =============================================================================
-- 3. Roles PostgreSQL de mínimo privilegio (mismo patrón que sql/089 sección
-- 14) - nexus_pipeline_requester: la API Next.js (crea corridas, lee
-- estado). nexus_pipeline_worker: el worker local y el job de GitHub
-- Actions (reclama, actualiza etapas, completa/falla). Ninguno de los dos
-- puede tocar manual_review.*/governance.issues directo - eso sigue siendo
-- exclusivo de nexus_rule_evaluator dentro de fn_run_rule_evaluation.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_pipeline_requester') THEN
    CREATE ROLE nexus_pipeline_requester WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'nexus_pipeline_worker') THEN
    CREATE ROLE nexus_pipeline_worker WITH LOGIN PASSWORD '__SET_IN_SUPABASE_DASHBOARD__';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA pipeline TO nexus_pipeline_requester, nexus_pipeline_worker;
GRANT USAGE ON SCHEMA governance TO nexus_pipeline_requester, nexus_pipeline_worker;

-- governance_owner (identidad efectiva dentro de las funciones SECURITY
-- DEFINER de abajo, mismo criterio que sql/089:632-648) necesita sus
-- propios privilegios sobre las tablas nuevas.
GRANT ALL ON pipeline.refresh_runs, pipeline.refresh_run_stages TO governance_owner;
GRANT SELECT, UPDATE ON pipeline.published_dataset_state TO governance_owner;

-- Lectura de estado (GET /api/data-refresh/*, ambos roles - gerencia y
-- administracion comparten data:refresh:observe, sql/100) - solo vía la
-- conexión nexus_pipeline_requester, nunca el pool genérico nexus_app_read
-- (que no tiene grant sobre pipeline.*).
GRANT SELECT ON pipeline.refresh_runs, pipeline.refresh_run_stages TO nexus_pipeline_requester, nexus_pipeline_worker;
GRANT SELECT ON pipeline.published_dataset_state TO nexus_pipeline_requester, nexus_pipeline_worker;

-- =============================================================================
-- 4. Funciones gobernadas (mismo patrón que governance.fn_run_rule_evaluation,
-- sql/090:274-341: LANGUAGE plpgsql, SECURITY DEFINER, search_path fijo,
-- advisory lock antes de cualquier INSERT/UPDATE).
-- =============================================================================

-- Crea una corrida QUEUED o devuelve la ya activa (idempotente por
-- environment - índice único parcial arriba es la garantía real; el
-- advisory lock evita que dos requests simultáneos ambos intenten insertar
-- y uno choque contra una violación de constraint cruda). CONFIRMATION_REQUIRED
-- se valida ACÁ TAMBIÉN (defensa en profundidad, no solo en la API route) -
-- scope=FULL sin p_confirmed=true nunca crea una fila.
CREATE OR REPLACE FUNCTION pipeline.fn_start_refresh_run(
  p_environment text,
  p_mode text,
  p_executor_type text,
  p_actor_user_id uuid,
  p_actor_role text,
  p_confirmed boolean,
  p_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
DECLARE
  v_lock_key bigint := hashtext('pipeline.refresh_run.' || p_environment);
  v_existing pipeline.refresh_runs%ROWTYPE;
  v_existing_idem governance.idempotency_keys;
  -- Mismo actor_type/actor_key que el resto de governance (sql/089:427-428):
  -- HUMAN cuando viene de una sesión Nexus real (Next.js), SERVICE cuando lo
  -- dispara el orquestador sin usuario (workflow_dispatch de GitHub Actions).
  v_actor_type text := CASE WHEN p_actor_user_id IS NOT NULL THEN 'HUMAN' ELSE 'SERVICE' END;
  v_actor_key text := coalesce(p_actor_user_id::text, p_actor_role, 'unknown');
  v_request_payload jsonb := jsonb_build_object(
    'commandType', 'data-refresh:start', 'environment', p_environment, 'mode', p_mode,
    'executorType', p_executor_type, 'confirmed', coalesce(p_confirmed, false), 'reason', p_reason
  );
  v_run_id uuid;
  v_result jsonb;
BEGIN
  IF p_environment NOT IN ('LOCAL','STAGING','PRODUCTION') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: environment inválido: %', p_environment USING ERRCODE = 'P0001';
  END IF;
  IF p_mode NOT IN ('INCREMENTAL','FULL') THEN
    RAISE EXCEPTION 'VALIDATION_ERROR: mode inválido: %', p_mode USING ERRCODE = 'P0001';
  END IF;
  IF p_mode = 'FULL' AND NOT coalesce(p_confirmed, false) THEN
    RAISE EXCEPTION 'CONFIRMATION_REQUIRED: mode=FULL exige confirmed=true' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotencia: MISMO mecanismo que todo comando de gobierno
  -- (governance.idempotency_keys, ver governance.fn_apply_part_alias
  -- sql/090:385-394) - nunca una columna/índice propio reimplementado acá.
  -- Compara request_payload completo (nunca solo la clave) para poder
  -- distinguir un replay legítimo de una reutilización con otro body.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing_idem FROM governance.idempotency_keys
      WHERE actor_type = v_actor_type AND actor_key = v_actor_key
        AND command_type = 'data-refresh:start' AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
      IF v_existing_idem.request_payload = v_request_payload THEN
        RETURN jsonb_set(v_existing_idem.response_snapshot, '{replay}', 'true'::jsonb);
      ELSE
        RAISE EXCEPTION 'IDEMPOTENCY_KEY_REUSED_DIFFERENT_BODY' USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT * INTO v_existing FROM pipeline.refresh_runs
    WHERE environment = p_environment AND status IN ('QUEUED','CLAIMED','RUNNING')
    LIMIT 1;
  IF FOUND THEN
    -- ALREADY_RUNNING es una respuesta transitoria ("todavía no, reintenta
    -- luego"), nunca se persiste en idempotency_keys - un reintento con la
    -- misma clave DESPUÉS de que la corrida activa termine debe poder crear
    -- una corrida nueva de verdad, no quedar repitiendo este estado viejo.
    RETURN jsonb_build_object('refreshRunId', v_existing.refresh_run_id, 'status', 'ALREADY_RUNNING');
  END IF;

  INSERT INTO pipeline.refresh_runs
    (environment, mode, executor_type, requested_by_user_id, requested_by_role, confirmed, reason, correlation_id, sources_requested)
  VALUES
    (p_environment, p_mode, p_executor_type, p_actor_user_id, p_actor_role, coalesce(p_confirmed, false), p_reason, p_correlation_id,
     ARRAY['fieldbeat','zendesk','dolibarr'])
  RETURNING refresh_run_id INTO v_run_id;

  v_result := jsonb_build_object('refreshRunId', v_run_id, 'status', 'QUEUED', 'replay', false);

  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO governance.idempotency_keys (actor_type, actor_key, command_type, idempotency_key, request_payload, body_hash, response_snapshot, correlation_id)
      VALUES (v_actor_type, v_actor_key, 'data-refresh:start', p_idempotency_key, v_request_payload,
        encode(extensions.digest(v_request_payload::text, 'sha256'), 'hex'), v_result, coalesce(p_correlation_id, gen_random_uuid()));
  END IF;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_start_refresh_run(text, text, text, uuid, text, boolean, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_start_refresh_run(text, text, text, uuid, text, boolean, text, text, uuid) TO nexus_pipeline_requester;

-- Reclamo tipo cola de trabajo (FOR UPDATE SKIP LOCKED - patrón estándar,
-- sin precedente previo en este codebase pero es la primitiva correcta para
-- "el próximo worker libre toma la próxima corrida en cola", a diferencia
-- del advisory lock de arriba que solo serializa la creación).
CREATE OR REPLACE FUNCTION pipeline.fn_claim_next_refresh_run(
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
    WHERE environment = p_environment AND executor_type = p_executor_type AND status = 'QUEUED'
    ORDER BY requested_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('claimed', false);
  END IF;

  UPDATE pipeline.refresh_runs
    SET status = 'CLAIMED', claimed_by = p_claimed_by, claimed_at = now(), last_heartbeat_at = now(), updated_at = now()
    WHERE refresh_run_id = v_run.refresh_run_id;

  RETURN jsonb_build_object('claimed', true, 'refreshRunId', v_run.refresh_run_id, 'mode', v_run.mode, 'environment', v_run.environment);
END;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_claim_next_refresh_run(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_claim_next_refresh_run(text, text, text) TO nexus_pipeline_worker;

CREATE OR REPLACE FUNCTION pipeline.fn_update_refresh_run_stage(
  p_refresh_run_id uuid,
  p_stage_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
BEGIN
  UPDATE pipeline.refresh_run_stages SET status = 'SUCCEEDED', finished_at = now()
    WHERE refresh_run_id = p_refresh_run_id AND status = 'RUNNING' AND stage_name <> p_stage_name;

  INSERT INTO pipeline.refresh_run_stages (refresh_run_id, stage_name, status)
    VALUES (p_refresh_run_id, p_stage_name, 'RUNNING')
    ON CONFLICT (refresh_run_id, stage_name) DO UPDATE SET status = 'RUNNING', started_at = now(), finished_at = NULL;

  UPDATE pipeline.refresh_runs
    SET status = 'RUNNING', current_stage = p_stage_name, last_heartbeat_at = now(),
        started_at = coalesce(started_at, now()), updated_at = now()
    WHERE refresh_run_id = p_refresh_run_id;
END;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_update_refresh_run_stage(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_update_refresh_run_stage(uuid, text) TO nexus_pipeline_worker;

CREATE OR REPLACE FUNCTION pipeline.fn_heartbeat_refresh_run(p_refresh_run_id uuid) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
  UPDATE pipeline.refresh_runs SET last_heartbeat_at = now(), updated_at = now() WHERE refresh_run_id = p_refresh_run_id;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_heartbeat_refresh_run(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_heartbeat_refresh_run(uuid) TO nexus_pipeline_worker;

-- Marca SUCCEEDED y publica el snapshot - la fecha de "última actualización
-- exitosa" (pipeline.published_dataset_state) SOLO cambia acá, nunca en
-- QUEUED/CLAIMED/RUNNING (sección 6 del encargo). rule_evaluation_run_id es
-- la evidencia de que la reevaluación de reglas (= Cerberus) ya terminó
-- antes de publicar - fn_complete_refresh_run nunca se llama antes de eso.
CREATE OR REPLACE FUNCTION pipeline.fn_complete_refresh_run(
  p_refresh_run_id uuid,
  p_sources_completed text[],
  p_rows_extracted integer,
  p_rows_loaded integer,
  p_validation_status text,
  p_rule_evaluation_run_id uuid,
  p_source_snapshot_id text,
  p_source_stats jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
DECLARE
  v_environment text;
BEGIN
  UPDATE pipeline.refresh_run_stages SET status = 'SUCCEEDED', finished_at = now()
    WHERE refresh_run_id = p_refresh_run_id AND status = 'RUNNING';

  UPDATE pipeline.refresh_runs
    SET status = 'SUCCEEDED', finished_at = now(), last_heartbeat_at = now(), updated_at = now(),
        sources_completed = p_sources_completed, rows_extracted = p_rows_extracted, rows_loaded = p_rows_loaded,
        validation_status = p_validation_status, rule_evaluation_run_id = p_rule_evaluation_run_id,
        source_snapshot_id = p_source_snapshot_id, source_stats = coalesce(p_source_stats, source_stats)
    WHERE refresh_run_id = p_refresh_run_id
    RETURNING environment INTO v_environment;

  UPDATE pipeline.published_dataset_state
    SET published_data_generation = published_data_generation + 1,
        source_snapshot_id = p_source_snapshot_id,
        published_refresh_run_id = p_refresh_run_id,
        published_at = now()
    WHERE environment_key = v_environment;
END;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_complete_refresh_run(uuid, text[], integer, integer, text, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_complete_refresh_run(uuid, text[], integer, integer, text, uuid, text, jsonb) TO nexus_pipeline_worker;

-- p_partial=true (PARTIAL_FAILED) para una falla DESPUÉS de que algo ya se
-- escribió pero antes de completar publicación - distinto de FAILED
-- (nunca llegó a tocar el snapshot publicado). error_summary SIEMPRE
-- saneado por el caller (orquestador) antes de llegar acá - nunca un stack
-- trace ni una connection string.
CREATE OR REPLACE FUNCTION pipeline.fn_fail_refresh_run(
  p_refresh_run_id uuid,
  p_error_code text,
  p_error_summary text,
  p_partial boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pipeline
AS $$
BEGIN
  UPDATE pipeline.refresh_run_stages SET status = 'FAILED', finished_at = now(), error_message = p_error_summary
    WHERE refresh_run_id = p_refresh_run_id AND status = 'RUNNING';

  UPDATE pipeline.refresh_runs
    SET status = CASE WHEN p_partial THEN 'PARTIAL_FAILED' ELSE 'FAILED' END,
        finished_at = now(), last_heartbeat_at = now(), updated_at = now(),
        error_code = p_error_code, error_summary = p_error_summary
    WHERE refresh_run_id = p_refresh_run_id;
END;
$$;

REVOKE ALL ON FUNCTION pipeline.fn_fail_refresh_run(uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_fail_refresh_run(uuid, text, text, boolean) TO nexus_pipeline_worker;

-- =============================================================================
-- 5. Owner de las funciones SECURITY DEFINER de arriba: governance_owner
-- (NOLOGIN), NUNCA quien aplique la migración (que en Supabase es
-- efectivamente un rol administrador) - mismo criterio y mismo mecanismo que
-- sql/090_governance_functions.sql:677-693, extendido acá al schema
-- `pipeline` (ese bloque original está scoped a `n.nspname = 'governance'`,
-- nunca tocaría estas funciones). Se reasigna al final por la misma razón:
-- el bloque de creación de arriba no requiere SET ROLE previo.
--
-- PostgreSQL exige, además de poder SET ROLE al nuevo owner (sql/089:
-- "GRANT governance_owner TO SESSION_USER WITH INHERIT FALSE, SET TRUE"),
-- que ese nuevo owner tenga CREATE sobre el schema de cada función
-- transferida - governance_owner ya tiene CREATE en `governance` (sql/089:636),
-- pero sql/089 solo le otorgó USAGE en `pipeline` (línea 637), nunca CREATE,
-- porque ese schema todavía no tenía ningún objeto propio de governance_owner
-- en ese momento. Sin este GRANT, el ALTER FUNCTION de abajo falla con
-- "permission denied for schema pipeline" (42501, confirmado contra
-- Supabase) - distinto del error de sql/090/098 (ese era falta de SET ROLE;
-- este es falta de CREATE en el schema destino, ambos exigidos por el mismo
-- ALTER ... OWNER TO). Privilegio mínimo y explícito -solo CREATE, nunca
-- ownership del schema completo (no hace falta: CREATE alcanza para que
-- governance_owner pueda poseer objetos ahí, nunca le da control sobre el
-- schema en sí ni sobre objetos de otros). No se toca USAGE (ya otorgado en
-- sql/089) ni se otorga nada a ningún rol runtime. Idempotente: repetir el
-- mismo GRANT nunca falla ni amplía nada.
GRANT CREATE ON SCHEMA pipeline TO governance_owner;

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
