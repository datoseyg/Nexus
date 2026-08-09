-- Permite reevaluar el matching contractual cuando cambia el maestro
-- processed.fieldbeat_equipments sin duplicar versiones ni importaciones.
-- Los resultados siguen siendo append-only; la vista de análisis elige el
-- más reciente por matched_at.
ALTER TABLE config.contract_equipment_matches
  DROP CONSTRAINT IF EXISTS contract_equipment_matches_observation_id_key;

CREATE INDEX IF NOT EXISTS contract_equipment_matches_observation_latest_idx
  ON config.contract_equipment_matches (observation_id, matched_at DESC, match_id DESC);

COMMENT ON TABLE config.contract_equipment_matches IS
  'Historial append-only de matching por observación; admite reevaluaciones tras refrescar el maestro FieldBeat.';
