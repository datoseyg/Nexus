# 05 -Métricas de negocio

## Vocabulario canónico de calidad de dato (enums usados como UI vocabulary en `components/ui/StatusBadge.tsx`)

| Métrica/enum | Definición | Valores | Fuente | Estado |
|---|---|---|---|---|
| `match_status` | Resultado de la cascada de resolución de identidad de repuestos contra el catálogo Dolibarr | `MATCHED, AMBIGUOUS_MATCH, PLACEHOLDER_VALUE, NO_MATCH` | `src/resolvers/part-identity-resolver.js:151-216`; columna en `marts.used_parts_dolibarr_match` | AS_IS · CONFIRMADA -LOCAL_RUNTIME: `/api/audit/summary` → `partsMatched:927, partsUnmatched:489, partsAmbiguous:56, partsPlaceholder:721` (suma 2193 = `total_fieldbeat_used_parts_global` de `docs/SCOPE_AND_LIMITATIONS.md:17`) |
| `report_quality_status` | Clasificación de calidad de un reporte FieldBeat según sus repuestos usados | `OK, NO_USED_PARTS, HAS_PLACEHOLDERS, HAS_UNMATCHED_PARTS, HAS_AMBIGUOUS_PARTS, REVIEW_REQUIRED` | `src/marts/build-ticket-fieldbeat-dolibarr-view.js:74-93`; `docs/GOLD_DATA_CONTRACT.md:29-39` | AS_IS · CONFIRMADA -LOCAL_RUNTIME: `reportsOk:480, reportsReviewRequired:1329` |
| `zendesk_join_status` | Estado del vínculo entre un reporte FieldBeat y un ticket Zendesk | `LINKED_TO_ACCESSIBLE_ZENDESK, LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK, NO_TICKET_REPORTED` | `src/marts/build-fieldbeat-report-dolibarr-view.js` | AS_IS · CONFIRMADA -LOCAL_RUNTIME: `reportsNoTicket:2537, reportsLinkedMissingOrRestricted:920` (coincide exacto con `docs/SCOPE_AND_LIMITATIONS.md:12,14`) |
| `calculation_status` | Si una tarea FieldBeat permitió calcular horas fuera de horario | `CALCULATED, CALCULATED_WITH_WARNINGS, NOT_CALCULABLE` | Comentario STATIC_CODE en `after-hours/summary/route.ts:58` (`w.calculation_status = 'NOT_CALCULABLE'`) | AS_IS · CONFIRMADA -LOCAL_RUNTIME: `tasksNotCalculable.value=12` |

## Niveles de confianza -corrección tras verificación puntual (importante)

La exploración inicial reportó "3 implementaciones paralelas duplicadas" de la lógica de confianza. **Verificación dirigida de esta sesión corrige esa afirmación:**

| Ubicación | ¿Existe en el commit auditado (`4a3d055`, `supabase-migration`)? | Qué hace | Evidencia |
|---|---|---|---|
| `apps/nexus-bi-app/lib/confidence.ts` | **Sí** | Mapea un score 0-100 ya calculado a `{label, tone}` -4 tiers: `0-39 Insuficiente/danger, 40-64 Baja/warning, 65-84 Media/info, 85-100 Alta/success`. No calcula el score, solo lo etiqueta. | STATIC_CODE `lib/confidence.ts:18-23` |
| `app/api/dashboard/after-hours/summary/route.ts` | **Sí** | **No re-implementa los tiers.** Lee `w.confidence_score` ya precalculado por fila desde `marts.fieldbeat_working_hours_analysis`, hace un promedio ponderado por `duration_minutes` (KPI 1-4), promedio simple filtrado (KPI 5) y una penalización fija (KPI 6: `95 - blank_status_count*5`), y llama a `getConfidenceLabel()` de `lib/confidence.ts` para la etiqueta final. Es una **agregación**, no una reimplementación de los umbrales. | STATIC_CODE `route.ts:21-29,77-79` |
| `src/lib/calculation-confidence.js` | **No existe en `supabase-migration`.** Solo existe en el commit `7e69d7c` ("cloud smoke test static deployment"), que pertenece a la línea `cloud-smoke-test`/`cloud-d1-readonly`, nunca mergeada. `src/lib/` en el commit auditado solo tiene `csv.js`, `http.js`, `save-json.js`. | GIT_HISTORY: `git log --all --oneline -- "src/lib/calculation-confidence.js"` → único hit `7e69d7c`; AUSENCIA CONFIRMADA en `4a3d055` · comando `ls src/lib/` |

**Conclusión corregida:** los 2 puntos que sí conviven en el commit auditado (`lib/confidence.ts` y la agregación SQL de la ruta) **son consistentes entre sí** -los mismos 4 umbrales, mismas etiquetas -porque el segundo delega en el primero para el etiquetado; no hay una reimplementación divergente de los cortes 39/40/64/65/84/85 dentro de esta branch. El cálculo *por tarea* del `confidence_score` (el algoritmo de puntaje ponderado por factores: 25pts `start_time` válido, 25pts `duration_minutes` válido, 15pts hora de término plausible, 15pts calendario laboral configurado, 10pts feriados configurados, 10pts trazabilidad) **sí es LEGACY** -recuperado vía `git show 7e69d7c:src/lib/calculation-confidence.js` (función `calculateTaskTimeConfidence`), y no tiene equivalente reproducible en `supabase-migration`. Esto es consistente con el hallazgo ya documentado en `docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md`: `marts.fieldbeat_working_hours_analysis` (la tabla que ya trae `confidence_score` precalculado por fila) no tiene builder en esta branch -los valores que la app lee y agrega en runtime son un snapshot heredado, no algo que este commit sepa recalcular desde cero.

Confianza observada en runtime hoy: KPI 1-4 (`totalHours`, `businessHours`, `afterHoursHours`, `afterHoursRate`) = 79.3 ("Media"); KPI 5 (`tasksWithAfterHours`) = 79.8 ("Media"); KPI 6 (`tasksNotCalculable`) = 95 ("Alta", fija salvo penalización). LOCAL_RUNTIME confirmado.

## Números de alcance (GOLD v1) -granularidad, fuente, fecha

| Métrica | Valor (STATIC_DOC) | Valor (LOCAL_RUNTIME, esta sesión) | Fuente | Fecha de actualización |
|---|---|---|---|---|
| `total_zendesk_tickets` | 628 | 628 (`totalTickets` en `/api/dashboard/operacional/summary`) | `data/reports/scope_reconciliation_summary.json`; `docs/SCOPE_AND_LIMITATIONS.md:9` | DESCONOCIDA -sin timestamp visible en la respuesta ni en el doc |
| `total_fieldbeat_tasks` | 3747 | 3747 (`totalRegistros`) | ídem, línea 10 | DESCONOCIDA |
| `used_parts_in_ticket_mart` / `_global` | 200 / 2193 | 2193 (`repuestosUsados`, universo global) | ídem, líneas 15-17 | DESCONOCIDA |
| `tickets_failed_by_error_403` | 291 | 291 (`ticketsForbiddenPending`) | `data/reports/zendesk_ticket_ids_not_accessible_403.json` | DESCONOCIDA |
| `pctConTicketAccesible` | No documentado estáticamente como %, solo como conteo | **7.74%** (calculado en runtime, `/api/dashboard/operacional/summary`) | Derivado de los conteos anteriores | DESCONOCIDA |

**Granularidad:** todas estas cifras son snapshot de una sola corrida de pipeline ("congelados a la fecha de este build", `docs/SCOPE_AND_LIMITATIONS.md:5`), no series temporales con fecha de corte explícita almacenada junto al dato.

## Estado de disponibilidad de metadatos de métrica -hueco confirmado

`docs/GOLD_DATA_CONTRACT.md` documenta la forma (columnas, granularidad, uso BI recomendado) de las 6 tablas GOLD principales, pero:

- AUSENCIA CONFIRMADA de lenguaje de frescura/SLA/responsable · comando: `grep -niE "frescura|sla|responsable|owner|actualiza|frecuencia" docs/GOLD_DATA_CONTRACT.md` → sin coincidencias · commit `4a3d055`.
- Ninguna tabla GOLD ni ninguna respuesta API trae un campo `updated_at`/`generated_at` visible al usuario final (existe `generated_at` en `data/reports/gold_build_summary.json`, pero ese reporte no se sirve por ninguna ruta API -STATIC_CODE, cero referencias a `gold_build_summary` en `apps/nexus-bi-app`).

**Estado de disponibilidad: DESCONOCIDA** para "fecha de actualización" y "responsable" en las 6 métricas/tablas GOLD principales -no es un vacío de lectura, es una ausencia real en el contrato documentado y en la API.

## Fuentes

`apps/nexus-bi-app/components/ui/StatusBadge.tsx`, `lib/confidence.ts`, `app/api/dashboard/after-hours/summary/route.ts`, `docs/GOLD_DATA_CONTRACT.md`, `docs/SCOPE_AND_LIMITATIONS.md`, `docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md`, `git show 7e69d7c:src/lib/calculation-confidence.js` (GIT_HISTORY), sondeo LOCAL_RUNTIME de esta sesión.
