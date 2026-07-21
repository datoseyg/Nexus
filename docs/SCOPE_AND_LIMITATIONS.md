# Alcance y limitaciones -GOLD v1 (Universo Zendesk accesible)

**GOLD v1 representa únicamente el universo Zendesk accesible con las credenciales actuales.** No representa el 100% del historial operativo de FieldBeat. Esta distinción es central para interpretar correctamente cualquier número de `data/gold/`.

## Los números de alcance (congelados a la fecha de este build)

| Métrica | Valor |
|---|---|
| `total_zendesk_tickets` | **628** |
| `total_fieldbeat_tasks` | **3747** |
| `fieldbeat_tasks_with_zendesk_ticket` | 1210 |
| `fieldbeat_tasks_without_zendesk_ticket` | 2537 |
| `fieldbeat_tasks_linked_to_existing_zendesk_ticket` | 290 |
| `fieldbeat_tasks_linked_to_missing_zendesk_ticket` | **920** |
| `used_parts_in_ticket_mart` | **200** |
| `used_parts_outside_ticket_mart` | **1993** |
| `total_fieldbeat_used_parts_global` | 2193 |
| `tickets_failed_by_error_403` (backfill) | **291** |

Fuente: `data/reports/scope_reconciliation_summary.json` y `data/reports/zendesk_backfill_by_fieldbeat_summary.json`.

## Por qué el mart final es tan pequeño comparado con el universo FieldBeat

El mart `Ticket_FieldBeat_Dolibarr_Operational_View.csv` es **ticket-céntrico**: 1 fila por cada uno de los 628 tickets Zendesk minados. Solo entra a ese mart un repuesto/task de FieldBeat si su relación puente (`BR_Ticket_FieldBeat_Task.csv`) apunta a un `zendesk_ticket_id` que **realmente existe** en `DB_Zendesk_Tickets.csv`.

De los 3747 tasks FieldBeat:

1. **2537 tasks (68%) nunca registraron un número de ticket** en su reporte -no hay fila puente en absoluto. Esto es un problema de captura de datos histórico en FieldBeat, no del pipeline.
2. **920 relaciones (de las 1210 que sí registran un número) apuntan a un ticket que no existe** en los 628 minados -"tickets fantasma". Solo 290 relaciones (24%) apuntan a un ticket real.
3. De ahí que solo **200 de 2193 repuestos globales (9%)** terminen representados en el mart final y en GOLD.

**Esto no es un bug de matching.** Se verificó explícitamente con `qa:scope-reconciliation` (`ticket_mart_totals_match: true`) que los 200 repuestos del mart calzan exacto con lo que el resolver de identidad de repuestos calcula de forma independiente.

## Por qué los 920 "tickets fantasma" no se resolvieron con backfill

Se corrió un backfill (`npm run get:zendesk:backfill-fieldbeat`) contra los 656 `zendesk_ticket_id` únicos referenciados por esas 920 relaciones, consultando Zendesk directo por `GET /api/v2/tickets/{id}.json`:

| Resultado | Cantidad |
|---|---|
| Encontrados | 4 (todos duplicados de tickets ya presentes en los 628 -variantes mal formateadas como `0001`/`00001`/`001` que Zendesk resolvió al mismo ticket real) |
| No encontrados (404 genuino) | 361 (IDs con forma de basura/typo de técnico, ej. 12+ dígitos) |
| **No accesibles (403 Forbidden)** | **291** |

**Los 291 tickets con 403 quedan fuera por permisos del token actual, no por un bug del pipeline.** El patrón de IDs no es aleatorio: caen en dos rangos densos y consecutivos (**5–500** y **~8600–10227**), lo que sugiere que son tickets reales existentes en Zendesk, pero el rol del token actual (`ZENDESK_USER`/`ZENDESK_TOKEN`) no tiene permiso para verlos vía la API -probablemente un agente restringido a tickets asignados/seguidos, o tickets privados/de otra marca. Con el token actual no hay forma de acceder a ellos. Ver [PHASE_2_BACKLOG.md](PHASE_2_BACKLOG.md).

La lista completa de los 291 IDs está en `data/reports/zendesk_ticket_ids_not_accessible_403.json`.

## Qué significa esto para quien consuma GOLD

- Los KPIs de `GOLD_Operational_Dashboard.csv` y `GOLD_Data_Quality_Report.csv` son correctos **dentro del universo de 628 tickets accesibles** -no hay que corregirlos ni ajustarlos manualmente.
- **No se debe presentar GOLD v1 como "el 100% del historial de servicio técnico"** sin la salvedad de este documento. `GOLD_Scope_Metadata.csv` existe precisamente para llevar esta advertencia adjunta a cualquier consumo BI.
- `GOLD_Used_Parts_Analysis.csv` es la única tabla que cubre el universo global (2193 repuestos, no 200) -es la vista correcta si lo que se necesita es "calidad de matching de repuestos" en vez de "servicio por ticket".
