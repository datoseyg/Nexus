# Paquete de queries SQL - EYG Nexus Local

Queries reutilizables sobre `data/warehouse/eyg_nexus.duckdb`. Pensadas para copiar/pegar en DuckDB CLI, DBeaver, o cualquier cliente compatible con DuckDB - no son parte del pipeline de build (no las ejecuta ningún script de Node).

## Cómo abrir la base

```bash
duckdb data/warehouse/eyg_nexus.duckdb
```

## Cómo correr una query desde acá

Copiar el contenido de cualquier archivo `sql/NN_*.sql` y pegarlo en el prompt de DuckDB CLI, o abrir el archivo directo en DBeaver/extensión SQL de VS Code apuntando a esa base. Cada archivo tiene una o más queries independientes, con un comentario arriba de cada una explicando el objetivo y el universo de datos que cubre (ticket-céntrico vs report-céntrico vs global).

También se puede correr un archivo completo desde la terminal sin abrir un prompt interactivo:
```bash
duckdb data/warehouse/eyg_nexus.duckdb < sql/01_ticket_operational_overview.sql
```

## La base es reconstruible

```bash
npm run db:build
```

Esto recrea las 33 tablas desde los CSV más recientes de `data/processed/`, `data/marts/` y `data/gold/` (`CREATE OR REPLACE TABLE`, no incremental). Si cambiaste el pipeline y los números de estas queries no coinciden con lo esperado, correr esto primero.

## Ticket-céntrico vs report-céntrico / FieldBeat-first

Hay dos líneas de análisis complementarias en el warehouse - ninguna reemplaza a la otra:

| | Ticket-céntrico | Report-céntrico / FieldBeat-first |
|---|---|---|
| Tabla mart principal | `marts.ticket_fieldbeat_dolibarr_operational_view` | `marts.fieldbeat_report_dolibarr_operational_view` |
| 1 fila = | 1 ticket Zendesk | 1 reporte/task FieldBeat |
| Universo | 628 tickets **accesibles** con las credenciales actuales | 3747 reportes - **todos**, incluso los que nunca tuvieron ticket Zendesk |
| Tabla GOLD dashboard | `gold.operational_dashboard` | `gold.fieldbeat_report_analysis` |
| Usar cuando... | La pregunta parte de un ticket Zendesk ("¿qué pasó con el ticket X?") | La pregunta parte de una máquina, cliente o intervención técnica, con o sin ticket ("¿qué hizo el técnico en tal visita?") |

Si la pregunta es sobre **volumen real de trabajo técnico o consumo de repuestos**, casi siempre conviene partir de la línea report-céntrica - el universo ticket-céntrico deja afuera 3457 de 3747 reportes (ver `docs/SCOPE_AND_LIMITATIONS.md` y `docs/KNOWN_LIMITATIONS_PHASE_1.md`).

## Archivos

| Archivo | Para qué |
|---|---|
| `00_schema_overview.sql` | Inventario de schemas/tablas/conteos |
| `01_ticket_operational_overview.sql` | KPIs ticket-céntricos |
| `02_fieldbeat_report_overview.sql` | KPIs report-céntricos |
| `03_client_report_volume.sql` | Volumen de reportes por cliente / por mes |
| `04_client_parts_consumption.sql` | Consumo de repuestos por cliente / por mes |
| `05_equipment_parts_consumption.sql` | Repuestos y reportes por equipo |
| `06_used_parts_quality.sql` | Calidad de matching de repuestos (global) |
| `07_unmatched_and_ambiguous_parts.sql` | Repuestos sin matchear / ambiguos, priorización de aliases |
| `08_scope_and_limitations.sql` | Alcance de GOLD v1 y pendientes de Fase 2 |
| `09_search_technical_events.sql` | Búsqueda textual de eventos técnicos ("cambio de tubo", "RX", etc.) |
| `10_machine_history_by_client.sql` | Historial de máquinas por cliente |
| `11_after_hours_overview.sql` | Trabajo fuera de horario, con confiabilidad por fila/KPI |

Ver también [`docs/QUERY_GUIDE.md`](../docs/QUERY_GUIDE.md) para preguntas de negocio comunes mapeadas a queries específicas, y [`docs/DATA_DICTIONARY.md`](../docs/DATA_DICTIONARY.md) para el significado de cada columna y las anomalías de tipos a tener en cuenta antes de escribir un join nuevo.
