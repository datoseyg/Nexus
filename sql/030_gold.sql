-- AUTOGENERADO por src/db/generate-postgres-ddl.js — NO EDITAR A MANO.
-- Fuente: information_schema.columns de data/warehouse/eyg_nexus.duckdb (introspección en vivo).
-- Para regenerar: npm run db:pg:ddl
-- Ver docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md para las tablas sin script generador propio.

CREATE TABLE IF NOT EXISTS gold."after_hours_by_client" (
  "client_name" TEXT,
  "client_rut" TEXT,
  "total_hours" DOUBLE PRECISION,
  "business_hours" DOUBLE PRECISION,
  "after_hours_total_hours" DOUBLE PRECISION,
  "after_hours_rate" DOUBLE PRECISION,
  "tasks_total" BIGINT,
  "tasks_with_after_hours" BIGINT,
  "confidence_score" BIGINT,
  "confidence_label" TEXT,
  "confidence_factors_summary" TEXT,
  "valid_rows" BIGINT,
  "invalid_rows" BIGINT,
  "estimated_rows" BIGINT,
  "exact_rows" BIGINT,
  "insufficient_rows" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."after_hours_by_period" (
  "period" TEXT,
  "total_hours" DOUBLE PRECISION,
  "business_hours" DOUBLE PRECISION,
  "after_hours_total_hours" DOUBLE PRECISION,
  "after_hours_rate" DOUBLE PRECISION,
  "tasks_total" BIGINT,
  "tasks_with_after_hours" BIGINT,
  "confidence_score" BIGINT,
  "confidence_label" TEXT,
  "confidence_factors_summary" TEXT,
  "valid_rows" BIGINT,
  "invalid_rows" BIGINT,
  "estimated_rows" BIGINT,
  "exact_rows" BIGINT,
  "insufficient_rows" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."after_hours_by_task_type" (
  "task_type" TEXT,
  "total_hours" DOUBLE PRECISION,
  "business_hours" DOUBLE PRECISION,
  "after_hours_total_hours" DOUBLE PRECISION,
  "after_hours_rate" DOUBLE PRECISION,
  "tasks_total" BIGINT,
  "tasks_with_after_hours" BIGINT,
  "confidence_score" BIGINT,
  "confidence_label" TEXT,
  "confidence_factors_summary" TEXT,
  "valid_rows" BIGINT,
  "invalid_rows" BIGINT,
  "estimated_rows" BIGINT,
  "exact_rows" BIGINT,
  "insufficient_rows" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."after_hours_by_technician" (
  "assigned_to" TEXT,
  "total_hours" DOUBLE PRECISION,
  "business_hours" DOUBLE PRECISION,
  "after_hours_total_hours" DOUBLE PRECISION,
  "after_hours_rate" DOUBLE PRECISION,
  "tasks_total" BIGINT,
  "tasks_with_after_hours" BIGINT,
  "confidence_score" BIGINT,
  "confidence_label" TEXT,
  "confidence_factors_summary" TEXT,
  "valid_rows" BIGINT,
  "invalid_rows" BIGINT,
  "estimated_rows" BIGINT,
  "exact_rows" BIGINT,
  "insufficient_rows" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."after_hours_work_analysis" (
  "kpi1_total_hours" DOUBLE PRECISION,
  "kpi1_confidence_score" BIGINT,
  "kpi1_confidence_label" TEXT,
  "kpi2_business_hours" DOUBLE PRECISION,
  "kpi2_confidence_score" BIGINT,
  "kpi2_confidence_label" TEXT,
  "kpi3_after_hours_hours" DOUBLE PRECISION,
  "kpi3_confidence_score" BIGINT,
  "kpi3_confidence_label" TEXT,
  "kpi4_after_hours_rate" DOUBLE PRECISION,
  "kpi4_confidence_score" BIGINT,
  "kpi4_confidence_label" TEXT,
  "kpi5_tasks_with_after_hours" BIGINT,
  "kpi5_confidence_score" BIGINT,
  "kpi5_confidence_label" TEXT,
  "kpi6_tasks_not_calculable" BIGINT,
  "kpi6_confidence_score" BIGINT,
  "kpi6_confidence_label" TEXT,
  "confidence_score" BIGINT,
  "confidence_label" TEXT,
  "confidence_factors_summary" TEXT,
  "valid_rows" BIGINT,
  "invalid_rows" BIGINT,
  "estimated_rows" BIGINT,
  "exact_rows" BIGINT,
  "insufficient_rows" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."client_parts_consumption" (
  "client_name" TEXT,
  "client_rut" TEXT,
  "period" TEXT,
  "total_reports" BIGINT,
  "used_parts_count" BIGINT,
  "matched_used_parts_count" BIGINT,
  "placeholder_used_parts_count" BIGINT,
  "unmatched_used_parts_count" BIGINT,
  "ambiguous_used_parts_count" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."client_report_volume_by_period" (
  "client_name" TEXT,
  "period" TEXT,
  "total_reports" BIGINT,
  "reports_with_used_parts" BIGINT,
  "reports_review_required" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."client_service_profile" (
  "client_name" TEXT,
  "total_tickets" BIGINT,
  "tickets_with_fieldbeat" BIGINT,
  "fieldbeat_report_count" BIGINT,
  "tickets_with_multiple_fieldbeat_reports" BIGINT,
  "tickets_with_used_parts" BIGINT,
  "used_parts_count" BIGINT,
  "matched_used_parts_count" BIGINT,
  "placeholder_used_parts_count" BIGINT,
  "unmatched_used_parts_count" BIGINT,
  "ambiguous_used_parts_count" BIGINT,
  "review_required_tickets" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."data_quality_report" (
  "data_quality_status" TEXT,
  "ticket_count" BIGINT,
  "percent_of_total_tickets" TEXT,
  "used_parts_count" BIGINT,
  "matched_used_parts_count" BIGINT,
  "placeholder_used_parts_count" BIGINT,
  "unmatched_used_parts_count" BIGINT,
  "ambiguous_used_parts_count" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."equipment_part_lifecycle_by_client" (
  "client_name" TEXT,
  "dolibarr_ref" TEXT,
  "dolibarr_label" TEXT,
  "first_observed_event_date" TIMESTAMPTZ,
  "last_observed_event_date" TIMESTAMPTZ,
  "observed_event_count" BIGINT,
  "valid_interval_count" BIGINT,
  "avg_interval_days" DOUBLE PRECISION,
  "median_interval_days" DOUBLE PRECISION,
  "selected_model" TEXT,
  "model_family" TEXT,
  "model_reason" TEXT,
  "estimated_life_days" DOUBLE PRECISION,
  "estimated_life_months" DOUBLE PRECISION,
  "estimated_life_p10_days" DOUBLE PRECISION,
  "estimated_life_p50_days" DOUBLE PRECISION,
  "estimated_life_p90_days" DOUBLE PRECISION,
  "credible_interval_low_days" DOUBLE PRECISION,
  "credible_interval_high_days" DOUBLE PRECISION,
  "machine_weight" DOUBLE PRECISION,
  "cohort_weight" DOUBLE PRECISION,
  "cohort_source" TEXT,
  "n_events" BIGINT,
  "n_intervals" BIGINT,
  "n_censored_observations" BIGINT,
  "replacement_rate_per_year" DOUBLE PRECISION,
  "manufacturer_life_months" TEXT,
  "manufacturer_life_source" TEXT,
  "observed_vs_manufacturer_ratio" TEXT,
  "predicted_next_replacement_date" TIMESTAMPTZ,
  "prediction_status" TEXT,
  "comparison_to_manufacturer" TEXT,
  "model_confidence_score" BIGINT,
  "model_confidence_label" TEXT,
  "model_confidence_factors" TEXT,
  "statistical_notes" TEXT,
  "estimate_status" TEXT,
  "lifecycle_confidence_score" BIGINT,
  "lifecycle_confidence_label" TEXT,
  "lifecycle_confidence_factors" TEXT,
  "min_interval_days" BIGINT,
  "max_interval_days" BIGINT,
  "stddev_interval_days" TEXT,
  "p25_interval_days" TEXT,
  "p75_interval_days" TEXT,
  "estimated_life_method" TEXT,
  "after_hours_ratio" DOUBLE PRECISION,
  "notes" TEXT
);

CREATE TABLE IF NOT EXISTS gold."equipment_part_lifecycle_by_machine" (
  "equipment_internal_id" TEXT,
  "client_name" TEXT,
  "dolibarr_ref" TEXT,
  "dolibarr_label" TEXT,
  "first_observed_event_date" TIMESTAMPTZ,
  "last_observed_event_date" TIMESTAMPTZ,
  "observed_event_count" BIGINT,
  "valid_interval_count" BIGINT,
  "avg_interval_days" DOUBLE PRECISION,
  "median_interval_days" DOUBLE PRECISION,
  "selected_model" TEXT,
  "model_family" TEXT,
  "model_reason" TEXT,
  "estimated_life_days" DOUBLE PRECISION,
  "estimated_life_months" DOUBLE PRECISION,
  "estimated_life_p10_days" DOUBLE PRECISION,
  "estimated_life_p50_days" DOUBLE PRECISION,
  "estimated_life_p90_days" DOUBLE PRECISION,
  "credible_interval_low_days" DOUBLE PRECISION,
  "credible_interval_high_days" DOUBLE PRECISION,
  "machine_weight" DOUBLE PRECISION,
  "cohort_weight" DOUBLE PRECISION,
  "cohort_source" TEXT,
  "n_events" BIGINT,
  "n_intervals" BIGINT,
  "n_censored_observations" BIGINT,
  "replacement_rate_per_year" DOUBLE PRECISION,
  "manufacturer_life_months" TEXT,
  "manufacturer_life_source" TEXT,
  "observed_vs_manufacturer_ratio" TEXT,
  "predicted_next_replacement_date" TIMESTAMPTZ,
  "prediction_status" TEXT,
  "comparison_to_manufacturer" TEXT,
  "model_confidence_score" BIGINT,
  "model_confidence_label" TEXT,
  "model_confidence_factors" TEXT,
  "statistical_notes" TEXT,
  "estimate_status" TEXT,
  "lifecycle_confidence_score" BIGINT,
  "lifecycle_confidence_label" TEXT,
  "lifecycle_confidence_factors" TEXT,
  "min_interval_days" BIGINT,
  "max_interval_days" BIGINT,
  "stddev_interval_days" TEXT,
  "p25_interval_days" TEXT,
  "p75_interval_days" TEXT,
  "estimated_life_method" TEXT,
  "after_hours_ratio" DOUBLE PRECISION,
  "notes" TEXT
);

CREATE TABLE IF NOT EXISTS gold."equipment_part_lifecycle_by_part" (
  "dolibarr_ref" TEXT,
  "dolibarr_label" TEXT,
  "first_observed_event_date" TIMESTAMPTZ,
  "last_observed_event_date" TIMESTAMPTZ,
  "observed_event_count" BIGINT,
  "valid_interval_count" BIGINT,
  "avg_interval_days" DOUBLE PRECISION,
  "median_interval_days" DOUBLE PRECISION,
  "selected_model" TEXT,
  "model_family" TEXT,
  "model_reason" TEXT,
  "estimated_life_days" DOUBLE PRECISION,
  "estimated_life_months" DOUBLE PRECISION,
  "estimated_life_p10_days" DOUBLE PRECISION,
  "estimated_life_p50_days" DOUBLE PRECISION,
  "estimated_life_p90_days" DOUBLE PRECISION,
  "credible_interval_low_days" DOUBLE PRECISION,
  "credible_interval_high_days" DOUBLE PRECISION,
  "machine_weight" TEXT,
  "cohort_weight" TEXT,
  "cohort_source" TEXT,
  "n_events" BIGINT,
  "n_intervals" BIGINT,
  "n_censored_observations" BIGINT,
  "replacement_rate_per_year" DOUBLE PRECISION,
  "manufacturer_life_months" TEXT,
  "manufacturer_life_source" TEXT,
  "observed_vs_manufacturer_ratio" TEXT,
  "predicted_next_replacement_date" TIMESTAMPTZ,
  "prediction_status" TEXT,
  "comparison_to_manufacturer" TEXT,
  "model_confidence_score" BIGINT,
  "model_confidence_label" TEXT,
  "model_confidence_factors" TEXT,
  "statistical_notes" TEXT,
  "estimate_status" TEXT,
  "lifecycle_confidence_score" BIGINT,
  "lifecycle_confidence_label" TEXT,
  "lifecycle_confidence_factors" TEXT,
  "min_interval_days" BIGINT,
  "max_interval_days" BIGINT,
  "stddev_interval_days" TEXT,
  "p25_interval_days" TEXT,
  "p75_interval_days" TEXT,
  "estimated_life_method" TEXT,
  "after_hours_ratio" DOUBLE PRECISION,
  "notes" TEXT
);

CREATE TABLE IF NOT EXISTS gold."equipment_part_lifecycle_insights" (
  "equipment_internal_id" TEXT,
  "dolibarr_ref" TEXT,
  "insight_type" TEXT,
  "insight_text" TEXT,
  "severity" TEXT
);

CREATE TABLE IF NOT EXISTS gold."equipment_part_lifecycle_summary" (
  "generated_at" TIMESTAMPTZ,
  "total_machine_part_combinations" BIGINT,
  "total_machines_analyzed" BIGINT,
  "total_parts_analyzed" BIGINT,
  "total_clients_analyzed" BIGINT,
  "prediction_status_breakdown" TEXT,
  "confidence_label_breakdown" TEXT,
  "total_insights_generated" BIGINT,
  "lifecycle_model_policy_default" TEXT
);

CREATE TABLE IF NOT EXISTS gold."equipment_parts_consumption" (
  "equipment_internal_id" TEXT,
  "total_reports" BIGINT,
  "used_parts_count" BIGINT,
  "matched_used_parts_count" BIGINT,
  "placeholder_used_parts_count" BIGINT,
  "unmatched_used_parts_count" BIGINT,
  "ambiguous_used_parts_count" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."equipment_service_profile" (
  "equipment_internal_id" TEXT,
  "total_tickets" BIGINT,
  "fieldbeat_report_count" BIGINT,
  "tickets_with_used_parts" BIGINT,
  "used_parts_count" BIGINT,
  "unmatched_used_parts_count" BIGINT,
  "ambiguous_used_parts_count" BIGINT,
  "review_required_tickets" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."fieldbeat_data_quality" (
  "report_quality_status" TEXT,
  "report_count" BIGINT,
  "percent_of_total_reports" TEXT,
  "used_parts_count" BIGINT,
  "matched_used_parts_count" BIGINT,
  "placeholder_used_parts_count" BIGINT,
  "unmatched_used_parts_count" BIGINT,
  "ambiguous_used_parts_count" BIGINT
);

CREATE TABLE IF NOT EXISTS gold."fieldbeat_report_analysis" (
  "total_fieldbeat_reports" BIGINT,
  "reports_no_ticket_reported" BIGINT,
  "reports_linked_to_accessible_zendesk" BIGINT,
  "reports_linked_to_missing_or_restricted_zendesk" BIGINT,
  "reports_with_used_parts" BIGINT,
  "reports_ok" BIGINT,
  "reports_review_required" BIGINT,
  "total_used_parts" BIGINT,
  "matched_used_parts" BIGINT,
  "placeholder_used_parts" BIGINT,
  "unmatched_used_parts" BIGINT,
  "ambiguous_used_parts" BIGINT,
  "zendesk_link_rate" TEXT,
  "used_parts_match_rate" TEXT,
  "review_required_rate" TEXT
);

CREATE TABLE IF NOT EXISTS gold."operational_dashboard" (
  "total_zendesk_tickets" BIGINT,
  "tickets_with_fieldbeat_report" BIGINT,
  "tickets_without_fieldbeat_report" BIGINT,
  "tickets_with_multiple_fieldbeat_reports" BIGINT,
  "tickets_with_used_parts" BIGINT,
  "tickets_with_all_parts_matched" BIGINT,
  "tickets_review_required" BIGINT,
  "total_used_parts_in_ticket_scope" BIGINT,
  "matched_used_parts" BIGINT,
  "placeholder_used_parts" BIGINT,
  "unmatched_used_parts" BIGINT,
  "ambiguous_used_parts" BIGINT,
  "ticket_fieldbeat_coverage_rate" TEXT,
  "used_parts_match_rate" TEXT,
  "review_required_rate" TEXT
);

CREATE TABLE IF NOT EXISTS gold."scope_metadata" (
  "total_fieldbeat_tasks" BIGINT,
  "total_fieldbeat_used_parts_global" BIGINT,
  "used_parts_in_ticket_mart" BIGINT,
  "used_parts_outside_ticket_mart" BIGINT,
  "fieldbeat_tasks_with_zendesk_ticket" BIGINT,
  "fieldbeat_tasks_without_zendesk_ticket" BIGINT,
  "fieldbeat_tasks_linked_to_existing_zendesk_ticket" BIGINT,
  "fieldbeat_tasks_linked_to_missing_zendesk_ticket" BIGINT,
  "zendesk_backfill_unique_missing_ticket_ids" BIGINT,
  "zendesk_backfill_tickets_found" BIGINT,
  "zendesk_backfill_tickets_not_found" BIGINT,
  "zendesk_backfill_tickets_forbidden" BIGINT,
  "scope_warning" TEXT,
  "phase_2_pending_action" TEXT
);

CREATE TABLE IF NOT EXISTS gold."used_parts_analysis" (
  "normalized_part_identifier" TEXT,
  "raw_part_identifier" TEXT,
  "part_name" TEXT,
  "occurrences" BIGINT,
  "matched_count" BIGINT,
  "placeholder_count" BIGINT,
  "no_match_count" BIGINT,
  "ambiguous_count" BIGINT,
  "dolibarr_refs" TEXT,
  "dolibarr_product_ids" BIGINT,
  "match_statuses" TEXT,
  "match_methods" TEXT,
  "needs_manual_review" BOOLEAN
);
