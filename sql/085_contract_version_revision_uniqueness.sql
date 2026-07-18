-- ETAPA 6.5.1.1 -- Corrección del modelo de versionado contractual.
-- (2ª ronda -corrige 2 defectos encontrados en la 1ª versión, ver reporte.)
--
-- Diagnóstico: UNIQUE (equipment_key, valid_from) (sql/070) fue creado
-- cuando valid_from representaba casi la fecha de la CORRIDA de importación
-- (bug corregido por sql/084). Tras 084, valid_from representa la fecha
-- REAL de inicio de vigencia contractual -por lo tanto dos revisiones (ej.
-- una corrección de registro: Gold -> Silver, SIN cambiar la vigencia de
-- negocio) pueden compartir legítimamente (equipment_key, valid_from), y el
-- UNIQUE global lo impide con "duplicate key value violates unique
-- constraint" en TODO intento de --apply que corrija un valor ya importado.
--
-- El índice parcial contract_equipment_versions_current_key_uidx
-- (equipment_key) WHERE is_current=true, también de sql/070, es AÚN MÁS
-- estricto de lo que el modelo corregido necesita: impide que dos vigencias
-- de negocio DISTINTAS (equipment_key con más de un valid_from real -ej.
-- reinstalación, contrato renegociado desde cero) coexistan como
-- autoritativas simultáneamente, aunque no compartan valid_from.
--
-- Separación de dos dimensiones temporales (ver reporte de ETAPA 6.5.1.1,
-- §4):
--   A. Vigencia de NEGOCIO: valid_from / valid_to -desde/hasta cuándo aplica
--      el contrato. Nunca se toca automáticamente al corregir un registro
--      (sin evidencia real de que terminó la vigencia comercial).
--   B. Vigencia de la REVISIÓN: is_current / superseded_at (nueva) -cuándo
--      una revisión dejó de ser la autoritativa PARA SU PROPIO valid_from.
--
-- Diseño aplicado: Alternativa A (índice parcial), diseño preferido del
-- encargo -conserva el PK existente, no borra revisiones históricas, no
-- modifica valid_from artificialmente.
--
-- Defecto 1 (corregido en esta ronda): valid_from es NULLABLE (ETAPA 6.5.1,
-- caso UNRESOLVED). Un UNIQUE/índice parcial normal de Postgres trata NULL
-- como distinto de cualquier otro NULL -dos revisiones is_current=true del
-- MISMO equipment_key con valid_from=NULL NO quedaban bloqueadas por el
-- índice de la 1ª versión de este archivo, violando la autoridad única
-- (invariante 5.3) exactamente para el caso UNRESOLVED. Corregido con
-- NULLS NOT DISTINCT (Postgres 16), que trata dos NULL como iguales para
-- efectos de unicidad -ver punto 6.
--
-- Defecto 2 (corregido en esta ronda, REVERTIDO respecto a la 1ª versión):
-- la 1ª versión de este archivo agregaba un UNIQUE histórico global
-- (equipment_key, valid_from, contract_fingerprint) como "defensa en
-- profundidad" de idempotencia. Esto es INCORRECTO: bloquea una reversión
-- de registro legítima Gold -> Silver -> Gold, donde la 2ª revisión Gold
-- tiene el MISMO contenido normativo (mismo fingerprint) que la 1ª, pero es
-- un evento de registro nuevo y distinto (ver reporte). La idempotencia NO
-- se protege contra TODA la historia -se protege contra la revisión
-- ACTUALMENTE autoritativa únicamente, bajo advisory lock y dentro de la
-- misma transacción (ver computeVersionAction() en versioning.js +
-- src/contracts/db-writer.js, que ya compara el fingerprint candidato
-- solo contra currentVersionRow, nunca contra el historial completo). Esta
-- versión NO crea ese UNIQUE histórico -si una aplicación anterior de la
-- 1ª versión de este archivo lo creó, se elimina explícitamente (punto 7).
--
-- Idempotente: cada paso detecta el objeto por nombre (ver verificación
-- empírica contra Postgres 16 desechable en el reporte -los nombres
-- auto-generados por Postgres para los CHECK sin nombre de sql/070 son
-- deterministas: dependen solo del orden de columnas de esa migración, que
-- no cambia) y usa DROP...IF EXISTS + ADD CONSTRAINT/CREATE INDEX
-- IF NOT EXISTS -aplicar este archivo dos veces no falla, incluso con datos
-- reales ya presentes (ver punto 2bis: precondición de datos).
--
-- NO se aplica en producción en esta etapa -solo contra Postgres 16
-- desechable (ver §2 del encargo y el reporte de ETAPA 6.5.1.1).

BEGIN;

-- 1) Precondition: la tabla debe existir tal como la dejaron sql/070 +
-- sql/084 -si no, este archivo no debe aplicarse sobre esta base.
DO $migration085$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'config' AND table_name = 'contract_equipment_versions'
  ) THEN
    RAISE EXCEPTION 'sql/085: config.contract_equipment_versions no existe -aplica sql/070_config.sql primero.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'config' AND table_name = 'contract_equipment_versions' AND column_name = 'valid_from_basis'
  ) THEN
    RAISE EXCEPTION 'sql/085: falta valid_from_basis -aplica sql/084_contract_valid_from_correction.sql primero.';
  END IF;
END
$migration085$;

-- 2) Nueva columna: momento en que una revisión dejó de ser autoritativa
-- para SU PROPIO valid_from -nunca confundir con valid_to (fin de vigencia
-- de negocio real, ver §4 del reporte). Todas las filas EXISTENTES quedan
-- con superseded_at=NULL en este punto (columna recién creada) -incluidas
-- filas is_current=false preexistentes, si las hay (ver punto 2bis).
ALTER TABLE config.contract_equipment_versions
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- 2bis) Precondición de datos -CRÍTICA. El CHECK del punto 4 exige
-- is_current=(superseded_at IS NULL); cualquier fila is_current=false
-- PREEXISTENTE (escrita por código anterior a esta migración, cuando
-- superseded_at no existía) tiene superseded_at=NULL en este momento y
-- violaría ese CHECK. Esta migración NUNCA inventa un superseded_at
-- histórico -no hay evidencia confiable de CUÁNDO exactamente una revisión
-- vieja perdió autoridad más allá de valid_to, que bajo el modelo previo
-- medía una cosa semánticamente distinta (fecha de la corrida que la
-- reemplazó, no necesariamente el fin de vigencia de negocio real -ver
-- diagnóstico arriba). Ante cualquier fila así, aborta con un mensaje claro
-- y la consulta exacta para revisarlas manualmente, en vez de adivinar un
-- valor o dejar que el ALTER TABLE del punto 4 falle con un error de
-- constraint críptico.
DO $migration085$
DECLARE
  unmigratable_count integer;
BEGIN
  SELECT count(*) INTO unmigratable_count
  FROM config.contract_equipment_versions
  WHERE is_current = false AND superseded_at IS NULL;

  IF unmigratable_count > 0 THEN
    RAISE EXCEPTION 'sql/085: % fila(s) is_current=false preexistente(s) sin superseded_at -esta migración no puede inferir de forma segura cuándo perdieron autoridad (no inventa superseded_at histórico, ver diagnóstico del archivo). Revisar manualmente antes de continuar: SELECT contract_version_id, equipment_key, valid_from, valid_to, updated_at FROM config.contract_equipment_versions WHERE is_current = false AND superseded_at IS NULL;', unmigratable_count;
  END IF;
END
$migration085$;

-- 3) Detecta y elimina, POR NOMBRE, el CHECK viejo que conflaba las dos
-- dimensiones (is_current = (valid_to IS NULL)) -bajo el modelo corregido
-- una revisión puede ser is_current=false y valid_to=NULL simultáneamente
-- (corrección de registro, misma vigencia de negocio). Precondition
-- estricta: si el constraint existe con OTRO nombre o definición
-- inesperada, la migración aborta en vez de adivinar qué eliminar.
DO $migration085$
DECLARE
  found_def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO found_def
  FROM pg_constraint
  WHERE conrelid = 'config.contract_equipment_versions'::regclass
    AND conname = 'contract_equipment_versions_check';

  IF found_def IS NOT NULL AND found_def <> 'CHECK ((is_current = (valid_to IS NULL)))' THEN
    RAISE EXCEPTION 'sql/085: contract_equipment_versions_check tiene una definición inesperada (%) -abortando, revisar manualmente antes de continuar.', found_def;
  END IF;
END
$migration085$;

ALTER TABLE config.contract_equipment_versions
  DROP CONSTRAINT IF EXISTS contract_equipment_versions_check;

-- 4) Bicondicional correcto para la dimensión B: is_current=true si y solo
-- si superseded_at IS NULL -bajo la lógica de escritura de esta etapa, la
-- ÚNICA forma en que una revisión deja de ser is_current es al ser
-- reemplazada (superseded_at se setea en ese mismo momento, nunca antes,
-- nunca en otro caso). Seguro de agregar acá: el punto 2bis ya garantizó
-- que ninguna fila existente lo viola.
ALTER TABLE config.contract_equipment_versions
  DROP CONSTRAINT IF EXISTS contract_equipment_versions_current_supersede_consistency;
ALTER TABLE config.contract_equipment_versions
  ADD CONSTRAINT contract_equipment_versions_current_supersede_consistency
  CHECK (is_current = (superseded_at IS NULL));

-- 5) Elimina el UNIQUE global -bloqueaba la coexistencia legítima de
-- revisiones con el mismo (equipment_key, valid_from) descrita arriba.
ALTER TABLE config.contract_equipment_versions
  DROP CONSTRAINT IF EXISTS contract_equipment_versions_equipment_key_valid_from_key;

-- 6) Elimina el parcial viejo (equipment_key) WHERE is_current=true -mismo
-- motivo: impedía que dos vigencias de negocio DISTINTAS (distinto
-- valid_from) coexistieran como autoritativas, cada una en lo suyo.
DROP INDEX IF EXISTS config.contract_equipment_versions_current_key_uidx;

-- 6bis) Si una aplicación ANTERIOR de este archivo (antes de esta
-- corrección) ya creó el índice del punto 7 SIN NULLS NOT DISTINCT, el
-- CREATE INDEX IF NOT EXISTS de abajo lo dejaría tal cual (mismo nombre ->
-- se salta la creación, sin actualizar la definición). Se detecta por
-- pg_index.indnullsnotdistinct (Postgres 16) y se recrea si corresponde,
-- para que esta corrección sea realmente idempotente incluso sobre una
-- base que ya corrió la versión anterior de este archivo.
DO $migration085$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'config'
      AND c.relname = 'contract_equipment_versions_current_per_period_uidx'
      AND i.indnullsnotdistinct = false
  ) THEN
    DROP INDEX config.contract_equipment_versions_current_per_period_uidx;
  END IF;
END
$migration085$;

-- 7) Autoridad única CORRECTA (Alternativa A / diseño preferido, §7 del
-- encargo, invariante 5.3 del reporte): como máximo una revisión
-- is_current=true por (equipment_key, valid_from) -distintas vigencias de
-- negocio (distinto valid_from) SÍ pueden coexistir como autoritativas,
-- cada una para su propio período. NULLS NOT DISTINCT (defecto 1,
-- Postgres 16): dos revisiones is_current=true del mismo equipment_key con
-- valid_from=NULL (UNRESOLVED) SÍ deben tratarse como el mismo "período"
-- para esta autoridad única -sin esto, dos revisiones UNRESOLVED
-- simultáneamente autoritativas pasarían sin detectarse.
CREATE UNIQUE INDEX IF NOT EXISTS contract_equipment_versions_current_per_period_uidx
  ON config.contract_equipment_versions (equipment_key, valid_from)
  NULLS NOT DISTINCT
  WHERE is_current = true;

-- 8) Defecto 2: el UNIQUE histórico global (equipment_key, valid_from,
-- contract_fingerprint) de la 1ª versión de este archivo se ELIMINA -no se
-- vuelve a crear. Bloqueaba una reversión de registro legítima
-- Gold -> Silver -> Gold (2ª revisión Gold: mismo fingerprint que la 1ª,
-- evento de registro nuevo). La idempotencia real se protege a nivel de
-- aplicación (computeVersionAction() comparando solo contra la revisión
-- ACTUALMENTE autoritativa, bajo advisory lock, en la misma transacción -
-- ver src/contracts/db-writer.js) y a nivel de autoridad única (punto 7),
-- nunca contra el historial completo.
ALTER TABLE config.contract_equipment_versions
  DROP CONSTRAINT IF EXISTS contract_equipment_versions_period_fingerprint_key;

COMMIT;

-- ============================================================
-- Rollback (documentado, NO ejecutado automáticamente por este archivo)
-- ============================================================
-- BEGIN;
--   DROP INDEX IF EXISTS config.contract_equipment_versions_current_per_period_uidx;
--   ALTER TABLE config.contract_equipment_versions DROP CONSTRAINT IF EXISTS contract_equipment_versions_equipment_key_valid_from_key;
--   ALTER TABLE config.contract_equipment_versions ADD CONSTRAINT contract_equipment_versions_equipment_key_valid_from_key UNIQUE (equipment_key, valid_from);
--   CREATE UNIQUE INDEX IF NOT EXISTS contract_equipment_versions_current_key_uidx ON config.contract_equipment_versions (equipment_key) WHERE is_current = true;
--   ALTER TABLE config.contract_equipment_versions DROP CONSTRAINT IF EXISTS contract_equipment_versions_current_supersede_consistency;
--   ALTER TABLE config.contract_equipment_versions ADD CONSTRAINT contract_equipment_versions_check CHECK (is_current = (valid_to IS NULL));
--   ALTER TABLE config.contract_equipment_versions DROP COLUMN IF EXISTS superseded_at;
-- COMMIT;
-- Nota: el rollback solo es seguro si NINGUNA fila fue insertada bajo el
-- modelo nuevo con is_current=false Y valid_to=NULL simultáneamente (el
-- CHECK viejo las rechazaría) -verificar antes de ejecutar el rollback
-- contra una base con datos reales de esta etapa.
