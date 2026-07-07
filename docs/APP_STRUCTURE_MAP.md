# Mapa de estructura de la app (`apps/nexus-bi-app`)

App Next.js (App Router) + React, 100% solo lectura sobre `data/warehouse/eyg_nexus.duckdb` (conexión `READ_ONLY`, ver `lib/duckdb.ts`). No existe un "modo static/cloud-demo" implementado hoy - solo se documenta como posibilidad futura en `docs/PRODUCT_APP_ARCHITECTURE.md` (migración a Cloudflare Pages/Workers/D1); no hay ningún archivo `src/cloud/` ni build estático separado en el repo actual.

## Rutas / páginas

| Ruta | Archivo | Propósito | Datos que consume | ¿Solo lectura? | Estado |
|---|---|---|---|---|---|
| `/` | `app/page.tsx` | Landing - grilla de las 6 pantallas implementadas + qué falta por implementar | - (estático) | Sí | Implementado |
| `/dashboard/fieldbeat` | `app/dashboard/fieldbeat/page.tsx` | Dashboard KPIs universo report-céntrico (Recharts) | `/api/dashboard/fieldbeat` → `gold.fieldbeat_report_analysis` + 4 tablas GOLD más | Sí | Implementado |
| `/dashboard/operacional` | `app/dashboard/operacional/page.tsx` | Dashboard "estilo Proyecto 7" - 2 tabs (Operacional + Uptime/Downtime), filtros, Chart.js | `/api/dashboard/operacional/*`, `/api/dashboard/uptime/*` | Sí | Implementado |
| `/dashboard/after-hours` | `app/dashboard/after-hours/page.tsx` | Vista independiente de Trabajo Fuera de Horario - KPIs con confiabilidad, 5 gráficos, tabla filtrable | `/api/dashboard/after-hours/*` → `marts.fieldbeat_working_hours_analysis` en vivo | Sí | Implementado |
| `/dashboard/equipment-lifecycle` | `app/dashboard/equipment-lifecycle/page.tsx` | Vida útil/frecuencia de cambio de repuestos por máquina - selector de máquina, tabla de repuestos con modelo estadístico y confiabilidad, timeline, comparación, insights por reglas, filtros "Todos"+búsqueda libre (ver [EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md](EQUIPMENT_PART_LIFECYCLE_ANALYSIS.md) y [LIFECYCLE_PREDICTIVE_MODELS.md](LIFECYCLE_PREDICTIVE_MODELS.md)) | `/api/dashboard/equipment-lifecycle/*` → `marts.equipment_part_lifecycle_events` en vivo + `gold.equipment_part_lifecycle_*` | Sí | Implementado |
| `/explorer` | `app/explorer/page.tsx` | Explorador tipo Excel de cualquier tabla del warehouse | `/api/tables`, `/api/tables/[schema]/[table]` | Sí | Implementado |
| `/search` | `app/search/page.tsx` | Búsqueda por palabras clave (sin IA), muestra la SQL ejecutada | `/api/search` | Sí | Implementado |
| `/audit/manual-review` | `app/audit/manual-review/page.tsx` | Auditoría/Validación Manual - 6 pestañas, botones de acción deshabilitados | `/api/audit/*` | Sí | Implementado (acciones deshabilitadas) |
| `/pipeline/status` (Administración del Pipeline) | — | Documentada como Pantalla 9 en `docs/APP_UI_SPEC.md`, **no implementada** | — | — | Especificación únicamente |

## Endpoints API

| Endpoint | Archivo | Propósito | Tablas DuckDB usadas | Filtros | Riesgo |
|---|---|---|---|---|---|
| `GET /api/dashboard/fieldbeat` | `app/api/dashboard/fieldbeat/route.ts` | KPIs fijos del dashboard FieldBeat | `gold.fieldbeat_report_analysis`, `gold.fieldbeat_data_quality`, `gold.client_report_volume_by_period`, `gold.client_parts_consumption`, `gold.equipment_parts_consumption` | Ninguno (sin input) | BAJO |
| `GET /api/dashboard/operacional/summary` | `.../operacional/summary/route.ts` | KPIs + distribución de estados + evolución temporal + matriz cliente×máquina, con cross-filter | `marts.fieldbeat_report_dolibarr_operational_view`, `processed.zendesk_tickets`, `processed.fieldbeat_used_parts` | from/to/grain/cliente/tipoTarea/maquina/sku/bodega/estadoTicket/origenRegistro/reportQuality | BAJO |
| `GET /api/dashboard/operacional/detail` | `.../operacional/detail/route.ts` | Tabla paginada "Detalle Operativo" | mart operacional | filtros compartidos + búsqueda por task/ticket id | BAJO |
| `GET /api/dashboard/operacional/parts` | `.../operacional/parts/route.ts` | Tabla paginada "Uso de Repuestos" (solo MATCHED, sin refs basura) | `marts.used_parts_dolibarr_match`, `processed.fieldbeat_used_parts`, mart operacional | filtros compartidos | BAJO |
| `GET /api/dashboard/operacional/filters` | `.../operacional/filters/route.ts` | Opciones de dropdowns + rango de fechas + cobertura de bodega/origen | mart operacional, `processed.zendesk_tickets`, `processed.fieldbeat_used_parts` | Ninguno (sin input) | BAJO |
| `GET /api/dashboard/uptime/summary` | `.../uptime/summary/route.ts` | Horas por bucket de tipo de tarea (etiquetado "horas registradas", NO downtime real) | `processed.fieldbeat_tasks` | from/to/cliente/tipo/maquina | BAJO |
| `GET /api/dashboard/uptime/table` | `.../uptime/table/route.ts` | Tabla cliente×máquina + horas por Año-Mes; columnas de uptime/HC devueltas `null` (pendiente fórmula de negocio) | `processed.fieldbeat_tasks`, mart operacional | filtros compartidos | BAJO |
| `GET /api/dashboard/uptime/tasks` | `.../uptime/tasks/route.ts` | Lista paginada de tasks crudas (fecha/duración/cliente/tipo) | `processed.fieldbeat_tasks`, mart operacional | filtros compartidos | BAJO |
| `GET /api/dashboard/after-hours/summary` | `.../after-hours/summary/route.ts` | Los 6 KPIs de Trabajo Fuera de Horario, cada uno con confianza | `marts.fieldbeat_working_hours_analysis` (en vivo) | from/to/client/technician/taskType/confidenceLevel/onlyAfterHours/onlyLowConfidence | BAJO |
| `GET /api/dashboard/after-hours/detail` | `.../after-hours/detail/route.ts` | Tabla paginada de tareas fuera de horario | ídem | ídem | BAJO |
| `GET /api/dashboard/after-hours/by-{client,task-type,technician,period}` | `.../after-hours/by-*/route.ts` | Rankings/series agrupadas para los gráficos | ídem | ídem | BAJO |
| `GET /api/dashboard/after-hours/confidence-distribution` | `.../after-hours/confidence-distribution/route.ts` | Distribución Alta/Media/Baja/Insuficiente | ídem | ídem | BAJO |
| `GET /api/dashboard/equipment-lifecycle/summary` | `.../equipment-lifecycle/summary/route.ts` | KPIs globales fijos + opciones de filtro (afinadas por `q`) | `gold.equipment_part_lifecycle_summary`, `marts.equipment_part_lifecycle_events` | q | BAJO |
| `GET /api/dashboard/equipment-lifecycle/machines` | `.../equipment-lifecycle/machines/route.ts` | Lista de máquinas para el selector | `gold.equipment_part_lifecycle_by_machine` | client/confidenceLevel/estimateStatus/model/q | BAJO |
| `GET /api/dashboard/equipment-lifecycle/machine/[equipmentId]` | `.../equipment-lifecycle/machine/[equipmentId]/route.ts` | Ficha de máquina + tabla de repuestos con modelo/confiabilidad | `gold.equipment_part_lifecycle_by_machine`, `marts.equipment_part_lifecycle_events` (perfil, en vivo) | confidenceLevel/estimateStatus/model/from/to/q | BAJO |
| `GET /api/dashboard/equipment-lifecycle/parts` | `.../equipment-lifecycle/parts/route.ts` | Catálogo global de repuestos rastreados | `gold.equipment_part_lifecycle_by_part` | filtros compartidos + q | BAJO |
| `GET /api/dashboard/equipment-lifecycle/part-history` | `.../equipment-lifecycle/part-history/route.ts` | Timeline de eventos de un repuesto en una máquina | `marts.equipment_part_lifecycle_events` (en vivo) | equipment+dolibarrRef (requeridos) + q | BAJO |
| `GET /api/dashboard/equipment-lifecycle/comparison` | `.../equipment-lifecycle/comparison/route.ts` | Compara la vida estimada del mismo repuesto: esta máquina / otras máquinas del cliente / otros clientes / global | `gold.equipment_part_lifecycle_by_{machine,client,part}` | equipment+dolibarrRef (requeridos) + q | BAJO |
| `GET /api/dashboard/equipment-lifecycle/insights` | `.../equipment-lifecycle/insights/route.ts` | Frases explicativas generadas por reglas (nunca IA) | `gold.equipment_part_lifecycle_insights` | equipment/dolibarrRef/q | BAJO |
| `GET /api/dashboard/equipment-lifecycle/detail-events` | `.../equipment-lifecycle/detail-events/route.ts` | Tabla paginada de todos los eventos base (incluye NO_MATCH/AMBIGUOUS/PLACEHOLDER para trazabilidad) | `marts.equipment_part_lifecycle_events` (en vivo) | filtros compartidos + q, paginado | BAJO |
| `GET /api/audit/summary` | `app/api/audit/summary/route.ts` | Resumen de calidad + conteo de pendientes (usado por el badge del NavBar) | `gold.fieldbeat_data_quality`, `gold.scope_metadata` | Ninguno | BAJO |
| `GET /api/audit/parts-review` | `app/api/audit/parts-review/route.ts` | Repuestos por revisar (needs_manual_review o status problemático) | `marts.used_parts_dolibarr_match`, `processed.fieldbeat_used_parts`, mart report-céntrico | cliente/maquina/from/to/matchStatus/q | BAJO |
| `GET /api/audit/ambiguous-parts` | `.../audit/ambiguous-parts/route.ts` | Matches ambiguos agrupados por identificador | `marts.used_parts_dolibarr_match` (`AMBIGUOUS_MATCH`) | cliente/maquina/from/to/q | BAJO |
| `GET /api/audit/placeholders` | `.../audit/placeholders/route.ts` | Placeholders agrupados por identificador normalizado | `marts.used_parts_dolibarr_match` (`PLACEHOLDER_VALUE`) | cliente/maquina/from/to/q | BAJO |
| `GET /api/audit/reports-review` | `.../audit/reports-review/route.ts` | Reportes con revisión requerida | mart report-céntrico | cliente/maquina/from/to/reportQuality/q | BAJO |
| `GET /api/audit/ticket-links-review` | `.../audit/ticket-links-review/route.ts` | Reportes con ticket faltante/restringido | mart report-céntrico (`zendesk_join_status`) | cliente/maquina/from/to/q | BAJO |
| `GET /api/search` | `app/api/search/route.ts` | Búsqueda de palabras clave (AND entre keywords, OR entre columnas) | mart report-céntrico (`description`), `processed.fieldbeat_report_fields` | query de texto libre | BAJO |
| `GET /api/tables` | `app/api/tables/route.ts` | Lista `schema.table` disponibles para el explorador | `information_schema.tables` (vía `lib/sql-guardrails.ts`) | Ninguno | BAJO |
| `GET /api/tables/[schema]/[table]` | `app/api/tables/[schema]/[table]/route.ts` | Lectura genérica paginada/ordenable/filtrable de cualquier tabla validada | Cualquiera de `processed`/`marts`/`gold` (identificadores validados contra `information_schema` antes de interpolar) | page/pageSize/sort/filtro por columna | MEDIO (SQL dinámico, pero con allowlist estricto - ver `lib/sql-guardrails.ts`) |

Todos los endpoints comparten: `lib/duckdb.ts` (única puerta de conexión, `READ_ONLY`), `lib/api-error.ts` (traduce `DB_LOCKED`/`DB_NOT_FOUND`/`QUERY_ERROR` a HTTP), y placeholders `$N` parametrizados (nunca interpolación directa de valores de usuario).

## Componentes (`components/`)

- **`components/ui/`** - sistema de diseño genérico: `AppShell`, `PageHeader`, `SectionCard`, `MetricCard`, `MetricCardWithConfidence`, `ConfidenceBadge`, `StatusBadge`, `ResponsiveTableShell` (+ su `.module.css`), `SelectWithAll` (select con opción "Todos" que nunca llega al SQL como literal), `SearchInput` (lupa con debounce 300ms). **`EmptyState.tsx` y `FilterPanel.tsx` existen pero no los importa ningún archivo actual - huérfanos, ver `docs/PROJECT_CLEANUP_CANDIDATES.md`.**
- **`components/equipment-lifecycle/`** - específico de `/dashboard/equipment-lifecycle`: `EquipmentLifecycleShell`, `EquipmentSelector`, `MachineProfileCard`, `MachinePartsTable`, `PartLifecycleCard`, `PartHistoryTimeline`, `PartComparisonChart`, `LifecycleConfidenceBadge`, `LifecycleInsightsPanel`, `LifecycleEventsTable`.
- **`components/dashboard/`** - específico del look "Proyecto 7" de `/dashboard/operacional`: `DashboardShell`, `OperationalDashboardTab`, `UptimeDowntimeTab`, `ChartCard`, `KpiCard`, `MiniBarTableCell`, `DataTableCard`, `DateRangePicker`, `FilterBar`, `FilterChips`, `dashboard.module.css` (tokens `--db-*` propios, distintos de `--eyg-*`).
- **`components/audit/`** - específico de `/audit/manual-review`: `AuditManualReviewShell`, `AuditFilterBar`, `PartsReviewSection`, `AmbiguousPartsSection`, `PlaceholdersSection`, `ReportsReviewSection`, `TicketLinksReviewSection`, `QualitySummarySection`, `FutureActionButton` (botón de acción, siempre deshabilitado hasta que exista Centro de Correcciones).
- **`components/after-hours/`** - específico de `/dashboard/after-hours`: `AfterHoursShell`, `AfterHoursFilterBar`, `AfterHoursKpiGrid`, `AfterHoursDetailTable`, `AfterHoursByPeriodChart`, `ConfidenceDistributionChart`.
- **Sueltos en `components/`** - `NavBar` (nav global), `HorizontalBarChart` (ranking de una serie, Recharts, reusado por after-hours y fieldbeat dashboard), `DataTable` (tabla genérica TanStack, usada por el Explorador), `ErrorBanner`, `PaginationControls`, `QueryDisclosure` (muestra la SQL ejecutada, usado por Búsqueda).

## `lib/` (helpers de servidor/cliente)

`duckdb.ts` (conexión + serialización de BIGINT/TIMESTAMP), `api-error.ts`, `sql-guardrails.ts` (allowlist de schema/tabla/columna, paginación), `dashboard-filters.ts` + `dashboard-sql.ts` + `dashboard-formatters.ts` (filtros/formato del Dashboard Operacional), `audit-sql.ts` (filtros de Auditoría), `after-hours-filters.ts` + `after-hours-config.ts` (filtros y status de config de Trabajo Fuera de Horario), `confidence.ts` (mirror liviano de labels/colores de confiabilidad - la fuente de verdad es `src/lib/calculation-confidence.js`, en el pipeline, no acá), `format.ts`, `csv-export.ts` (descarga CSV client-side), `chartjs-setup.ts` (registro global de Chart.js).

## `types/`

`types/audit.ts` (formas de `/api/audit/*`, incluye `PaginatedResponse<T>` genérico reusado por after-hours), `types/after-hours.ts` (formas de `/api/dashboard/after-hours/*`).

## Estilos

`app/globals.css` - tokens de marca `--eyg-*` (verde/teal E&G Medical Systems) + tokens genéricos (`--surface-1`, `--text-primary`, `--series-1`, etc.) remapeados a esa paleta, con overrides `@media (prefers-color-scheme: dark)`. `components/dashboard/dashboard.module.css` y `components/ui/ResponsiveTableShell.module.css` son CSS modules locales a esos componentes.

## Modo local-DuckDB vs. cloud/estático

Solo existe el **modo local-DuckDB** (Route Handlers Node + `@duckdb/node-api`, archivo `.duckdb` local, `READ_ONLY`). No hay ningún modo "static export" o "cloud demo" implementado - `next.config.ts` incluso aísla deliberadamente la app de cualquier inferencia de workspace/monorepo (`turbopack.root`), y `serverExternalPackages` excluye el binding nativo de DuckDB del bundle. La migración a Cloudflare (D1/R2/Workers) está documentada como plan en `docs/PRODUCT_APP_ARCHITECTURE.md`, no implementada.
