# Nexus BI App - Fase 1 MVP

App web local, solo lectura, para consumir el warehouse DuckDB de EYG Nexus sin necesidad de saber SQL. Ver [`../../docs/PRODUCT_APP_ARCHITECTURE.md`](../../docs/PRODUCT_APP_ARCHITECTURE.md) para la arquitectura completa y [`../../docs/APP_UI_SPEC.md`](../../docs/APP_UI_SPEC.md) para la especificación de las 10 pantallas objetivo (acá solo están implementadas 3).

## Requisito previo: correr el pipeline y construir el warehouse

Esta app **no genera datos** - lee `data/warehouse/eyg_nexus.duckdb`, que debe existir de antes. Desde la raíz del proyecto (`eyg-nexus-local/`, no acá):

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

Abrir `http://localhost:3000`.

## Esta app es 100% de solo lectura

- Abre `data/warehouse/eyg_nexus.duckdb` en modo `READ_ONLY` - no hay ningún camino de código que escriba en la base.
- No modifica `data/raw/`, `data/processed/`, `data/marts/`, `data/gold/`, ni `data/curation/`.
- El Explorador de Tablas no tiene edición de celdas. La Búsqueda no tiene acciones de escritura.

## Desarrollo local de los dashboards que usan Postgres, no DuckDB

`/dashboard/after-hours` (10 endpoints, `app/api/dashboard/after-hours/**`) y `/dashboard/fieldbeat` (`app/api/dashboard/fieldbeat/route.ts`, ETAPA 5) no leen `eyg_nexus.duckdb` -leen Postgres vía `lib/db.ts` (`SUPABASE_DB_URL`). Por defecto esa variable apunta al pooler de Supabase cloud (`.env.local`, no versionado) - para desarrollar sin depender de la nube ni tocar ninguna base compartida:

**1. Preparar un Postgres 16 local desechable** (una sola vez, o cuando quieras empezar de cero):

```bash
npm run dev:local:setup
```

Requiere Docker corriendo. Crea (o reutiliza) un único contenedor `nexus_bi_dev_local`, le aplica el esquema (`sql/*.sql`) y escribe `apps/nexus-bi-app/.env.development.local` con la connection string local y `DATABASE_SSL_MODE=disable` (no versionado, `.gitignore` ya lo excluye vía `.env.*.local`). Si ya existía ese archivo, lo respeta moviéndolo a `.env.development.local.previous` en vez de descartarlo.

**2. Levantar Nexus** (sin cambios respecto a lo de arriba):

```bash
npm run dev
```

La base queda con el esquema aplicado pero sin datos - el dashboard mostrará KPIs en cero / estados vacíos genuinos (no "no disponible"; eso solo aparece si la conexión falla). Para datos reales, correr desde la **raíz del repo** (no acá).

**Forma oficial (única, funciona igual en Git Bash/PowerShell/cmd.exe)**: `contracts:import`, `holidays:import` y `working-hours:build` leen 3 nombres de variable de entorno *distintos* (`SUPABASE_DB_URL_DIRECT`, `HOLIDAYS_DB_URL`, `WORKING_HOURS_DB_URL` - ver `src/{contracts,holidays,working-hours}/db-client.js`) y cada uno resuelve su `.env` según el `cwd` del proceso, no según dónde vive el script - correrlos con `VAR=valor npm run ...` (sintaxis solo-Bash) o desde `apps/nexus-bi-app/` en vez de la raíz son las dos formas de que fallen con `Falta <VAR> en .env`. `scripts/with-local-pipeline-env.mjs` (raíz del repo) resuelve ambos problemas a la vez: fija los 3 nombres de variable a la MISMA base local (leyendo `.env.working-hours.local`, copiar desde `.env.working-hours.local.example`) y ejecuta el comando en un proceso Node, sin sintaxis de shell:

```bash
node scripts/with-local-pipeline-env.mjs node src/holidays/import-holidays.js apply --confirm --file=data/config/holidays/CL/2024.json
node scripts/with-local-pipeline-env.mjs node src/holidays/import-holidays.js publish --confirm --coverage-id=<id>
node scripts/with-local-pipeline-env.mjs node src/contracts/import-contracts.js --apply --effective-date=YYYY-MM-DD --file=<csv>
node scripts/with-local-pipeline-env.mjs node src/working-hours/build-working-hours.js apply --confirm
```

(repetir holidays por cada bundle en `data/config/holidays/**`; usar `dry-run`/`--dry-run` sin `--confirm`/`--apply` para previsualizar sin escribir. Si tu Postgres local no corre en `localhost:55480/nexus_bi_dev_local_test`, editar `.env.working-hours.local` con el puerto real que imprimió `dev:local:setup`).

`/dashboard/fieldbeat` lee `gold.fieldbeat_report_analysis`/`gold.fieldbeat_data_quality`/`gold.client_report_volume_by_period`/`gold.client_parts_consumption`/`gold.equipment_parts_consumption` - datos distintos a los de After-Hours (no dependen de `contracts:import`/`holidays:import`/`working-hours:build`). Para poblarlos contra el mismo Postgres local, desde la **raíz del repo**:

```bash
npm run db:build
SUPABASE_DB_URL_DIRECT=postgresql://postgres:localtest@localhost:<PUERTO>/nexus_bi_dev_local_test npm run db:pg:migrate
```

`db:build` construye/valida el warehouse DuckDB completo (`processed`/`marts`/`gold`, incluidas las 5 tablas de arriba); `db:pg:migrate` sincroniza esas tablas hacia el Postgres local (nunca hacia `nexus-afterhours-realdata2` ni Supabase cloud - confirmar el preflight de SAFETY-1 antes de aceptar que tocó el destino correcto).

**3. Verificar que la API responde:**

```bash
PORT=<puerto de next dev> npm run smoke
```

o `curl http://localhost:<puerto>/api/dashboard/after-hours/summary` / `curl http://localhost:<puerto>/api/dashboard/fieldbeat`.

**4. Limpiar** (opcional, cuando ya no lo necesites):

```bash
npm run dev:local:teardown
```

Elimina solo el contenedor `nexus_bi_dev_local` - nunca toca Supabase cloud ni ningún otro contenedor Postgres que tengas corriendo.

**Nunca conectar el runtime de esta app contra un Postgres local sin decidir `DATABASE_SSL_MODE` explícitamente** (`lib/db.ts`): sin la variable, el default es `require` incluso en `localhost` (nunca se infiere del hostname). `DATABASE_SSL_MODE=disable` solo se acepta contra `localhost`/`127.0.0.1`/`::1` - contra cualquier otro host, lanza un error claro en vez de aceptarlo en silencio.

## Si aparece "Base de datos bloqueada"

DuckDB no permite que otro proceso (ej. DBeaver con una conexión abierta) tenga el archivo abierto en lectura-escritura al mismo tiempo que esta app intenta leerlo - ni siquiera en modo solo-lectura de este lado. Cerrar la conexión en DBeaver (o la herramienta que sea) y refrescar la página.

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
| Explorador (semántico, por entidad de negocio) | `/explorer` | `GET /api/explorer/[entity]`, `GET /api/explorer/detail` |
| Búsqueda / Lupa | `/search` | `GET /api/search?q=...` |

## Dashboard Operacional (`/dashboard/operacional`)

Port del layout visual de referencia "Proyecto 7 - Dashboard Operacional EyG" (KPI cards, filtros, gráficos Chart.js, tablas paginadas), con datos 100% reales del warehouse. Detalle completo de layout, paleta y mapeo visualización→tabla en [`../../docs/DASHBOARD_VISUAL_STYLE.md`](../../docs/DASHBOARD_VISUAL_STYLE.md).

Para levantarlo: es parte del mismo `npm run dev` / `npm run app:dev` de arriba - no requiere nada adicional. Navegar a `http://localhost:3000/dashboard/operacional`.

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

Todos los endpoints de arriba aceptan `from`/`to`/`grain` (rango de fechas y agrupación temporal) y, salvo `filters`, los filtros de identidad (`cliente`, `tipoTarea`, `maquina`, `sku`, `bodega`, `estadoTicket`, `origenRegistro`, `reportQuality`) - ver el detalle de cross-filter y self-exclusion en `docs/DASHBOARD_VISUAL_STYLE.md`.

**Cómo interpretar métricas marcadas como no disponibles:** cualquier respuesta de estos endpoints puede incluir un campo con forma `{ available: false, reason: "..." }` (a nivel de filtro o de métrica individual). Cuando eso pasa, la UI muestra literalmente "No disponible" o "Pendiente de parametrización" - **nunca un valor inventado ni un `0` silencioso**. Esto aplica hoy a: las columnas `HC_calc`/`% Uptime`/`THA`/`HC Teórica` de la tabla cliente-máquina de Uptime (no existe fórmula de negocio aprobada para calcularlas), y a la serie "Apoteca" simultánea en el gráfico de Evolución Operativa (se puede filtrar por separado con "Origen Registro", pero no se grafica como segunda serie en este corte) - ver advertencias completas en `DASHBOARD_VISUAL_STYLE.md`. "Origen Registro" y la columna "Origen" del detalle **ya no están deshabilitadas**: son una clasificación estimada real basada en `equipment_internal_ids` (ver doc), y la tabla de repuestos ya no muestra "Pag. PDF" (se quitó la columna en vez de dejarla vacía sin aportar nada). Si necesitas confirmar que ninguna métrica quedó "inventada", buscar por `available: false` y `"Pendiente"` en las respuestas de la API, no asumir por el nombre del campo.

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
                                        dashboard.module.css - ver DASHBOARD_VISUAL_STYLE.md
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

- **DuckDB Node corre en runtime Node de Next.js**, no en Edge - necesita el binding nativo de `@duckdb/node-api`. `next.config.ts` lo marca explícitamente como paquete externo de servidor.
- **Identificadores (schema/tabla/columna) nunca se interpolan sin validar.** Toda la lógica de esto vive en `lib/sql-guardrails.ts`: se valida contra `information_schema` antes de usarlos en cualquier SQL, y se escapan con comillas dobles como defensa adicional (DuckDB no permite parametrizar nombres de columna/tabla, solo valores).
- **BIGINT de DuckDB se convierte a `Number` antes de responder JSON** (`serializeRow`/`serializeRows` en `lib/duckdb.ts`) - `JSON.stringify` no soporta `bigint` nativo.
- La conexión a DuckDB se cachea en `globalThis` para sobrevivir el hot-reload de `next dev` sin reabrir el archivo en cada guardado.
