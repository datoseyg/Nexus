// Formas de request/response de /api/dashboard/equipment-lifecycle/* - ver
// docs/EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md. Todo viene precalculado del
// pipeline (marts.equipment_part_lifecycle_* / gold.equipment_part_lifecycle_*),
// la app nunca recalcula vida útil ni confiabilidad, solo lee y filtra.

// Modelo estadístico elegido por src/models/lifecycle/lifecycle-model-selector.js
// (ver docs/LIFECYCLE_PREDICTIVE_MODELS.md) - usado por el selector de
// modelo de la UI (Parte 11).
export type LifecycleModelName =
  | "MEDIAN_INTERVAL"
  | "TRIMMED_MEAN_INTERVAL"
  | "EMPIRICAL_BAYES_SHRINKAGE"
  | "BAYESIAN_WEIBULL_GRID"
  | "GAMMA_POISSON_RATE_MODEL"
  | "NONE";

export type LifecyclePredictionStatus =
  | "DIRECT_HISTORY_ENOUGH"
  | "LOW_N_SHRINKAGE"
  | "BORROWED_COHORT_ESTIMATE"
  | "RATE_MODEL_ESTIMATE"
  | "MANUFACTURER_PRIOR_ONLY"
  | "INSUFFICIENT_DATA"
  | "UNSTABLE_MODEL";

export interface LifecycleAggregateRow {
  equipment_internal_id?: string | null;
  client_name?: string | null;
  dolibarr_ref: string;
  dolibarr_label: string | null;
  first_observed_event_date: string | null;
  last_observed_event_date: string | null;
  observed_event_count: number;
  valid_interval_count: number;
  avg_interval_days: number | null;
  median_interval_days: number | null;
  // --- Motor de modelos predictivos (Partes 5-10) ---
  selected_model: LifecycleModelName;
  model_family: string;
  model_reason: string;
  estimated_life_days: number | null;
  estimated_life_months: number | null;
  estimated_life_p10_days: number | null;
  estimated_life_p50_days: number | null;
  estimated_life_p90_days: number | null;
  credible_interval_low_days: number | null;
  credible_interval_high_days: number | null;
  machine_weight: number | null;
  cohort_weight: number | null;
  cohort_source: string | null;
  n_events: number;
  n_intervals: number;
  n_censored_observations: number;
  replacement_rate_per_year: number | null;
  manufacturer_life_months: string | null;
  manufacturer_life_source: string;
  observed_vs_manufacturer_ratio: number | null;
  predicted_next_replacement_date: string | null;
  prediction_status: LifecyclePredictionStatus;
  comparison_to_manufacturer: string;
  model_confidence_score: number;
  model_confidence_label: string;
  model_confidence_factors: string;
  statistical_notes: string;
  // --- Alias de compatibilidad con la sesión anterior (mismo valor que
  // sus contrapartes de arriba - ver build-equipment-part-lifecycle-gold.js) ---
  estimated_life_method: string;
  min_interval_days: number | null;
  max_interval_days: number | null;
  stddev_interval_days: number | null;
  p25_interval_days: number | null;
  p75_interval_days: number | null;
  lifecycle_confidence_score: number;
  lifecycle_confidence_label: string;
  lifecycle_confidence_factors: string;
  estimate_status: string;
  after_hours_ratio: number | null;
  notes: string | null;
}

export interface EquipmentLifecycleEventRow {
  lifecycle_event_id: string;
  fieldbeat_task_id: number;
  event_date: string | null;
  client_name: string | null;
  equipment_internal_id: string | null;
  task_type: string | null;
  task_state: string | null;
  technician_names: string | null;
  used_part_id: number;
  part_name: string | null;
  quantity: string | null;
  dolibarr_ref: string | null;
  dolibarr_label: string | null;
  match_status: string;
  match_method: string | null;
  event_type_inferred: string;
  association_confidence_score: number;
  association_confidence_label: string;
  calculation_status: string;
  calculation_notes: string | null;
}

export interface LifecycleInsightRow {
  equipment_internal_id: string;
  dolibarr_ref: string;
  insight_type: string;
  insight_text: string;
  severity: string;
}

export interface MachineListItem {
  equipment_internal_id: string;
  client_name: string | null;
  parts_tracked: number;
  reports_count: number;
  avg_confidence_score: number | null;
}

export interface MachineProfile {
  equipment_internal_id: string;
  client_name: string | null;
  reports_count: number;
  parts_observed: number;
  first_event_date: string | null;
  last_event_date: string | null;
  business_minutes_total: number | null;
  after_hours_minutes_total: number | null;
}

export interface LifecycleSummary {
  total_machine_part_combinations: number;
  total_machines_analyzed: number;
  total_parts_analyzed: number;
  total_clients_analyzed: number;
  estimate_status_breakdown: Record<string, number>;
  confidence_label_breakdown: Record<string, number>;
  total_insights_generated: number;
  filterOptions: {
    clientes: string[];
    tiposTarea: string[];
  };
}
