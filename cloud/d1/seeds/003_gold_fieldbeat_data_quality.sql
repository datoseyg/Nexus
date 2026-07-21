-- Seed generado por src/cloud/export-d1-seed.js - NO EDITAR A MANO.
-- Tabla: gold_fieldbeat_data_quality
-- Filas: 6

INSERT INTO gold_fieldbeat_data_quality (report_quality_status, report_count, percent_of_total_reports, used_parts_count, matched_used_parts_count, placeholder_used_parts_count, unmatched_used_parts_count, ambiguous_used_parts_count) VALUES
('OK', 480, '12.81%', 625, 625, 0, 0, 0),
('NO_USED_PARTS', 1938, '51.72%', 0, 0, 0, 0, 0),
('HAS_PLACEHOLDERS', 696, '18.57%', 734, 15, 719, 0, 0),
('HAS_UNMATCHED_PARTS', 460, '12.28%', 573, 91, 2, 480, 0),
('HAS_AMBIGUOUS_PARTS', 56, '1.49%', 106, 41, 0, 9, 56),
('REVIEW_REQUIRED', 117, '3.12%', 155, 155, 0, 0, 0);
