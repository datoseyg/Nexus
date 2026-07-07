-- ============================================================
-- 10_machine_history_by_client.sql
-- Objetivo: dado un cliente (o patrón de nombre), listar sus máquinas y
-- el historial completo de reportes/intervenciones de cada una.
-- Universo: report-céntrico - todos los reportes, con o sin ticket Zendesk.
--
-- CÓMO USAR: reemplazar '%alemana%' (o el equipment_internal_id de
-- ejemplo) por el patrón que se necesite buscar.
-- ============================================================

-- Qué máquinas tiene un cliente (lista única de equipment_internal_id).
SELECT DISTINCT UNNEST(STRING_SPLIT(equipment_internal_ids, '|')) AS equipment_internal_id
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE client_name ILIKE '%alemana%'
  AND equipment_internal_ids != ''
ORDER BY equipment_internal_id;

-- Historial completo de reportes de ese cliente (todas sus máquinas).
SELECT
  client_name,
  equipment_internal_ids,
  fieldbeat_task_id,
  fieldbeat_task_date,
  task_type,
  task_state,
  technician_names,
  used_parts_count,
  used_part_names,
  report_quality_status
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE client_name ILIKE '%alemana%'
ORDER BY fieldbeat_task_date DESC;

-- Cuándo se intervino una máquina específica (reemplazar el patrón de
-- equipment_internal_id).
SELECT
  client_name, equipment_internal_ids, fieldbeat_task_id, fieldbeat_task_date,
  task_type, task_state, technician_names, used_parts_count, used_part_names,
  report_quality_status
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE equipment_internal_ids ILIKE '%LINAC-153038%'
ORDER BY fieldbeat_task_date DESC;

-- Qué repuestos usó una máquina específica a lo largo del tiempo.
SELECT
  fieldbeat_task_id, fieldbeat_task_date, used_part_names, used_part_numbers,
  dolibarr_refs, part_match_statuses
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE equipment_internal_ids ILIKE '%LINAC-153038%'
  AND used_parts_count > 0
ORDER BY fieldbeat_task_date DESC;
