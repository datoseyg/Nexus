# Matriz de variables de despliegue

Esta matriz registra variables consumidas por el código auditado. No contiene valores reales. Los secretos se configuran en el gestor correspondiente y nunca en archivos versionados ni en `netlify.toml`.

## Aplicación local y Netlify

| Variable | Local app | Netlify Builds | Netlify Functions | Secreta | Consumidor / valor esperado |
|---|---:|---:|---:|---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Sí | Sí | Sí | No | Clientes Supabase browser/server; URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Sí | Sí | Sí | No | Publishable key pública; nunca secret/service-role key |
| `SUPABASE_DB_URL` | Sí | No | Sí | Sí | `apps/nexus-bi-app/lib/db.ts`; transaction pooler `:6543`, rol `nexus_app` |
| `DATABASE_SSL_MODE` | Opcional | No | Sí | No | `verify-full` (verificación estricta de certificado + hostname) para remoto - también el default si se omite; `disable` solo contra `localhost`/`127.0.0.1`/`::1` |
| `DATABASE_SSL_CA_B64` | Opcional (local) | No | Sí | Sí | Obligatoria bajo `DATABASE_SSL_MODE=verify-full`; PEM de la CA raíz (ej. Supabase) en base64, server-only |
| `NEXUS_AUTH_GERENCIA_EMAIL` | Sí | No | Sí | Sensible | Resolución server-only de `GERENCIA` |
| `NEXUS_AUTH_ADMINISTRACION_EMAIL` | Sí | No | Sí | Sensible | Resolución server-only de `ADMINISTRACION` |
| `NEXUS_ADMIN_TOKEN` | Si se prueban APIs admin | No | Sí | Sí | Header técnico de `/api/admin/**`; no es la sesión de usuario |
| `NEXUS_SHOW_AUDIT` | Opcional | No | Sí | No | `false` en primera liberación |
| `NEXUS_SHOW_EXPLORER` | Opcional | No | Sí | No | `false` en primera liberación |
| `NODE_ENV` | Automática | Automática | Automática | No | Next/Node; no configurar como credencial |
| `GOVERNANCE_PIPELINE_REQUESTER_DB_URL` | Sí | No | Sí | Sí | NEXUS V3 - `POST`/`GET /api/data-refresh/runs*`; rol `nexus_pipeline_requester` (`pipeline.fn_start_refresh_run` + lectura de `pipeline.refresh_runs`). A diferencia de Auditoría, `DataRefreshControl.tsx` se monta siempre en la sidebar (no está detrás de `NEXUS_SHOW_AUDIT`) - esta variable es requerida desde el primer deploy que incluya este cambio, no solo cuando Auditoría se active |
| `NEXUS_REFRESH_ENVIRONMENT` | No | No | Sí | No | NEXUS V3 - `route.ts::resolveRefreshEnvironment()`; `LOCAL`\|`STAGING`\|`PRODUCTION`. Obligatoria bajo `NODE_ENV=production` (nunca asume `LOCAL` en un deployment real - ver el comentario extenso en `route.ts`); ausente/`LOCAL` bajo `NODE_ENV=production` aborta el `POST` con error explícito |
| `GITHUB_ACTIONS_DISPATCH_TOKEN` | No | No | Sí | Sí | `lib/github-actions-dispatch.ts::dispatchDataRefreshWorkflow()`; token con permiso `actions:write` (scope `workflow` si es PAT clásico) sobre el repo, para `POST .../actions/workflows/{workflow}/dispatches`. Sin ella, el dispatch nunca llama a la API de GitHub (falla cerrado, la fila `QUEUED` igual se crea) |
| `GITHUB_ACTIONS_DISPATCH_OWNER` | No | No | Sí | No | Owner/org del repo de GitHub (ej. `datoseyg`) - arma la URL de la API |
| `GITHUB_ACTIONS_DISPATCH_REPO` | No | No | Sí | No | Nombre del repo de GitHub (ej. `Nexus`) - arma la URL de la API |
| `GITHUB_ACTIONS_DISPATCH_WORKFLOW` | No | No | Opcional | No | Default `data-refresh.yml` si se omite - nombre de archivo del workflow a disparar |
| `GITHUB_ACTIONS_DISPATCH_REF` | No | No | Opcional | No | Default `main` si se omite - branch/ref del workflow a disparar |

Notas de scope Netlify (NEXUS V3): `GOVERNANCE_PIPELINE_REQUESTER_DB_URL` solo autoriza encolar/observar corridas (`fn_start_refresh_run`, `SELECT` sobre `pipeline.refresh_runs`/`refresh_run_stages`) - nunca reclamar, avanzar etapas ni completar/fallar una corrida (eso es `GOVERNANCE_PIPELINE_WORKER_DB_URL`, exclusivo del worker local y de GitHub Actions, **nunca** en Netlify). La app desplegada nunca ejecuta el pipeline en sí, solo lo solicita. Las 5 variables `GITHUB_ACTIONS_DISPATCH_*`/`NEXUS_REFRESH_ENVIRONMENT` son las que realmente disparan `workflow_dispatch` tras crear esa fila - ver `## GitHub Actions (STAGING/PRODUCTION)` más abajo para lo que ese workflow necesita a su vez, en un Environment de GitHub completamente distinto (nunca en Netlify).

Notas de scope Netlify:

- Las dos variables `NEXT_PUBLIC_*` participan en el bundle del navegador y deben existir en Builds; también las consume el código SSR en Functions.
- `SUPABASE_DB_URL`, emails, token y flags son runtime server-side. Configurarlos en Netlify UI/CLI/API con scope Functions y contextos separados para preview/producción.
- Nunca definir `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `service_role` o equivalentes en Builds o Functions. El código desplegado no los necesita.
- No copiar variables administrativas al entorno del sitio.

## Administración de Supabase y pipeline de datos

Estas variables pertenecen a una estación/job administrativo aislado. Ninguna debe existir en Netlify.

| Variable | Consumidor | Uso / restricción |
|---|---|---|
| `SUPABASE_DB_URL_DIRECT` | migrador, validador read-only, recorder e importador de contratos | Direct IPv6 `:5432` o session pooler IPv4 `:5432`; rol administrativo. El generador DDL no la consume |
| `CONFIRM_WRITE_TARGET` | `db-safety.js` | Token exacto `host:port/database` antes de migrar o registrar validación |
| `CONFIRM_PROTECTED_WRITE_TARGET` | migrador y `db:pg:record-validation` | Segundo token exacto obligatorio para destino protegido |
| `LOAD_RAW` | `migrate-to-supabase.js` | Default `false`; `true` requiere autorización adicional por volumen/sensibilidad |
| `CONTRACTS_IMPORT_STATEMENT_TIMEOUT_MS` | cliente de contratos | Timeout opcional, default del código |
| `HOLIDAYS_DB_URL` | importador de festivos | Destino administrativo; nunca runtime Netlify |
| `HOLIDAYS_IMPORT_STATEMENT_TIMEOUT_MS` | cliente de festivos | Timeout opcional |
| `WORKING_HOURS_DB_URL` | constructor working-hours | Destino administrativo; nunca runtime Netlify |
| `WORKING_HOURS_STATEMENT_TIMEOUT_MS` | cliente working-hours | Timeout opcional |
| `USER` / `USERNAME` | auditoría de migración | Identidad de sistema registrada como actor; no reutilizar como variable de aplicación |

Antes de ejecutar una operación remota, imprimir y verificar host, puerto, base y usuario sin mostrar contraseña. Los tokens de confirmación autorizan solamente ese destino exacto; no son banderas genéricas.

## GitHub Actions (STAGING/PRODUCTION) - Environment secrets del pipeline

`.github/workflows/data-refresh.yml` (`workflow_dispatch`) resuelve el Environment de GitHub (`STAGING` o `PRODUCTION`, elegido en el input `environment`) y ejecuta `scripts/pipeline/run-data-refresh.mjs` con los secrets de ESE Environment - superficie de secretos completamente separada de Netlify (nunca reutilizar el mismo secret/nombre entre ambas; ver ADR 0001). Configurar en GitHub -> Settings -> Environments -> `STAGING`/`PRODUCTION` -> Secrets, uno por Environment.

| Variable | Consumidor | Uso / restricción |
|---|---|---|
| `SUPABASE_DB_URL_DIRECT` | `migrate-to-supabase.js` (SYNC_POSTGRES), `validate-supabase.js` (VALIDATE) | Mismo destino/rol que en la sección "Administración de Supabase" - acá es además el secret real que usa el worker automático, no solo un job manual |
| `SUPABASE_PROJECT_REF_V3` | `migrateToSupabase()`/`assertKnownSupabaseProject` | Project ref exacto del Supabase V3 de ese Environment - un secret mal configurado aborta ANTES de escribir, nunca sincroniza contra el proyecto equivocado |
| `GOVERNANCE_PIPELINE_WORKER_DB_URL` | `run-data-refresh.mjs::withPool()` (claim, heartbeat, avance de etapas, `fn_complete_refresh_run`/`fn_fail_refresh_run`) | Rol `nexus_pipeline_worker` - conexión dedicada de gobierno, nunca la misma que `_REQUESTER` (Gate B B13/B34). TLS remoto: `ssl:{rejectUnauthorized:true}`, ver `NODE_EXTRA_CA_CERTS` abajo |
| `GOVERNANCE_RULE_EVALUATOR_DB_URL` | `run-data-refresh.mjs::reevaluateRules()` (etapa REEVALUATE_RULES, `fn_run_rule_evaluation`) | Rol dedicado, mismo motivo que el de arriba |
| `WORKING_HOURS_DB_URL` | `src/working-hours/db-client.js` (etapa BUILD_WORKING_HOURS y el contract-rematch previo) | Mismo destino/rol que en la sección "Administración de Supabase" - nunca `SUPABASE_DB_URL_DIRECT`. TLS remoto: `ssl:{rejectUnauthorized:true}` (nunca `false`), ver `NODE_EXTRA_CA_CERTS` abajo |
| `SUPABASE_DB_CA_B64` | Step `Configurar CA de Supabase (NODE_EXTRA_CA_CERTS)` del workflow | PEM de la CA raíz de Supabase en base64 - **distinta variable** de `DATABASE_SSL_CA_B64` (esa es de Netlify/runtime web; puede ser el mismo material de CA, pero son secrets/superficies separadas, nunca reutilizar el nombre). Obligatoria: si falta o queda vacía, ese step falla con `exit 1` ANTES de llegar a ejecutar el orquestador (bloqueó una corrida productiva real el 2026-08-09, run `31328024412` - la corrida quedó `QUEUED` porque nunca llegó a reclamarse) |
| `FIELDBEAT_API_BASE_URL` / `FIELDBEAT_API_USER` / `FIELDBEAT_API_PASS` | `src/miners/fieldbeat-all.js` (etapa EXTRACT) | Credenciales de la API FieldBeat |
| `ZENDESK_URL` / `ZENDESK_USER` / `ZENDESK_TOKEN` | `src/miners/zendesk.js` (etapa EXTRACT) | Credenciales de la API Zendesk |
| `DOLIBARR_URL` / `DOLIBARR_TOKEN` | `src/miners/dolibarr.js` (etapa EXTRACT) | Credenciales de la API Dolibarr |

`NODE_EXTRA_CA_CERTS`: no es un secret - lo exporta el propio workflow (`$GITHUB_ENV`) a partir de `SUPABASE_DB_CA_B64`, apuntando a un archivo temporal en `$RUNNER_TEMP` que desaparece con el runner. `GOVERNANCE_PIPELINE_WORKER_DB_URL`/`GOVERNANCE_RULE_EVALUATOR_DB_URL`/`WORKING_HOURS_DB_URL` deben ser connection strings **limpias**, sin `sslmode`/`sslrootcert`/`sslcert`/`sslkey` en la query string (node-postgres los usaría para reemplazar el objeto `ssl` explícito del código - ver `src/working-hours/db-client.js`/`scripts/pipeline/run-data-refresh.mjs::withPool()`).

## Smoke y servidor local

| Variable | Consumidor | Uso |
|---|---|---|
| `BASE_URL` | `apps/nexus-bi-app/scripts/smoke.mjs` | URL local o deploy preview a comprobar |
| `PORT` | smoke/Next local | Puerto local si `BASE_URL` no se define |
| `SMOKE_TIMEOUT_MS` | smoke | Timeout por request |

El smoke actual es anónimo y read-only. No agregar tokens administrativos ni bodies mutantes a este entorno para preview/producción.

## Integración desechable y tests

| Variable | Suite | Regla |
|---|---|---|
| `AFTER_HOURS_TEST_DATABASE_URL` | integración after-hours | Solo PostgreSQL desechable, nunca Supabase cloud |
| `AFTER_HOURS_TEST_RUN_ID` | integración after-hours | Debe coincidir con la marca `DISPOSABLE_TEST` de la corrida |
| `CONTRACTS_TEST_DATABASE_URL` | integración contratos y ownership | Solo PostgreSQL desechable |
| `CONTRACTS_TEST_RUN_ID` | integración contratos | Run ID de la marca desechable |
| `HOLIDAYS_TEST_DATABASE_URL` | integración festivos | Solo PostgreSQL desechable |
| `HOLIDAYS_TEST_RUN_ID` | integración festivos | Run ID de la marca desechable |
| `WORKING_HOURS_TEST_DATABASE_URL` | integración working-hours | Solo PostgreSQL desechable |
| `WORKING_HOURS_TEST_RUN_ID` | integración working-hours | Run ID de la marca desechable |
| `DB_SAFETY_TEST_DATABASE_URL` | integración de guards | Destino desechable principal |
| `DB_SAFETY_PROTECTED_NAME_TEST_URL` | integración de guards | Fixture local cuyo nombre simula un target protegido; nunca una nube real |
| `DB_SAFETY_NONOWNER_TEST_URL` | integración de guards | Conexión local con rol no owner para pruebas negativas |

Durante las suites, los adaptadores pueden mapear temporalmente estas URLs a `SUPABASE_DB_URL_DIRECT`, `HOLIDAYS_DB_URL`, `WORKING_HOURS_DB_URL` o `SUPABASE_DB_URL`. Todas deben pasar por `assertDisposableTarget`; la mera presencia de una URL nunca autoriza fixtures.

## Valores por contexto de primera liberación

| Contexto | Backend/Auth | Flags | Escrituras de smoke |
|---|---|---|---|
| Local | local/mock o PostgreSQL desechable | `false` / `false` | Solo contra destino marcado desechable |
| Deploy preview (`Frontend-Rev`) | proyecto no productivo aprobado | `false` / `false` | Prohibidas |
| Producción (`main`) | proyecto productivo autorizado | `false` / `false` | Prohibidas |
