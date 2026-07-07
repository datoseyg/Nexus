# BI Readiness - EYG Nexus Local

Qué tablas de `data/warehouse/eyg_nexus.duckdb` usar para construir un dashboard, y qué mostrar con cada una. **La base ya está lista para conectar** (DuckDB soporta conexión directa desde Power BI, o exportar a Google Sheets/BigQuery para Looker Studio) - este documento deja el mapeo listo, pero **no se construyó ningún dashboard todavía** (queda para Fase 2, ver [PHASE_2_HANDOFF.md](PHASE_2_HANDOFF.md)).

## Dos dashboards posibles (complementarios, no uno reemplaza al otro)

### Dashboard ticket-céntrico (universo: 628 tickets Zendesk accesibles)

| Tabla | Uso recomendado |
|---|---|
| `gold.operational_dashboard` | Tarjetas de KPI (scorecards) arriba de todo: tickets totales, con FieldBeat, con repuestos, tasas. |
| `gold.data_quality_report` | Gráfico de torta/barras: distribución de tickets por `data_quality_status`. |
| `gold.client_service_profile` | Tabla/ranking de clientes por volumen de tickets y calidad de repuestos. |
| `gold.equipment_service_profile` | Ranking de equipos por intervenciones y repuestos sin matchear. |
| `gold.scope_metadata` | **No graficar** - mostrar como nota/tooltip de advertencia de alcance al pie del dashboard. |

### Dashboard report-céntrico / FieldBeat-first (universo: 3747 reportes completos)

| Tabla | Uso recomendado |
|---|---|
| `gold.fieldbeat_report_analysis` | Tarjetas de KPI del universo completo (incluye lo que el dashboard ticket-céntrico deja afuera). |
| `gold.client_parts_consumption` | Gráfico de líneas/barras: consumo de repuestos por cliente y mes (grano ya viene pre-agregado por período). |
| `gold.client_report_volume_by_period` | Gráfico de tendencia: volumen de reportes por cliente en el tiempo. |
| `gold.equipment_parts_consumption` | Ranking de equipos por consumo de repuestos. |
| `gold.fieldbeat_data_quality` | Distribución de reportes por `report_quality_status`. |

## Visualizaciones sugeridas

- **Reportes por cliente** - barras horizontales, `gold.client_report_volume_by_period` sumado por cliente (o filtrado a un período).
- **Consumo de repuestos por cliente y mes** - serie de tiempo / heatmap, `gold.client_parts_consumption` (grano cliente × mes ya resuelto, filtrar `period` para ventanas específicas).
- **Equipos con mayor consumo** - ranking, `gold.equipment_parts_consumption` (ticket-céntrico: `gold.equipment_service_profile`).
- **Repuestos no matcheados** - tabla priorizada por `occurrences`, `gold.used_parts_analysis` filtrando `no_match_count > 0` - insumo directo para decidir qué alias manuales agregar primero (`data/config/part_identity_aliases.csv`).
- **Calidad de datos** - gráfico de torta, `gold.data_quality_report` (ticket-céntrico) o `gold.fieldbeat_data_quality` (report-céntrico).
- **Alcance y restricciones** - panel de texto fijo con `gold.scope_metadata.scope_warning` y los números clave (628 tickets accesibles, 3747 reportes totales, 291 tickets 403 pendientes) - **debe estar visible en cualquier dashboard que use el universo ticket-céntrico**, para que nadie lo interprete como el 100% del negocio.

## Antes de conectar una herramienta BI

- Revisar [DATA_DICTIONARY.md](DATA_DICTIONARY.md), sección "Anomalías y advertencias de tipos" - algunas columnas de porcentaje son texto (`"42.27%"`), y `zendesk_ticket_id` no es del mismo tipo en todas las tablas.
- Correr `npm run db:build` para asegurar que el warehouse refleja los CSV más recientes.
- Si la herramienta BI requiere un archivo plano en vez de conexión directa a DuckDB, exportar la tabla GOLD necesaria a CSV (ya existen en `data/gold/*.csv`, son la fuente de las tablas SQL).
