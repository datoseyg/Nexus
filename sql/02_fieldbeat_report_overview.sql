-- ============================================================
-- 02_fieldbeat_report_overview.sql
-- Objetivo: panorama operativo report-céntrico / FieldBeat-first.
-- Universo: 3747 reportes FieldBeat COMPLETOS (con o sin ticket Zendesk).
-- ============================================================

-- KPIs globales (1 fila) - equivalente report-céntrico de
-- gold.operational_dashboard, sin recortar por alcance de ticket.
SELECT * FROM gold.fieldbeat_report_analysis;

-- Reportes sin ticket reportado (el técnico nunca escribió un número).
SELECT COUNT(*) AS reportes_sin_ticket
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE zendesk_join_status = 'NO_TICKET_REPORTED';

-- Reportes linkeados a un ticket Zendesk que SÍ existe/es accesible.
SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, linked_zendesk_ticket_id
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE zendesk_join_status = 'LINKED_TO_ACCESSIBLE_ZENDESK'
ORDER BY fieldbeat_task_date DESC;

-- Reportes linkeados a un ticket faltante/restringido (ticket "fantasma"
-- o bloqueado por permisos - ver docs/SCOPE_AND_LIMITATIONS.md).
SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, linked_zendesk_ticket_id
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK'
ORDER BY fieldbeat_task_date DESC;

-- Reportes con repuestos usados.
SELECT fieldbeat_task_id, client_name, used_parts_count, used_part_numbers, dolibarr_refs
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE used_parts_count > 0
ORDER BY used_parts_count DESC;

-- Reportes con revisión requerida.
SELECT fieldbeat_task_id, client_name, report_quality_status,
       review_required_used_parts_count, part_match_statuses
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE review_required_used_parts_count > 0
ORDER BY review_required_used_parts_count DESC;

-- Distribución por estado de calidad de reporte.
SELECT * FROM gold.fieldbeat_data_quality
ORDER BY report_count DESC;
