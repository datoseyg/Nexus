# Inventario maestro de archivos

Tabla archivo por archivo (o grupo de archivos, cuando son datos repetitivos del mismo tipo) con responsabilidad, procedencia y riesgo. Para el inventario **completo y machine-readable** (fila por fila, sin agrupar, incluyendo los ~260 archivos escaneados) ver `data/reports/project_file_inventory.json` / `.csv`, generados por `npm run audit:structure` (`src/qa/audit-project-structure.js`). Este documento es la versión curada para lectura humana - agrupa archivos de datos repetitivos (ej. los CSV de `data/processed/`) en una sola fila cuando siguen un patrón idéntico, para que sea escaneable.

Columnas: **Tipo** (código/configuración/documentación/dato fuente/dato procesado/mart/gold/reporte/app frontend/endpoint-API/script/test/plantilla/desconocido), **Categoría** (miner/normalizer/resolver/mart builder/gold builder/duckdb warehouse/app UI/app API/dashboard/auditoría/curación/sincronización/cloud demo/documentación/configuración/dato generado/legacy-sospechoso), **Fuente/Generado** (SOURCE/GENERATED/CONFIG/DOC/TEMPLATE/REPORT/UNKNOWN), **¿Versionar?** (YES/NO/MAYBE), **Riesgo** (ALTO/MEDIO/BAJO/DESCONOCIDO).

---

## Raíz

| Ruta | Tipo | Categoría | Responsabilidad | Fuente/Generado | ¿Versionar? | Riesgo | Notas |
|---|---|---|---|---|---|---|---|
| `package.json` | configuración | configuración | Scripts globales del pipeline (26) + 3 dependencias (`@duckdb/node-api`, `csv-parse`, `dotenv`) | SOURCE | YES | ALTO (cambiarlo mal rompe todo el pipeline) | Único archivo a tocar para agregar scripts nuevos |
| `package-lock.json` | configuración | configuración | Lockfile de dependencias de la raíz | GENERATED (por `npm install`) | YES | MEDIO | No editar a mano |
| `.gitignore` | configuración | configuración | Excluye `.env`, `data/raw/`, `data/warehouse/`, `node_modules/`, `.next/` | SOURCE | YES | BAJO | Ver gap: falta `*.tsbuildinfo` (Parte 5 de cleanup candidates) |
| `.env` | configuración | configuración | Credenciales reales de Zendesk/FieldBeat/Dolibarr | SOURCE (secreto) | **NO** | ALTO (secretos) | Nunca versionar, nunca citar su contenido |
| `.env.example` | plantilla | configuración | Plantilla de variables de entorno (sin valores) | TEMPLATE | YES | BAJO | Seguro de versionar - no tiene secretos |
| `CLAUDE.md` | documentación | documentación | Instrucciones de proyecto para agentes IA - rol, stack, reglas de seguridad, filosofía de trabajo | DOC | YES | MEDIO (guía el comportamiento de cualquier IA que trabaje acá) | Documento vivo, se actualiza con "Pendientes conocidos" |
| `README.md` | documentación | documentación | Prácticamente vacío (`# Nexus`) | DOC | YES | BAJO | Ver `PROJECT_CLEANUP_CANDIDATES.md` |
| `PROJECT_INDEX.md` | documentación | documentación | Índice ejecutivo de esta auditoría - punto de entrada principal | DOC | YES | BAJO | Generado en esta auditoría (2026-07-04) |
| `nodenpm` | desconocido | legacy/sospechoso | Archivo de 0 bytes, sin referencias | UNKNOWN | MAYBE | BAJO | Ver `PROJECT_CLEANUP_CANDIDATES.md` |

## `src/` - pipeline

| Ruta | Tipo | Categoría | Responsabilidad | Fuente/Generado | ¿Versionar? | Riesgo | Notas |
|---|---|---|---|---|---|---|---|
| `src/run-all.js` | script | sincronización | Corre los 3 miners en secuencia (Dolibarr→Zendesk→FieldBeat vía `fieldbeat-all.js`) | SOURCE | YES | ALTO (dispara 3 llamadas API reales) | Script `get:all` |
| `src/request.http` | desconocido | legacy/sospechoso | Contiene JS casi idéntico a `run-all.js` pero con el miner viejo - no es un archivo de HTTP requests pese al nombre | SOURCE (obsoleto) | MAYBE | BAJO (no se ejecuta) | Ver `PROJECT_CLEANUP_CANDIDATES.md` |
| `src/miners/zendesk.js` | código | miner | Extrae tickets Zendesk (paginado, `/api/v2/search.json`) | SOURCE | YES | ALTO (API real) | Script `get:zendesk` |
| `src/miners/fieldbeat.js` | código | miner | **DEPRECADO (2026-07-04)** - miner puntual por `FIELDBEAT_TASK_IDS`; tenía un bug (variable `taskId` no declarada, no iteraba) y ahora lanza un error explícito de deprecación en vez de intentar la llamada HTTP | SOURCE | YES | BAJO (ya no puede fallar de forma confusa) | Script `get:fieldbeat`; usar `get:fieldbeat:all` en su lugar - ver cleanup candidates |
| `src/miners/fieldbeat-all.js` | código | miner | Extrae todas las tasks FieldBeat por cursor `next_page` | SOURCE | YES | ALTO (API real) | Script `get:fieldbeat:all` - el miner FieldBeat real del flujo completo |
| `src/miners/dolibarr.js` | código | miner | Extrae catálogo de productos Dolibarr (paginado) | SOURCE | YES | ALTO (API real) | Script `get:dolibarr` |
| `src/miners/zendesk-backfill-missing-ticket-ids.js` | código | miner | Backfill puntual: busca en Zendesk los ticket_id que FieldBeat menciona pero no se minaron | SOURCE | YES | ALTO (API real, 1 request/ticket) | Script `get:zendesk:backfill-fieldbeat` - ya ejecutado, no repetir |
| `src/miners/.prettierrc` | configuración | configuración | Config de Prettier, ubicada solo en esta subcarpeta | SOURCE | YES | BAJO | Ubicación inusual - normalmente vive en la raíz |
| `src/normalizers/fieldbeat-normalizer.js` | código | normalizer | RAW FieldBeat → 7 CSV normalizados (tasks, equipos, campos de reporte, repuestos con explosión de listas, clientes, equipos dim, puente) | SOURCE | YES | ALTO (define el schema de PROCESSED) | Reimplementa `csvEscape`/`writeCsv` en vez de usar `lib/csv.js` |
| `src/normalizers/zendesk-normalizer.js` | código | normalizer | RAW Zendesk → 3 CSV normalizados (tickets, tags, custom fields) | SOURCE | YES | ALTO | Usa `lib/csv.js` |
| `src/normalizers/dolibarr-normalizer.js` | código | normalizer | RAW Dolibarr → productos + mapa de identidad (REF/BARCODE/ID) | SOURCE | YES | ALTO | Usa `lib/csv.js` + `resolvers/part-identity-resolver.js` (solo `normalizeIdentifier`) |
| `src/resolvers/part-identity-resolver.js` | código | resolver | Cascada de resolución de identidad de repuestos (alias manual → placeholder → REF/BARCODE/ID exacto → normalizado → REF_LIKE → NO_MATCH) | SOURCE | YES | ALTO (lógica de negocio central) | Consumido por `build-used-parts-dolibarr-match.js` y el normalizer Dolibarr |
| `src/marts/build-ticket-fieldbeat-view.js` | código | mart builder | Cruza tickets Zendesk con reportes FieldBeat (sin Dolibarr) | SOURCE | YES | MEDIO | Línea ticket-céntrica |
| `src/marts/build-ticket-fieldbeat-dolibarr-view.js` | código | mart builder | Agrega métricas de repuestos + `data_quality_status` al mart ticket-céntrico | SOURCE | YES | MEDIO | Mart ticket-céntrico principal |
| `src/marts/build-used-parts-dolibarr-match.js` | código | mart builder | Corre el resolver sobre cada repuesto usado (global) | SOURCE | YES | ALTO | Lee `data/config/part_identity_aliases.csv` |
| `src/marts/build-fieldbeat-report-dolibarr-view.js` | código | mart builder | Vista report-céntrica/FieldBeat-first (1 fila por task, universo completo) | SOURCE | YES | MEDIO | Complementario al mart ticket-céntrico |
| `src/marts/build-fieldbeat-working-hours-analysis.js` | código | mart builder | Clasifica cada task en business/after-hours/weekend/holiday + confiabilidad | SOURCE | YES | MEDIO | Depende de `lib/business-hours.js` + `lib/calculation-confidence.js` |
| `src/gold/build-gold.js` | código | gold builder | 6 tablas GOLD ticket-céntricas | SOURCE | YES | MEDIO | Script `build:gold` |
| `src/gold/build-fieldbeat-gold.js` | código | gold builder | 5 tablas GOLD report-céntricas | SOURCE | YES | MEDIO | Script `build:gold:fieldbeat` |
| `src/gold/build-after-hours-gold.js` | código | gold builder | 5 tablas GOLD de Trabajo Fuera de Horario | SOURCE | YES | MEDIO | Script `build:gold:after-hours` |
| `src/db/warehouse-config.js` | código | duckdb warehouse | Lista maestra de las 33 tablas a cargar (schema/tabla/CSV origen) | SOURCE | YES | ALTO (único punto de wiring del warehouse) | Editar acá para registrar tablas nuevas |
| `src/db/init-duckdb.js` | código | duckdb warehouse | Crea el directorio + 4 schemas (idempotente) | SOURCE | YES | BAJO | Script `db:init` |
| `src/db/load-duckdb.js` | código | duckdb warehouse | `CREATE OR REPLACE TABLE` para cada entrada de `warehouse-config.js` | SOURCE | YES | ALTO (reemplaza el warehouse completo) | Script `db:load` |
| `src/db/validate-duckdb.js` | código | duckdb warehouse | Compara conteo CSV vs SQL por tabla, falla si no calza | SOURCE | YES | BAJO (solo lee, pero puede abortar el build) | Script `db:validate` |
| `src/qa/audit-fieldbeat.js` | código | auditoría | Duplicados/cobertura de `DB_FieldBeat_*` | SOURCE | YES | BAJO | Script `qa:fieldbeat` |
| `src/qa/audit-zendesk.js` | código | auditoría | Duplicados/integridad referencial de `DB_Zendesk_*` | SOURCE | YES | BAJO | Script `qa:zendesk` |
| `src/qa/audit-dolibarr.js` | código | auditoría | Duplicados/cobertura de `DB_Dolibarr_*` | SOURCE | YES | BAJO | Script `qa:dolibarr` |
| `src/qa/audit-ticket-fieldbeat-multiplicity.js` | código | auditoría | Distribución de reportes FieldBeat por ticket Zendesk | SOURCE | YES | BAJO | Script `qa:ticket-fieldbeat` |
| `src/qa/reconcile-ticket-fieldbeat-dolibarr-scope.js` | código | auditoría | Cuánto de FieldBeat quedó dentro/fuera del mart ticket-céntrico | SOURCE | YES | BAJO | Script `qa:scope-reconciliation` |
| `src/qa/final-phase1-audit.js` | código | auditoría | Verifica docs/tablas/sql esperados + estado del warehouse | SOURCE | YES | BAJO | Script `qa:phase1` |
| `src/qa/audit-project-structure.js` | script | auditoría | **Nuevo (esta auditoría)** - escanea toda la estructura y genera el inventario | SOURCE | YES | BAJO (solo lee) | Script `audit:structure` |
| `src/curation/validate-curation-files.js` | código | curación | Valida schema de los CSV de `data/curation/` | SOURCE | YES | BAJO | Script `curation:validate` |
| `src/lib/csv.js` | código | configuración (helper) | Leer/escribir CSV (usado por casi todo el pipeline) | SOURCE | YES | ALTO (helper central) | - |
| `src/lib/http.js` | código | configuración (helper) | `fetch` con manejo de errores + basic auth | SOURCE | YES | MEDIO | Usado por miners |
| `src/lib/save-json.js` | código | configuración (helper) | Guardar RAW JSON + timestamp para nombre de archivo | SOURCE | YES | MEDIO | Usado por miners |
| `src/lib/business-hours.js` | código | configuración (helper) | Conversión UTC↔hora Chile + partición business/after-hours/weekend/holiday | SOURCE | YES | ALTO (lógica de negocio de after-hours) | Usado por el mart de working hours |
| `src/lib/calculation-confidence.js` | código | configuración (helper) | Modelo de confiabilidad (6 factores, 4 tiers, agregación) | SOURCE | YES | ALTO (lógica de negocio de after-hours) | Usado por el mart de working hours |

## `apps/nexus-bi-app/` - app web (ver detalle completo en `APP_STRUCTURE_MAP.md`)

| Ruta / grupo | Tipo | Categoría | Responsabilidad | Fuente/Generado | ¿Versionar? | Riesgo | Notas |
|---|---|---|---|---|---|---|---|
| `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `next-env.d.ts` | configuración | configuración | Configuración del proyecto Next.js independiente | SOURCE/GENERATED | YES | MEDIO/ALTO (`next.config.ts` aísla deliberadamente el workspace) | Lockfile propio - no es un monorepo |
| `README.md` (de la app) | documentación | documentación | Cómo correr la app, pantallas implementadas, notas técnicas | DOC | YES | BAJO | Más completo que el README de la raíz |
| `app/layout.tsx`, `app/globals.css` | app frontend | app UI | Layout raíz mínimo + tokens de diseño `--eyg-*` | SOURCE | YES | MEDIO | Cada página monta su propio `AppShell` |
| `app/page.tsx` | app frontend | app UI | Landing con grilla de pantallas | SOURCE | YES | BAJO | - |
| `app/dashboard/{fieldbeat,operacional,after-hours}/page.tsx` | app frontend | dashboard | 3 vistas de dashboard, cada una independiente | SOURCE | YES | BAJO | Ver `APP_STRUCTURE_MAP.md` |
| `app/audit/manual-review/page.tsx` | app frontend | auditoría | Vista de Auditoría/Validación Manual (6 pestañas) | SOURCE | YES | BAJO | Solo lectura, acciones deshabilitadas |
| `app/explorer/page.tsx`, `app/search/page.tsx` | app frontend | app UI | Explorador de tablas + Búsqueda por palabras clave | SOURCE | YES | BAJO | - |
| `app/api/dashboard/**/route.ts` (12 archivos) | endpoint/API | app API / dashboard | Endpoints de los 3 dashboards | SOURCE | YES | BAJO/MEDIO (`[schema]/[table]` es el único con SQL dinámico validado) | Todos `READ_ONLY` |
| `app/api/audit/**/route.ts` (6 archivos) | endpoint/API | app API / auditoría | Endpoints de las 6 pestañas de Auditoría | SOURCE | YES | BAJO | - |
| `app/api/{search,tables}/**/route.ts` (3 archivos) | endpoint/API | app API | Búsqueda + Explorador de tablas | SOURCE | YES | BAJO/MEDIO | `[schema]/[table]` valida identificadores contra `information_schema` |
| `components/ui/*.tsx` (13 archivos + 1 `.module.css`) | app frontend | app UI | Sistema de diseño genérico | SOURCE | YES | MEDIO | `EmptyState.tsx`/`FilterPanel.tsx` sin uso actual - ver cleanup candidates |
| `components/dashboard/*.tsx` (10 archivos + 1 `.module.css`) | app frontend | dashboard | Componentes específicos del look "Proyecto 7" | SOURCE | YES | BAJO | - |
| `components/audit/*.tsx` (8 archivos) | app frontend | auditoría | Componentes específicos de Auditoría | SOURCE | YES | BAJO | `FutureActionButton.tsx` siempre deshabilitado |
| `components/after-hours/*.tsx` (6 archivos) | app frontend | dashboard | Componentes específicos de Trabajo Fuera de Horario | SOURCE | YES | BAJO | - |
| `components/{DataTable,ErrorBanner,PaginationControls,QueryDisclosure,HorizontalBarChart}.tsx` | app frontend | app UI | Componentes compartidos sueltos | SOURCE | YES | BAJO | - |
| `lib/*.ts` (16 archivos) | código | app API (helper) | Conexión DuckDB, manejo de errores, guardrails SQL, filtros/formato por dominio | SOURCE | YES | ALTO (`duckdb.ts`/`sql-guardrails.ts` son el único punto de acceso a datos) | `confidence.ts` es mirror de `src/lib/calculation-confidence.js` - mantener sincronizado a mano |
| `types/{audit,after-hours}.ts` | código | app API (tipos) | Formas de request/response de los endpoints de Auditoría y After-Hours | SOURCE | YES | BAJO | - |

## `data/` - datos locales

| Ruta / grupo | Tipo | Categoría | Responsabilidad | Fuente/Generado | ¿Versionar? | Riesgo | Notas |
|---|---|---|---|---|---|---|---|
| `data/raw/**` | dato fuente | dato generado | JSON crudo de las 3 APIs | GENERATED (por miners) | **NO** | ALTO (inmutable) | Excluido del escaneo profundo por instrucción explícita |
| `data/processed/{dolibarr,fieldbeat,zendesk}/*.csv` (12 archivos) | dato procesado | dato generado | Tablas normalizadas, una por entidad | GENERATED (por normalizers) | YES | ALTO (no editar a mano) | Regenerable desde RAW |
| `data/marts/*.csv` (6 archivos) | mart | dato generado | Vistas intermedias de negocio (3 líneas) | GENERATED (por mart builders) | YES | MEDIO (no editar a mano) | Regenerable desde PROCESSED+config |
| `data/gold/*.csv` (16 archivos) | gold | dato generado | Datasets finales para BI (3 líneas) | GENERATED (por gold builders) | YES | MEDIO (no editar a mano) | Regenerable desde MARTS |
| `data/warehouse/eyg_nexus.duckdb`(+`.wal`) | dato procesado | duckdb warehouse | Warehouse consultable (33 tablas) | GENERATED (por `db:build`) | **NO** | ALTO (no abrir en lectura-escritura desde otra herramienta mientras el pipeline corre) | Excluido del escaneo profundo |
| `data/config/business-hours.json` | configuración | configuración | Horario hábil (Lun-Vie 08:30-18:30, `DEFAULT_UNVALIDATED`) | CONFIG | YES | ALTO (afecta todos los cálculos de after-hours) | Editar a mano para reflejar política real |
| `data/config/holidays.example.json` | plantilla | configuración | Feriados chilenos de fecha fija 2018-2026, `EXAMPLE_INCOMPLETE` | TEMPLATE | YES | MEDIO | Copiar a `holidays.json` (sin `.example`) para calendario validado |
| `data/config/part_identity_aliases.example.csv` | plantilla | configuración | Plantilla de alias de repuestos (schema simple, 5 columnas) - la que de verdad lee el pipeline si se copia a `.csv` | TEMPLATE | YES | ALTO (afecta matching de repuestos) | Ver duplicado deliberado con `data/curation/` en cleanup candidates |
| `data/curation/*.example.csv` (6 archivos) | plantilla | curación | Plantillas del modelo de curación futuro (client/equipment/part aliases, ticket link overrides, report field corrections, placeholder rules, audit log) | TEMPLATE | YES | BAJO (no conectadas al pipeline todavía) | Validadas por `curation:validate`, no consumidas por ningún builder |
| `data/reports/*.json` (~15 archivos) | reporte | dato generado | Resúmenes de build/QA/validación | GENERATED | YES | BAJO | No editar a mano - se sobreescriben en cada corrida |
| `data/reports/*.csv` (~8 archivos) | reporte | dato generado | Colas de detalle (repuestos sin match, tickets fantasma, etc.) | GENERATED | YES | BAJO | No editar a mano |

## `docs/`

| Ruta | Tipo | Categoría | Responsabilidad | Fuente/Generado | ¿Versionar? | Riesgo | Notas |
|---|---|---|---|---|---|---|---|
| `ARCHITECTURE.md` | documentación | documentación | Filosofía local/serverless-first, las 4 capas, roles de las 3 plataformas | DOC | YES | BAJO | Vivo, foundational |
| `DATA_DICTIONARY.md` | documentación | documentación | Columna por columna de las 33 tablas del warehouse (v1.4) | DOC | YES | MEDIO (desactualizarse rompe confianza en los datos) | Vivo, debe actualizarse con cada tabla nueva |
| `DATA_PIPELINE.md` | documentación | documentación | Orden de ejecución del flujo ticket-céntrico original (1-6) + nota apuntando a las líneas report-céntrica/after-hours | DOC | YES | BAJO | Parcialmente desactualizado (no detalla las líneas nuevas en el diagrama) |
| `GOLD_DATA_CONTRACT.md` | documentación | documentación | Objetivo/granularidad/columnas/uso BI de cada tabla GOLD | DOC | YES | BAJO | Cubre ticket-céntrica + after-hours; falta la línea report-céntrica (gap preexistente) |
| `SQL_WAREHOUSE.md` | documentación | documentación | Cómo conectarse + qué tablas hay + queries de ejemplo (v1.4) | DOC | YES | BAJO | Vivo |
| `APP_UI_SPEC.md` | documentación | documentación | Especificación de las 12 pantallas de la app | DOC | YES | BAJO | Especificación, no siempre 1:1 con la implementación real |
| `PRODUCT_APP_ARCHITECTURE.md` | documentación | documentación | Stack técnico de la app, flujos, plan de migración a Cloudflare | DOC | YES | BAJO | Vivo |
| `DASHBOARD_VISUAL_STYLE.md` | documentación | documentación | Diseño visual actual del Dashboard Operacional | DOC | YES | BAJO | Vivo - fuente de verdad del look actual |
| `MANUAL_REVIEW_VIEW.md` | documentación | documentación | Spec de `/audit/manual-review` | DOC | YES | BAJO | Vivo pero no enlazado desde otros docs (huérfano de navegación, no de contenido) |
| `CURATION_MODEL.md` | documentación | documentación | Diseño del modelo de curación (7 tablas, principio RAW-inmutable) | DOC | YES | BAJO | Vivo, feature aún no implementada |
| `LOCAL_OPERATIONS_RUNBOOK.md` | documentación | documentación | Cómo correr el pipeline completo, en orden, qué revisar después | DOC | YES | MEDIO (es la guía operativa real) | Vivo, actualizado con las líneas report-céntrica y after-hours |
| `QUERY_GUIDE.md` | documentación | documentación | Preguntas de negocio → queries SQL concretas | DOC | YES | BAJO | Vivo, ligado a `sql/` |
| `AFTER_HOURS_METRICS.md` | documentación | documentación | Metodología de Trabajo Fuera de Horario | DOC | YES | BAJO | Nuevo, vivo |
| `CALCULATION_CONFIDENCE_MODEL.md` | documentación | documentación | Modelo de confiabilidad (qué es/no es, factores, pesos) | DOC | YES | BAJO | Nuevo, vivo |
| `BI_READINESS.md` | documentación | documentación | Qué tablas GOLD usar para BI | DOC | YES | BAJO | **Desactualizado** - afirma que no hay dashboard todavía |
| `VISUAL_REDESIGN_EYG.md` | documentación | documentación | Changelog del sprint de rediseño visual | DOC | YES | BAJO | Snapshot de sprint, no doc vivo |
| `PHASE_1_CLOSEOUT.md`, `SCOPE_AND_LIMITATIONS.md`, `KNOWN_LIMITATIONS_PHASE_1.md`, `PHASE_2_BACKLOG.md`, `PHASE_2_HANDOFF.md` | documentación | documentación | Snapshots de cierre de Fase 1 / planeación Fase 2 | DOC | YES | BAJO | Congelados a la fecha del build citado |
| `"Documentación Proyecto 4.md"`, `P4.gs.txt`, `P5.txt` | documentación / código legacy | legacy/sospechoso | Spec + código fuente del sistema predecesor (Apps Script) | DOC/SOURCE (histórico) | YES | BAJO | Quedan en `docs/` raíz a propósito (referenciados por nombre desde `CURATION_MODEL.md`/`PHASE_2_HANDOFF.md`) - ver cleanup candidates |
| `legacy/desglose_tecnologico_eyg.html`, `legacy/relevamiento_maestro_nexus_cerberus.html`, `legacy/levantamiento_maestro.pdf`, `legacy/"Proyecto 6_..." .xlsx`, `legacy/` 3 CSV "Proyecto 7...", `legacy/"Proyecto_7_..." .pdf`, `legacy/"Proyecto%204%20...".json` | documentación | legacy/sospechoso | Material de relevamiento/diseño histórico de proyectos anteriores | DOC (histórico) | YES | BAJO | **Movidos a `docs/legacy/` el 2026-07-04** (vía `git mv`, sin referencias cruzadas antes ni después del movimiento); el `.json` conserva su nombre URL-encoded anómalo sin renombrar |

## `sql/`

| Ruta | Tipo | Categoría | Responsabilidad | Fuente/Generado | ¿Versionar? | Riesgo | Notas |
|---|---|---|---|---|---|---|---|
| `00_schema_overview.sql` … `11_after_hours_overview.sql` (12 archivos) | script | documentación | Queries reutilizables de ejemplo por tema, para copiar/pegar en un cliente DuckDB | SOURCE | YES | BAJO | No los ejecuta ningún script de Node |
| `README.md` | documentación | documentación | Índice de los 12 archivos SQL + cómo correrlos | DOC | YES | BAJO | - |
