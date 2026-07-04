// Formas de request/response de /api/dashboard/after-hours/* - ver
// docs/AFTER_HOURS_METRICS.md y docs/CALCULATION_CONFIDENCE_MODEL.md.
// Todo lo que aparece acá viene de marts.fieldbeat_working_hours_analysis
// (calculado una vez en el pipeline, nunca recalculado en la app).

export interface MetricWithConfidence<T> {
  value: T;
  confidence_score: number;
  confidence_label: string;
  confidence_factors_summary?: string;
}

export interface AfterHoursSummary {
  businessHoursStatus: string;
  holidaysStatus: string;
  filterOptions: {
    clientes: string[];
    tecnicos: string[];
    tiposTarea: string[];
  };
  kpis: {
    totalHours: MetricWithConfidence<number>;
    businessHours: MetricWithConfidence<number>;
    afterHoursHours: MetricWithConfidence<number>;
    afterHoursRate: MetricWithConfidence<number>;
    tasksWithAfterHours: MetricWithConfidence<number>;
    tasksNotCalculable: MetricWithConfidence<number>;
  };
}

export interface AfterHoursDetailRow {
  fieldbeat_task_id: number;
  start_time: string | null;
  estimated_end_time: string | null;
  client_name: string | null;
  equipment_internal_ids: string | null;
  assigned_to: string | null;
  task_type: string | null;
  duration_hours: number | null;
  business_hours: number | null;
  after_hours: number | null;
  weekend_hours: number | null;
  holiday_hours: number | null;
  after_hours_rate: number | null;
  calculation_method: string;
  calculation_status: string;
  confidence_score: number | null;
  confidence_label: string | null;
  confidence_factors: string | null;
}

export interface AfterHoursByDimensionRow {
  key: string;
  extra?: string | null;
  total_hours: number;
  business_hours: number;
  after_hours_total_hours: number;
  after_hours_rate: number;
  tasks_total: number;
  tasks_with_after_hours: number;
  confidence_score: number;
  confidence_label: string;
}

export interface ConfidenceDistributionRow {
  confidence_label: string;
  task_count: number;
}
