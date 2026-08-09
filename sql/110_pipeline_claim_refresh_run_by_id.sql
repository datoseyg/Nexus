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
--
-- =============================================================================
-- Corrección post-intento fallido en Cloud - ownership no-superusuario.
-- =============================================================================
-- El intento previo de aplicar este archivo contra Cloud falló, pero NO hizo
-- rollback: la función quedó persistida, con owner=governance_owner,
-- prosecdef=true y ACL correcta (nexus_pipeline_worker con EXECUTE, PUBLIC
-- ausente) - exactamente el estado final deseado. La falla real estaba en el
-- mecanismo de idempotencia de ESTE archivo, no en la función en sí:
--
-- El migrador real de Cloud es un rol NO superusuario, miembro de
-- governance_owner con INHERIT FALSE / SET TRUE (mismo patrón que sql/089
-- establece para "quien aplique la migración"). INHERIT FALSE significa que
-- el migrador NO hereda automáticamente los privilegios de governance_owner
-- -Postgres exige un `SET ROLE governance_owner` explícito para actuar como
-- tal. La versión anterior de este archivo hacía `CREATE OR REPLACE
-- FUNCTION` directo como el migrador, seguido de un sweep `ALTER FUNCTION
-- ... OWNER TO governance_owner` sobre TODO pipeline.* al final (mismo
-- patrón que sql/101/102). Eso funciona la PRIMERA vez (el migrador acaba
-- de crear la función, la posee, puede transferirla), pero falla en
-- cualquier reintento posterior: para entonces la función ya pertenece a
-- governance_owner, y `CREATE OR REPLACE FUNCTION` ejecutado por el
-- migrador (sin SET ROLE, por el INHERIT FALSE) ya no cuenta como "es
-- owner" para Postgres -> "must be owner of function
-- pipeline.fn_claim_refresh_run_by_id". Reintentar el archivo tal cual
-- reproduce la misma falla indefinidamente contra el estado real de Cloud.
--
-- (Nota aparte, fuera del alcance de esta corrección: sql/101 y sql/102
-- tienen la MISMA fragilidad estructural en su propio sweep final, pero
-- nunca se manifestó porque bootstrap-disposable-postgres.mjs -el único
-- caller de estos archivos en local- siempre conecta como superusuario, que
-- bypassa cualquier chequeo de ownership. Ningún test de idempotencia local
-- existente lo detecta por la misma razón. No se toca acá -el pedido actual
-- es exclusivamente sql/110-, pero queda documentado para quien retome esto.)
--
-- Corrección: detectar el owner ACTUAL antes de tocar nada, y nunca asumir
-- que el migrador es quien la posee.
--   1. Función inexistente (fresh) -> nada que detectar, se crea más abajo
--      directamente como governance_owner (vía SET ROLE) - queda con el
--      owner correcto desde el instante de creación, sin ALTER posterior.
--   2. owner actual = governance_owner (el estado real observado en Cloud
--      tras el intento previo) -> NINGÚN ALTER OWNER (sería redundante) -
--      el SET ROLE + CREATE OR REPLACE de más abajo alcanza solo.
--   3. owner actual = el propio rol que corre esta migración
--      ("partial-owned-by-migrator", ej. un intento aún más antiguo que
--      creó la función pero nunca llegó a transferirla) -> el migrador SÍ
--      la posee todavía, así que PUEDE hacer ALTER OWNER TO governance_owner
--      él mismo (no necesita SET ROLE para eso: ALTER OWNER exige poseer el
--      objeto -cierto acá- y ser miembro del rol destino -cierto por el
--      GRANT ... SET TRUE de sql/089-, nunca depende de INHERIT). Tras esa
--      transferencia, queda en el mismo estado que el caso 2.
--   4. owner actual: cualquier otro rol inesperado (ni governance_owner ni
--      el migrador) -> FALLA FUERTE Y EXPLÍCITA, nombrando el owner real.
--      Nunca DROP automático, nunca reasignación silenciosa - exige
--      revisión manual de cómo llegó a ese estado.
-- Con los casos 1-3 resueltos (o el 4 ya habiendo abortado), `SET ROLE
-- governance_owner` es SIEMPRE seguro antes de CREATE OR REPLACE FUNCTION:
-- la función, si existe, es governance_owner; si no existe, se crea como
-- governance_owner directamente. Por eso el sweep final sobre TODO
-- pipeline.* desaparece por completo -era el mecanismo que este archivo
-- necesitaba cuando dependía de que el migrador fuera el owner transitorio;
-- ya no aplica.
DO $$
DECLARE
  v_current_owner text;
  v_migrator text := current_user;
BEGIN
  SELECT pg_get_userbyid(p.proowner) INTO v_current_owner
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'pipeline' AND p.proname = 'fn_claim_refresh_run_by_id';

  IF v_current_owner IS NULL THEN
    -- Caso 1 (fresh): no existe todavía, nada que hacer acá.
    RETURN;
  END IF;

  IF v_current_owner = 'governance_owner' THEN
    -- Caso 2: ya está en el estado final deseado - nunca un ALTER redundante.
    RETURN;
  END IF;

  IF v_current_owner = v_migrator THEN
    -- Caso 3: el propio migrador todavía la posee - transferirla ÉL MISMO
    -- (puede: la posee + es miembro SET-able de governance_owner).
    ALTER FUNCTION pipeline.fn_claim_refresh_run_by_id(uuid, text, text, text) OWNER TO governance_owner;
    RETURN;
  END IF;

  -- Caso 4: owner inesperado - ni governance_owner ni quien corre esta
  -- migración. Nunca se repara solo.
  RAISE EXCEPTION 'pipeline.fn_claim_refresh_run_by_id ya existe con un owner inesperado: "%". Se esperaba "governance_owner" o el rol que corre esta migración ("%"). Revisar manualmente antes de reintentar -nunca DROP automático.', v_current_owner, v_migrator;
END
$$;

-- A partir de acá el owner real (si la función ya existía) es SIEMPRE
-- governance_owner (casos 1/2/3 ya resueltos arriba; el caso 4 abortó antes
-- de llegar acá) - SET ROLE es seguro incondicionalmente.
SET ROLE governance_owner;

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
-- Ejecutado bajo contexto governance_owner (dueño real): tiene autoridad de
-- GRANT/REVOKE sobre su propia función sin necesitar WITH GRANT OPTION.
REVOKE ALL ON FUNCTION pipeline.fn_claim_refresh_run_by_id(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pipeline.fn_claim_refresh_run_by_id(uuid, text, text, text) TO nexus_pipeline_worker;

-- Nunca dejar la sesión corriendo como governance_owner para lo que venga
-- después en la misma conexión (otros archivos sql/*.sql posteriores,
-- corridos por el mismo migrador).
RESET ROLE;
