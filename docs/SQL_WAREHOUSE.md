# SQL Warehouse local — DuckDB v1

Capa de consulta SQL analítica sobre las tablas ya generadas por el pipeline CSV (`PROCESSED`, `MARTS`, `GOLD`). **No es la fuente primaria de datos** — el pipeline de archivos CSV sigue siendo la fuente de verdad; DuckDB es una vista de consumo/consulta que se reconstruye completa a partir de esos CSV cada vez que se corre `npm run db:load`.

Base de datos: `data/warehouse/eyg_nexus.duckdb` (no transaccional — no hay escritura concurrente ni movimientos de stock, es solo lectura analítica).

## Comandos

```bash
npm run db:init      # crea data/warehouse/ y los 4 schemas (idempotente)
npm run db:load       # (re)carga las 13 tablas desde los CSV actuales — CREATE OR REPLACE, reconstruible desde cero
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
| `marts` | `ticket_fieldbeat_operational_view` | `data/marts/Ticket_FieldBeat_Operational_View.csv` |
| `marts` | `ticket_fieldbeat_dolibarr_operational_view` | `data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv` |
| `marts` | `used_parts_dolibarr_match` | `data/marts/Used_Parts_Dolibarr_Match.csv` |
| `gold` | `operational_dashboard` | `data/gold/GOLD_Operational_Dashboard.csv` |
| `gold` | `data_quality_report` | `data/gold/GOLD_Data_Quality_Report.csv` |
| `gold` | `client_service_profile` | `data/gold/GOLD_Client_Service_Profile.csv` |
| `gold` | `equipment_service_profile` | `data/gold/GOLD_Equipment_Service_Profile.csv` |
| `gold` | `used_parts_analysis` | `data/gold/GOLD_Used_Parts_Analysis.csv` |
| `gold` | `scope_metadata` | `data/gold/GOLD_Scope_Metadata.csv` |
| `reports` | *(vacío en v1)* | — |

El schema `reports` se crea (`CREATE SCHEMA IF NOT EXISTS`) pero **no tiene tablas cargadas todavía** — los archivos de `data/reports/` son mayormente JSON de resumen, no CSV tabulares pensados para SQL. Queda reservado para una futura carga (ej. `used_parts_manual_review_queue.csv`, `scope_reconciliation_summary.json` aplanado) si se decide en Fase 2.

Los tipos de columna se infieren automáticamente (`read_csv_auto`) — no hay un schema SQL manual definido. Se verificó que columnas de ID compartidas entre tablas (ej. `zendesk_ticket_id`) infieren consistentemente al mismo tipo (`BIGINT`) en todas las tablas donde aparecen, por lo que los joins funcionan sin cast explícito.

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

## Reglas de esta capa

- No reemplaza el pipeline CSV — sigue siendo necesario correr `npm run build:gold` (y todo lo anterior) antes de `npm run db:load`.
- No transaccional: no hay `INSERT`/`UPDATE` manuales esperados, ni movimientos de stock. Es de solo lectura para análisis.
- Reconstruible desde cero: borrar `data/warehouse/eyg_nexus.duckdb` y correr `npm run db:build` la regenera completa.
- `npm run db:validate` es el chequeo de confianza: si algún conteo CSV vs SQL no calza, el comando falla explícitamente (exit code ≠ 0) en vez de fallar en silencio.
