-- Fase 2/2 de la identidad normalizada de cliente contractual. Aplicar
-- SOLO después de: sql/103 aplicada, writer actualizado desplegado, backfill
-- (scripts/contracts/backfill-client-name-key.mjs --apply) completado con
-- cero NULL remanentes, y auditoría de colisiones
-- (scripts/contracts/audit-client-name-key-collisions.mjs) revisada -ver
-- "Orden de despliegue real" del plan.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM config.contract_equipment_versions WHERE client_name_key IS NULL) THEN
    RAISE EXCEPTION 'ABORT: existen filas con client_name_key NULL -correr scripts/contracts/backfill-client-name-key.mjs --apply antes de aplicar esta migración.';
  END IF;
END $$;

ALTER TABLE config.contract_equipment_versions
  ALTER COLUMN client_name_key SET NOT NULL;

-- NOT NULL por sí solo no impide '' (cadena vacía) -buildContractClientNameKey(null)
-- y buildContractClientNameKey("   ") devuelven "", que cumpliría NOT NULL
-- pero sería una identidad de cliente inválida y aparecería como una opción
-- de filtro vacía en el facet. El backfill ya falla antes de persistir una
-- clave vacía (ver ese script); este CHECK es la garantía a nivel de base,
-- no solo a nivel de aplicación.
ALTER TABLE config.contract_equipment_versions
  DROP CONSTRAINT IF EXISTS contract_client_name_key_not_blank_chk;
ALTER TABLE config.contract_equipment_versions
  ADD CONSTRAINT contract_client_name_key_not_blank_chk CHECK (BTRIM(client_name_key) <> '');
