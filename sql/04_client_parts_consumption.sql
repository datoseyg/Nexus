-- ============================================================
-- 04_client_parts_consumption.sql
-- Objetivo: consumo de repuestos por cliente y por período.
-- Universo: report-céntrico (gold.client_parts_consumption ya viene con
-- grano cliente x período mensual - ver docs/GOLD_DATA_CONTRACT.md).
-- ============================================================

-- Repuestos usados por cliente (todo el histórico).
SELECT client_name, SUM(used_parts_count) AS repuestos_usados
FROM gold.client_parts_consumption
GROUP BY client_name
ORDER BY repuestos_usados DESC;

-- Repuestos usados por cliente y mes.
SELECT client_name, period, used_parts_count,
       matched_used_parts_count, placeholder_used_parts_count,
       unmatched_used_parts_count, ambiguous_used_parts_count
FROM gold.client_parts_consumption
ORDER BY client_name, period;

-- Desglose matched/unmatched/placeholder/ambiguous por cliente (histórico).
SELECT
  client_name,
  SUM(used_parts_count) AS total,
  SUM(matched_used_parts_count) AS matched,
  SUM(placeholder_used_parts_count) AS placeholder,
  SUM(unmatched_used_parts_count) AS no_match,
  SUM(ambiguous_used_parts_count) AS ambiguous
FROM gold.client_parts_consumption
GROUP BY client_name
ORDER BY total DESC;

-- Top 10 clientes por consumo de repuestos, todo el histórico.
SELECT client_name, SUM(used_parts_count) AS repuestos_usados
FROM gold.client_parts_consumption
GROUP BY client_name
ORDER BY repuestos_usados DESC
LIMIT 10;

-- Top clientes por consumo EN UNA VENTANA DE TIEMPO (ejemplo: 2024).
SELECT client_name, SUM(used_parts_count) AS repuestos_en_periodo
FROM gold.client_parts_consumption
WHERE period BETWEEN '2024-01' AND '2024-12'
GROUP BY client_name
ORDER BY repuestos_en_periodo DESC
LIMIT 10;

-- Clientes con más repuestos sin matchear (candidatos a revisión manual
-- prioritaria - ver sql/07_unmatched_and_ambiguous_parts.sql).
SELECT client_name, SUM(unmatched_used_parts_count) AS no_matcheados
FROM gold.client_parts_consumption
GROUP BY client_name
HAVING SUM(unmatched_used_parts_count) > 0
ORDER BY no_matcheados DESC;

-- Clientes con más placeholders ("sin numero", "NC", etc. - no son
-- repuestos reales, ver docs/DATA_DICTIONARY.md).
SELECT client_name, SUM(placeholder_used_parts_count) AS placeholders
FROM gold.client_parts_consumption
GROUP BY client_name
HAVING SUM(placeholder_used_parts_count) > 0
ORDER BY placeholders DESC;
