-- ============================================================
-- 03_client_report_volume.sql
-- Objetivo: volumen de reportes FieldBeat por cliente y por período.
-- Universo: report-céntrico, 3747 reportes (todos los clientes FieldBeat).
-- ============================================================

-- Reportes FieldBeat por cliente (todo el histórico).
SELECT client_name, SUM(total_reports) AS total_reportes
FROM gold.client_report_volume_by_period
GROUP BY client_name
ORDER BY total_reportes DESC;

-- Reportes por cliente y mes (grano ya viene así en la tabla GOLD).
SELECT client_name, period, total_reports, reports_with_used_parts, reports_review_required
FROM gold.client_report_volume_by_period
ORDER BY client_name, period;

-- Top 10 clientes por volumen de reportes, todo el histórico.
SELECT client_name, SUM(total_reports) AS total_reportes
FROM gold.client_report_volume_by_period
GROUP BY client_name
ORDER BY total_reportes DESC
LIMIT 10;

-- Top clientes por volumen EN UNA VENTANA DE TIEMPO (ejemplo: 2024 completo).
-- Cambiar los literales 'YYYY-MM' según la ventana que se necesite.
SELECT client_name, SUM(total_reports) AS reportes_en_periodo
FROM gold.client_report_volume_by_period
WHERE period BETWEEN '2024-01' AND '2024-12'
GROUP BY client_name
ORDER BY reportes_en_periodo DESC
LIMIT 10;

-- Tendencia mensual de un cliente específico (cambiar el nombre).
SELECT period, total_reports, reports_with_used_parts, reports_review_required
FROM gold.client_report_volume_by_period
WHERE client_name = 'FUNDACION ARTURO LOPEZ PEREZ'
ORDER BY period;
