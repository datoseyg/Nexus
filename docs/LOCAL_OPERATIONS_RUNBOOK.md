# Runbook de operación local - EYG Nexus Local

Cómo correr el pipeline completo desde cero, en orden, y qué revisar después.

## Requisitos previos

```bash
npm install
```

`.env` debe existir con las credenciales de Zendesk, FieldBeat y Dolibarr (ver `.env.example`). **Nunca commitear `.env` ni pegar sus valores en ningún archivo versionado.**

## Pipeline completo, en orden

```bash
# 1. Miners - RAW
npm run get:fieldbeat:all
npm run get:zendesk
npm run get:dolibarr

# 2. Normalizers - RAW -> PROCESSED
npm run normalize:fieldbeat
npm run normalize:zendesk
npm run normalize:dolibarr

# 3. Resolución de identidad de repuestos (FieldBeat <-> Dolibarr)
npm run build:used-parts-dolibarr-match

# 4. Marts ticket-céntricos
npm run build:ticket-fieldbeat-view
npm run build:ticket-fieldbeat-dolibarr-view

# 5. QA de alcance (antes de GOLD)
npm run qa:scope-reconciliation

# 6. GOLD ticket-céntrico
npm run build:gold

# 7. Mart y GOLD report-céntrico / FieldBeat-first
npm run build:fieldbeat-report-dolibarr-view
npm run build:gold:fieldbeat

# 7b. Mart y GOLD de Trabajo Fuera de Horario (after-hours)
npm run build:fieldbeat-working-hours
npm run build:gold:after-hours

# 8. Warehouse SQL (DuckDB) - carga las capas de arriba
npm run db:build

# 9. Auditoría final de Fase 1
npm run qa:phase1
```

> **Corrección respecto al comando `npm run get:fieldbeat`:** ese script existe, pero es el miner puntual de tareas por ID (`FIELDBEAT_TASK_IDS` en `.env`) - **no** es el que alimenta el pipeline completo. El comando correcto para minar todo FieldBeat es **`npm run get:fieldbeat:all`** (paginación por cursor `next_page`), que es el que aparece arriba.

Backfill puntual (no forma parte del flujo estándar, ya ejecutado en Fase 1 - **no repetir**, ver [KNOWN_LIMITATIONS_PHASE_1.md](KNOWN_LIMITATIONS_PHASE_1.md)):
```bash
npm run get:zendesk:backfill-fieldbeat
```

## Qué revisar después de correr

| Archivo | Qué confirma |
|---|---|
| `data/reports/duckdb_validation_summary.json` | `all_match: true` - los conteos CSV vs SQL calzan en las 33 tablas. |
| `data/reports/gold_build_summary.json` | Resumen del build de GOLD ticket-céntrico (row counts, cross-checks). |
| `data/reports/fieldbeat_gold_build_summary.json` | Resumen del build de GOLD report-céntrico. |
| `data/reports/fieldbeat_working_hours_analysis_summary.json` | Resumen del mart de Trabajo Fuera de Horario: distribución de `calculation_method`/`calculation_status`, distribución de confianza, y self-check (`after_hours_rate` siempre 0-1, `confidence_score` siempre 0-100). |
| `data/reports/after_hours_gold_build_summary.json` | Resumen del build de las 5 tablas GOLD de after-hours. |
| `data/reports/scope_reconciliation_summary.json` | Cuánto del universo FieldBeat quedó dentro/fuera del mart ticket-céntrico, y por qué. |
| `data/reports/phase1_final_audit_summary.json` | `phase1_status: READY` - auditoría final de que todo el cierre de Fase 1 está completo. |

Si `db:validate` falla (`all_match: false`) o `qa:phase1` reporta `NOT_READY`, revisar la salida en consola de esos comandos - indican exactamente qué tabla/archivo no calza o falta.

## Cómo abrir DuckDB en DBeaver

1. Nueva conexión → tipo **DuckDB**.
2. Ruta del archivo: `data/warehouse/eyg_nexus.duckdb` (ruta absoluta del proyecto).
3. Conectar - se ven los 4 schemas (`processed`, `marts`, `gold`, `reports`).

**Importante:** mientras DBeaver tiene la conexión abierta, **el archivo queda bloqueado** - ningún script de Node (`db:load`, `db:validate`, `db:build`, `qa:phase1`) va a poder leer/escribir la base hasta que se cierre la conexión en DBeaver (ni siquiera en modo solo-lectura, DuckDB no permite acceso concurrente si otro proceso la tiene abierta en lectura-escritura, que es el modo por defecto de DBeaver). Cerrar la conexión en DBeaver antes de correr cualquiera de esos comandos.

## Qué NO versionar (ya cubierto en `.gitignore`)

```
data/raw/
.env
data/warehouse/*.duckdb
data/warehouse/*.wal
node_modules/
```

`data/processed/`, `data/marts/`, `data/gold/`, `data/reports/` y `data/config/` **sí** se versionan (son CSV/JSON legibles y auditables, sin secretos). El archivo binario de DuckDB no se versiona porque es 100% reconstruible con `npm run db:build` a partir de esos CSV.
