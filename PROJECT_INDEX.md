# Índice del proyecto - EYG Nexus Local / Nexus BI App

Punto de entrada principal para orientarse en este proyecto. Generado como parte de la auditoría de estructura del **2026-07-04**, con una pasada de estabilización el mismo día (secretos revisados, un bug deprecado, `.gitignore` completado, legacy ordenado). Puede regenerarse/verificarse corriendo `npm run audit:structure`.

## 1. Qué es este proyecto

Un pipeline ETL local (Node.js, costo cero, sin servidores físicos) que integra datos de **Zendesk**, **FieldBeat** y **Dolibarr** en un warehouse **DuckDB** consultable, más una app web local de solo lectura (**Nexus BI**, `apps/nexus-bi-app`, Next.js) para usuarios no técnicos. Ver `CLAUDE.md` para el rol y las reglas de seguridad completas.

## 2. Estado actual de alto nivel

- **Pipeline:** 4 líneas de análisis completas y funcionando - ticket-céntrica, report-céntrica/FieldBeat-first, Trabajo Fuera de Horario, y Vida Útil de Repuestos por Máquina (nueva, con motor de modelos estadísticos AUTO - ver `docs/LIFECYCLE_PREDICTIVE_MODELS.md`).
- **Warehouse:** 40 tablas DuckDB cargadas + 6 opcionales en el schema `rules` (Business Rules Layer, sin CSV real todavía), reconstruible con `npm run db:build` (`data/reports/duckdb_validation_summary.json` → `all_match: true`).
- **Business Rules Layer:** `business-rules/` centraliza políticas de cálculo y entidades contractuales (contratos, vida útil de fabricante) - ver `docs/BUSINESS_RULES_LAYER.md`. Validar con `npm run business-rules:validate`. No reemplaza `data/config/` todavía (migración incremental documentada).
- **Cierre de Fase 1:** `npm run qa:phase1` → `READY`.
- **App:** 8 pantallas implementadas (Dashboard FieldBeat, Dashboard Operacional, Trabajo Fuera de Horario, Vida Útil de Repuestos, Explorador, Búsqueda, Auditoría/Validación Manual, Landing) - todas de solo lectura.
- **No implementado todavía:** Centro de Correcciones (curación real conectada al pipeline), Administración del Pipeline (UI para rebuild), autenticación, deploy cloud, sincronización automática (`sync:*` no existe como script), contratos de `business-rules/entities/*` conectados a exposición operativa real (hoy solo el prior de vida útil de fabricante está conectado).
- **Esta auditoría (2026-07-04):** primer registro maestro completo de archivos/carpetas/scripts - ver `docs/PROJECT_FILE_INVENTORY.md` y `data/reports/project_structure_audit_summary.json`.
- **Pasada de estabilización (mismo día):** los 4 `possible_secret_hits` se confirmaron como falsos positivos (ninguno era un secreto real); `src/miners/fieldbeat.js` (roto) quedó deprecado explícitamente; `.gitignore` ahora ignora `*.tsbuildinfo`; 9 archivos legacy sin referencias se movieron a `docs/legacy/`. Detalle completo en `docs/PROJECT_CLEANUP_CANDIDATES.md`.

## 3. Cómo está organizado

```
/                       raíz - package.json, CLAUDE.md, este índice
src/                    pipeline local (miners → normalizers → resolvers → marts → gold → db → qa)
apps/nexus-bi-app/      app web local (Next.js), solo lectura sobre DuckDB
data/                   raw (inmutable) → processed → marts → gold → warehouse (.duckdb) + config/curation/reports
docs/                   documentación técnica y de producto (docs/legacy/ = material histórico de proyectos previos)
sql/                    queries SQL reutilizables (no forman parte del pipeline de build)
```

Detalle completo:
- Carpeta por carpeta → [`docs/PROJECT_STRUCTURE_MAP.md`](docs/PROJECT_STRUCTURE_MAP.md)
- Archivo por archivo → [`docs/PROJECT_FILE_INVENTORY.md`](docs/PROJECT_FILE_INVENTORY.md) (curado) / `data/reports/project_file_inventory.json`+`.csv` (completo, machine-readable)
- Flujo de datos → [`docs/DATA_PIPELINE_MAP.md`](docs/DATA_PIPELINE_MAP.md)
- Estructura de la app → [`docs/APP_STRUCTURE_MAP.md`](docs/APP_STRUCTURE_MAP.md)
- Todos los scripts → [`docs/SCRIPTS_REGISTRY.md`](docs/SCRIPTS_REGISTRY.md)
- Candidatos de limpieza (sin borrar nada) → [`docs/PROJECT_CLEANUP_CANDIDATES.md`](docs/PROJECT_CLEANUP_CANDIDATES.md)

## 4. Comandos principales

```bash
npm install                          # dependencias de la raíz
npm run get:all                      # minar las 3 plataformas (RAW) - llama APIs reales
npm run normalize:fieldbeat|zendesk|dolibarr   # RAW -> PROCESSED
npm run build:used-parts-dolibarr-match        # resolución de identidad de repuestos
npm run build:gold                             # línea ticket-céntrica completa (mart+gold)
npm run build:fieldbeat-report-dolibarr-view && npm run build:gold:fieldbeat   # línea report-céntrica
npm run build:fieldbeat-working-hours && npm run build:gold:after-hours       # línea Trabajo Fuera de Horario
npm run build:equipment-part-lifecycle-events && npm run build:equipment-part-lifecycle-intervals && npm run build:gold:equipment-lifecycle   # línea Vida Útil de Repuestos
npm run business-rules:validate      # valida business-rules/ (entidades/políticas)
npm run db:build                     # reconstruye y valida el warehouse DuckDB (40 tablas + 6 opcionales en `rules`)
npm run qa:phase1                    # auditoría final de cierre de Fase 1
npm run audit:structure              # esta auditoría de estructura (nuevo)
npm run app:dev                      # levanta la app web local
```

Orden completo y qué revisar después de cada paso → [`docs/LOCAL_OPERATIONS_RUNBOOK.md`](docs/LOCAL_OPERATIONS_RUNBOOK.md).

## 5. Dónde mirar según lo que quiero hacer

| Quiero... | Ver |
|---|---|
| Actualizar datos / entender qué scripts corren en qué orden | [`docs/LOCAL_OPERATIONS_RUNBOOK.md`](docs/LOCAL_OPERATIONS_RUNBOOK.md) y [`docs/SCRIPTS_REGISTRY.md`](docs/SCRIPTS_REGISTRY.md) — **nota:** no existe `sync:full`/`sync:rebuild`/`sync:status` como script hoy; el equivalente real es `npm run db:build` |
| Ver estructura de tablas del warehouse | [`docs/DATA_DICTIONARY.md`](docs/DATA_DICTIONARY.md) |
| Cambiar o entender un dashboard | `apps/nexus-bi-app/` + [`docs/APP_UI_SPEC.md`](docs/APP_UI_SPEC.md) + [`docs/APP_STRUCTURE_MAP.md`](docs/APP_STRUCTURE_MAP.md) |
| Corregir repuestos/clientes/máquinas mal identificados | [`docs/CURATION_MODEL.md`](docs/CURATION_MODEL.md) - **nota:** el modelo está diseñado y validado (`data/curation/*.example.csv`, `npm run curation:validate`) pero **no conectado** a ningún flujo de escritura real todavía |
| Entender el pipeline completo (RAW→PROCESSED→MARTS→GOLD→DuckDB) | [`docs/DATA_PIPELINE_MAP.md`](docs/DATA_PIPELINE_MAP.md) y [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) |
| Desplegar una demo cloud | **No existe todavía** - no hay `src/cloud/`, ni `CLOUD_SMOKE_TEST.md`, ni script `deploy`. Lo más cercano es la sección de migración a Cloudflare en [`docs/PRODUCT_APP_ARCHITECTURE.md`](docs/PRODUCT_APP_ARCHITECTURE.md) (documentado, no implementado) |
| Saber qué archivo hace qué | [`docs/PROJECT_FILE_INVENTORY.md`](docs/PROJECT_FILE_INVENTORY.md) (o el JSON/CSV completo en `data/reports/`) |
| Entender el modelo de confiabilidad de Trabajo Fuera de Horario | [`docs/AFTER_HOURS_METRICS.md`](docs/AFTER_HOURS_METRICS.md) y [`docs/CALCULATION_CONFIDENCE_MODEL.md`](docs/CALCULATION_CONFIDENCE_MODEL.md) |
| Ver qué archivos son huérfanos, duplicados o legacy | [`docs/PROJECT_CLEANUP_CANDIDATES.md`](docs/PROJECT_CLEANUP_CANDIDATES.md) |
| Auditar la calidad de los datos normalizados | `npm run qa:fieldbeat`/`qa:zendesk`/`qa:dolibarr`, [`docs/KNOWN_LIMITATIONS_PHASE_1.md`](docs/KNOWN_LIMITATIONS_PHASE_1.md) |
| Entender qué le falta a Fase 2 | [`docs/PHASE_2_BACKLOG.md`](docs/PHASE_2_BACKLOG.md) y [`docs/PHASE_2_HANDOFF.md`](docs/PHASE_2_HANDOFF.md) |

## 6. Advertencias críticas

- **Nunca tocar `.env`** ni citar/exponer su contenido - las credenciales reales de las 3 APIs viven ahí.
- **Nunca versionar `data/raw/`** - es inmutable y ya está en `.gitignore`.
- **Nunca editar a mano `data/processed/`, `data/marts/`, ni `data/gold/`** - son 100% reconstruibles desde la capa anterior; cualquier edición manual se pierde (o queda inconsistente) en el próximo build.
- **Nunca subir el `.duckdb` completo a un repo cloud** - es un binario reconstruible (`npm run db:build`), no un artefacto para versionar ni distribuir tal cual.
- **No existe `sync:full`** - no ejecutarlo porque no está definido; si algo lo referencia, es aspiracional/desactualizado. El pipeline se corre paso a paso o vía `npm run db:build` para la última etapa.
- **No llamar APIs externas sin intención explícita** - `get:zendesk`, `get:fieldbeat*`, `get:dolibarr`, `get:all` y el backfill consumen cuota real de las 3 plataformas.
- Dos componentes de UI (`EmptyState.tsx`, `FilterPanel.tsx`) y dos archivos sueltos (`nodenpm`, `src/request.http`) siguen marcados como huérfanos/sospechosos - no se tocaron (son código, no documentos; "no mover código sin confirmar"), solo se re-confirmaron (ver `docs/PROJECT_CLEANUP_CANDIDATES.md`).
- **`get:fieldbeat` (`src/miners/fieldbeat.js`) está DEPRECADO** - tenía un bug real (variable no declarada, `ReferenceError` si se corría). Se corrigió para lanzar un error explícito de deprecación en vez de intentar la llamada HTTP - **usar `get:fieldbeat:all` en su lugar**. `get:fieldbeat:all` no se tocó.
- `docs/legacy/` es nuevo (2026-07-04) - contiene 9 archivos históricos (HTML/PDF/XLSX/CSV/JSON de proyectos previos) movidos desde `docs/` raíz vía `git mv` porque no tenían ninguna referencia cruzada. `P4.gs.txt`, `P5.txt` y `"Documentación Proyecto 4.md"` **no** se movieron (sí están referenciados por nombre desde otros docs).

## 7. Documentos generados por esta auditoría (2026-07-04)

- `PROJECT_INDEX.md` (este archivo)
- `docs/PROJECT_FILE_INVENTORY.md`
- `docs/PROJECT_STRUCTURE_MAP.md`
- `docs/SCRIPTS_REGISTRY.md`
- `docs/DATA_PIPELINE_MAP.md`
- `docs/APP_STRUCTURE_MAP.md`
- `docs/PROJECT_CLEANUP_CANDIDATES.md`
- `src/qa/audit-project-structure.js` (+ script `npm run audit:structure`)
- `data/reports/project_file_inventory.json` / `.csv`
- `data/reports/project_structure_audit_summary.json`

## 8. Qué cambió en la pasada de estabilización (2026-07-04, mismo día)

- Revisados los 4 `possible_secret_hits` de la auditoría inicial → **los 4 son falsos positivos**, no había ningún secreto real hardcodeado (detalle en `docs/PROJECT_CLEANUP_CANDIDATES.md` § 6). No hizo falta tocar `.env`/`.env.example`.
- `src/miners/fieldbeat.js` (script `get:fieldbeat`, roto) → **deprecado explícitamente**, ya no lanza `ReferenceError`, ahora indica claramente usar `get:fieldbeat:all`. `get:fieldbeat:all` no se modificó.
- `.gitignore` → se agregó `*.tsbuildinfo`.
- `docs/legacy/` (carpeta nueva) → 9 archivos históricos sin referencias cruzadas movidos ahí vía `git mv` (reversible). `P4.gs.txt`, `P5.txt`, `"Documentación Proyecto 4.md"` quedaron en `docs/` raíz a propósito (sí tienen referencias cruzadas).
- `nodenpm`, `src/request.http`, `EmptyState.tsx`, `FilterPanel.tsx` → re-revisados, siguen sin tocarse (son código/archivo vacío, no documentos - no se movieron ni se borraron sin confirmación).
