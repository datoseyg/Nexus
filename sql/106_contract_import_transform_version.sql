-- Idempotencia contractual gobernada por contenido + version explicita de
-- transformacion. Las corridas historicas se conservan como legacy-v1; no se
-- eliminan ni se reetiquetan como fallidas.
ALTER TABLE config.contract_import_runs
  ADD COLUMN IF NOT EXISTS transform_version text;

UPDATE config.contract_import_runs
SET transform_version = 'legacy-v1'
WHERE transform_version IS NULL;

ALTER TABLE config.contract_import_runs
  ALTER COLUMN transform_version SET NOT NULL;

DROP INDEX IF EXISTS config.contract_import_runs_success_sha_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS contract_import_runs_success_sha_transform_uidx
  ON config.contract_import_runs (source_sha256, transform_version)
  WHERE import_status = 'SUCCESS';

COMMENT ON COLUMN config.contract_import_runs.transform_version IS
  'Version gobernada y estable de la transformacion contractual; nunca timestamp ni hash de codigo.';
