# ADR 0001 — Un solo orquestador, dos ejecutores (worker local + GitHub Actions)

Fecha: 2026-07-31
Estado: Aceptada

## Contexto

NEXUS V3 necesita un mecanismo para solicitar manualmente una actualización de datos desde FieldBeat/Zendesk/Dolibarr, que funcione tanto en la máquina de desarrollo local (`LOCAL`) como contra entornos remotos (`STAGING`/`PRODUCTION`, cuando existan). El encargo es explícito: **nunca dos pipelines separados** — la lógica de extracción/normalización/cruce/GOLD/sincronización/validación/reevaluación de reglas debe vivir en un solo lugar, sin importar quién la dispare.

## Decisión

- `scripts/pipeline/run-data-refresh.mjs` es el **único** orquestador. Reclama la próxima corrida `QUEUED` (`pipeline.fn_claim_next_refresh_run`, `FOR UPDATE SKIP LOCKED`) y ejecuta las 10 etapas siempre en el mismo orden, actualizando `pipeline.refresh_runs`/`refresh_run_stages` en cada paso.
- Dos ejecutores lo invocan, nunca lo reimplementan:
  - `scripts/pipeline/local-refresh-worker.mjs` — un loop de polling en la máquina local, exclusivo de `environment=LOCAL`. Rechaza arrancar si `SUPABASE_DB_URL_DIRECT` apunta a un host Supabase cloud (nunca debe poder procesar STAGING/PRODUCTION).
  - `.github/workflows/data-refresh.yml` — un job de `workflow_dispatch` manual (nunca automático) que corre el mismo script con `--start` (crea + reclama + ejecuta en un solo paso), exclusivo de `STAGING`/`PRODUCTION`.
- La API de Next.js (`POST /api/data-refresh/runs`) solo **encola** (`pipeline.fn_start_refresh_run`) — nunca ejecuta el pipeline dentro del request HTTP. Esto es deliberado: el requisito explícito era "nunca síncrono en un request", y una corrida completa (extracción de 3 APIs externas + sincronización a Postgres) puede tardar minutos, muy por encima de cualquier timeout razonable de función serverless.
- Reutiliza módulos reales sin reimplementarlos: los 3 miners (`src/miners/{fieldbeat-all,zendesk,dolibarr}.js`) se importan directo (exportan una función async); los 9 normalizadores/mart-builders/gold-builders son CLI-only sin export (auto-invocación al importar) y se ejecutan vía `spawnSync`, igual que el precedente ya establecido en `scripts/import-after-hours-pipeline.mjs`.
- `governance.fn_run_rule_evaluation` (el motor de reglas, "Cerberus") siempre se llama con `scope_mode='FULL'`, sin importar si el refresh es `INCREMENTAL` o `FULL` — esa función todavía no soporta un scope incremental (`RAISE EXCEPTION` explícito en `sql/090_governance_functions.sql` si se intenta), y el modo del refresh describe cuánta data fuente se re-extrae, no cuántas reglas se reevalúan.

## Alternativas consideradas

- **Un runner distinto para GitHub Actions (lógica en YAML).** Rechazada: duplicaría la secuencia de 10 etapas en dos lenguajes/lugares, exactamente lo que el encargo prohíbe explícitamente ("nunca dos pipelines separados").
- **La API ejecuta el refresh directamente (sin worker).** Rechazada: viola "nunca síncrono en un request HTTP" y ataría la duración de una función serverless a la de todo el pipeline (minutos, no segundos).
- **Un solo "modo" que detecta automáticamente si está en GitHub Actions o local.** Rechazada a favor de flags explícitos (`--executor-type=LOCAL|GITHUB`, `--environment=`) — más simple de razonar y de testear que detección implícita por variables de entorno de CI.

## Consecuencias

- Cualquier cambio a una etapa del pipeline (ej. agregar una fuente nueva) se hace en un solo archivo y automáticamente aplica a ambos ejecutores.
- El worker local requiere un proceso aparte corriendo (`npm run pipeline:refresh:worker:local`) para que una corrida encolada desde la UI avance — documentado en [../data-refresh-runbook.md](../data-refresh-runbook.md) §3.
- No hay reaper automático de corridas colgadas si un worker muere sin capturar la señal de terminación — brecha operativa conocida, documentada en el runbook §6, no implementada en este corte.
- La etapa `BUILD_WORKING_HOURS` (módulo After-Hours) solo puede tener éxito en `environment=LOCAL` hoy: `WORKING_HOURS_DB_URL` rechaza estructuralmente cualquier host Supabase productivo (decisión previa de ETAPA 6.6B2, no de este orquestador) — para `STAGING`/`PRODUCTION` esa etapa falla con mensaje claro hasta que exista un flag/gate explícito de promoción.
