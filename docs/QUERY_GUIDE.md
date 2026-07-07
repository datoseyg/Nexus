# Guía de queries - preguntas de negocio comunes

Mapeo de preguntas frecuentes a queries concretas. El paquete completo con comentarios está en [`sql/`](../sql/) - este documento es el índice rápido "tengo esta pregunta, ¿qué corro?".

Abrir la base: `duckdb data/warehouse/eyg_nexus.duckdb`. Ver [`sql/README.md`](../sql/README.md) para más detalle de cómo correr las queries.

## ¿Cuántos reportes por cliente?

```sql
SELECT client_name, SUM(total_reports) AS total_reportes
FROM gold.client_report_volume_by_period
GROUP BY client_name
ORDER BY total_reportes DESC;
```
Ver `sql/03_client_report_volume.sql`.

## ¿Qué cliente usa más repuestos?

```sql
SELECT client_name, SUM(used_parts_count) AS repuestos_usados
FROM gold.client_parts_consumption
GROUP BY client_name
ORDER BY repuestos_usados DESC
LIMIT 10;
```
Ver `sql/04_client_parts_consumption.sql`. Para una ventana de tiempo específica, agregar `WHERE period BETWEEN 'YYYY-MM' AND 'YYYY-MM'`.

## ¿Qué máquina usa más repuestos?

```sql
SELECT equipment_internal_id, used_parts_count
FROM gold.equipment_parts_consumption
ORDER BY used_parts_count DESC
LIMIT 10;
```
Ver `sql/05_equipment_parts_consumption.sql`.

## ¿Cuándo se cambió un repuesto específico?

```sql
SELECT fieldbeat_task_id, fieldbeat_task_date, client_name, equipment_internal_ids, used_part_names
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE used_part_names ILIKE '%tubo%'  -- reemplazar por el repuesto buscado
ORDER BY fieldbeat_task_date DESC;
```
Para búsquedas más profundas (por descripción del reporte, no solo por nombre de repuesto), ver `sql/09_search_technical_events.sql`.

## ¿Qué reportes requieren revisión?

```sql
-- Ticket-céntrico (628 tickets accesibles)
SELECT zendesk_ticket_id, subject, review_required_used_parts_count
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE review_required_used_parts_count > 0
ORDER BY review_required_used_parts_count DESC;

-- Report-céntrico (3747 reportes, universo completo)
SELECT fieldbeat_task_id, client_name, review_required_used_parts_count
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE review_required_used_parts_count > 0
ORDER BY review_required_used_parts_count DESC;
```
Ver `sql/01_ticket_operational_overview.sql` y `sql/02_fieldbeat_report_overview.sql`.

## ¿Cuáles son los tickets sin FieldBeat?

```sql
SELECT zendesk_ticket_id, subject, status
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE has_fieldbeat_report = false;
```
Ver `sql/01_ticket_operational_overview.sql`.

## ¿Cuáles son los reportes FieldBeat sin ticket Zendesk?

```sql
SELECT fieldbeat_task_id, client_name, fieldbeat_task_date, task_type
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE zendesk_join_status = 'NO_TICKET_REPORTED'
ORDER BY fieldbeat_task_date DESC;
```
Ver `sql/02_fieldbeat_report_overview.sql`. Para distinguir "nunca reportó ticket" de "reportó un ticket que no existe/no es accesible", ver `zendesk_join_status` en [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## ¿Qué repuestos no matchearon contra Dolibarr y conviene priorizar?

```sql
SELECT normalized_part_identifier, raw_part_identifier, occurrences
FROM gold.used_parts_analysis
WHERE no_match_count > 0 OR ambiguous_count > 0
ORDER BY occurrences DESC
LIMIT 30;
```
Ver `sql/07_unmatched_and_ambiguous_parts.sql` - es el insumo directo para decidir qué agregar a `data/config/part_identity_aliases.csv`.

## ¿Qué máquinas tiene un cliente y cuál es su historial?

```sql
SELECT DISTINCT UNNEST(STRING_SPLIT(equipment_internal_ids, '|')) AS equipment_internal_id
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE client_name ILIKE '%<nombre del cliente>%'
  AND equipment_internal_ids != '';
```
Ver `sql/10_machine_history_by_client.sql` para el historial completo de reportes de cada máquina.

## ¿Cuál es el estado de alcance de GOLD v1 (qué falta y por qué)?

```sql
SELECT * FROM gold.scope_metadata;
```
Ver `sql/08_scope_and_limitations.sql` y [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md).
