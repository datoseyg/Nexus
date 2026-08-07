-- Phase 5 - índices sobre fieldbeat_task_id, medidos como necesarios (no
-- especulativos): el endpoint de detalle maestro
-- (GET /api/dashboard/fieldbeat/reports/[id]) hace un lookup de 1 fila por
-- tabla vía correlated subqueries (ver lib/fieldbeat-report-detail-queries.ts)
-- y sin índice cada una de estas 4 tablas resuelve por Seq Scan completo
-- (2.000-3.800 filas cada una). Individualmente cada Seq Scan es rápido
-- (<1ms), pero el ESTIMADO de costo del planner (que asume el peor caso
-- para las correlated subqueries) supera jit_above_cost y dispara
-- compilación JIT completa - medido con EXPLAIN (ANALYZE, BUFFERS): ~1.7s
-- de esos ~1.75s totales eran compilación JIT (Optimization 902ms + Emission
-- 731ms), NO ejecución real (todos los nodos del plan ejecutan en
-- sub-milisegundos). Con el índice, el estimado de costo baja lo
-- suficiente para que el planner ya no dispare JIT, y el lookup pasa a ser
-- Index Scan directo.
--
-- Ninguna de estas 4 tablas tenía NINGÚN índice (ni siquiera PK) antes de
-- esta migración - verificado contra información_schema/pg_indexes en
-- localhost:55480/nexus_bi_dev_local_test. CREATE INDEX IF NOT EXISTS:
-- reaplicar esta migración nunca falla ni reconstruye el índice si ya existe.
CREATE INDEX IF NOT EXISTS idx_fieldbeat_tasks_task_id
  ON processed.fieldbeat_tasks (fieldbeat_task_id);

CREATE INDEX IF NOT EXISTS idx_fieldbeat_report_dolibarr_operational_view_task_id
  ON marts.fieldbeat_report_dolibarr_operational_view (fieldbeat_task_id);

CREATE INDEX IF NOT EXISTS idx_ticket_fieldbeat_report_detail_task_id
  ON marts.ticket_fieldbeat_report_detail (fieldbeat_task_id);

CREATE INDEX IF NOT EXISTS idx_used_parts_dolibarr_match_task_id
  ON marts.used_parts_dolibarr_match (fieldbeat_task_id);
