-- ============================================================
-- 09_search_technical_events.sql
-- Objetivo: búsqueda textual profunda de eventos técnicos específicos
-- (ej. "cambio de tubo", "generador", "colimador", "mantenimiento
-- preventivo") en las descripciones de reportes FieldBeat y en los
-- campos de texto libre del formulario técnico.
-- Universo: report-céntrico - los 3747 reportes completos, con o sin
-- ticket Zendesk (la descripción y los campos del reporte no dependen
-- de si el ticket es accesible).
--
-- CÓMO USAR: reemplazar los patrones ILIKE '%...%' por el texto buscado.
-- ILIKE en vez de LIKE para ignorar mayúsculas/minúsculas.
-- ============================================================

-- Búsqueda 1: por descripción del task (campo libre principal del
-- reporte), cruzado con el mart report-céntrico para traer
-- cliente/equipo/repuestos ya resueltos.
SELECT
  m.fieldbeat_task_id,
  m.fieldbeat_task_date,
  m.client_name,
  m.equipment_internal_ids,
  m.task_type,
  m.task_state,
  m.technician_names,
  m.linked_zendesk_ticket_id,
  m.used_part_names,
  m.used_part_numbers,
  m.dolibarr_refs,
  t.description
FROM marts.fieldbeat_report_dolibarr_operational_view m
JOIN processed.fieldbeat_tasks t
  ON m.fieldbeat_task_id = t.fieldbeat_task_id
WHERE t.description ILIKE '%tubo%'
   OR t.description ILIKE '%rayos x%'
   OR t.description ILIKE '%generador%'
   OR t.description ILIKE '%colimador%'
ORDER BY m.fieldbeat_task_date DESC;

-- Búsqueda 2: por campos de texto libre del formulario FieldBeat
-- (ej. "TRABAJO REALIZADO", "OBSERVACIONES", "DIAGNOSTICO", "NUMERO DE
-- TICKET"). Un task puede tener muchas filas de campos -> esta query
-- devuelve 1 fila por CAMPO que matchea, no 1 fila por task.
SELECT
  m.fieldbeat_task_id,
  m.fieldbeat_task_date,
  m.client_name,
  m.equipment_internal_ids,
  m.task_type,
  m.task_state,
  m.technician_names,
  m.linked_zendesk_ticket_id,
  m.used_part_names,
  m.used_part_numbers,
  m.dolibarr_refs,
  rf.field_name,
  rf.field_value
FROM processed.fieldbeat_report_fields rf
JOIN marts.fieldbeat_report_dolibarr_operational_view m
  ON rf.fieldbeat_task_id = m.fieldbeat_task_id
WHERE rf.field_value ILIKE '%cambio de tubo%'
   OR rf.field_value ILIKE '%mantenimiento preventivo%'
ORDER BY m.fieldbeat_task_date DESC;

-- Ejemplo combinado: cliente + evento técnico a la vez
-- ("Clínica Alemana" + tubo/rayos x/RX).
SELECT
  m.fieldbeat_task_id, m.fieldbeat_task_date, m.client_name,
  m.equipment_internal_ids, m.task_type, m.used_part_names, t.description
FROM marts.fieldbeat_report_dolibarr_operational_view m
JOIN processed.fieldbeat_tasks t ON m.fieldbeat_task_id = t.fieldbeat_task_id
WHERE m.client_name ILIKE '%alemana%'
  AND (t.description ILIKE '%tubo%' OR t.description ILIKE '%rayos x%' OR t.description ILIKE '%RX%')
ORDER BY m.fieldbeat_task_date DESC;

-- Otros ejemplos de patrones útiles (descomentar/ajustar el que se necesite):
-- WHERE t.description ILIKE '%colimador%'
-- WHERE t.description ILIKE '%mantenimiento preventivo%'
-- WHERE rf.field_value ILIKE '%falla%' AND rf.field_name ILIKE '%diagnostico%'
