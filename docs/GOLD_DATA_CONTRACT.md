# Contrato de datos — GOLD v1

Generado por `npm run build:gold` (`src/gold/build-gold.js`). Todas las tablas están en `data/gold/`. Antes de conectar cualquiera de estas tablas a una herramienta BI, leer [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md) — GOLD v1 no representa el 100% del universo FieldBeat, solo la porción vinculada a tickets Zendesk accesibles con las credenciales actuales.

---

## GOLD_Operational_Dashboard.csv

**Objetivo:** una sola fila con los KPIs globales del negocio — el número que se muestra arriba de cualquier dashboard.

**Granularidad:** 1 fila (todo el universo Zendesk accesible).

**Columnas principales:**
- `total_zendesk_tickets`, `tickets_with_fieldbeat_report`, `tickets_without_fieldbeat_report`, `tickets_with_multiple_fieldbeat_reports`
- `tickets_with_used_parts`, `tickets_with_all_parts_matched`, `tickets_review_required`
- `total_used_parts_in_ticket_scope`, `matched_used_parts`, `placeholder_used_parts`, `unmatched_used_parts`, `ambiguous_used_parts`
- `ticket_fieldbeat_coverage_rate`, `used_parts_match_rate`, `review_required_rate`

**Uso BI recomendado:** tarjetas de KPI (scorecards) en la primera fila del dashboard. No se filtra ni se cruza con otras tablas — es un snapshot fijo.

---

## GOLD_Data_Quality_Report.csv

**Objetivo:** explicar *por qué* el dashboard no muestra 100% de calidad — desglose de los 628 tickets por estado de calidad de dato.

**Granularidad:** 1 fila por `data_quality_status` (6 filas fijas, siempre las mismas 6 categorías aunque alguna tenga 0 tickets).

**Estados:**
| Estado | Significado |
|---|---|
| `OK` | Tiene reporte FieldBeat, sin problemas de repuestos (o sin repuestos) |
| `NO_FIELDBEAT_REPORT` | El ticket nunca tuvo un reporte FieldBeat vinculado |
| `HAS_PLACEHOLDERS` | Al menos un repuesto es un valor placeholder ("sin número", "NC", etc.) |
| `HAS_UNMATCHED_PARTS` | Al menos un repuesto no matcheó contra Dolibarr |
| `HAS_AMBIGUOUS_PARTS` | Al menos un repuesto matcheó contra más de un producto Dolibarr |
| `REVIEW_REQUIRED` | Todos los repuestos matchearon, pero al menos uno con confianza baja (`REF_LIKE`) |

**Columnas principales:** `ticket_count`, `percent_of_total_tickets`, `used_parts_count`, `matched_used_parts_count`, `placeholder_used_parts_count`, `unmatched_used_parts_count`, `ambiguous_used_parts_count`.

**Uso BI recomendado:** gráfico de torta/barras apiladas mostrando distribución de calidad. Es la vista de "salud del dato" para un equipo de datos, no para el cliente final.

---

## GOLD_Client_Service_Profile.csv

**Objetivo:** perfil de servicio por cliente — cuánto se le atendió, con qué calidad de repuestos.

**Granularidad:** 1 fila por `client_name`. Un ticket puede aportar a más de un cliente si tuvo reportes FieldBeat de clientes distintos (fan-out sobre la lista pipe-separada `client_names` del mart).

**Columnas principales:** `total_tickets`, `tickets_with_fieldbeat`, `fieldbeat_report_count`, `tickets_with_multiple_fieldbeat_reports`, `tickets_with_used_parts`, `used_parts_count`, `matched_used_parts_count`, `placeholder_used_parts_count`, `unmatched_used_parts_count`, `ambiguous_used_parts_count`, `review_required_tickets`.

**Uso BI recomendado:** tabla/ranking por cliente, filtro por nombre de cliente. Útil para detectar clientes con alto volumen de repuestos sin matchear (candidatos a revisión manual prioritaria).

---

## GOLD_Equipment_Service_Profile.csv

**Objetivo:** perfil de servicio por equipo — qué tan seguido se interviene cada equipo y con qué calidad de repuestos.

**Granularidad:** 1 fila por `equipment_internal_id` (fan-out igual que el perfil de cliente).

**Columnas principales:** `total_tickets`, `fieldbeat_report_count`, `tickets_with_used_parts`, `used_parts_count`, `unmatched_used_parts_count`, `ambiguous_used_parts_count`, `review_required_tickets`.

**Uso BI recomendado:** ranking de equipos por frecuencia de intervención o por repuestos sin matchear — insumo para mantenimiento predictivo o para detectar equipos con documentación de repuestos crónicamente mala.

---

## GOLD_Used_Parts_Analysis.csv

**Objetivo:** catálogo de calidad de matching de repuestos — a diferencia de las demás tablas GOLD, **no está acotado a tickets Zendesk accesibles**: cubre las 2193 filas globales de `Used_Parts_Dolibarr_Match.csv` (todas las tasks FieldBeat).

**Granularidad:** 1 fila por `normalized_part_identifier` único (576 grupos).

**Columnas principales:** `raw_part_identifier` (variantes pipe-joined), `part_name` (variantes pipe-joined), `occurrences`, `matched_count`, `placeholder_count`, `no_match_count`, `ambiguous_count`, `dolibarr_refs`, `dolibarr_product_ids`, `match_statuses`, `match_methods`, `needs_manual_review`.

**Uso BI recomendado:** priorizar aliases manuales (`data/config/part_identity_aliases.csv`) — ordenar por `occurrences` descendente para atacar primero los repuestos sin match que más se repiten. **No cruzar directamente con las tablas ticket-céntricas de arriba** sin tener en cuenta que esta cubre un universo más amplio.

---

## GOLD_Scope_Metadata.csv

**Objetivo:** documentar explícitamente el alcance real de GOLD v1, para que ningún consumidor BI interprete los números de arriba como el 100% del negocio.

**Granularidad:** 1 fila (metadata fija de este build).

**Columnas principales:** `total_fieldbeat_tasks`, `total_fieldbeat_used_parts_global`, `used_parts_in_ticket_mart`, `used_parts_outside_ticket_mart`, `fieldbeat_tasks_with_zendesk_ticket`, `fieldbeat_tasks_without_zendesk_ticket`, `fieldbeat_tasks_linked_to_existing_zendesk_ticket`, `fieldbeat_tasks_linked_to_missing_zendesk_ticket`, `zendesk_backfill_unique_missing_ticket_ids`, `zendesk_backfill_tickets_found`, `zendesk_backfill_tickets_not_found`, `zendesk_backfill_tickets_forbidden`, `scope_warning`, `phase_2_pending_action`.

**Uso BI recomendado:** no graficar — mostrar como texto/nota al pie de cualquier dashboard que use GOLD v1, o como tooltip de advertencia. Ver el detalle completo en [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md).
