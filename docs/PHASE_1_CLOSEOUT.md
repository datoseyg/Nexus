# Cierre de Fase 1 - EYG Nexus Local

**Estado: Fase 1 cerrada como MVP local de BI/DataOps.** Local/serverless-first, sin dependencias cloud, sin movimientos de stock, documentado y auditable.

## Resumen ejecutivo

Se construyó un pipeline local completo que integra 3 plataformas operativas de EYG (Zendesk, FieldBeat, Dolibarr) en 5 capas de datos, cerrando con un warehouse SQL consultable (DuckDB) y un paquete de queries reutilizables. Todo corre desde VS Code con `npm run <script>`, sin servidores ni costos variables.

## Las 5 capas

| Capa | Qué es | Dónde vive |
|---|---|---|
| **RAW** | JSON crudo de cada API, tal como llega | `data/raw/` (no versionado) |
| **PROCESSED** | CSV normalizado por plataforma, 1 tabla por entidad | `data/processed/` |
| **MARTS** | Cruces resueltos entre plataformas | `data/marts/` |
| **GOLD** | Tablas finales agregadas para consumo BI | `data/gold/` |
| **DuckDB SQL Warehouse** | Las 4 capas de arriba cargadas en una base SQL consultable | `data/warehouse/eyg_nexus.duckdb` |

Ver [ARCHITECTURE.md](ARCHITECTURE.md) para el detalle de diseño de cada capa.

## Fuentes integradas

- **Zendesk** - demanda/ticket (el cliente reporta un problema).
- **FieldBeat** - ejecución técnica/reporte (el técnico documenta el trabajo en terreno, incluyendo repuestos usados).
- **Dolibarr** - catálogo de productos/repuestos/inventario.

## Universos de datos (snapshot de cierre de Fase 1)

| Universo | Cantidad |
|---|---|
| Tickets Zendesk **accesibles** con las credenciales actuales | 628 |
| Reportes/tasks FieldBeat (universo completo) | 3747 |
| Repuestos usados (global, todas las tasks FieldBeat) | 2193 |
| Productos del catálogo Dolibarr | 1609 |
| Tablas cargadas en DuckDB | 27 (ver `data/reports/duckdb_validation_summary.json`) |

## Dos líneas de análisis complementarias

Este es el punto conceptual más importante de Fase 1: **no hay un único mart "correcto"** - hay dos universos distintos, ninguno reemplaza al otro:

1. **Ticket-céntrica** (Zendesk → FieldBeat → Dolibarr): 1 fila = 1 ticket Zendesk. Universo de 628 tickets **accesibles**. Tabla principal: `marts.ticket_fieldbeat_dolibarr_operational_view`.
2. **Report-céntrica / FieldBeat-first** (FieldBeat → Dolibarr → Zendesk opcional): 1 fila = 1 reporte/task FieldBeat. Universo **completo** de 3747 reportes, con o sin ticket Zendesk. Tabla principal: `marts.fieldbeat_report_dolibarr_operational_view`.

La línea ticket-céntrica solo cubre 290 de 3747 reportes FieldBeat (7.7%) - el resto nunca tuvo un ticket Zendesk asociado, o el ticket no es accesible con el token actual. Cualquier pregunta sobre volumen real de trabajo técnico o consumo de repuestos debe partir de la línea report-céntrica. Ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md) y [KNOWN_LIMITATIONS_PHASE_1.md](KNOWN_LIMITATIONS_PHASE_1.md).

## Documentación de referencia

- [ARCHITECTURE.md](ARCHITECTURE.md) - diseño de capas y filosofía local/serverless-first.
- [DATA_PIPELINE.md](DATA_PIPELINE.md) - comandos en orden y qué genera cada uno.
- [DATA_DICTIONARY.md](DATA_DICTIONARY.md) - diccionario completo de las 27 tablas DuckDB, columna por columna.
- [GOLD_DATA_CONTRACT.md](GOLD_DATA_CONTRACT.md) - contrato de las tablas GOLD ticket-céntricas.
- [SQL_WAREHOUSE.md](SQL_WAREHOUSE.md) - cómo consultar DuckDB.
- [LOCAL_OPERATIONS_RUNBOOK.md](LOCAL_OPERATIONS_RUNBOOK.md) - cómo correr el pipeline completo.
- [BI_READINESS.md](BI_READINESS.md) - qué tablas usar para dashboard.
- [QUERY_GUIDE.md](QUERY_GUIDE.md) - preguntas de negocio comunes y su query.
- [KNOWN_LIMITATIONS_PHASE_1.md](KNOWN_LIMITATIONS_PHASE_1.md) - todo lo que Fase 1 NO resuelve todavía.
- [PHASE_2_HANDOFF.md](PHASE_2_HANDOFF.md) - checklist de arranque para Fase 2.
- `sql/` - paquete de 11 queries reutilizables + README.

## Qué NO se hizo en Fase 1 (a propósito)

- No se migró a cloud ni se implementó serverless.
- No se crearon movimientos de stock en Dolibarr.
- No se completó el backfill de los 291 tickets Zendesk con `403 Forbidden` (requiere un token con permisos ampliados - Fase 2).
- No se construyó un dashboard BI - la base queda lista para conectar, pero la publicación queda para Fase 2.

## Verificación de cierre

Correr `npm run qa:phase1` (ver `src/qa/final-phase1-audit.js`) para una auditoría automática que confirma que todos los artefactos de este cierre existen y que DuckDB sigue consistente. Resultado en `data/reports/phase1_final_audit_summary.json`.
