WITH picks AS (
  (SELECT used_part_id, raw_part_identifier, fieldbeat_task_id FROM marts.used_parts_dolibarr_match WHERE raw_part_identifier = 'NA' ORDER BY used_part_id LIMIT 1)
  UNION ALL
  (SELECT used_part_id, raw_part_identifier, fieldbeat_task_id FROM marts.used_parts_dolibarr_match WHERE raw_part_identifier = 'N/A' ORDER BY used_part_id LIMIT 1)
  UNION ALL
  (SELECT used_part_id, raw_part_identifier, fieldbeat_task_id FROM marts.used_parts_dolibarr_match WHERE raw_part_identifier = 'No hay' ORDER BY used_part_id LIMIT 1)
  UNION ALL
  (SELECT used_part_id, raw_part_identifier, fieldbeat_task_id FROM marts.used_parts_dolibarr_match WHERE raw_part_identifier = 'No' ORDER BY used_part_id LIMIT 1)
  UNION ALL
  (SELECT used_part_id, raw_part_identifier, fieldbeat_task_id FROM marts.used_parts_dolibarr_match WHERE raw_part_identifier = 'N/C' ORDER BY used_part_id LIMIT 1)
)
SELECT
  m.fieldbeat_task_id,
  m.used_part_id,
  r.client_name,
  r.equipment_internal_ids,
  r.fieldbeat_task_date,
  m.raw_part_identifier,
  m.normalized_part_identifier,
  m.part_name,
  p.quantity,
  m.dolibarr_ref,
  m.candidate_dolibarr_product_ids,
  m.match_status AS raw_match_status,
  quality.classify_part_declaration(m.raw_part_identifier, m.match_status, p.quantity) AS effective_match_status,
  q.historical_match_status AS view_historical_match_status,
  i.id AS issue_id, i.rule_code, i.status AS issue_status, i.is_currently_detected, i.first_seen_at, i.last_seen_at, i.disappeared_at
FROM picks pk
JOIN marts.used_parts_dolibarr_match m ON m.used_part_id = pk.used_part_id
LEFT JOIN processed.fieldbeat_used_parts p ON p.used_part_id = m.used_part_id
LEFT JOIN marts.fieldbeat_report_dolibarr_operational_view r ON r.fieldbeat_task_id = m.fieldbeat_task_id
LEFT JOIN quality.fieldbeat_used_part_match q ON q.used_part_id = m.used_part_id
LEFT JOIN governance.issues i ON i.entity_type = 'part_occurrence' AND i.occurrence_key = m.used_part_id AND i.rule_code IN ('PART_PLACEHOLDER_VALUE','PART_NO_MATCH')
ORDER BY m.raw_part_identifier;
