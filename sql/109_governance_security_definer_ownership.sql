-- NEXUS V3 - Repara la deriva de ownership de funciones SECURITY DEFINER de
-- `governance`/`pipeline` detectada en Cloud: sql/092, sql/094, sql/095 y
-- sql/097 crean/reemplazan 18 funciones SECURITY DEFINER DESPUÉS de que el
-- sweep de ownership de sql/090 (schema `governance`) ya corrió, y ninguno
-- de esos 4 archivos volvía a barrer -esas 18 funciones quedaron owned por
-- quien aplicó la migración (postgres en Supabase) en vez de
-- governance_owner. Esos 4 archivos ya se corrigieron (SET ROLE
-- governance_owner; ... RESET ROLE;) para crear directo como
-- governance_owner en cualquier aplicación futura, pero Cloud ya tiene
-- 000->108 aplicado con la deriva ya ocurrida -esta migración repara ese
-- estado existente sin necesidad de reejecutar 092/094/095/097.
--
-- (sql/096 ya reasignaba correctamente su propia función fn_start_review,
-- sin deriva -no necesitó corrección en ese archivo; el filtro de abajo la
-- incluye igual, sin efecto adicional, porque ya es owned por
-- governance_owner.)
--
-- Filtro: schema `governance` o `pipeline` Y prosecdef = true (SECURITY
-- DEFINER) - inequívoco para este repo, porque TODA función SECURITY
-- DEFINER en esos dos schemas es Nexus y está diseñada para ser owned por
-- governance_owner (ninguna excepción documentada en ningún sql/*.sql).
-- Nunca toca funciones normales no-SECURITY-DEFINER (ej.
-- governance._fingerprint, LANGUAGE sql IMMUTABLE) ni objetos fuera de
-- governance/pipeline - mismo mecanismo ya usado por sql/090 (schema
-- governance completo) y sql/101/102 (schema pipeline completo), extendido
-- acá a ambos schemas a la vez y acotado explícitamente por prosecdef para
-- no depender de que el schema completo sea "todo SECURITY DEFINER"
-- (cierto hoy en pipeline, no en governance).
--
-- Mismo mecanismo de privilegio mínimo ya establecido (sql/089/090/101):
-- requiere solo la membresía SET ya otorgada
-- ("GRANT governance_owner TO SESSION_USER WITH INHERIT FALSE, SET TRUE")
-- y el CREATE ya otorgado sobre ambos schemas (governance: sql/089;
-- pipeline: sql/101) - nunca INHERIT, nunca SUPERUSER, nunca un grant nuevo
-- a ningún rol runtime. Idempotente: reasignar un owner ya correcto es un
-- no-op seguro (probado por la corrida de idempotencia de
-- sql-migration-idempotency.integration.test.ts, que reaplica todo sql/*.sql
-- dos veces seguidas).
DO $$
DECLARE v_fn record;
BEGIN
  FOR v_fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('governance', 'pipeline')
      AND p.prosecdef = true
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO governance_owner', v_fn.sig);
  END LOOP;
END
$$;
