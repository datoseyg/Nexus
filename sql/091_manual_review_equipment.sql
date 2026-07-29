-- Overlay de identificación de equipo (Gate B, comando 4 - B8): mismo patrón
-- aditivo que manual_review.part_aliases/ticket_link_overrides (sql/050) -
-- fila efectiva vigente, historial real vive en governance.correction_versions
-- (B5), nunca en esta tabla.

CREATE TABLE IF NOT EXISTS manual_review.equipment_identification_overrides (
  id                              bigserial PRIMARY KEY,
  fieldbeat_task_id                bigint NOT NULL,
  raw_equipment_reference            text,
  corrected_equipment_internal_id      text NOT NULL,
  reason                                text,
  created_by                              text,
  created_at                                timestamptz NOT NULL DEFAULT now(),
  updated_at                                  timestamptz NOT NULL DEFAULT now(),
  active                                        boolean NOT NULL DEFAULT true,
  UNIQUE (fieldbeat_task_id, raw_equipment_reference)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON manual_review.equipment_identification_overrides TO governance_owner;
GRANT USAGE, SELECT ON manual_review.equipment_identification_overrides_id_seq TO governance_owner;
GRANT SELECT ON manual_review.equipment_identification_overrides TO nexus_app_read, nexus_app_corrections, nexus_rule_evaluator;
