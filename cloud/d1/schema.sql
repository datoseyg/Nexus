-- Cloudflare D1 (SQLite) - esquema read-only para Nexus BI Fase 2 Cloud.
-- Ver docs/CLOUDFLARE_D1_MIGRATION.md para el contexto completo.
--
-- D1 no soporta schemas tipo `gold.tabla` (SQLite es un único namespace
-- plano) - se usa el prefijo original (gold_, marts_, curation_, rules_) en
-- el nombre de tabla en su lugar. Los nombres de columna son idénticos a
-- los del warehouse DuckDB local (mismo CSV de origen) para que las queries
-- de los Route Handlers actuales sean casi copy-paste al portarlas a
-- Pages Functions.
--
-- IMPORTANTE - client_rut: donde aparece, contiene el RUT ENMASCARADO
-- (ej. "**.***.**8-9" - solo se conservan los últimos 2 caracteres
-- alfanuméricos), nunca el valor real. Ver src/cloud/sanitize-d1-export.js
-- (maskClientRut) y docs/CLOUDFLARE_D1_MIGRATION.md § Qué NO se migra.
--
-- Todas las tablas se crean siempre (aunque el seed venga vacío) para que
-- los endpoints de Pages Functions nunca fallen con "no such table".

-- ============================================================
-- GOLD (snapshots fijos agregados - ver docs/GOLD_DATA_CONTRACT.md)
-- ============================================================

CREATE TABLE IF NOT EXISTS gold_operational_dashboard (
  total_zendesk_tickets INTEGER,
  tickets_with_fieldbeat_report INTEGER,
  tickets_without_fieldbeat_report INTEGER,
  tickets_with_multiple_fieldbeat_reports INTEGER,
  tickets_with_used_parts INTEGER,
  tickets_with_all_parts_matched INTEGER,
  tickets_review_required INTEGER,
  total_used_parts_in_ticket_scope INTEGER,
  matched_used_parts INTEGER,
  placeholder_used_parts INTEGER,
  unmatched_used_parts INTEGER,
  ambiguous_used_parts INTEGER,
  ticket_fieldbeat_coverage_rate REAL,
  used_parts_match_rate REAL,
  review_required_rate REAL
);

CREATE TABLE IF NOT EXISTS gold_fieldbeat_report_analysis (
  total_fieldbeat_reports INTEGER,
  reports_no_ticket_reported INTEGER,
  reports_linked_to_accessible_zendesk INTEGER,
  reports_linked_to_missing_or_restricted_zendesk INTEGER,
  reports_with_used_parts INTEGER,
  reports_ok INTEGER,
  reports_review_required INTEGER,
  total_used_parts INTEGER,
  matched_used_parts INTEGER,
  placeholder_used_parts INTEGER,
  unmatched_used_parts INTEGER,
  ambiguous_used_parts INTEGER,
  zendesk_link_rate REAL,
  used_parts_match_rate REAL,
  review_required_rate REAL
);

CREATE TABLE IF NOT EXISTS gold_fieldbeat_data_quality (
  report_quality_status TEXT,
  report_count INTEGER,
  percent_of_total_reports TEXT,
  used_parts_count INTEGER,
  matched_used_parts_count INTEGER,
  placeholder_used_parts_count INTEGER,
  unmatched_used_parts_count INTEGER,
  ambiguous_used_parts_count INTEGER
);

CREATE TABLE IF NOT EXISTS gold_client_report_volume_by_period (
  client_name TEXT,
  period TEXT,
  total_reports INTEGER,
  reports_with_used_parts INTEGER,
  reports_review_required INTEGER
);

-- client_rut: ENMASCARADO (ver nota de cabecera).
CREATE TABLE IF NOT EXISTS gold_client_parts_consumption (
  client_name TEXT,
  client_rut TEXT,
  period TEXT,
  total_reports INTEGER,
  used_parts_count INTEGER,
  matched_used_parts_count INTEGER,
  placeholder_used_parts_count INTEGER,
  unmatched_used_parts_count INTEGER,
  ambiguous_used_parts_count INTEGER
);

CREATE TABLE IF NOT EXISTS gold_equipment_parts_consumption (
  equipment_internal_id TEXT,
  total_reports INTEGER,
  used_parts_count INTEGER,
  matched_used_parts_count INTEGER,
  placeholder_used_parts_count INTEGER,
  unmatched_used_parts_count INTEGER,
  ambiguous_used_parts_count INTEGER
);

CREATE TABLE IF NOT EXISTS gold_after_hours_work_analysis (
  kpi1_total_hours REAL,
  kpi1_confidence_score REAL,
  kpi1_confidence_label TEXT,
  kpi2_business_hours REAL,
  kpi2_confidence_score REAL,
  kpi2_confidence_label TEXT,
  kpi3_after_hours_hours REAL,
  kpi3_confidence_score REAL,
  kpi3_confidence_label TEXT,
  kpi4_after_hours_rate REAL,
  kpi4_confidence_score REAL,
  kpi4_confidence_label TEXT,
  kpi5_tasks_with_after_hours INTEGER,
  kpi5_confidence_score REAL,
  kpi5_confidence_label TEXT,
  kpi6_tasks_not_calculable INTEGER,
  kpi6_confidence_score REAL,
  kpi6_confidence_label TEXT,
  confidence_score REAL,
  confidence_label TEXT,
  confidence_factors_summary TEXT,
  valid_rows INTEGER,
  invalid_rows INTEGER,
  estimated_rows INTEGER,
  exact_rows INTEGER,
  insufficient_rows INTEGER
);

-- client_rut: ENMASCARADO (ver nota de cabecera).
CREATE TABLE IF NOT EXISTS gold_after_hours_by_client (
  client_name TEXT,
  client_rut TEXT,
  total_hours REAL,
  business_hours REAL,
  after_hours_total_hours REAL,
  after_hours_rate REAL,
  tasks_total INTEGER,
  tasks_with_after_hours INTEGER,
  confidence_score REAL,
  confidence_label TEXT,
  confidence_factors_summary TEXT,
  valid_rows INTEGER,
  invalid_rows INTEGER,
  estimated_rows INTEGER,
  exact_rows INTEGER,
  insufficient_rows INTEGER
);

CREATE TABLE IF NOT EXISTS gold_after_hours_by_period (
  period TEXT,
  total_hours REAL,
  business_hours REAL,
  after_hours_total_hours REAL,
  after_hours_rate REAL,
  tasks_total INTEGER,
  tasks_with_after_hours INTEGER,
  confidence_score REAL,
  confidence_label TEXT,
  confidence_factors_summary TEXT,
  valid_rows INTEGER,
  invalid_rows INTEGER,
  estimated_rows INTEGER,
  exact_rows INTEGER,
  insufficient_rows INTEGER
);

CREATE TABLE IF NOT EXISTS gold_scope_metadata (
  total_fieldbeat_tasks INTEGER,
  total_fieldbeat_used_parts_global INTEGER,
  used_parts_in_ticket_mart INTEGER,
  used_parts_outside_ticket_mart INTEGER,
  fieldbeat_tasks_with_zendesk_ticket INTEGER,
  fieldbeat_tasks_without_zendesk_ticket INTEGER,
  fieldbeat_tasks_linked_to_existing_zendesk_ticket INTEGER,
  fieldbeat_tasks_linked_to_missing_zendesk_ticket INTEGER,
  zendesk_backfill_unique_missing_ticket_ids INTEGER,
  zendesk_backfill_tickets_found INTEGER,
  zendesk_backfill_tickets_not_found INTEGER,
  zendesk_backfill_tickets_forbidden INTEGER,
  scope_warning TEXT,
  phase_2_pending_action TEXT
);

-- ============================================================
-- MARTS (grano detallado - filtrable, ver docs/SQL_WAREHOUSE.md)
-- ============================================================

CREATE TABLE IF NOT EXISTS marts_used_parts_dolibarr_match (
  used_part_id TEXT,
  fieldbeat_task_id INTEGER,
  zendesk_ticket_id TEXT,
  part_name TEXT,
  raw_part_identifier TEXT,
  normalized_part_identifier TEXT,
  dolibarr_product_id TEXT,
  dolibarr_ref TEXT,
  dolibarr_barcode TEXT,
  dolibarr_label TEXT,
  match_method TEXT,
  match_confidence REAL,
  match_status TEXT,
  needs_manual_review INTEGER,
  candidate_dolibarr_product_ids TEXT
);

-- client_rut: ENMASCARADO (ver nota de cabecera).
CREATE TABLE IF NOT EXISTS marts_fieldbeat_report_dolibarr_operational_view (
  fieldbeat_task_id INTEGER,
  fieldbeat_task_date TEXT,
  client_key TEXT,
  client_rut TEXT,
  client_name TEXT,
  task_type TEXT,
  task_state TEXT,
  technician_names TEXT,
  equipment_internal_ids TEXT,
  linked_zendesk_ticket_id TEXT,
  zendesk_join_status TEXT,
  used_parts_count INTEGER,
  matched_used_parts_count INTEGER,
  placeholder_used_parts_count INTEGER,
  unmatched_used_parts_count INTEGER,
  ambiguous_used_parts_count INTEGER,
  review_required_used_parts_count INTEGER,
  dolibarr_refs TEXT,
  dolibarr_product_ids TEXT,
  used_part_numbers TEXT,
  used_part_names TEXT,
  part_match_statuses TEXT,
  part_match_methods TEXT,
  report_quality_status TEXT
);

-- client_rut: ENMASCARADO (ver nota de cabecera).
CREATE TABLE IF NOT EXISTS marts_fieldbeat_working_hours_analysis (
  fieldbeat_task_id INTEGER,
  client_key TEXT,
  client_rut TEXT,
  client_name TEXT,
  task_type TEXT,
  assigned_to TEXT,
  equipment_internal_ids TEXT,
  start_time_utc TEXT,
  start_time_local TEXT,
  duration_minutes REAL,
  reported_start_raw TEXT,
  reported_end_raw TEXT,
  reported_interval_plausible INTEGER,
  estimated_end_time_local TEXT,
  business_minutes REAL,
  after_hours_weekday_minutes REAL,
  weekend_minutes REAL,
  holiday_minutes REAL,
  after_hours_total_minutes REAL,
  after_hours_rate REAL,
  is_after_hours_task INTEGER,
  calculation_method TEXT,
  calculation_status TEXT,
  calculation_notes TEXT,
  confidence_score REAL,
  confidence_label TEXT,
  confidence_color TEXT,
  confidence_factors TEXT
);

-- ============================================================
-- CURATION (business-rules/data/curation/*.example.csv - hoy solo hay
-- plantillas .example, no archivos reales todavía). Tabla creada siempre;
-- el seed queda vacío hasta que el negocio complete el archivo real - ver
-- export-d1-seed.js y business-rules/README.md.
-- ============================================================

CREATE TABLE IF NOT EXISTS curation_placeholder_rules (
  pattern_value TEXT,
  match_type TEXT,
  applies_to TEXT,
  reason TEXT,
  created_by TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS curation_part_identity_aliases (
  alias_value TEXT,
  alias_type TEXT,
  dolibarr_product_id TEXT,
  dolibarr_ref TEXT,
  reason TEXT,
  created_by TEXT,
  created_at TEXT
);

-- ============================================================
-- RULES (Business Rules Layer - business-rules/entities/*.example.csv,
-- mismo caso que CURATION: tabla siempre creada, seed vacío si solo existe
-- el .example.csv - ver business-rules/README.md).
-- ============================================================

CREATE TABLE IF NOT EXISTS rules_client_contracts (
  client_contract_id TEXT,
  client_key TEXT,
  client_name TEXT,
  contract_name TEXT,
  contract_type TEXT,
  effective_from TEXT,
  effective_to TEXT,
  working_days TEXT,
  service_start_time TEXT,
  service_end_time TEXT,
  includes_weekends INTEGER,
  includes_holidays INTEGER,
  sla_level TEXT,
  response_time_hours REAL,
  preventive_visits_per_year INTEGER,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS rules_part_manufacturer_life (
  dolibarr_ref TEXT,
  dolibarr_label TEXT,
  manufacturer_life_months INTEGER,
  manufacturer_life_hours INTEGER,
  manufacturer_source TEXT,
  manufacturer_notes TEXT,
  confidence_of_source TEXT,
  effective_from TEXT,
  effective_to TEXT
);
