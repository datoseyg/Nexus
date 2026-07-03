# Nexus BI App — Fase 1 MVP

App web local, solo lectura, para consumir el warehouse DuckDB de EYG Nexus sin necesidad de saber SQL. Ver [`../../docs/PRODUCT_APP_ARCHITECTURE.md`](../../docs/PRODUCT_APP_ARCHITECTURE.md) para la arquitectura completa y [`../../docs/APP_UI_SPEC.md`](../../docs/APP_UI_SPEC.md) para la especificación de las 10 pantallas objetivo (acá solo están implementadas 3).

## Requisito previo: correr el pipeline y construir el warehouse

Esta app **no genera datos** — lee `data/warehouse/eyg_nexus.duckdb`, que debe existir de antes. Desde la raíz del proyecto (`eyg-nexus-local/`, no acá):

```bash
npm run db:build
```

Ver [`../../docs/LOCAL_OPERATIONS_RUNBOOK.md`](../../docs/LOCAL_OPERATIONS_RUNBOOK.md) si hace falta correr el pipeline completo desde cero antes de eso.

## Instalar y levantar

```bash
cd apps/nexus-bi-app
npm install
npm run dev
```

Abrir `http://localhost:3000`. También se puede levantar desde la raíz del proyecto con:

```bash
npm run app:dev
```

## Esta app es 100% de solo lectura

- Abre `data/warehouse/eyg_nexus.duckdb` en modo `READ_ONLY` — no hay ningún camino de código que escriba en la base.
- No modifica `data/raw/`, `data/processed/`, `data/marts/`, `data/gold/`, ni `data/curation/`.
- El Explorador de Tablas no tiene edición de celdas. La Búsqueda no tiene acciones de escritura.

## Si aparece "Base de datos bloqueada"

DuckDB no permite que otro proceso (ej. DBeaver con una conexión abierta) tenga el archivo abierto en lectura-escritura al mismo tiempo que esta app intenta leerlo — ni siquiera en modo solo-lectura de este lado. Cerrar la conexión en DBeaver (o la herramienta que sea) y refrescar la página.

## Qué NO implementa este corte (Fase 1 MVP)

Ver `docs/PRODUCT_APP_ARCHITECTURE.md` § "Qué queda fuera de Fase 1" para el detalle completo. En este corte específico, explícitamente no están:

- Centro de correcciones (pantallas 5-8 de `APP_UI_SPEC.md`).
- Rebuild del pipeline desde la UI (pantalla 9).
- Autenticación / multiusuario.
- IA local con Ollama en la Búsqueda (es 100% por keywords, sin LLM).
- Deploy a Cloudflare.
- Cualquier movimiento de stock en Dolibarr.

## Pantallas implementadas

| Pantalla | Ruta | API |
|---|---|---|
| Dashboard Operacional FieldBeat | `/dashboard/fieldbeat` | `GET /api/dashboard/fieldbeat` |
| Dashboard Operacional (estilo Proyecto 7) | `/dashboard/operacional` | ver tabla dedicada abajo |
| Explorador de Tablas | `/explorer` | `GET /api/tables`, `GET /api/tables/[schema]/[table]` |
| Búsqueda / Lupa | `/search` | `GET /api/search?q=...` |

## Dashboard Operacional (`/dashboard/operacional`)

Port del layout visual de referencia "Proyecto 7 — Dashboard Operacional EyG" (KPI cards, filtros, gráficos Chart.js, tablas paginadas), con datos 100% reales del warehouse. Detalle completo de layout, paleta y mapeo visualización→tabla en [`../../docs/DASHBOARD_VISUAL_STYLE.md`](../../docs/DASHBOARD_VISUAL_STYLE.md).

Para levantarlo: es parte del mismo `npm run dev` / `npm run app:dev` de arriba — no requiere nada adicional. Navegar a `http://localhost:3000/dashboard/operacional`.

Tiene 2 pestañas, cada una con sus propios endpoints:

| Pestaña | Sección | Endpoint |
|---|---|---|
| Dashboard Operacional | Filtros (cliente/tipo tarea/máquina/estado ticket/origen/bodega) + rango de fechas real (`DateRangePicker`) | `GET /api/dashboard/operacional/filters` |
| Dashboard Operacional | KPIs, Distribución de Estados (**tickets Zendesk**), Evolución Operativa, Bodegas/Clientes, Ranking Bodegas, % Tickets por Cliente, Estado General, Atenciones Máquinas×Clientes | `GET /api/dashboard/operacional/summary` |
| Dashboard Operacional | Tabla Uso de Repuestos (solo repuestos Dolibarr con match real) | `GET /api/dashboard/operacional/parts` |
| Dashboard Operacional | Detalle Operativo (incluye columna `origen` derivada) | `GET /api/dashboard/operacional/detail` |
| Integración Uptime/Downtime | Tabla de Tareas | `GET /api/dashboard/uptime/tasks` |
| Integración Uptime/Downtime | KPIs por tipo de tarea (horas registradas) | `GET /api/dashboard/uptime/summary` |
| Integración Uptime/Downtime | Tabla Uptime/Downtime por cliente-máquina, gráfico Duración Registrada por Año-Mes | `GET /api/dashboard/uptime/table` |

Todos los endpoints de arriba aceptan `from`/`to`/`grain` (rango de fechas y agrupación temporal) y, salvo `filters`, los filtros de identidad (`cliente`, `tipoTarea`, `maquina`, `sku`, `bodega`, `estadoTicket`, `origenRegistro`, `reportQuality`) — ver el detalle de cross-filter y self-exclusion en `docs/DASHBOARD_VISUAL_STYLE.md`.

**Cómo interpretar métricas marcadas como no disponibles:** cualquier respuesta de estos endpoints puede incluir un campo con forma `{ available: false, reason: "..." }` (a nivel de filtro o de métrica individual). Cuando eso pasa, la UI muestra literalmente "No disponible" o "Pendiente de parametrización" — **nunca un valor inventado ni un `0` silencioso**. Esto aplica hoy a: las columnas `HC_calc`/`% Uptime`/`THA`/`HC Teórica` de la tabla cliente-máquina de Uptime (no existe fórmula de negocio aprobada para calcularlas), y a la serie "Apoteca" simultánea en el gráfico de Evolución Operativa (se puede filtrar por separado con "Origen Registro", pero no se grafica como segunda serie en este corte) — ver advertencias completas en `DASHBOARD_VISUAL_STYLE.md`. "Origen Registro" y la columna "Origen" del detalle **ya no están deshabilitadas**: son una clasificación estimada real basada en `equipment_internal_ids` (ver doc), y la tabla de repuestos ya no muestra "Pag. PDF" (se quitó la columna en vez de dejarla vacía sin aportar nada). Si necesitas confirmar que ninguna métrica quedó "inventada", buscar por `available: false` y `"Pendiente"` en las respuestas de la API, no asumir por el nombre del campo.

## Estructura

```
apps/nexus-bi-app/
  app/
    page.tsx                          Landing con links a las pantallas
    dashboard/fieldbeat/page.tsx       Pantalla 1
    dashboard/operacional/page.tsx     Dashboard Operacional estilo Proyecto 7 (2 tabs)
    explorer/page.tsx                 Pantalla 2
    search/page.tsx                   Pantalla 3
    api/
      dashboard/fieldbeat/route.ts     KPIs + rankings (5 tablas GOLD report-céntricas)
      dashboard/operacional/{filters,summary,parts,detail}/route.ts  Tab Dashboard Operacional
      dashboard/uptime/{summary,tasks,table}/route.ts                Tab Integración Uptime/Downtime
      tables/route.ts                  Lista schema.table disponibles
      tables/[schema]/[table]/route.ts Datos paginados/ordenados/filtrados de una tabla
      search/route.ts                  Búsqueda por keywords (sin IA)
  components/                          NavBar, KpiCard, HorizontalBarChart, DataTable, etc.
  components/dashboard/                DashboardShell, FilterBar, KpiCard, ChartCard, DataTableCard,
                                        MiniBarTableCell, OperationalDashboardTab, UptimeDowntimeTab,
                                        dashboard.module.css — ver DASHBOARD_VISUAL_STYLE.md
  lib/
    duckdb.ts                          Conexión READ_ONLY + manejo de bloqueo + serialización BIGINT
    sql-guardrails.ts                  Validación de schema/tabla/columna contra information_schema
    api-error.ts                       Traduce errores de duckdb.ts a respuestas HTTP
    format.ts / csv-export.ts          Helpers de UI (primer corte)
    dashboard-formatters.ts            Formateo es-CL + paleta de colores del Dashboard Operacional
    dashboard-sql.ts                   Filtros compartidos y remapeo de report_quality_status
    chartjs-setup.ts                   Registro de componentes Chart.js
```

## Notas técnicas

- **DuckDB Node corre en runtime Node de Next.js**, no en Edge — necesita el binding nativo de `@duckdb/node-api`. `next.config.ts` lo marca explícitamente como paquete externo de servidor.
- **Identificadores (schema/tabla/columna) nunca se interpolan sin validar.** Toda la lógica de esto vive en `lib/sql-guardrails.ts`: se valida contra `information_schema` antes de usarlos en cualquier SQL, y se escapan con comillas dobles como defensa adicional (DuckDB no permite parametrizar nombres de columna/tabla, solo valores).
- **BIGINT de DuckDB se convierte a `Number` antes de responder JSON** (`serializeRow`/`serializeRows` en `lib/duckdb.ts`) — `JSON.stringify` no soporta `bigint` nativo.
- La conexión a DuckDB se cachea en `globalThis` para sobrevivir el hot-reload de `next dev` sin reabrir el archivo en cada guardado.
