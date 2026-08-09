-- Fase 1/2 de la identidad normalizada de cliente contractual: agrega
-- config.contract_equipment_versions.client_name_key NULLABLE (se vuelve
-- NOT NULL recién en sql/104, después del backfill + auditoría de
-- colisiones -ver ese archivo). client_name_key es la clave de folding
-- (mismo algoritmo que src/contracts/client-name-key.js, ver comentario en
-- ese archivo) usada por el facet/filtro de Cliente de Contratos;
-- client_name_canonical sigue siendo el label legible, nunca se muestra
-- client_name_key al usuario.
--
-- El writer (src/contracts/db-writer.js) ya persiste client_name_key en
-- toda fila NUEVA a partir de este cambio de código -esta migración debe
-- aplicarse solo DESPUÉS de desplegar ese writer actualizado (ver "Orden de
-- despliegue real" del plan), para que ninguna importación quede sin clave
-- entre el backfill y sql/104's SET NOT NULL.

ALTER TABLE config.contract_equipment_versions
  ADD COLUMN IF NOT EXISTS client_name_key text;

-- config.contract_equipment_analysis se define ACÁ (no en sql/070_config.sql)
-- porque client_name_key todavía no existe en el punto de la secuencia
-- donde corre 070 -una base nueva fallaría si 070 intentara seleccionar una
-- columna que esta misma migración recién agrega. Esta es ahora la ÚNICA
-- definición de esta vista (ver comentario en sql/070_config.sql, sección
-- 11) - reaplicar sql/*.sql completo dos veces seguidas nunca vuelve a una
-- forma más corta, así que CREATE OR REPLACE VIEW nunca choca con "cannot
-- drop columns from view".
CREATE OR REPLACE VIEW config.contract_equipment_analysis AS
SELECT
  v.contract_version_id,
  v.equipment_key,
  v.client_name_canonical,
  v.site_abbreviation,
  v.equipment_model,
  v.serial_number,
  v.installation_month,
  v.installation_date_precision,
  v.contract_status_code,
  v.spa_tier_code,
  v.weekday_service,
  v.weekend_service,
  v.support_mode_code,
  v.parts_coverage_code,
  v.hw_refresh_code,
  v.updates_code,
  v.upgrades_code,
  v.preventive_maintenance_min,
  v.preventive_maintenance_max,
  v.preventive_maintenance_rule,
  v.warranty_end_date,
  v.valid_from,
  v.valid_to,
  v.is_current,
  v.requires_review,
  v.normalization_status,
  v.updated_at,
  latest_match.match_status,
  latest_match.match_method,
  latest_match.fieldbeat_equipment_key,
  latest_match.fieldbeat_internal_id,
  v.client_name_key,
  v.created_at
FROM config.contract_equipment_versions v
LEFT JOIN LATERAL (
  SELECT m.match_status, m.match_method, m.fieldbeat_equipment_key, m.fieldbeat_internal_id
  FROM config.contract_equipment_matches m
  JOIN config.contract_equipment_observations o ON o.observation_id = m.observation_id
  WHERE o.equipment_key = v.equipment_key
  ORDER BY o.effective_date DESC, m.matched_at DESC
  LIMIT 1
) latest_match ON true;

-- Esta vista ya no se crea en sql/070_config.sql (ver arriba), así que el
-- GRANT tampoco puede heredarse de ahí -se otorga acá, la única vez que
-- esta vista se crea.
GRANT SELECT ON config.contract_equipment_analysis TO nexus_app;

-- Mismo patrón que el índice parcial ya existente
-- contract_equipment_versions_current_key_uidx (sql/070_config.sql) -acota
-- el índice al universo real que consultan el facet/filtro (is_current=true).
CREATE INDEX IF NOT EXISTS contract_equipment_versions_client_name_key_idx
  ON config.contract_equipment_versions (client_name_key)
  WHERE is_current = true;
