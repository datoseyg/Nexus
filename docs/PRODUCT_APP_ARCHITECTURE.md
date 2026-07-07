# Arquitectura de producto - App BI Operacional (Fase 1)

## Redefinición del salto de Fase 1

El MVP de Fase 1 hasta ahora es una BDD local consultable (DuckDB) más un paquete de queries SQL - pensado para alguien que sabe escribir SQL. **Este documento redefine el siguiente salto: una aplicación web local, sin backend cloud, para usuarios no técnicos**, que envuelve todo lo ya construido (pipeline, warehouse, queries) sin reemplazar nada de eso.

No se implementa la UI en este documento - es la propuesta técnica, el modelo de datos de curación, las plantillas y la especificación de pantallas. La implementación real de código de la app queda para un siguiente paso explícito.

## Principios que no cambian

- **Costo 0.** Nada de esto requiere tarjeta de crédito ni un plan pago. Next.js corre local con `next dev`; DuckDB es un archivo; no hay servicios cloud de pago involucrados.
- **Local-first.** La app corre en la máquina del usuario, contra el mismo `data/warehouse/eyg_nexus.duckdb` que ya existe.
- **Serverless-ready.** El diseño elige deliberadamente piezas que migran limpio a Cloudflare Pages/Workers/D1 más adelante (ver sección de migración), sin necesitar reescribir la lógica de negocio.
- **RAW inmutable, todo lo demás reconstruible.** La app nunca escribe directo a `data/raw/`, `data/processed/`, `data/marts/`, `data/gold/`, ni a la base DuckDB. Toda corrección pasa por `data/curation/` (ver [CURATION_MODEL.md](CURATION_MODEL.md)).
- **Sin movimientos de stock.** Ninguna pantalla de esta app modifica inventario en Dolibarr.

## Stack técnico

### Frontend
- **Next.js (App Router) + React** - Server Components para las pantallas de solo lectura (dashboards, explorador), Client Components donde se necesita interactividad (grilla editable de filtros, formularios de corrección).
- **Tailwind CSS** - estilos, sobre un sistema de diseño con identidad E&G Medical Systems (`app/globals.css` § tokens `--eyg-*`, componentes reutilizables en `components/ui/`: `AppShell`, `PageHeader`, `SectionCard`, `MetricCard`, `FilterPanel`, `StatusBadge`, `EmptyState`, `ResponsiveTableShell`) - ver [VISUAL_REDESIGN_EYG.md](VISUAL_REDESIGN_EYG.md).
- **TanStack Table** (recomendado) para el explorador tipo Excel - es headless, sin costo de licencia, y se integra bien con paginación server-side (necesaria: `processed.fieldbeat_report_fields` tiene 66107 filas, no se cargan todas al cliente). **AG Grid Community** queda como alternativa documentada si más adelante se necesita edición inline tipo Excel más sofisticada (agrupamiento, pivot) - no es necesaria para Fase 1 porque el explorador es de solo lectura.
- **Recharts** (recomendado) para gráficos de dashboard - más liviano que ECharts, suficiente para barras/líneas/torta que pide `BI_READINESS.md`. ECharts queda como alternativa si se necesitan visualizaciones más complejas (heatmaps, series de tiempo densas) en una iteración posterior.

### Backend local
- **Node.js API vía Next.js Route Handlers** (`app/api/**/route.ts`), corriendo en runtime Node (no Edge) porque `@duckdb/node-api` necesita el binding nativo - esto es intencional y se revisita en la migración a Cloudflare (ver esa sección).
- **DuckDB Node** - cada Route Handler abre una conexión de solo lectura (`access_mode: "READ_ONLY"`) al archivo existente, corre la query, cierra la conexión. **Lección aprendida en Fase 1:** DuckDB no permite acceso concurrente si otro proceso (ej. DBeaver) tiene el archivo abierto en lectura-escritura - la app debe manejar ese error explícitamente y mostrar un mensaje claro ("la base está en uso por otra herramienta"), no un 500 genérico.
- **Scripts existentes del pipeline** - la Administración del Pipeline invoca los scripts de `package.json` (`npm run get:..`, `normalize:..`, `build:..`, `db:build`) como child processes (`child_process.spawn`), capturando stdout/stderr para mostrar progreso en vivo. No se reimplementa la lógica de los scripts en la app - se orquestan.
- **Capa de correcciones** (`data/curation/`) - los Route Handlers de corrección leen/escriben estos CSV (nunca los de `data/processed/` etc.), usando `src/lib/csv.js` (mismo helper que ya usa el pipeline) para mantener consistencia de formato.

### IA / búsqueda
- **Lupa sin IA (default, Fase 1):** un clasificador simple de la pregunta del usuario (keywords + detección de nombre de cliente/equipo vía `ILIKE` contra `processed.fieldbeat_clients`/`fieldbeat_equipments`) elige uno de los templates ya construidos en `sql/09_search_technical_events.sql` / `sql/10_machine_history_by_client.sql`, rellena los parámetros, y ejecuta. Cero dependencia de LLM, cero costo, determinístico.
- **IA local opcional con Ollama:** si el usuario tiene Ollama corriendo localmente (`http://localhost:11434`, gratis, sin API key), la app puede usarlo para interpretar preguntas más ambiguas. **Regla de seguridad no negociable:** el modelo local **nunca genera SQL libre para ejecutar directo** - su única salida permitida es (a) elegir uno de los templates predefinidos y sus parámetros, o (b) en un modo más avanzado, generar un `SELECT` que se valida contra un allowlist de tablas/columnas y se ejecuta en una conexión estrictamente `READ_ONLY` antes de correr. Si Ollama no está instalado, la app cae automáticamente al modo sin IA - nunca es un requisito.
- **No se usan APIs pagadas** (OpenAI, Anthropic, etc.) en Fase 1 - esto es una restricción explícita del usuario, no una limitación técnica; queda abierto para Fase 2 si se decide.

## Módulos de la app

1. **Dashboard** - visualización de KPIs (ticket-céntrico y report-céntrico).
2. **Explorador de tablas** - vista tipo Excel de cualquiera de las 27 tablas del warehouse.
3. **Lupa / Chat** - búsqueda en lenguaje natural o por palabras clave.
4. **Auditoría / Validación Manual** (`/audit/manual-review`) - implementado en modo solo lectura: repuestos por revisar, matches ambiguos, placeholders, reportes con revisión requerida, tickets faltantes/restringidos y resumen de calidad. Acciones de corrección preparadas pero deshabilitadas hasta que exista el Centro de correcciones - ver [MANUAL_REVIEW_VIEW.md](MANUAL_REVIEW_VIEW.md).
5. **Centro de correcciones** - crear/revisar reglas de `data/curation/` (no implementado todavía; la Auditoría es su antesala de solo lectura).
6. **Administración del pipeline** - disparar rebuild, ver estado de cada etapa.
7. **Trabajo Fuera de Horario** (`/dashboard/after-hours`) - implementado en modo solo lectura, **vista independiente** del Dashboard - análisis de horas fuera del horario hábil configurado, con score de confiabilidad explícito por KPI. Ver [AFTER_HOURS_METRICS.md](AFTER_HOURS_METRICS.md) y [CALCULATION_CONFIDENCE_MODEL.md](CALCULATION_CONFIDENCE_MODEL.md).

## Flujo: Dashboard

1. Usuario entra a `/dashboard/ejecutivo` o `/dashboard/fieldbeat`.
2. El Server Component llama a un Route Handler (`/api/gold/operational-dashboard`, `/api/gold/fieldbeat-report-analysis`, etc.) que abre DuckDB read-only, corre la query fija sobre la tabla GOLD correspondiente, cierra la conexión.
3. El resultado (1 fila de KPIs + tablas de desglose) se pasa a componentes Recharts + tarjetas.
4. No hay estado mutable - cada carga de página es una lectura fresca del warehouse actual. No hace falta caché en Fase 1 (los datos solo cambian cuando alguien corre un rebuild).

## Flujo: Explorador tipo Excel

1. Usuario elige un schema/tabla de un dropdown (poblado desde `information_schema.tables`, igual que `sql/00_schema_overview.sql`).
2. La UI pide la página 1 (`LIMIT 50 OFFSET 0`) vía `/api/tables/[schema]/[table]?page=1`.
3. TanStack Table renderiza con paginación server-side, orden por columna (traducido a `ORDER BY` en la query), y un filtro de texto simple por columna (traducido a `WHERE columna ILIKE '%...%'`, con la columna validada contra el schema real de la tabla para evitar inyección).
4. Botón "Exportar CSV" descarga la página actual (o, con confirmación explícita, la tabla completa) - reutiliza `writeCsv` de `src/lib/csv.js` o genera el CSV en el Route Handler.
5. **Es de solo lectura.** No hay edición de celdas - cualquier corrección redirige al Centro de Correcciones.

## Flujo: Lupa / Chat

1. Usuario escribe una pregunta en un campo de texto único.
2. Clasificador determina la intención:
   - Menciona un cliente + palabra técnica (tubo, colimador, etc.) → template de `sql/09_search_technical_events.sql`.
   - Menciona un cliente sin palabra técnica → template de `sql/10_machine_history_by_client.sql`.
   - Menciona "no matcheados"/"sin match" → template de `sql/07_unmatched_and_ambiguous_parts.sql`.
   - Si Ollama está disponible y el clasificador simple no encuentra un template razonable, se le pasa la pregunta + el mapa de templates disponibles, pidiéndole que elija uno y extraiga los parámetros.
3. Se ejecuta la query resultante (siempre de solo lectura) y se muestran los resultados en una tabla simple, con la opción de "ver la query SQL que se corrió" (transparencia - nunca una caja negra).
4. Si ningún template calza, se ofrece redirigir al Explorador de Tablas con una tabla sugerida.

## Flujo: Auditoría / Validación Manual

1. Usuario entra a `/audit/manual-review` y elige una de 6 pestañas.
2. Cada pestaña llama a su propio Route Handler (`/api/audit/{parts-review,ambiguous-parts,placeholders,reports-review,ticket-links-review,summary}`), que abre DuckDB read-only, aplica filtros (cliente/máquina/fecha/match_status o report_quality_status/búsqueda textual) y devuelve filas paginadas - nunca escribe.
3. Cada fila trae una "acción sugerida" calculada en el Route Handler (ver `lib/audit-sql.ts::suggestAction`) y un botón de acción **deshabilitado** (`FutureActionButton`, tooltip "Disponible cuando se active Centro de Correcciones").
4. El NavBar muestra el conteo de `reportsReviewRequired` (`/api/audit/summary`) junto al link "Auditoría" para que el pendiente sea visible sin entrar a la pantalla.
5. Cuando se implemente el Centro de correcciones (flujo siguiente), estos mismos botones se conectan a los formularios de corrección - ver [MANUAL_REVIEW_VIEW.md](MANUAL_REVIEW_VIEW.md) § Acciones futuras.

## Flujo: Centro de correcciones

1. Usuario elige un tipo de corrección (repuestos, clientes, máquinas, ticket links).
2. La pantalla muestra una cola priorizada (reutilizando las queries de `sql/07_unmatched_and_ambiguous_parts.sql` y equivalentes) - ej. repuestos sin match ordenados por `occurrences`.
3. Usuario completa el formulario de corrección (valor canónico + `reason`; `created_by` se completa con el usuario de sesión o un campo de texto en Fase 1 sin autenticación).
4. Antes de habilitar "Guardar", la UI corre una query de preview de impacto (`SELECT COUNT(*) FROM ... WHERE ...` con el patrón propuesto) y la muestra: *"esta regla afectaría a N registros"*.
5. Al confirmar:
   a. Se agrega la fila al CSV de curation correspondiente (`data/curation/<tipo>.csv`) vía `src/lib/csv.js`.
   b. Se agrega una fila a `curation_audit_log.csv` con el resumen, impacto estimado y `rebuild_triggered`.
   c. Se ofrece "Reconstruir ahora" (dispara el flujo de rebuild de la etapa correspondiente) o "Reconstruir después" (queda pendiente, visible en Administración del Pipeline).

## Flujo: Trabajo Fuera de Horario

1. Usuario entra a `/dashboard/after-hours` (vía su propio link de nav, no anidado bajo `/dashboard/operacional`).
2. `AfterHoursShell` (client component) llama en paralelo a los 6 Route Handlers de `/api/dashboard/after-hours/*` (`summary`, `by-client`, `by-task-type`, `by-technician`, `by-period`, `confidence-distribution`), todos consultando `marts.fieldbeat_working_hours_analysis` **en vivo** (no las tablas GOLD, que son un snapshot fijo tipo cookbook SQL) con los filtros activos.
3. Cada KPI, fila de gráfico y fila de tabla trae su propio `confidence_score`/`confidence_label`, calculado una sola vez en `src/marts/build-fieldbeat-working-hours-analysis.js` (nunca recalculado en la app) - ver [CALCULATION_CONFIDENCE_MODEL.md](CALCULATION_CONFIDENCE_MODEL.md).
4. La tabla de detalle (`/api/dashboard/after-hours/detail`) sigue el mismo patrón de paginación server-side que Auditoría.
5. Es de solo lectura - las únicas ediciones posibles son manuales, fuera de la app: `data/config/business-hours.json` y `data/config/holidays.json`/`.example.json`.

## Flujo: Rebuild de BDD

1. Desde Administración del Pipeline, usuario elige "Rebuild completo" o una etapa específica (miners / normalizers / marts / gold / warehouse).
2. El Route Handler correspondiente lanza el/los scripts de `package.json` como child process, en el orden de [LOCAL_OPERATIONS_RUNBOOK.md](LOCAL_OPERATIONS_RUNBOOK.md).
3. stdout/stderr se transmiten a la UI en vivo (Server-Sent Events o polling simple - no hace falta WebSockets para Fase 1).
4. Al terminar, se corre automáticamente `npm run db:build` y se muestra el resultado de `data/reports/duckdb_validation_summary.json` (`all_match`).
5. Si algo falla, se muestra el error tal como aparece en consola - no se oculta ni se reinterpreta.

## Migración a Cloudflare Pages/Workers/D1 (Fase 2)

Ninguna decisión de Fase 1 debería requerir reescribir lógica de negocio para migrar - solo cambia dónde corre cada pieza:

| Componente Fase 1 (local) | Equivalente Cloudflare (Fase 2) |
|---|---|
| Next.js app (`next dev`) | Cloudflare Pages, vía adaptador `@cloudflare/next-on-pages` u OpenNext |
| Route Handlers Node | Cloudflare Pages Functions / Workers |
| `data/warehouse/eyg_nexus.duckdb` (archivo local) | Opción A: DuckDB-WASM en el Worker leyendo el archivo desde R2. Opción B (recomendada para las tablas GOLD/MARTS, que son pequeñas y ya agregadas): migrar a **Cloudflare D1** (SQLite-compatible), sirviendo las mismas queries adaptadas a sintaxis SQLite. Las transformaciones pesadas (normalizers, resolver) seguirían corriendo en un batch job fuera de Cloudflare (GitHub Actions / Cloud Run) y publicando el resultado agregado a D1/R2. |
| `data/raw/`, `data/processed/`, `data/marts/`, `data/gold/` (archivos locales) | Cloudflare R2 (object storage) |
| `data/curation/*.csv` | R2 versionado, o tablas D1 si se necesita concurrencia de edición real |
| Scripts de pipeline (child process local) | GitHub Actions con cron, o Cloudflare Workers con Cron Triggers para las etapas livianas |
| Ollama local | Sin equivalente serverless directo - evaluar Cloudflare Workers AI (tiene capa gratuita limitada) si se quiere mantener IA en la migración, o mantener la Lupa solo en modo sin-IA en producción cloud |

La migración es incremental: se puede mover el frontend a Pages manteniendo el backend/DuckDB local vía túnel, o migrar el warehouse a D1 primero y dejar el frontend local - no es un salto todo-o-nada.

## Qué queda fuera de Fase 1 (explícito)

- **Toda la implementación de código de la UI** - este documento es la propuesta, no la app. Ver [APP_UI_SPEC.md](APP_UI_SPEC.md) para el detalle de pantallas antes de implementar.
- **Aplicación efectiva de las reglas de curation** dentro de los normalizers/resolver - hoy son solo plantillas y modelo (ver [CURATION_MODEL.md](CURATION_MODEL.md)); conectar `data/curation/*.csv` a la lógica del pipeline es un paso de implementación posterior.
- **Autenticación y multiusuario** - Fase 1 asume un solo operador local, sin login. `created_by` se completa manualmente o con un valor fijo de sesión.
- **Deploy real a Cloudflare** - solo se documenta el camino, no se ejecuta.
- **Instalación/configuración de Ollama** - se documenta como opción, no se instala ni configura en este alcance.
- **Cualquier movimiento de stock en Dolibarr**, en ninguna pantalla, bajo ninguna circunstancia.
