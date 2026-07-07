-- ============================================================
-- 01_ticket_operational_overview.sql
-- Objetivo: panorama operativo ticket-céntrico.
-- Universo: 628 tickets Zendesk ACCESIBLES con las credenciales actuales.
-- ============================================================

-- KPIs globales (1 fila).
SELECT * FROM gold.operational_dashboard;

-- Tickets con FieldBeat vs sin FieldBeat.
SELECT
  has_fieldbeat_report,
  COUNT(*) AS tickets
FROM marts.ticket_fieldbeat_dolibarr_operational_view
GROUP BY has_fieldbeat_report;

-- Tickets con más de un reporte FieldBeat (posible indicio de trabajo
-- recurrente o de un ticket que agrupó varias visitas).
SELECT zendesk_ticket_id, subject, fieldbeat_report_count, fieldbeat_task_ids
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE has_multiple_fieldbeat_reports = true
ORDER BY fieldbeat_report_count DESC;

-- Tickets con repuestos usados.
SELECT zendesk_ticket_id, subject, used_parts_count, used_part_numbers, dolibarr_refs
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE used_parts_count > 0
ORDER BY used_parts_count DESC;

-- Tickets con revisión requerida (incluye placeholders, no-match, ambiguos
-- y matches de baja confianza REF_LIKE).
SELECT zendesk_ticket_id, subject, data_quality_status,
       review_required_used_parts_count, part_match_statuses
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE review_required_used_parts_count > 0
ORDER BY review_required_used_parts_count DESC;

-- Distribución por estado de calidad de dato.
SELECT * FROM gold.data_quality_report
ORDER BY ticket_count DESC;
