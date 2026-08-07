# Runbook — Actualización manual de datos (NEXUS V3)

Estado de este documento: creado junto con la implementación (`sql/101_pipeline_refresh_runs.sql`, `scripts/pipeline/*`, `.github/workflows/data-refresh.yml`). El workflow de GitHub Actions descrito acá **nunca fue disparado** durante el desarrollo — no existe todavía un proyecto Supabase V3 real para STAGING/PRODUCTION (ver informe de cierre de la tarea). Todo lo verificado en esta etapa corrió contra PostgreSQL local desechable.

## 1. Qué es y qué no es

Un mecanismo para **solicitar explícitamente** una actualización de datos desde FieldBeat, Zendesk y Dolibarr — nunca automático, nunca disparado por el login, nunca síncrono dentro de un request HTTP. Una solicitud crea una fila `QUEUED` en `pipeline.refresh_runs`; un worker (local o GitHub Actions) la reclama y la procesa en segundo plano.

Un solo orquestador real (`scripts/pipeline/run-data-refresh.mjs`) ejecuta las mismas 10 etapas sin importar quién lo invoque:

```
EXTRACT -> NORMALIZE -> BUILD_MARTS -> BUILD_GOLD -> SYNC_POSTGRES ->
BUILD_WORKING_HOURS -> VALIDATE_AFTER_HOURS -> VALIDATE -> REEVALUATE_RULES -> PUBLISH_SNAPSHOT
```

Cualquier falla detiene el resto de inmediato (`pipeline.fn_fail_refresh_run`) — un snapshot ya publicado y sano **nunca** se reemplaza por una carga incompleta; `PUBLISH_SNAPSHOT` (que mueve `pipeline.published_dataset_state`) solo se alcanza si las 9 etapas anteriores terminaron bien.

"Reevaluar reglas" (etapa `REEVALUATE_RULES`) es la misma llamada a `governance.fn_run_rule_evaluation('FULL', ..., 'DATA_REFRESH_PUBLISH')` que ya usa el resto del sistema de gobierno — no es un sistema aparte ("Cerberus" es el nombre conceptual de ese mismo motor). Siempre corre en modo `FULL`, sin importar si el refresh es `INCREMENTAL` o `FULL`: ese modo describe cuánta data fuente se re-extrae, no cuántas reglas se reevalúan (`fn_run_rule_evaluation` todavía no soporta un `scope_mode` incremental).

**`BUILD_WORKING_HOURS`/`VALIDATE_AFTER_HOURS` (módulo After-Hours).** `BUILD_WORKING_HOURS` invoca `src/working-hours/build-working-hours.js::runApply` — el mismo mecanismo real que `npm run working-hours:build -- apply --confirm`, nunca reimplementado — para recalcular `marts.fieldbeat_working_hours_analysis_v2`/`_equipment_links`/`_contract_coverage_segments` desde `processed.fieldbeat_tasks` (ya sincronizado por `SYNC_POSTGRES`). Antes del cálculo reevalúa de forma append-only los matches contractuales actuales contra el inventario FieldBeat recién sincronizado. Luego publica mediante `UPSERT` transaccional por tarea/equipo, sin truncar tablas persistentes. Siempre corre sobre la población completa (`{from:null,to:null}`) para que cambios de contratos, matches o calendarios reevaluúen también tareas existentes. `VALIDATE_AFTER_HOURS` verifica (solo lectura, nunca reimporta) que exista cobertura de feriados `VALIDATED` para cada año presente en las tareas procesadas — si falta un año, la corrida falla con un mensaje explícito en vez de publicar tareas con horas fuera de jornada mal calculadas.

Las tablas `gold.after_hours_by_client/by_period/by_task_type/by_technician/work_analysis` **no** se tocan en esta etapa ni en ninguna otra: son snapshots congelados sin generador vigente en esta rama (ver `docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md`). Los endpoints reales de `/dashboard/after-hours` consultan la vista `marts.fieldbeat_working_hours_analysis_current` (`sql/082_working_hours_analysis_current_view.sql`), que resuelve en vivo sobre `processed.fieldbeat_tasks` y `marts.fieldbeat_working_hours_analysis_v2` — no hace falta una etapa GOLD adicional para After-Hours.

**Solo funciona hoy para `environment=LOCAL`.** `WORKING_HOURS_DB_URL` (conexión propia del builder, distinta de `SUPABASE_DB_URL_DIRECT`) rechaza estructuralmente cualquier host reconocido como Supabase productivo (`src/working-hours/db-client.js::assertNotProductionHost`, decisión deliberada de ETAPA 6.6B2). Hasta que exista un flag/gate explícito para promover este builder a STAGING/PRODUCTION, `BUILD_WORKING_HOURS` fallará esa etapa puntual en esos entornos con un mensaje claro — nunca se salta el módulo en silencio.

## 2. Dos ejecutores, un solo orquestador

| Entorno | Quién procesa | Cómo se dispara |
|---|---|---|
| `LOCAL` | `scripts/pipeline/local-refresh-worker.mjs` (loop de polling en la máquina de desarrollo) | Botón "Actualizar ahora" / "Actualización completa (FULL)" en la sidebar de la app (`DataRefreshControl.tsx`), que solo encola (`POST /api/data-refresh/runs`) — el worker debe estar corriendo aparte (`npm run pipeline:refresh:worker:local`) para que la corrida encolada avance. |
| `STAGING` / `PRODUCTION` | `.github/workflows/data-refresh.yml` (`workflow_dispatch`, un solo job) | Manual desde la pestaña **Actions** del repo en GitHub — una persona con permiso de escritura llena `environment`/`mode`/`confirmed`/`reason` y ejecuta. Este job encola y procesa su propia corrida en el mismo paso (`--start`), no depende de que la UI de Next.js haya creado nada antes. |

La UI de Next.js (`DataRefreshControl.tsx`) **solo expone `LOCAL`** a propósito: STAGING/PRODUCTION no tienen todavía un proyecto Supabase V3 real, y crear ahí una corrida `QUEUED` que nadie fuera a procesar habría sido engañoso. Cuando esos entornos existan, STAGING/PRODUCTION se disparan siempre desde GitHub Actions, nunca desde la app.

## 3. Cómo correr el worker local

```bash
npm run pipeline:refresh:worker:local
# o con intervalo de polling propio:
node scripts/pipeline/local-refresh-worker.mjs --poll-interval-ms=5000
# una sola pasada (sin loop), útil para depurar:
node scripts/pipeline/local-refresh-worker.mjs --once
```

Variables de entorno requeridas (ver `.env.development.local`, generadas por `scripts/set-local-governance-role-passwords.mjs`): `GOVERNANCE_PIPELINE_WORKER_DB_URL`, `GOVERNANCE_RULE_EVALUATOR_DB_URL`, `SUPABASE_DB_URL_DIRECT` (debe apuntar a Postgres local — el worker aborta si detecta un host Supabase cloud, ver `local-refresh-worker.mjs`), más las credenciales de FieldBeat/Zendesk/Dolibarr del `.env` raíz.

El worker reclama con `SELECT/UPDATE ... FOR UPDATE SKIP LOCKED` (`pipeline.fn_claim_next_refresh_run`) — solo puede haber una corrida activa (`QUEUED`/`CLAIMED`/`RUNNING`) por entorno a la vez (índice único parcial `refresh_runs_one_active_per_environment`), así que encolar una segunda mientras la primera sigue en curso devuelve `ALREADY_RUNNING` en vez de crear una corrida nueva.

`SIGINT`/`SIGTERM` (Ctrl+C) hacen que el worker termine la corrida que ya reclamó (best-effort) y no reclame una nueva — no se saltan pasos ni se deja una corrida abandonada en `RUNNING` sin haber intentado cerrarla primero.

## 4. Cómo dispatchear el workflow de GitHub Actions

Requisitos previos (una sola vez, manual, fuera del alcance de esta tarea):

1. Crear los **Environments** de GitHub `STAGING` y `PRODUCTION` (Settings → Environments). El job usa `environment: ${{ inputs.environment }}`, así que cada Environment resuelve sus propios secretos automáticamente sin lógica adicional en el YAML. `PRODUCTION` puede configurarse con "required reviewers" para exigir una aprobación humana adicional antes de que el job corra, aunque el dispatch ya se haya disparado.
2. Cargar en cada Environment: `FIELDBEAT_API_BASE_URL`, `FIELDBEAT_API_USER`, `FIELDBEAT_API_PASS`, `ZENDESK_URL`, `ZENDESK_USER`, `ZENDESK_TOKEN`, `DOLIBARR_URL`, `DOLIBARR_TOKEN`, `SUPABASE_DB_URL_DIRECT`, `SUPABASE_PROJECT_REF_V3`, `GOVERNANCE_PIPELINE_REQUESTER_DB_URL`, `GOVERNANCE_PIPELINE_WORKER_DB_URL`, `GOVERNANCE_RULE_EVALUATOR_DB_URL`.

   `CONFIRM_WRITE_TARGET`/`CONFIRM_PROTECTED_WRITE_TARGET` **no** son secretos del workflow: el orquestador los calcula él mismo a partir de `SUPABASE_DB_URL_DIRECT` (`buildWriteConfirmationToken`) justo antes de escribir — ver `prepareSupabaseWriteConfirmation` en `run-data-refresh.mjs`.

3. Dispatch: pestaña **Actions** → "Actualización manual de datos (NEXUS V3)" → *Run workflow* → elegir `environment`, `mode`, `confirmed` (solo relevante si `mode=FULL`; el orquestador rechaza con `CONFIRMATION_REQUIRED` un `FULL` sin confirmar) y `reason`.

`concurrency: { group: data-refresh-<environment>, cancel-in-progress: false }` evita dos jobs simultáneos sobre el mismo entorno — un segundo dispatch mientras el primero sigue corriendo queda en cola de GitHub Actions, no cancela al que ya está corriendo.

## 5. Cómo leer el estado

`GET /api/data-refresh/runs?environment=LOCAL` (usado por `DataRefreshControl.tsx`) devuelve las últimas corridas; `GET /api/data-refresh/runs/<id>` da el detalle completo, incluidas las etapas (`pipeline.refresh_run_stages`). Ambos requieren la capacidad `data:refresh:observe` (hoy: `gerencia` y `administracion`, idénticas tras `sql/100_role_capabilities_unification.sql`).

| `status` | Significado |
|---|---|
| `QUEUED` | Encolada, esperando que un worker la reclame. |
| `CLAIMED` | Un worker la tomó pero todavía no reportó la primera etapa. |
| `RUNNING` | En curso — `current_stage` indica en cuál de las 10 etapas está, `last_heartbeat_at` se actualiza cada 15s mientras avanza. |
| `SUCCEEDED` | Las 10 etapas terminaron bien; `pipeline.published_dataset_state` del entorno ya apunta a este `refresh_run_id`. |
| `FAILED` | Falló antes de tocar Postgres (`EXTRACT`/`NORMALIZE`/`BUILD_MARTS`/`BUILD_GOLD`) — el snapshot publicado no cambió. |
| `PARTIAL_FAILED` | Falló en `SYNC_POSTGRES` en adelante — puede haber quedado una sincronización parcial en el warehouse remoto, pero `pipeline.published_dataset_state` **no** se movió (la publicación es la última etapa). Revisar `error_summary` y considerar reintentar. |
| `CANCELLED` / `SUPERSEDED` | Reservados para uso futuro (cancelación manual / reemplazo explícito) — ninguna función de `sql/101` los produce todavía. |

## 6. Brechas operativas conocidas (documentadas, no implementadas en este corte)

- **Sin reaper automático de corridas colgadas.** Si un worker muere sin capturar `SIGINT`/`SIGTERM` (kill -9, corte de energía, OOM), la fila queda en `RUNNING` con `last_heartbeat_at` congelado. No hay un proceso que la marque `FAILED` automáticamente por heartbeat vencido — un operador debe detectarlo (heartbeat viejo + entorno bloqueado por el índice único parcial) y correr manualmente `SELECT pipeline.fn_fail_refresh_run(...)` con el rol `nexus_pipeline_worker` para liberar el entorno.
- **`CANCELLED` no tiene UI ni función dedicada.** El valor existe en el `CHECK` de `status` para uso futuro; cancelar una corrida en curso hoy requiere intervención manual directa en la base.
- **El botón FULL de la UI solo cubre `LOCAL`.** Un FULL en STAGING/PRODUCTION solo se dispara desde GitHub Actions (sección 4).
