-- ============================================================
-- 05_equipment_parts_consumption.sql
-- Objetivo: reportes y consumo de repuestos por equipo.
-- Universo: report-céntrico (gold.equipment_parts_consumption, fan-out
-- desde marts.fieldbeat_report_dolibarr_operational_view.equipment_internal_ids).
-- ============================================================

-- Equipos con más reportes (más intervenidos).
SELECT equipment_internal_id, total_reports
FROM gold.equipment_parts_consumption
ORDER BY total_reports DESC
LIMIT 20;

-- Equipos con más repuestos usados.
SELECT equipment_internal_id, used_parts_count, matched_used_parts_count
FROM gold.equipment_parts_consumption
ORDER BY used_parts_count DESC
LIMIT 20;

-- Equipos con más repuestos no matcheados o ambiguos (peor calidad de dato
-- de repuestos, prioridad de revisión).
SELECT
  equipment_internal_id,
  unmatched_used_parts_count,
  ambiguous_used_parts_count,
  (unmatched_used_parts_count + ambiguous_used_parts_count) AS problema_total
FROM gold.equipment_parts_consumption
WHERE unmatched_used_parts_count > 0 OR ambiguous_used_parts_count > 0
ORDER BY problema_total DESC;

-- Detalle de un equipo específico: cruce con la dimensión FieldBeat de
-- equipos (tipo inferido, cliente dueño).
SELECT
  epc.equipment_internal_id,
  fe.equipment_type,
  fe.client_key,
  epc.total_reports,
  epc.used_parts_count
FROM gold.equipment_parts_consumption epc
LEFT JOIN processed.fieldbeat_equipments fe
  ON epc.equipment_internal_id = fe.internal_id
ORDER BY epc.total_reports DESC;
