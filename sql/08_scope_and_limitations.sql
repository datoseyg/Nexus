-- ============================================================
-- 08_scope_and_limitations.sql
-- Objetivo: dejar explícito el alcance real de GOLD v1 antes de presentar
-- cualquier número - evita que alguien lea un KPI como "el 100% del
-- negocio" cuando en realidad es "el universo Zendesk accesible hoy".
-- Ver docs/SCOPE_AND_LIMITATIONS.md y docs/KNOWN_LIMITATIONS_PHASE_1.md
-- para la narrativa completa.
-- ============================================================

-- Metadata de alcance completa (1 fila).
SELECT * FROM gold.scope_metadata;

-- Los 291 tickets Zendesk con 403 Forbidden: NO están cargados en el
-- warehouse (nunca se pudieron descargar). Esta query solo confirma el
-- número documentado; la lista completa de IDs vive en
-- data/reports/zendesk_ticket_ids_not_accessible_403.json (fuera de SQL).
SELECT zendesk_backfill_tickets_forbidden AS tickets_403_pendientes_fase_2
FROM gold.scope_metadata;

-- Cuánto del universo FieldBeat quedó DENTRO del mart ticket-céntrico
-- vs cuánto quedó fuera.
SELECT
  used_parts_in_ticket_mart,
  used_parts_outside_ticket_mart,
  total_fieldbeat_used_parts_global,
  ROUND(100.0 * used_parts_in_ticket_mart / total_fieldbeat_used_parts_global, 2) AS pct_en_alcance
FROM gold.scope_metadata;

-- Tasks FieldBeat sin ningún ticket Zendesk reportado (nunca se escribió
-- un número de ticket en el reporte técnico) vs con ticket fantasma/
-- restringido vs con ticket real y accesible.
SELECT zendesk_join_status, COUNT(*) AS reportes
FROM marts.fieldbeat_report_dolibarr_operational_view
GROUP BY zendesk_join_status
ORDER BY reportes DESC;
