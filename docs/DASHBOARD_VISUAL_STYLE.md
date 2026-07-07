# Estilo visual del Dashboard Operacional

`/dashboard/operacional` toma como referencia visual **Proyecto 7 - Dashboard Operacional EyG** (el HTML/PDF de la integración FieldBeat+Dolibarr+Zendesk anterior), portado a Next.js/React con datos 100% reales de `data/warehouse/eyg_nexus.duckdb`. **Los archivos de referencia (`index (2).html`, `app.js`, el PDF) nunca se copiaron tal cual** - son plantilla visual, no código final; sus `PLACEHOLDER_*` no son datos de producción.

## Layout general

- Fondo gris claro (`#f2f4f8`), cards blancas con borde sutil (`#e3e7ee`) y sombra suave.
- Appbar superior con logo, título y tabs.
- 2 tabs: **Dashboard Operacional** y **Integración Uptime / Downtime** - ver `components/dashboard/DashboardShell.tsx`.
- Barra de filtros (`filterBar`) arriba de cada tab.
- Fila de KPI cards (`kpiRow`, grid de 5).
- Grids de charts (`grid2`, `grid3`, `grid21` - 2, 3 columnas, o 2 asimétricas).
- Tablas con headers azul claro (`#eaf1ff` / `#274b8c`), scroll interno, paginación con flechas `‹ ›`.
- Botón amarillo "Descargar Informe" como KPI card de acción.
- Barra mini de progreso dentro de celdas de tabla (repuestos más usados).

Implementación: `components/dashboard/dashboard.module.css` (CSS Module - el resto de la app usa Tailwind + variables CSS del skill de dataviz; acá se usó CSS Module porque el diseño de referencia es específico y no mapea limpio a utilidades Tailwind genéricas).

## Paleta de colores

Mismos 10 colores del `app.js` de referencia, como valores hex literales (Chart.js dibuja en `<canvas>`, no soporta `var(--css-custom-property)` como el resto de la app con Recharts/SVG):

```
azul #3b6fd6 · teal #0f9aa8 · verde #1fa971 · rojo #e5484d · amarillo #f2b705
rosado #e06b9b · morado #7c5cbf · naranja #e8873a · gris #9aa4b2 · cyan #38b6c9
```

Definidos en `lib/dashboard-formatters.ts` (`DASHBOARD_PALETTE`, `DASHBOARD_PALETTE_SEQUENCE`).

## Componentes creados

| Componente | Para qué |
|---|---|
| `DashboardShell.tsx` | Appbar + tabs, orquesta los 2 tabs |
| `FilterBar.tsx` | Barra de filtros genérica (selects + input + borrar), soporta filtros deshabilitados con motivo |
| `KpiCard.tsx` (dashboard) | Tarjeta de KPI, variantes `default` / `action` (botón amarillo) / `client` |
| `ChartCard.tsx` | Envoltorio de gráfico con título y estado `available=false` -> "No disponible" |
| `DataTableCard.tsx` | Tabla paginada genérica con header azul y paginación por flechas |
| `MiniBarTableCell.tsx` | Barra mini proporcional dentro de una celda |
| `DateRangePicker.tsx` | Calendario/rango real (presets + `<input type="date">` + agrupación) - reemplaza el select estático de período |
| `FilterChips.tsx` | Chips de filtros activos, removibles individualmente (feedback visual del cross-filter) |
| `OperationalDashboardTab.tsx` | Contenido completo del Tab 1, incluye estado global de filtros sincronizado con la URL y los `onClick` de cross-filter de cada gráfico |
| `UptimeDowntimeTab.tsx` | Contenido completo del Tab 2 |

## Mapeo visualización → tabla DuckDB

### Tab 1 - Dashboard Operacional

| Visualización | Fuente | Endpoint |
|---|---|---|
| KPI: Total Registros FieldBeat | `COUNT(*)` sobre `marts.fieldbeat_report_dolibarr_operational_view` filtrado | `/api/dashboard/operacional/summary` |
| KPI: Total Tickets Zendesk | `COUNT(*)` sobre `processed.zendesk_tickets` filtrado (universo ticket-céntrico completo, 628 - independiente del universo report-céntrico) | idem |
| KPI: Repuestos Usados | `SUM(used_parts_count)` sobre la mart | idem |
| KPI: % con Ticket Reportado | `zendesk_join_status != 'NO_TICKET_REPORTED'` / total | idem |
| KPI: % con Ticket Zendesk Accesible | `zendesk_join_status = 'LINKED_TO_ACCESSIBLE_ZENDESK'` / total | idem |
| KPI: Último Cliente | `client_name` con `fieldbeat_task_date` más reciente | idem |
| Distribución de Estados | **`processed.zendesk_tickets.status`** remapeado (ver tabla abajo) - **no** `task_state` de FieldBeat | idem (`estados`) |
| Evolución Operativa | `fieldbeat_task_date` agrupado por `grain` (día/semana/mes) - **solo serie "General"** | idem (`evolucion`) |
| Uso Bodegas (Dimensión Clientes) | `processed.fieldbeat_used_parts.origin_location` join a `client_name`, agrupado por cliente, `pct` redondeado a 1 decimal | idem (`bodegasClientes`) |
| Ranking Bodegas Utilizadas | mismo origen, agrupado por nombre de bodega, `pct` redondeado a 1 decimal | idem (`rankingBodegas`) |
| % Tickets por Cliente | `client_name` + proporción `LINKED_TO_ACCESSIBLE_ZENDESK`, `pct` redondeado a 1 decimal | idem (`ticketsCliente`) |
| Estado General | `report_quality_status` remapeado (ver tabla abajo) | idem (`estadoGeneral`) |
| Tabla Uso de Repuestos | `marts.used_parts_dolibarr_match` (**solo `match_status = 'MATCHED'`**, sin refs basura) join `processed.fieldbeat_used_parts` (cantidad) y la mart (cliente) | `/api/dashboard/operacional/parts` |
| Atenciones Máquinas x Clientes | fan-out `client_name` × `equipment_internal_ids`, top 8 clientes × top 10 máquinas | `/api/dashboard/operacional/summary` (`maquinasClientes`) |
| Detalle Operativo | `marts.fieldbeat_report_dolibarr_operational_view`, paginado, columna `origen` derivada (ver heurística Apoteca abajo) | `/api/dashboard/operacional/detail` |
| Filtros (cliente/máquina/tipo/estado ticket/origen/bodega/período) | ver abajo | `/api/dashboard/operacional/filters` |

**Mapeo `processed.zendesk_tickets.status` → "Distribución de Estados"** (los 5 valores reales son `closed`, `solved`, `open`, `new`, `pending` - verificado por query directa; documentado en `lib/dashboard-sql.ts::TICKET_ESTADO_GROUPS`):

| `status` crudo | Etiqueta visual |
|---|---|
| `closed`, `solved` | Cerrado |
| `open`, `new` | Abierto |
| `pending` y cualquier otro valor no cubierto arriba | Pendiente |

**Mapeo `report_quality_status` → "Estado General"** (documentado también en `lib/dashboard-sql.ts`):

| `report_quality_status` | Etiqueta visual |
|---|---|
| `NO_USED_PARTS` | Éxito (Sin Repuestos) |
| `OK` | Éxito (Con Repuestos) |
| `HAS_PLACEHOLDERS`, `REVIEW_REQUIRED` | Validación Manual |
| `HAS_UNMATCHED_PARTS`, `HAS_AMBIGUOUS_PARTS` | Error |

**Heurística "Origen Registro" (General vs. Apoteca)** - no existe un campo explícito en el warehouse. Se probó contra `client_name`, `processed.fieldbeat_used_parts.origin_location` y `equipment_internal_ids`; solo este último tiene coincidencias reales de la palabra "APOTECA" (269 de 3747 reportes, ~7.2%). Regla aplicada (ver `lib/dashboard-filters.ts::buildMartIdentityConditions`):

```sql
CASE WHEN UPPER(COALESCE(equipment_internal_ids, '')) LIKE '%APOTECA%' THEN 'Apoteca' ELSE 'General' END
```

Se usa tanto para el filtro `origenRegistro` como para la columna `origen` de Detalle Operativo - en ambos casos es una clasificación **estimada**, documentada como tal en la propia respuesta de la API (`filters.origenRegistro.note`).

## Filtros globales y Cross-filter

Todos los endpoints de ambos tabs aceptan un set común de filtros por query param: `from`, `to` (rango de fechas, `YYYY-MM-DD`), `grain` (`day`/`week`/`month`, agrupación de la evolución temporal), `cliente`, `tipoTarea`, `maquina`, `sku`, `bodega`, `estadoTicket`, `origenRegistro`, `reportQuality`. El estado completo de filtros vive en la URL de `/dashboard/operacional` (sincronizado vía `window.history.replaceState`, sin librería de routing adicional), por lo que es compartible.

**Fuente de fecha por universo** (`lib/dashboard-filters.ts`): el universo report-céntrico (mart, KPIs, evolución, bodegas, repuestos, detalle) filtra por `fieldbeat_task_date`; el universo ticket-céntrico (Distribución de Estados, Total Tickets) filtra por `processed.zendesk_tickets.created_at` - nunca `updated_at`. Cuando hay filtros de cliente/tipoTarea/maquina/origenRegistro/reportQuality activos, la query de tickets los aplica vía un puente (`zendesk_ticket_id IN (SELECT ... FROM marts...WHERE linked_zendesk_ticket_id IS NOT NULL AND ...)`) - esto solo afecta a los tickets que sí están vinculados a un reporte FieldBeat; el resto de los 628 tickets no tiene ese vínculo en este dataset y no se ve afectado por esos filtros (sí por el rango de fechas y por `estadoTicket`, que son nativos de la tabla de tickets).

**Cross-filter con self-exclusion**: cada gráfico de identidad (cliente, bodega, estado de ticket, estado general) permite click para fijar el filtro global correspondiente (toggle: click de nuevo lo quita). El gráfico que originó el click **excluye su propio filtro** al construir su query - sigue mostrando la distribución completa, resaltando la categoría seleccionada (el resto se atenúa a 25% de opacidad, no se re-pinta con otro color) - mientras el resto del dashboard sí aplica el filtro:

| Gráfico | Filtro que fija al hacer click | Se auto-excluye a sí mismo de |
|---|---|---|
| Distribución de Estados | `estadoTicket` | su propia query |
| Uso Bodegas (Dimensión Clientes) | `cliente` | su propia query (sigue aplicando `bodega` si está activo) |
| Ranking Bodegas | `bodega` | su propia query (sigue aplicando `cliente` si está activo) |
| % Tickets por Cliente | `cliente` | su propia query |
| Estado General | `reportQuality` | su propia query |
| Atenciones Máquinas x Clientes | `cliente` (eje X) | ambos ejes (`cliente` y `maquina`) - es una matriz con dos dimensiones clickeables |
| Tabla Uso de Repuestos (click de fila) | `sku` | no aplica (es una tabla, no una distribución categórica) |

Un chip visual ("Cliente: Clínica Alemana ×") aparece por cada filtro activo, removible individualmente sin afectar el resto - ver `components/dashboard/FilterChips.tsx`.

**Selector de período**: reemplaza el select estático "Selecciona un período" del dashboard de referencia por un calendario real (`components/dashboard/DateRangePicker.tsx`) - presets (Hoy, últimos 7/30 días, este mes, este año, todo) + inputs de fecha nativos (`<input type="date">`, sin librería de pago) + selector de agrupación (día/semana/mes). Sin esto, no había forma de acotar el dashboard a un rango arbitrario.

### Tab 2 - Integración Uptime / Downtime

| Visualización | Fuente | Endpoint |
|---|---|---|
| Tabla de Tareas | `processed.fieldbeat_tasks` join a la vista report-céntrica (solo para `client_name`) | `/api/dashboard/uptime/tasks` |
| KPIs por tipo de tarea (horas) | `SUM(duration_minutes)/60` agrupado por `task_type` | `/api/dashboard/uptime/summary` |
| Tabla Uptime/Downtime por cliente-máquina | fan-out `equipment_internal_ids`, `SUM(duration_minutes)` por tipo - columnas HC/%Uptime = `null` | `/api/dashboard/uptime/table` |
| Duración registrada por Año-Mes | `STRFTIME(start_time, '%Y')/'%m'` + `SUM(duration_minutes)/60` | `/api/dashboard/uptime/table` (`periodChart`) |

## Métricas disponibles (reales, verificadas contra el warehouse)

- Total reportes FieldBeat, total tickets Zendesk, repuestos usados, % con ticket reportado, % con ticket Zendesk accesible, último cliente.
- Distribución de estados de **tickets Zendesk** (Cerrado/Abierto/Pendiente, agrupado desde los 5 valores reales `closed`/`solved`/`open`/`new`/`pending`).
- Estado general (4 categorías remapeadas de `report_quality_status`).
- Bodega de origen de repuesto (`origin_location`) - **cobertura parcial: 561 de 2193 repuestos (25.6%)**, el resto no tiene bodega documentada; cantidades enteras y porcentajes redondeados a 1 decimal.
- Origen Registro (General/Apoteca) - clasificación estimada real (269/3747 reportes, ~7.2%, basada en `equipment_internal_ids`), disponible como filtro y como columna del Detalle Operativo.
- % tickets accesibles por cliente.
- Atenciones por máquina × cliente (fan-out real).
- Repuestos Dolibarr realmente usados (solo `match_status='MATCHED'`, sin valores basura como N/A, S/N, NO HAY, --), con reportes y clientes asociados.
- Rango de fechas real (`from`/`to`) y agrupación configurable (día/semana/mes) sobre la evolución operativa.
- Cross-filter: click en cliente/bodega/estado/estado general filtra el resto del dashboard, con self-exclusion en el gráfico de origen.
- Horas registradas (`duration_minutes`) por tipo de tarea, por cliente-máquina, por año-mes - ahora también filtrables por rango de fechas.

## Métricas pendientes / no disponibles (no inventadas)

- **Serie "Apoteca" separada en Evolución Operativa:** se puede aproximar filtrando por "Origen Registro" = Apoteca, pero no existe como serie simultánea a "General" en el mismo gráfico en este corte - requeriría rediseñar el chart para 2 series con el mismo filtro heurístico aplicado a cada una.
- **Clientes/máquinas como filtro independiente en el cross-filter de "Atenciones Máquinas x Clientes":** el click solo fija `cliente` (eje X); no hay una interacción de click separada para fijar `maquina` desde ese gráfico en este corte.
- Real fórmula de Uptime/Downtime (Tab 2): ver advertencia dedicada abajo - sin cambios respecto al corte anterior.

## ⚠️ Advertencia sobre Uptime/Downtime

**Lo que este dashboard llama "horas registradas" NO es downtime/uptime real.** `processed.fieldbeat_tasks.duration_minutes` es la duración que FieldBeat registró para cada task - no hay en este warehouse una fórmula de negocio aprobada que calcule disponibilidad de equipo (horas base por día/semana, feriados, ventanas de mantenimiento, etc.). El Tab 2 muestra un banner permanente con esta advertencia, y las columnas `HC_calc`, `% Uptime`, `THA`, `HC Teórica` de la tabla cliente-máquina se muestran explícitamente como **"Pendiente"** - no se calculan con una fórmula inventada.

Para habilitar el cálculo real de uptime hace falta, como mínimo: horas base de operación por cliente/máquina, calendario de feriados, y una fórmula de negocio revisada y aprobada - ninguno de estos insumos existe hoy en el pipeline.
