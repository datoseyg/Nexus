# SQL Warehouse local - DuckDB v1.4

Capa de consulta SQL analítica sobre las tablas ya generadas por el pipeline CSV (`PROCESSED`, `MARTS`, `GOLD`). **No es la fuente primaria de datos** - el pipeline de archivos CSV sigue siendo la fuente de verdad; DuckDB es una vista de consumo/consulta que se reconstruye completa a partir de esos CSV cada vez que se corre `npm run db:load`.

Base de datos: `data/warehouse/eyg_nexus.duckdb` (no transaccional - no hay escritura concurrente ni movimientos de stock, es solo lectura analítica).

**Diccionario de datos completo (columna por columna, con significado):** [DATA_DICTIONARY.md](DATA_DICTIONARY.md). Este documento (`SQL_WAREHOUSE.md`) se queda en "cómo conectarse y qué tablas hay" - para "qué significa cada columna" usar el diccionario.

**v1.1** agregó 7 tablas auxiliares/dimensionales que ya existían como CSV pero no estaban cargadas en v1. **v1.2** agregó 6 tablas más del mart/GOLD FieldBeat-first (report-centric). **v1.3** (cierre de Fase 1) agregó `processed.fieldbeat_report_fields`, la tabla de texto libre de los reportes técnicos, para búsqueda textual profunda (ver `sql/09_search_technical_events.sql`). **v1.4** agregó el mart `fieldbeat_working_hours_analysis` y las 5 tablas `gold.after_hours_*` - análisis de trabajo fuera de horario con confiabilidad explícita, para la vista independiente `/dashboard/after-hours` (ver [AFTER_HOURS_METRICS.md](AFTER_HOURS_METRICS.md) y [CALCULATION_CONFIDENCE_MODEL.md](CALCULATION_CONFIDENCE_MODEL.md)). En ningún caso se tocó un miner, normalizador, ni CSV existente - solo se amplió el mapeo de carga en `src/db/warehouse-config.js`.

**Los 291 tickets Zendesk con `403 Forbidden` (ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md) y [PHASE_2_BACKLOG.md](PHASE_2_BACKLOG.md)) siguen fuera de alcance en v1.3 - esto es esperado y no bloquea el warehouse.** El warehouse solo carga lo que ya existe en `data/processed/`, `data/marts/` y `data/gold/`; esos 291 tickets nunca llegaron a esas capas porque el token actual no tiene permiso para leerlos desde Zendesk. La lista completa sigue en `data/reports/zendesk_ticket_ids_not_accessible_403.json`.

## Comandos

```bash
npm run db:init      # crea data/warehouse/ y los 4 schemas (idempotente)
npm run db:load       # (re)carga las 33 tablas desde los CSV actuales - CREATE OR REPLACE, reconstruible desde cero
npm run db:validate   # compara conteo de filas CSV vs SQL para cada tabla, falla si no calzan
npm run db:build      # corre los 3 en orden: init -> load -> validate
```

Correr `npm run db:build` después de cualquier `npm run build:gold` para mantener el warehouse sincronizado con el CSV más reciente.

## Schemas y tablas

| Schema | Tabla | Fuente CSV |
|---|---|---|
| `processed` | `zendesk_tickets` | `data/processed/zendesk/DB_Zendesk_Tickets.csv` |
| `processed` | `fieldbeat_tasks` | `data/processed/fieldbeat/DB_FieldBeat_Tasks.csv` |
| `processed` | `fieldbeat_used_parts` | `data/processed/fieldbeat/DB_FieldBeat_Used_Parts.csv` |
| `processed` | `dolibarr_products` | `data/processed/dolibarr/DB_Dolibarr_Products.csv` |
| `processed` | `fieldbeat_clients` *(v1.1)* | `data/processed/fieldbeat/DIM_Clients.csv` |
| `processed` | `fieldbeat_equipments` *(v1.1)* | `data/processed/fieldbeat/DIM_Equipments.csv` |
| `processed` | `fieldbeat_task_equipments` *(v1.1)* | `data/processed/fieldbeat/DB_FieldBeat_Task_Equipments.csv` |
| `processed` | `zendesk_ticket_tags` *(v1.1)* | `data/processed/zendesk/DB_Zendesk_Ticket_Tags.csv` |
| `processed` | `zendesk_custom_fields` *(v1.1)* | `data/processed/zendesk/DB_Zendesk_Custom_Fields.csv` |
| `processed` | `dolibarr_product_identity_map` *(v1.1)* | `data/processed/dolibarr/DIM_Dolibarr_Product_Identity_Map.csv` |
| `processed` | `fieldbeat_report_fields` *(v1.3)* | `data/processed/fieldbeat/DB_FieldBeat_Report_Fields.csv` |
| `marts` | `ticket_fieldbeat_operational_view` | `data/marts/Ticket_FieldBeat_Operational_View.csv` |
| `marts` | `ticket_fieldbeat_dolibarr_operational_view` | `data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv` |
| `marts` | `used_parts_dolibarr_match` | `data/marts/Used_Parts_Dolibarr_Match.csv` |
| `marts` | `ticket_fieldbeat_report_detail` *(v1.1)* | `data/marts/Ticket_FieldBeat_Report_Detail.csv` |
| `marts` | `fieldbeat_report_dolibarr_operational_view` *(v1.2, report-centric)* | `data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv` |
| `marts` | `fieldbeat_working_hours_analysis` *(v1.4, after-hours)* | `data/marts/FieldBeat_Working_Hours_Analysis.csv` |
| `gold` | `operational_dashboard` | `data/gold/GOLD_Operational_Dashboard.csv` |
| `gold` | `data_quality_report` | `data/gold/GOLD_Data_Quality_Report.csv` |
| `gold` | `client_service_profile` | `data/gold/GOLD_Client_Service_Profile.csv` |
| `gold` | `equipment_service_profile` | `data/gold/GOLD_Equipment_Service_Profile.csv` |
| `gold` | `used_parts_analysis` | `data/gold/GOLD_Used_Parts_Analysis.csv` |
| `gold` | `scope_metadata` | `data/gold/GOLD_Scope_Metadata.csv` |
| `gold` | `fieldbeat_report_analysis` *(v1.2, report-centric)* | `data/gold/GOLD_FieldBeat_Report_Analysis.csv` |
| `gold` | `client_parts_consumption` *(v1.2, report-centric)* | `data/gold/GOLD_Client_Parts_Consumption.csv` |
| `gold` | `client_report_volume_by_period` *(v1.2, report-centric)* | `data/gold/GOLD_Client_Report_Volume_By_Period.csv` |
| `gold` | `equipment_parts_consumption` *(v1.2, report-centric)* | `data/gold/GOLD_Equipment_Parts_Consumption.csv` |
| `gold` | `fieldbeat_data_quality` *(v1.2, report-centric)* | `data/gold/GOLD_FieldBeat_Data_Quality.csv` |
| `gold` | `after_hours_work_analysis` *(v1.4, after-hours)* | `data/gold/GOLD_After_Hours_Work_Analysis.csv` |
| `gold` | `after_hours_by_client` *(v1.4, after-hours)* | `data/gold/GOLD_After_Hours_By_Client.csv` |
| `gold` | `after_hours_by_task_type` *(v1.4, after-hours)* | `data/gold/GOLD_After_Hours_By_Task_Type.csv` |
| `gold` | `after_hours_by_technician` *(v1.4, after-hours)* | `data/gold/GOLD_After_Hours_By_Technician.csv` |
| `gold` | `after_hours_by_period` *(v1.4, after-hours)* | `data/gold/GOLD_After_Hours_By_Period.csv` |
| `reports` | *(vacío en v1)* | - |

Las tablas marcadas *(report-centric)* son **complementarias** a las ticket-céntricas - no las reemplazan. Una fila en `marts.fieldbeat_report_dolibarr_operational_view` es 1 task/reporte FieldBeat (universo completo: 3747, incluye los que nunca tuvieron ticket Zendesk), mientras que una fila en `marts.ticket_fieldbeat_dolibarr_operational_view` es 1 ticket Zendesk (628, solo el universo accesible). Ver [DATA_DICTIONARY.md](DATA_DICTIONARY.md) para el detalle columna por columna de ambas líneas.

El schema `reports` se crea (`CREATE SCHEMA IF NOT EXISTS`) pero **no tiene tablas cargadas todavía** - los archivos de `data/reports/` son mayormente JSON de resumen, no CSV tabulares pensados para SQL. Queda reservado para una futura carga (ej. `used_parts_manual_review_queue.csv`, `scope_reconciliation_summary.json` aplanado) si se decide en Fase 2.

Los tipos de columna se infieren automáticamente (`read_csv_auto`) - no hay un schema SQL manual definido. **Ojo:** esto NO garantiza que una columna con el mismo nombre tenga el mismo tipo en todas las tablas - por ejemplo `zendesk_ticket_id` es `BIGINT` en la mayoría de las tablas pero `VARCHAR` en `marts.used_parts_dolibarr_match` (esa columna viene casi vacía). Ver la sección **"Anomalías y advertencias de tipos"** en [DATA_DICTIONARY.md](DATA_DICTIONARY.md) antes de escribir un join nuevo.

## Cómo consultar la base

Cualquier cliente compatible con DuckDB sirve: [DuckDB CLI](https://duckdb.org/docs/api/cli/overview.html), [DBeaver](https://duckdb.org/docs/guides/sql_editors/dbeaver.html), extensión de VS Code, Python (`duckdb` package), o un script Node con `@duckdb/node-api` (la misma librería que usa este pipeline).

Ejemplo rápido desde DuckDB CLI:
```bash
duckdb data/warehouse/eyg_nexus.duckdb
```
```sql
SHOW ALL TABLES;
SELECT * FROM gold.operational_dashboard;
```

Ejemplo desde Node (mismo patrón que `src/db/validate-duckdb.js`):
```js
import { DuckDBInstance } from "@duckdb/node-api";

const instance = await DuckDBInstance.create("data/warehouse/eyg_nexus.duckdb");
const connection = await instance.connect();
const reader = await connection.runAndReadAll("SELECT * FROM gold.operational_dashboard");
console.log(reader.getRowObjects());
connection.closeSync();
```

**Nota:** columnas `BIGINT` se devuelven como `bigint` de JS (ej. `228n`), no `number`. Esto solo importa si consumís los resultados desde JS/Node (ej. para `JSON.stringify` hay que convertir con `Number(...)` o `.toString()`); desde SQL puro (CLI, DBeaver, Python) no es un problema.

## Consultas de ejemplo

### 1. Tickets con FieldBeat
```sql
SELECT zendesk_ticket_id, subject, status, fieldbeat_report_count
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE has_fieldbeat_report = true
ORDER BY fieldbeat_report_count DESC;
```

### 2. Tickets con repuestos
```sql
SELECT zendesk_ticket_id, subject, used_parts_count, used_part_numbers
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE used_parts_count > 0
ORDER BY used_parts_count DESC;
```

### 3. Tickets con revisión requerida
```sql
SELECT zendesk_ticket_id, subject, data_quality_status,
       review_required_used_parts_count, part_match_statuses
FROM marts.ticket_fieldbeat_dolibarr_operational_view
WHERE review_required_used_parts_count > 0
ORDER BY review_required_used_parts_count DESC;
```

### 4. Clientes con más intervenciones
```sql
SELECT client_name, total_tickets, tickets_with_used_parts, review_required_tickets
FROM gold.client_service_profile
ORDER BY total_tickets DESC
LIMIT 20;
```

### 5. Repuestos no matcheados
```sql
SELECT normalized_part_identifier, raw_part_identifier, part_name, occurrences
FROM gold.used_parts_analysis
WHERE no_match_count > 0
ORDER BY occurrences DESC;
```

### 6. Estado de alcance GOLD v1
```sql
SELECT * FROM gold.scope_metadata;
```
Trae en una sola fila: universo total de FieldBeat, cuánto quedó dentro/fuera del mart, resultado del backfill, y las columnas de texto `scope_warning`/`phase_2_pending_action`. Ver el detalle narrativo completo en [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md).

### 7. Reportes FieldBeat sin ticket Zendesk (vista report-centric)
```sql
SELECT fieldbeat_task_id, client_name, task_type, zendesk_join_status, used_parts_count
FROM marts.fieldbeat_report_dolibarr_operational_view
WHERE zendesk_join_status != 'LINKED_TO_ACCESSIBLE_ZENDESK'
ORDER BY used_parts_count DESC;
```
A diferencia de las queries 1-3 (que solo ven los 628 tickets accesibles), esta trae los 3457 reportes FieldBeat que NO tienen ticket Zendesk accesible (2537 nunca reportaron ticket + 920 con ticket fantasma/restringido) - el universo que el mart ticket-céntrico deja afuera.

### 8. Clientes por consumo de repuestos en una ventana de tiempo
```sql
SELECT client_name, SUM(used_parts_count) AS repuestos_periodo
FROM gold.client_parts_consumption
WHERE period BETWEEN '2024-01' AND '2024-12'
GROUP BY client_name
ORDER BY repuestos_periodo DESC
LIMIT 10;
```
`gold.client_parts_consumption` tiene grano (cliente, período mensual) a propósito - filtrar `period` antes de sumar es lo que permite responder "en una ventana de tiempo" sin reconstruir el pipeline.

### 9. Tareas fuera de horario, con confiabilidad (v1.4)
```sql
SELECT fieldbeat_task_id, client_name, task_type, start_time_local,
       after_hours_total_minutes / 60.0 AS after_hours_hours,
       after_hours_rate, calculation_method, confidence_score, confidence_label
FROM marts.fieldbeat_working_hours_analysis
WHERE is_after_hours_task = true
ORDER BY after_hours_total_minutes DESC
LIMIT 20;
```
Nunca mostrar `confidence_score`/`confidence_label` por separado del valor - ver [CALCULATION_CONFIDENCE_MODEL.md](CALCULATION_CONFIDENCE_MODEL.md). Este es un cálculo preliminar sobre un horario hábil configurado (`data/config/business-hours.json`) que aún no ha sido validado con negocio.

## Reglas de esta capa

- No reemplaza el pipeline CSV - sigue siendo necesario correr `npm run build:gold` (y todo lo anterior) antes de `npm run db:load`.
- No transaccional: no hay `INSERT`/`UPDATE` manuales esperados, ni movimientos de stock. Es de solo lectura para análisis.
- Reconstruible desde cero: borrar `data/warehouse/eyg_nexus.duckdb` y correr `npm run db:build` la regenera completa.
- `npm run db:validate` es el chequeo de confianza: si algún conteo CSV vs SQL no calza, el comando falla explícitamente (exit code ≠ 0) en vez de fallar en silencio.
