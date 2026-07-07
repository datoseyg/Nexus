-- ============================================================
-- 00_schema_overview.sql
-- Objetivo: inventario de schemas, tablas y conteo de filas.
-- Universo: todo el warehouse (sin filtrar).
-- ============================================================

-- Todas las tablas por schema.
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema IN ('processed', 'marts', 'gold', 'reports')
ORDER BY table_schema, table_name;

-- Conteo de filas de las tablas principales, agrupadas por dominio.
-- (Para un conteo automático y siempre actualizado de TODAS las tablas,
-- usar `npm run db:validate` -> data/reports/duckdb_validation_summary.json)
SELECT 'processed.zendesk_tickets' AS tabla, COUNT(*) AS filas FROM processed.zendesk_tickets
UNION ALL
SELECT 'processed.fieldbeat_tasks', COUNT(*) FROM processed.fieldbeat_tasks
UNION ALL
SELECT 'processed.fieldbeat_used_parts', COUNT(*) FROM processed.fieldbeat_used_parts
UNION ALL
SELECT 'processed.fieldbeat_report_fields', COUNT(*) FROM processed.fieldbeat_report_fields
UNION ALL
SELECT 'processed.dolibarr_products', COUNT(*) FROM processed.dolibarr_products
UNION ALL
SELECT 'marts.ticket_fieldbeat_dolibarr_operational_view', COUNT(*) FROM marts.ticket_fieldbeat_dolibarr_operational_view
UNION ALL
SELECT 'marts.fieldbeat_report_dolibarr_operational_view', COUNT(*) FROM marts.fieldbeat_report_dolibarr_operational_view
UNION ALL
SELECT 'marts.used_parts_dolibarr_match', COUNT(*) FROM marts.used_parts_dolibarr_match
UNION ALL
SELECT 'gold.operational_dashboard', COUNT(*) FROM gold.operational_dashboard
UNION ALL
SELECT 'gold.fieldbeat_report_analysis', COUNT(*) FROM gold.fieldbeat_report_analysis;

-- Tablas principales por dominio (referencia rápida, ver DATA_DICTIONARY.md
-- para el detalle columna por columna de cada una):
--
-- Zendesk:    processed.zendesk_tickets, zendesk_ticket_tags, zendesk_custom_fields
-- FieldBeat:  processed.fieldbeat_tasks, fieldbeat_used_parts, fieldbeat_task_equipments,
--             fieldbeat_clients, fieldbeat_equipments, fieldbeat_report_fields
-- Dolibarr:   processed.dolibarr_products, dolibarr_product_identity_map
--
-- Ticket-céntrico:   marts.ticket_fieldbeat_operational_view,
--                    marts.ticket_fieldbeat_dolibarr_operational_view,
--                    marts.ticket_fieldbeat_report_detail,
--                    gold.operational_dashboard, gold.data_quality_report,
--                    gold.client_service_profile, gold.equipment_service_profile
--
-- Report-céntrico:   marts.fieldbeat_report_dolibarr_operational_view,
--                    gold.fieldbeat_report_analysis, gold.client_parts_consumption,
--                    gold.client_report_volume_by_period,
--                    gold.equipment_parts_consumption, gold.fieldbeat_data_quality
--
-- Global (ambos):    marts.used_parts_dolibarr_match, gold.used_parts_analysis,
--                    gold.scope_metadata
