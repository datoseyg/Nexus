-- Motivo explícito para un estado contractual NO_CONTRACT. Se conserva
-- NO_CONTRACT_STATUS por compatibilidad con resultados históricos, mientras
-- las reconstrucciones nuevas publican NO_CONTRACT.
BEGIN;

ALTER TABLE marts.fieldbeat_contract_coverage_segments
  DROP CONSTRAINT IF EXISTS fieldbeat_contract_coverage_segments_segment_reason_code_check;
ALTER TABLE marts.fieldbeat_contract_coverage_segments
  ADD CONSTRAINT fieldbeat_contract_coverage_segments_segment_reason_code_check
  CHECK (segment_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'WITHIN_LEGACY_SCHEDULE', 'NO_CONTRACT_AT_TASK_DATE',
    'EQUIPMENT_UNMATCHED', 'EQUIPMENT_AMBIGUOUS', 'NO_CONTRACT', 'NO_CONTRACT_STATUS',
    'ON_DEMAND_UNDEFINED', 'CONTRACT_STATUS_DEINSTALLED', 'SCHEDULE_REVIEW_REQUIRED',
    'CRITICALITY_UNKNOWN', 'HOLIDAY_COVERAGE_UNKNOWN'
  ));

ALTER TABLE marts.fieldbeat_working_hours_analysis_v2
  DROP CONSTRAINT IF EXISTS fieldbeat_working_hours_analysis_v2_coverage_reason_code_check;
ALTER TABLE marts.fieldbeat_working_hours_analysis_v2
  ADD CONSTRAINT fieldbeat_working_hours_analysis_v2_coverage_reason_code_check
  CHECK (coverage_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'WITHIN_LEGACY_SCHEDULE', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE',
    'MULTIPLE_EQUIPMENT_CONFLICT', 'NO_EQUIPMENT', 'EQUIPMENT_UNMATCHED', 'EQUIPMENT_AMBIGUOUS',
    'NO_CONTRACT_AT_TASK_DATE', 'NO_CONTRACT', 'NO_CONTRACT_STATUS', 'ON_DEMAND_UNDEFINED',
    'CONTRACT_STATUS_DEINSTALLED', 'SCHEDULE_REVIEW_REQUIRED', 'CRITICALITY_UNKNOWN',
    'HOLIDAY_COVERAGE_UNKNOWN', 'INVALID_START_TIME', 'INVALID_DURATION', 'INSUFFICIENT_DATA'
  ));

ALTER TABLE marts.fieldbeat_working_hours_analysis_v2
  DROP CONSTRAINT IF EXISTS fieldbeat_working_hours_analysis__contractual_reason_code_check;
ALTER TABLE marts.fieldbeat_working_hours_analysis_v2
  ADD CONSTRAINT fieldbeat_working_hours_analysis__contractual_reason_code_check
  CHECK (contractual_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'MULTIPLE_EQUIPMENT_SAME_COVERAGE', 'MULTIPLE_EQUIPMENT_CONFLICT',
    'NO_EQUIPMENT', 'EQUIPMENT_UNMATCHED', 'EQUIPMENT_AMBIGUOUS', 'NO_CONTRACT_AT_TASK_DATE',
    'NO_CONTRACT', 'NO_CONTRACT_STATUS', 'ON_DEMAND_UNDEFINED', 'CONTRACT_STATUS_DEINSTALLED',
    'SCHEDULE_REVIEW_REQUIRED', 'CRITICALITY_UNKNOWN', 'HOLIDAY_COVERAGE_UNKNOWN',
    'INVALID_START_TIME', 'INVALID_DURATION', 'INSUFFICIENT_DATA'
  ));

ALTER TABLE marts.fieldbeat_working_hours_equipment_links
  DROP CONSTRAINT IF EXISTS fieldbeat_working_hours_equipment_l_equipment_reason_code_check;
ALTER TABLE marts.fieldbeat_working_hours_equipment_links
  ADD CONSTRAINT fieldbeat_working_hours_equipment_l_equipment_reason_code_check
  CHECK (equipment_reason_code IN (
    'WITHIN_MATCHED_CONTRACT', 'NO_CONTRACT_AT_TASK_DATE', 'EQUIPMENT_UNMATCHED',
    'EQUIPMENT_AMBIGUOUS', 'NO_CONTRACT', 'NO_CONTRACT_STATUS', 'ON_DEMAND_UNDEFINED',
    'CONTRACT_STATUS_DEINSTALLED', 'SCHEDULE_REVIEW_REQUIRED', 'CRITICALITY_UNKNOWN',
    'HOLIDAY_COVERAGE_UNKNOWN'
  ));

COMMIT;
