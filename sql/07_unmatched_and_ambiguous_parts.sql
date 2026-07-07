-- ============================================================
-- 07_unmatched_and_ambiguous_parts.sql
-- Objetivo: identificar y priorizar repuestos sin matchear o ambiguos
-- para revisión manual / alta de alias en data/config/part_identity_aliases.csv.
-- Universo: GLOBAL (marts.used_parts_dolibarr_match, 2193 repuestos).
-- ============================================================

-- NO_MATCH más frecuentes (agrupado por identificador normalizado, para
-- no repetir la misma variante de texto muchas veces).
SELECT normalized_part_identifier, raw_part_identifier, part_name, occurrences
FROM gold.used_parts_analysis
WHERE no_match_count > 0
ORDER BY occurrences DESC
LIMIT 30;

-- Todas las filas AMBIGUOUS_MATCH, con sus candidatos.
SELECT used_part_id, fieldbeat_task_id, raw_part_identifier,
       match_method, candidate_dolibarr_product_ids
FROM marts.used_parts_dolibarr_match
WHERE match_status = 'AMBIGUOUS_MATCH'
ORDER BY fieldbeat_task_id;

-- Detalle de los productos candidatos de una ambigüedad específica
-- (reemplazar la lista de IDs por la de `candidate_dolibarr_product_ids`
-- de la fila que se quiera resolver).
-- Ejemplo con IDs reales vistos durante el desarrollo:
SELECT dolibarr_product_id, ref, label
FROM processed.dolibarr_products
WHERE dolibarr_product_id IN (11815, 11920, 10702, 10703);

-- Priorización sugerida para data/config/part_identity_aliases.csv:
-- repuestos NO_MATCH o AMBIGUOUS_MATCH ordenados por cuántas veces
-- aparecen - atacar primero los de mayor `occurrences` maximiza el
-- impacto de cada alias manual que se agregue.
SELECT
  normalized_part_identifier,
  raw_part_identifier,
  part_name,
  occurrences,
  match_statuses,
  needs_manual_review
FROM gold.used_parts_analysis
WHERE no_match_count > 0 OR ambiguous_count > 0
ORDER BY occurrences DESC
LIMIT 50;
