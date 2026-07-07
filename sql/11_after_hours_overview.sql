-- ============================================================
-- 11_after_hours_overview.sql
-- Objetivo: KPIs de trabajo fuera de horario, con confiabilidad explícita
-- por fila/KPI (ver docs/AFTER_HOURS_METRICS.md y
-- docs/CALCULATION_CONFIDENCE_MODEL.md). Cálculo preliminar/metodológico,
-- no una certeza absoluta - horario hábil aún sin validar con negocio.
-- Universo: report-céntrico, todas las 3747 tareas FieldBeat.
-- ============================================================

-- KPIs globales (equivalente a lo que muestra /dashboard/after-hours).
SELECT * FROM gold.after_hours_work_analysis;

-- Top 10 tareas con más horas fuera de horario, con su confiabilidad.
SELECT
  fieldbeat_task_id, client_name, task_type, assigned_to, start_time_local,
  duration_minutes / 60.0 AS duration_hours,
  business_minutes / 60.0 AS business_hours,
  after_hours_total_minutes / 60.0 AS after_hours_hours,
  after_hours_rate, calculation_method, calculation_status,
  confidence_score, confidence_label, confidence_factors
FROM marts.fieldbeat_working_hours_analysis
WHERE is_after_hours_task = true
ORDER BY after_hours_total_minutes DESC
LIMIT 10;

-- Top clientes por horas fuera de horario.
SELECT client_name, client_rut, total_hours, after_hours_total_hours, after_hours_rate,
       tasks_total, tasks_with_after_hours, confidence_score, confidence_label
FROM gold.after_hours_by_client
ORDER BY after_hours_total_hours DESC
LIMIT 10;

-- Distribución de confiabilidad de los cálculos (Alta/Media/Baja/Insuficiente).
SELECT confidence_label, COUNT(*) AS tareas
FROM marts.fieldbeat_working_hours_analysis
GROUP BY confidence_label
ORDER BY tareas DESC;

-- Tareas que no se pudieron calcular (no desaparecen del mart, quedan con
-- calculation_status = 'NOT_CALCULABLE' y el motivo en calculation_notes).
SELECT fieldbeat_task_id, client_name, calculation_method, calculation_notes
FROM marts.fieldbeat_working_hours_analysis
WHERE calculation_status = 'NOT_CALCULABLE';
