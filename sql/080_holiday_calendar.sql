-- ETAPA 6.6B0 -- Calendario de feriados versionable (Capa A, extiende
-- config.* de ETAPA 6.5). Migración autocontenida: no modifica sql/000,
-- sql/050 ni sql/070 -todo lo nuevo vive acá. Se aplica a mano, después de
-- sql/070_config.sql, vía el SQL editor de Supabase o psql contra la
-- conexión DIRECTA -igual que el resto de sql/*.
--
-- Diseño primario: NO depende de la extensión btree_gist. La comprobación
-- de no-solapamiento entre coberturas VALIDATED se hace vía un trigger que
-- usa el operador nativo && sobre daterange (disponible en core Postgres
-- sin ninguna extensión), reforzado con un advisory lock determinístico por
-- jurisdicción para cerrar la carrera de dos validaciones concurrentes.
-- Antes de aplicar este archivo, verificar (no bloqueante, informativo):
--   SELECT * FROM pg_available_extensions WHERE name = 'btree_gist';
-- Si está disponible y el equipo prefiere la forma declarativa, ver la
-- alternativa comentada al final de la sección 3.

CREATE SCHEMA IF NOT EXISTS config; -- ya existe vía sql/070, IF NOT EXISTS por si este archivo se aplica solo

-- ============================================================
-- 1. config.holiday_import_runs
-- ============================================================
-- Espeja la disciplina de config.contract_import_runs (idempotencia por
-- SHA-256 vía índice único PARCIAL, atomicidad accepted+ignored+errored=read).
-- Sin `effective_date`: un hecho de feriado no tiene un "as-of" de import
-- como un contrato -su vigencia real se expresa vía
-- holiday_calendar_coverage.coverage_range, no vía esta tabla.
CREATE TABLE IF NOT EXISTS config.holiday_import_runs (
  import_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_filename text NOT NULL,
  source_sha256 text NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'CL',
  rows_read integer NOT NULL,
  rows_accepted integer NOT NULL,
  rows_ignored integer NOT NULL,
  rows_errored integer NOT NULL,
  import_status text NOT NULL CHECK (import_status IN ('SUCCESS', 'FAILED')),
  imported_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb,
  CHECK (rows_read = rows_accepted + rows_ignored + rows_errored),
  CHECK (import_status <> 'SUCCESS' OR rows_errored = 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS holiday_import_runs_success_sha_uidx
  ON config.holiday_import_runs (source_sha256) WHERE import_status = 'SUCCESS';

-- ============================================================
-- 2. config.holiday_calendar_entries
-- ============================================================
-- Identidad de evento (corrige: UNIQUE(local_date,jurisdiction,
-- source_import_id) seguía impidiendo 2 eventos reales coincidentes en la
-- misma fecha dentro de una importación, ej. un feriado nacional y uno
-- regional el mismo día). source_event_key es una identidad ESTABLE del
-- evento, nunca un UUID aleatorio: si la fuente trae un código propio se usa
-- tal cual; si no, el IMPORTADOR (JS, ver 6.6B1 -- src/working-hours/
-- holiday-importer.js, evita depender de la extensión `unaccent` de
-- Postgres) lo deriva determinísticamente vía slugify del nombre
-- (minúsculas, sin tildes, espacios->guiones) -mismo nombre siempre produce
-- la misma clave. UNIQUE(source_import_id, source_event_key) permite 2+
-- eventos en la misma fecha; impide duplicar el MISMO evento dentro de un
-- import.
CREATE TABLE IF NOT EXISTS config.holiday_calendar_entries (
  holiday_entry_id bigserial PRIMARY KEY,
  local_date date NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'CL',
  source_event_key text NOT NULL,
  holiday_name text NOT NULL,
  holiday_type text NOT NULL CHECK (holiday_type IN ('FIXED_DATE', 'MOVABLE', 'REGIONAL')),
  is_irrenunciable boolean,
  source_import_id uuid NOT NULL REFERENCES config.holiday_import_runs(import_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_import_id, source_event_key)
);
CREATE INDEX IF NOT EXISTS holiday_calendar_entries_date_idx ON config.holiday_calendar_entries (local_date, jurisdiction);

-- ============================================================
-- 3. config.holiday_calendar_coverage
-- ============================================================
-- La ausencia de fila para un rango = HOLIDAY_COVERAGE_UNKNOWN (nunca "no es
-- feriado" por omisión). coverage_status distingue DRAFT (recién importada,
-- aún no confirmada) / VALIDATED (confirmada, participa en la regla de
-- no-solapamiento) / SUPERSEDED (reemplazada por una corrección posterior,
-- NUNCA borrada -conserva el historial completo).
--
-- superseded_by_coverage_id vive en la fila VIEJA, apuntando hacia ADELANTE
-- a la fila que la reemplazó (corrige la semántica invertida/contradictoria
-- de una ronda anterior de diseño, que tenía supersedes_coverage_id
-- apuntando hacia atrás desde la fila nueva). Bicondicional real:
-- coverage_status='SUPERSEDED' <=> superseded_by_coverage_id IS NOT NULL.
CREATE TABLE IF NOT EXISTS config.holiday_calendar_coverage (
  coverage_id bigserial PRIMARY KEY,
  jurisdiction text NOT NULL DEFAULT 'CL',
  coverage_range daterange NOT NULL,
  coverage_status text NOT NULL DEFAULT 'DRAFT' CHECK (coverage_status IN ('DRAFT', 'VALIDATED', 'SUPERSEDED')),
  superseded_by_coverage_id bigint REFERENCES config.holiday_calendar_coverage(coverage_id),
  source_import_id uuid NOT NULL REFERENCES config.holiday_import_runs(import_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  validated_at timestamptz,
  CHECK (coverage_status <> 'VALIDATED' OR validated_at IS NOT NULL),
  CHECK ((coverage_status = 'SUPERSEDED') = (superseded_by_coverage_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS holiday_calendar_coverage_lookup_idx ON config.holiday_calendar_coverage (jurisdiction, coverage_status);
-- Índice GiST puro sobre el rango -opclass nativa de Postgres para tipos
-- range, NO requiere btree_gist (esa extensión solo hace falta para
-- combinar una columna escalar de igualdad -jurisdiction- con el rango en
-- UN MISMO índice de exclusión; acá se evita esa combinación por diseño).
CREATE INDEX IF NOT EXISTS holiday_calendar_coverage_range_gist_idx ON config.holiday_calendar_coverage USING gist (coverage_range);

-- Orden transaccional obligatorio para reemplazar una cobertura (ver
-- docs -- 1. INSERT la nueva fila DRAFT; 2. UPDATE la anterior a SUPERSEDED
-- con superseded_by_coverage_id apuntando a la nueva (en este punto la
-- anterior ya no es VALIDATED, no compite en el chequeo de no-solapamiento);
-- 3. UPDATE la nueva a VALIDATED. Todo dentro de una sola transacción.

-- ============================================================
-- 4. Trigger de no-solapamiento -idempotente, seguro ante concurrencia
-- ============================================================
-- No confía SOLO en el advisory lock adquirido dentro del trigger: el lock
-- serializa validaciones concurrentes para la MISMA jurisdicción (cerrando
-- la carrera donde dos transacciones pasarían el EXISTS antes de que la otra
-- confirme), y el propio EXISTS es la comprobación real. El lock es
-- xact-scoped (se libera solo al COMMIT/ROLLBACK).
CREATE OR REPLACE FUNCTION config.check_holiday_coverage_no_overlap() RETURNS trigger AS $$
BEGIN
  IF NEW.coverage_status = 'VALIDATED' THEN
    PERFORM pg_advisory_xact_lock(hashtext('holiday_coverage:' || NEW.jurisdiction));

    IF EXISTS (
      SELECT 1 FROM config.holiday_calendar_coverage
      WHERE jurisdiction = NEW.jurisdiction
        AND coverage_status = 'VALIDATED'
        AND coverage_range && NEW.coverage_range
        AND coverage_id <> NEW.coverage_id
    ) THEN
      RAISE EXCEPTION 'holiday_calendar_coverage: solapamiento VALIDATED para jurisdiction=%, range=%', NEW.jurisdiction, NEW.coverage_range;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Idempotente: DROP...IF EXISTS antes de CREATE, para que este archivo se
-- pueda aplicar 2 veces sin error (CREATE TRIGGER no tiene una forma
-- "IF NOT EXISTS" portable en todas las versiones soportadas).
DROP TRIGGER IF EXISTS holiday_calendar_coverage_no_overlap ON config.holiday_calendar_coverage;
CREATE TRIGGER holiday_calendar_coverage_no_overlap
  BEFORE INSERT OR UPDATE ON config.holiday_calendar_coverage
  FOR EACH ROW EXECUTE FUNCTION config.check_holiday_coverage_no_overlap();

-- Alternativa declarativa (NO aplicada por defecto): si se confirma
-- btree_gist disponible y el equipo prefiere una restricción declarativa en
-- vez de un trigger, un EXCLUDE evita la carrera sin advisory lock (el
-- índice de exclusión es atómico por construcción):
--   CREATE EXTENSION IF NOT EXISTS btree_gist;
--   ALTER TABLE config.holiday_calendar_coverage
--     ADD CONSTRAINT holiday_calendar_coverage_validated_no_overlap
--     EXCLUDE USING gist (jurisdiction WITH =, coverage_range WITH &&)
--     WHERE (coverage_status = 'VALIDATED');
-- En ese caso, además se recomienda mantener el trigger de arriba como
-- defensa adicional (no eliminarlo), tal como fue pedido explícitamente.

-- ============================================================
-- 4b. Función de publicación -no confía SOLO en el advisory lock
-- adquirido dentro del trigger de la tabla (ese lock solo protege el paso
-- final "poner en VALIDATED"). Esta función encapsula la secuencia
-- COMPLETA (insertar DRAFT -> marcar la anterior SUPERSEDED -> validar la
-- nueva) adquiriendo el lock ANTES de tocar cualquier fila, serializando la
-- operación de reemplazo entera por jurisdicción -el trigger sigue siendo
-- una defensa adicional (nunca se retira), no la única línea de protección.
-- Se ejecuta dentro de la transacción del llamador (sin COMMIT interno).
-- ============================================================
CREATE OR REPLACE FUNCTION config.publish_holiday_coverage(
  p_jurisdiction text,
  p_coverage_range daterange,
  p_source_import_id uuid,
  p_supersedes_coverage_id bigint DEFAULT NULL
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_new_coverage_id bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('holiday_coverage:' || p_jurisdiction));

  INSERT INTO config.holiday_calendar_coverage (jurisdiction, coverage_range, coverage_status, source_import_id)
  VALUES (p_jurisdiction, p_coverage_range, 'DRAFT', p_source_import_id)
  RETURNING coverage_id INTO v_new_coverage_id;

  IF p_supersedes_coverage_id IS NOT NULL THEN
    UPDATE config.holiday_calendar_coverage
    SET coverage_status = 'SUPERSEDED', superseded_by_coverage_id = v_new_coverage_id
    WHERE coverage_id = p_supersedes_coverage_id;
  END IF;

  UPDATE config.holiday_calendar_coverage
  SET coverage_status = 'VALIDATED', validated_at = now()
  WHERE coverage_id = v_new_coverage_id;

  RETURN v_new_coverage_id;
END;
$$;

-- ============================================================
-- 5. Calendario canónico vigente
-- ============================================================
-- El builder de 6.6B2 NUNCA consulta config.holiday_calendar_entries
-- directo -siempre vía esta vista. Una fecha ausente de acá (sin cobertura
-- VALIDATED que la cubra) resuelve a HOLIDAY_COVERAGE_UNKNOWN, nunca
-- "no es feriado" por omisión.
CREATE OR REPLACE VIEW config.current_holiday_calendar_entries AS
SELECT e.holiday_entry_id, e.local_date, e.jurisdiction, e.source_event_key, e.holiday_name,
       e.holiday_type, e.is_irrenunciable, e.source_import_id
FROM config.holiday_calendar_entries e
JOIN config.holiday_calendar_coverage c
  ON c.jurisdiction = e.jurisdiction
 AND c.source_import_id = e.source_import_id
 AND c.coverage_status = 'VALIDATED'
 AND c.coverage_range @> e.local_date;

-- ============================================================
-- 6. Cobertura canónica vigente (distinta de "entries" -- permite al
-- builder distinguir explícitamente los 3 estados de holiday_coverage_status
-- de Capa B: sin cobertura validada -> HOLIDAY_COVERAGE_UNKNOWN; cobertura
-- validada + evento -> CONFIRMED_HOLIDAY; cobertura validada + sin evento ->
-- CONFIRMED_NOT_HOLIDAY. Sin esta vista, el builder tendría que reconstruir
-- esa lógica de 3 vías a mano en cada consulta.)
-- ============================================================
CREATE OR REPLACE VIEW config.current_holiday_calendar_coverage AS
SELECT coverage_id, jurisdiction, coverage_range, source_import_id, validated_at
FROM config.holiday_calendar_coverage
WHERE coverage_status = 'VALIDATED';

-- ============================================================
-- 7. Revokes -defensa en profundidad, mismo criterio que config.contract_*
-- ============================================================
REVOKE ALL ON config.holiday_import_runs, config.holiday_calendar_entries, config.holiday_calendar_coverage FROM PUBLIC, nexus_app;
REVOKE ALL ON SEQUENCE config.holiday_calendar_entries_holiday_entry_id_seq FROM PUBLIC, nexus_app;
REVOKE ALL ON SEQUENCE config.holiday_calendar_coverage_coverage_id_seq FROM PUBLIC, nexus_app;
-- Las 2 vistas canónicas y la función de validación de cobertura tampoco se
-- otorgan a nexus_app en 6.6B0 -mismo criterio "tablas/vistas base
-- bloqueadas" que config.contract_equipment_analysis es la ÚNICA excepción
-- ya aprobada; un futuro dashboard de administración de feriados necesitaría
-- su propia vista curada, en una subetapa aparte.
REVOKE ALL ON config.current_holiday_calendar_entries FROM PUBLIC, nexus_app;
REVOKE ALL ON config.current_holiday_calendar_coverage FROM PUBLIC, nexus_app;
REVOKE ALL ON FUNCTION config.check_holiday_coverage_no_overlap() FROM PUBLIC, nexus_app;
REVOKE ALL ON FUNCTION config.publish_holiday_coverage(text, daterange, uuid, bigint) FROM PUBLIC, nexus_app;
