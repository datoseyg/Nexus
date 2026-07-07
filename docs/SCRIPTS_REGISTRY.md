# Registro de scripts (`package.json`)

Todos los scripts del `package.json` de la raíz (26 scripts). `apps/nexus-bi-app/package.json` tiene su propio `package.json` con solo `dev`/`build`/`start` (ver [APP_STRUCTURE_MAP.md](APP_STRUCTURE_MAP.md)) — se listan al final de esta tabla como referencia.

| Script | Comando | Categoría | Qué hace | Entradas | Salidas | Riesgo | Cuándo usarlo |
|---|---|---|---|---|---|---|---|
| `get:zendesk` | `node src/miners/zendesk.js` | extracción | Pagina `/api/v2/search.json` de Zendesk (búsqueda de tickets) | `.env` (ZENDESK_*) | `data/raw/zendesk/search_page_N_*.json` | ALTO (llama API externa real, consume rate limit) | Al iniciar o refrescar datos de Zendesk |
| `get:fieldbeat` | `node src/miners/fieldbeat.js` | extracción | **DEPRECADO (2026-07-04)** - detectado roto en la auditoría de estructura (usaba una variable `taskId` nunca declarada y no iteraba sobre `FIELDBEAT_TASK_IDS`). Se corrigió para lanzar un error claro y explícito en vez de un `ReferenceError` - **ya no intenta ninguna llamada HTTP**, nunca se adivinó el endpoint real "un task por ID" de FieldBeat (no está documentado en ningún lugar del repo) | `.env` (FIELDBEAT_*, `FIELDBEAT_TASK_IDS`) | Ninguna (lanza error inmediato) | BAJO (ya no puede fallar en producción de forma confusa, ni traer datos incorrectos) | **No usar** - usar `get:fieldbeat:all` |
| `get:fieldbeat:all` | `node src/miners/fieldbeat-all.js` | extracción | Pagina `/fleets/eyg/tasks` por cursor `next_page` hasta agotar páginas | `.env` (FIELDBEAT_*) | `data/raw/fieldbeat/list_pages/*.json`, `all_tasks_latest.json`, `task_index.json` | ALTO (llama API externa real) | Miner FieldBeat real del flujo completo |
| `get:dolibarr` | `node src/miners/dolibarr.js` | extracción | Pagina `/api/index.php/products` de Dolibarr | `.env` (DOLIBARR_*) | `data/raw/dolibarr/products_page_N_*.json` | ALTO (llama API externa real) | Al iniciar o refrescar catálogo Dolibarr |
| `get:all` | `node src/run-all.js` | extracción | Corre los 3 miners en secuencia (Dolibarr → Zendesk → FieldBeat, vía `fieldbeat-all.js`) | `.env` completo | RAW de las 3 plataformas | ALTO (3 APIs externas reales) | Extracción completa desde cero |
| `get:zendesk:backfill-fieldbeat` | `node src/miners/zendesk-backfill-missing-ticket-ids.js` | extracción (backfill puntual) | Busca en Zendesk, uno por uno, los `zendesk_ticket_id` que FieldBeat menciona pero que `get:zendesk` no trajo | `data/reports/fieldbeat_tasks_linked_to_missing_zendesk_ticket.csv`, `.env` (ZENDESK_*) | `data/raw/zendesk/backfill_by_fieldbeat_ticket_ids/*.json`, `data/reports/zendesk_backfill_by_fieldbeat_summary.json`, `zendesk_ticket_ids_not_found_after_backfill.csv` | ALTO (llama API externa, 1 request por ticket) | Ya ejecutado en Fase 1 - **no repetir** sin necesidad (ver `docs/KNOWN_LIMITATIONS_PHASE_1.md`) |
| `normalize:fieldbeat` | `node src/normalizers/fieldbeat-normalizer.js` | normalización | RAW FieldBeat → 7 CSV normalizados, incluye explosión de listas numeradas de repuestos | `data/raw/fieldbeat/all_tasks_latest.json` | `data/processed/fieldbeat/*.csv` (7 archivos) | MEDIO (sobreescribe processed) | Después de cualquier `get:fieldbeat*` |
| `normalize:zendesk` | `node src/normalizers/zendesk-normalizer.js` | normalización | RAW Zendesk (recursivo, incluye backfill) → 3 CSV normalizados | `data/raw/zendesk/**/*.json` | `data/processed/zendesk/*.csv` (3 archivos) | MEDIO | Después de `get:zendesk` o el backfill |
| `normalize:dolibarr` | `node src/normalizers/dolibarr-normalizer.js` | normalización | RAW Dolibarr → productos + mapa de identidad (REF/BARCODE/ID) | `data/raw/dolibarr/*.json` | `data/processed/dolibarr/*.csv` (2 archivos) | MEDIO | Después de `get:dolibarr` |
| `qa:fieldbeat` | `node src/qa/audit-fieldbeat.js` | QA | Duplicados, cobertura de ticket/part_number, muestras | `data/processed/fieldbeat/*.csv` | `data/reports/fieldbeat_audit_report.json` | BAJO (solo lee) | Después de `normalize:fieldbeat` |
| `qa:zendesk` | `node src/qa/audit-zendesk.js` | QA | Duplicados, integridad referencial tags/custom fields | `data/processed/zendesk/*.csv` | `data/reports/zendesk_audit_report.json` | BAJO | Después de `normalize:zendesk` |
| `qa:dolibarr` | `node src/qa/audit-dolibarr.js` | QA | Duplicados, cobertura ref/barcode, refs compartidas por >1 producto | `data/processed/dolibarr/*.csv` | `data/reports/dolibarr_audit_report.json` | BAJO | Después de `normalize:dolibarr` |
| `qa:ticket-fieldbeat` | `node src/qa/audit-ticket-fieldbeat-multiplicity.js` | QA | Cuántos reportes FieldBeat tiene cada ticket Zendesk (distribución) | `BR_Ticket_FieldBeat_Task.csv`, `DB_FieldBeat_Tasks.csv` | `data/reports/ticket_fieldbeat_multiplicity_summary.json` + 2 CSV | BAJO | Exploración de datos, no bloquea el flujo |
| `build:used-parts-dolibarr-match` | `node src/marts/build-used-parts-dolibarr-match.js` | resolver/mart | Corre el resolver de identidad sobre cada repuesto usado (global, todas las tasks) | `DB_FieldBeat_Used_Parts.csv`, `DIM_Dolibarr_Product_Identity_Map.csv`, `data/config/part_identity_aliases.csv` (opcional) | `data/marts/Used_Parts_Dolibarr_Match.csv` + varios `data/reports/used_parts_*` | MEDIO | Después de normalizar FieldBeat y Dolibarr |
| `build:ticket-fieldbeat-view` | `node src/marts/build-ticket-fieldbeat-view.js` | mart builder | Cruza tickets Zendesk con reportes FieldBeat (sin Dolibarr todavía) | `DB_Zendesk_Tickets.csv`, `BR_Ticket_FieldBeat_Task.csv`, `DB_FieldBeat_*.csv` | `data/marts/Ticket_FieldBeat_Operational_View.csv`, `Ticket_FieldBeat_Report_Detail.csv` | MEDIO | Línea ticket-céntrica, antes de la vista con Dolibarr |
| `build:ticket-fieldbeat-dolibarr-view` | `node src/marts/build-ticket-fieldbeat-dolibarr-view.js` | mart builder | Agrega métricas de repuestos + `data_quality_status` al mart ticket-céntrico | `Ticket_FieldBeat_Operational_View.csv`, `Used_Parts_Dolibarr_Match.csv` | `data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv` | MEDIO | Mart ticket-céntrico principal |
| `qa:scope-reconciliation` | `node src/qa/reconcile-ticket-fieldbeat-dolibarr-scope.js` | QA | Cuánto de FieldBeat quedó dentro/fuera del mart ticket-céntrico, y por qué | mart ticket-céntrico + processed FieldBeat/Zendesk | `data/reports/scope_reconciliation_summary.json` + 2 CSV | BAJO | Antes de construir GOLD ticket-céntrico |
| `build:gold` | `node src/gold/build-gold.js` | gold builder | 6 tablas GOLD ticket-céntricas (KPIs, calidad, perfiles cliente/equipo, repuestos, alcance) | mart ticket-céntrico + reportes JSON | `data/gold/GOLD_*.csv` (6 archivos) | MEDIO | Cierre de la línea ticket-céntrica |
| `build:fieldbeat-report-dolibarr-view` | `node src/marts/build-fieldbeat-report-dolibarr-view.js` | mart builder | Vista report-céntrica/FieldBeat-first - 1 fila por task, universo completo (con o sin ticket) | `DB_FieldBeat_Tasks.csv`, equipos, bridge, Zendesk, used parts match | `data/marts/FieldBeat_Report_Dolibarr_Operational_View.csv` | MEDIO | Línea report-céntrica, complementaria a la ticket-céntrica |
| `build:gold:fieldbeat` | `node src/gold/build-fieldbeat-gold.js` | gold builder | 5 tablas GOLD report-céntricas | mart report-céntrico + used parts match | `data/gold/GOLD_FieldBeat_*.csv`, `GOLD_Client_*.csv`, `GOLD_Equipment_Parts_Consumption.csv` | MEDIO | Cierre de la línea report-céntrica |
| `build:fieldbeat-working-hours` | `node src/marts/build-fieldbeat-working-hours-analysis.js` | mart builder | Clasifica cada task en business/after-hours/weekend/holiday + score de confiabilidad | `DB_FieldBeat_Tasks.csv`, `DB_FieldBeat_Report_Fields.csv`, mart report-céntrico, `data/config/business-hours.json`/`holidays.*.json` | `data/marts/FieldBeat_Working_Hours_Analysis.csv` | MEDIO | Antes de `build:gold:after-hours` |
| `build:gold:after-hours` | `node src/gold/build-after-hours-gold.js` | gold builder | 5 tablas GOLD de Trabajo Fuera de Horario (global + por cliente/tipo/técnico/período) | mart de working hours | `data/gold/GOLD_After_Hours_*.csv` (5 archivos) | MEDIO | Cierre de la línea after-hours |
| `db:init` | `node src/db/init-duckdb.js` | duckdb | Crea `data/warehouse/` y los 4 schemas (idempotente) | ninguna | `data/warehouse/eyg_nexus.duckdb` (schemas vacíos si es nuevo) | BAJO | Primera vez, o si se borró el archivo |
| `db:load` | `node src/db/load-duckdb.js` | duckdb | `CREATE OR REPLACE TABLE` para las 33 tablas de `warehouse-config.js`, reconstrucción completa | `data/processed/marts/gold/*.csv` | Tablas cargadas en el `.duckdb` | MEDIO/ALTO (reemplaza todo el contenido del warehouse) | Después de cualquier build de mart/gold |
| `db:validate` | `node src/db/validate-duckdb.js` | duckdb (QA) | Compara conteo de filas CSV vs SQL para cada tabla, falla si no calzan | warehouse cargado + CSV fuente | `data/reports/duckdb_validation_summary.json`, exit code ≠ 0 si falla | BAJO (solo lee, pero puede fallar el build) | Siempre después de `db:load` |
| `db:build` | `npm run db:init && npm run db:load && npm run db:validate` | duckdb | Los 3 anteriores en orden | - | warehouse reconstruido + reporte de validación | MEDIO/ALTO (reemplaza el warehouse) | Después de cualquier cambio en marts/gold, antes de levantar la app |
| `qa:phase1` | `node src/qa/final-phase1-audit.js` | QA | Verifica docs requeridos, tablas esperadas (aprox), `sql/` presente, estado del warehouse | `data/reports/duckdb_validation_summary.json`, `data/warehouse/eyg_nexus.duckdb`, `docs/*`, `sql/*` | `data/reports/phase1_final_audit_summary.json` (`phase1_status`: READY / READY_WITH_WARNINGS / NOT_READY) | BAJO (solo lee) | Chequeo final después de correr todo el pipeline |
| `curation:validate` | `node src/curation/validate-curation-files.js` | curación (QA) | Valida que los CSV de `data/curation/` tengan las columnas esperadas | `data/curation/*.csv` (`.example.csv` y reales si existen) | `data/reports/curation_validation_summary.json` | BAJO (solo lee) | Si se edita algo en `data/curation/` |
| `app:dev` | `cd apps/nexus-bi-app && npm run dev` | app | Levanta la app Next.js en modo desarrollo (`next dev`, puerto 3000) | warehouse ya construido | servidor local | BAJO (solo lectura sobre DuckDB) | Para usar/probar la app |
| `app:build` | `cd apps/nexus-bi-app && npm run build` | app | Build de producción de la app Next.js | - | `.next/` (no versionado) | BAJO | Antes de un `next start` real |

### Scripts de `apps/nexus-bi-app/package.json` (independiente, no llamado por scripts de la raíz salvo `app:dev`/`app:build`)

| Script | Comando | Categoría | Qué hace | Riesgo |
|---|---|---|---|---|
| `dev` | `next dev` | app | Servidor de desarrollo Next.js (Turbopack) | BAJO |
| `build` | `next build` | app | Build de producción | BAJO |
| `start` | `next start` | app | Sirve el build de producción | BAJO |

### Scripts que NO existen (mencionados en el pedido o en documentación, pero ausentes hoy)

- **`sync:full` / `sync:rebuild` / `sync:status`** - no existen en ningún `package.json` del repo (verificado por grep). No hay riesgo de correrlos por accidente porque no están definidos. El equivalente real hoy es `npm run db:build` (o correr todo el pipeline en el orden de `docs/LOCAL_OPERATIONS_RUNBOOK.md`).
- **`audit:structure`** - no existía antes de esta auditoría; se agrega en esta misma sesión (ver `docs/PROJECT_INDEX.md` / Parte 10 del pedido).
- No hay scripts `test`, `lint`, ni `typecheck` en ningún `package.json` del repo.

### Scripts duplicados

Ninguno - cada script mapea 1:1 a un archivo distinto. `get:fieldbeat` y `get:fieldbeat:all` ambos "minan FieldBeat" conceptualmente, pero `get:fieldbeat` está **deprecado y deshabilitado** desde el 2026-07-04 (ver fila arriba) - `get:fieldbeat:all` es el único miner FieldBeat funcional.

### Scripts que llaman a archivos inexistentes

Ninguno - los 26 scripts de la raíz apuntan a archivos que existen y son ejecutables.

### Archivos ejecutables sin script asociado

- `src/request.http` - no tiene (ni debería tener) script; es un archivo huérfano, ver [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md).
- `src/lib/*.js`, `src/resolvers/part-identity-resolver.js`, `src/db/warehouse-config.js` - correctamente sin script propio, son módulos importados por otros scripts, no ejecutables standalone.
