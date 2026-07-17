-- ETAPA 6.5.1 -- Corrección de vigencias contractuales históricas.
--
-- Diagnóstico: src/contracts/db-writer.js persistía effective_date (la
-- fecha de LA CORRIDA de importación, correctamente usada para versionado
-- en versioning.js) directamente como valid_from (la fecha REAL de inicio
-- de cobertura contractual). Como el CSV real se importó en una sola
-- corrida con --effective-date=2026-07-13, las 23 versiones quedaron con
-- valid_from idéntico -la fecha de importación, no de vigencia. Esto hacía
-- que ninguna tarea histórica (2018-2026) cayera dentro de la ventana de
-- ningún contrato.
--
-- Corrección: valid_from ahora se resuelve por separado (ver
-- src/contracts/contract-start-date-resolver.js), en orden: fecha de
-- negocio conocida y confirmada > installation_month inferido (con
-- installation_date_precision real) > sin resolver (NULL, nunca una fecha
-- artificial). Columnas de procedencia nuevas para poder distinguir cada
-- caso en el frontend/reportes, nunca mezclarlos silenciosamente.
ALTER TABLE config.contract_equipment_versions
  ALTER COLUMN valid_from DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS valid_from_is_inferred boolean,
  ADD COLUMN IF NOT EXISTS valid_from_basis text
    CHECK (valid_from_basis IN ('EXPLICIT_KNOWN_DATE', 'INSTALLATION_DATE_INFERRED', 'UNRESOLVED')),
  ADD COLUMN IF NOT EXISTS valid_from_precision text
    CHECK (valid_from_precision IN ('DAY', 'MONTH', 'YEAR', 'UNKNOWN')),
  ADD COLUMN IF NOT EXISTS valid_from_source_field text,
  ADD COLUMN IF NOT EXISTS valid_from_source_value_raw text;

-- Bicondicional real: valid_from es NULL si y solo si la base es
-- UNRESOLVED (nunca una versión "resuelta" sin fecha, ni una UNRESOLVED
-- con fecha fantasma). CHECK con nombre explícito -DROP...IF EXISTS antes
-- para que el archivo se pueda aplicar dos veces sin error (ADD CONSTRAINT
-- no tiene IF NOT EXISTS portable).
ALTER TABLE config.contract_equipment_versions
  DROP CONSTRAINT IF EXISTS contract_equipment_versions_valid_from_basis_consistency;
ALTER TABLE config.contract_equipment_versions
  ADD CONSTRAINT contract_equipment_versions_valid_from_basis_consistency
  CHECK ((valid_from IS NULL) = (valid_from_basis = 'UNRESOLVED'));

-- Sin GRANT/REVOKE adicional: config.contract_equipment_versions ya queda
-- cubierto por el REVOKE ALL ON ALL TABLES IN SCHEMA config FROM PUBLIC de
-- sql/070_config.sql, y nexus_app nunca tuvo SELECT directo sobre esta
-- tabla (solo sobre las vistas contract_equipment_analysis/
-- contract_service_window_analysis) -este archivo no cambia esa postura.
