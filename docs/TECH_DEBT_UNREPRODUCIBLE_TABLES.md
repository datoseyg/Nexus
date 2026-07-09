# Deuda técnica — tablas del warehouse sin generador en esta rama

`data/warehouse/eyg_nexus.duckdb` tiene **40 tablas**, no las 26 documentadas en [SQL_WAREHOUSE.md](SQL_WAREHOUSE.md) (inspección directa vía `information_schema.tables`, solo lectura). 14 de esas 40 no tienen script generador ni en `src/` de esta rama (`main`/`supabase-migration`) ni en `src/db/warehouse-config.js`. Esto se descubrió auditando el proyecto antes de migrar a Supabase — ver [ARCHITECTURE.md § Legacy: Cloudflare](ARCHITECTURE.md#legacy-cloudflare) para el contexto completo de por qué hay código relevante en otras ramas del repo.

**Importante:** "sin generador en esta rama" no significa "perdido". El repo tiene un remoto real (`github.com/datoseyg/Nexus.git`) con ramas `cloudflare-migration`, `cloud-d1-readonly` y `cloud-smoke-test` que muy probablemente contienen el código fuente de varias de estas tablas — simplemente nunca se mergearon a `main`. Ver la columna "¿Existe en otra rama?" de cada fila.

Estas 14 tablas se migran a Postgres igual que las otras 26 (son datos reales y algunas están en uso activo) — este documento existe para que nadie asuma que todo lo que aparece en el Postgres resultante corresponde a una feature terminada y mantenida en `main`.

## Tabla de hallazgos

| Tabla | Consumida por (rutas/componentes reales en `main`/`supabase-migration`) | Script generador en esta rama | ¿Existe en otra rama? | Riesgo |
|---|---|---|---|---|
| `processed.fieldbeat_report_fields` | `app/api/search/route.ts`, `app/api/tables/[schema]/[table]/route.ts` | No — falta en `warehouse-config.js` (gap de configuración, no de datos) | No hace falta — tiene CSV fuente en esta misma rama: `data/processed/fieldbeat/DB_FieldBeat_Report_Fields.csv` | **Bajo** — se arregla agregando una línea a `warehouse-config.js`; se incluye igual en el DDL autogenerado de Postgres. |
| `marts.fieldbeat_working_hours_analysis` | 7 rutas de `/api/dashboard/after-hours/*` + `lib/after-hours-filters.ts` + `components/after-hours/*` — **feature en producción, uso real y activo en esta rama** | No | **Probablemente sí** — `cloud-d1-readonly` tiene `sql/11_after_hours_overview.sql`, `src/cloud/export-d1-seed.js` y `data/reports/fieldbeat_working_hours_analysis_summary.json`, indicando un builder real en esa rama | **Medio** — no reproducible desde `supabase-migration`, pero el código fuente casi seguro existe en `cloud-d1-readonly`. Portarlo a esta rama es trabajo aparte, fuera de esta migración. Si se pierde el `.duckdb` actual sin haber portado el builder antes, el dashboard after-hours queda roto hasta que se traiga el código de la otra rama. |
| `gold.after_hours_by_client` | Ninguno en código fuente vivo de esta rama — comentario en `app/api/dashboard/after-hours/summary/route.ts` confirma que estas 5 tablas son deliberadamente "snapshot fijo tipo cookbook SQL", no usadas por rutas filtrables | No | `sql/11_after_hours_overview.sql` en `cloud-d1-readonly` es candidato a ser el origen | **Bajo-Medio** — no rompe ninguna feature activa de `main` si falta; se migra como snapshot congelado. |
| `gold.after_hours_by_period` | Ídem | No | Ídem | Ídem |
| `gold.after_hours_by_task_type` | Ídem | No | Ídem | Ídem |
| `gold.after_hours_by_technician` | Ídem | No | Ídem | Ídem |
| `gold.after_hours_work_analysis` | Ídem | No | Ídem | Ídem |
| `marts.equipment_part_lifecycle_events` | Ninguno — `app/dashboard/equipment-lifecycle` no existe en el árbol fuente de esta rama | No | **Sí** — `cloud-d1-readonly` y `cloud-smoke-test` tienen el dashboard equipment-lifecycle completo (páginas, componentes, rutas API bajo `app/api/dashboard/equipment-lifecycle/*`) y `data/reports/equipment_part_lifecycle_events_summary.json` | **Bajo-Medio** — no es una feature huérfana de verdad, es una feature real que todavía no llegó a `main`. Se migra la tabla; portar la UI/API es una decisión de producto aparte. |
| `marts.equipment_part_lifecycle_intervals` | Ninguno en esta rama | No | Mismo caso — `data/reports/equipment_part_lifecycle_intervals_summary.json` en `cloud-d1-readonly` | **Bajo-Medio** — mismo caso. |
| `gold.equipment_part_lifecycle_by_client` | Ninguno en esta rama | No | Mismo caso, consumida por el dashboard equipment-lifecycle de `cloud-d1-readonly`/`cloud-smoke-test` | **Bajo-Medio** — mismo caso. |
| `gold.equipment_part_lifecycle_by_machine` | Ídem | No | Ídem | Ídem |
| `gold.equipment_part_lifecycle_by_part` | Ídem | No | Ídem | Ídem |
| `gold.equipment_part_lifecycle_insights` | Ídem | No | Ídem | Ídem |
| `gold.equipment_part_lifecycle_summary` | Ídem | No | Ídem | Ídem |

## Conclusión operativa

- Las 14 tablas se migran a Postgres junto con las otras 26 (Fase 2 de la migración) — no se descartan.
- `fieldbeat_report_fields` es la única con arreglo trivial (falta una línea de config).
- `fieldbeat_working_hours_analysis` es la única de las 13 restantes con consumidor **activo** en `main` hoy — es la de mayor riesgo real si se pierde el `.duckdb` sin haber portado antes el builder desde `cloud-d1-readonly`.
- Las otras 12 (5 `after_hours_*` + 7 `equipment_part_lifecycle_*`) no tienen consumidor en `main` — se migran como snapshot de datos, sin que eso implique mantenimiento activo de una feature en esta rama.
- Si se decide en el futuro portar el dashboard equipment-lifecycle o reconstruir el builder de after-hours en `main`, el punto de partida es revisar `cloud-d1-readonly` (rama con más contenido de ambas features) antes de escribir código nuevo desde cero.
