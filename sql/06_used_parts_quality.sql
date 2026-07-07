-- ============================================================
-- 06_used_parts_quality.sql
-- Objetivo: calidad de matching de repuestos contra el catálogo Dolibarr.
-- Universo: GLOBAL - marts.used_parts_dolibarr_match y gold.used_parts_analysis
-- cubren los 2193 repuestos de TODOS los tasks FieldBeat, no solo los de
-- tickets Zendesk accesibles.
-- ============================================================

-- Resumen de match_status (cuántos repuestos MATCHED / NO_MATCH /
-- AMBIGUOUS_MATCH / PLACEHOLDER_VALUE).
SELECT match_status, COUNT(*) AS repuestos
FROM marts.used_parts_dolibarr_match
GROUP BY match_status
ORDER BY repuestos DESC;

-- Desglose por match_method (qué tier de la cascada de resolución
-- resolvió cada repuesto - ver src/resolvers/part-identity-resolver.js).
SELECT match_method, COUNT(*) AS repuestos
FROM marts.used_parts_dolibarr_match
GROUP BY match_method
ORDER BY repuestos DESC;

-- Repuestos con mayor ocurrencia (útil para priorizar qué vale la pena
-- estandarizar primero - un repuesto que aparece 50 veces vale más la
-- pena arreglar que uno que aparece 1 vez).
SELECT normalized_part_identifier, raw_part_identifier, part_name, occurrences, match_statuses
FROM gold.used_parts_analysis
ORDER BY occurrences DESC
LIMIT 30;

-- Placeholders más frecuentes ("sin numero", "NC", "N/A", etc. - no son
-- repuestos reales, ver docs/DATA_DICTIONARY.md / KNOWN_LIMITATIONS_PHASE_1.md).
SELECT normalized_part_identifier, raw_part_identifier, occurrences
FROM gold.used_parts_analysis
WHERE match_statuses LIKE '%PLACEHOLDER_VALUE%'
ORDER BY occurrences DESC;

-- Matches de baja confianza (REF_LIKE) y todo lo marcado para revisión
-- manual, aunque el match_status final sea MATCHED.
SELECT used_part_id, fieldbeat_task_id, raw_part_identifier, dolibarr_ref,
       match_method, match_confidence, match_status
FROM marts.used_parts_dolibarr_match
WHERE needs_manual_review = true
ORDER BY match_confidence ASC;

-- Solo los REF_LIKE (el tier de menor confianza que sí produjo un match).
SELECT used_part_id, fieldbeat_task_id, raw_part_identifier, dolibarr_ref, dolibarr_label
FROM marts.used_parts_dolibarr_match
WHERE match_method = 'REF_LIKE'
ORDER BY fieldbeat_task_id;
