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

Notas de scope Netlify (NEXUS V3): `GOVERNANCE_PIPELINE_REQUESTER_DB_URL` solo autoriza encolar/observar corridas (`fn_start_refresh_run`, `SELECT` sobre `pipeline.refresh_runs`/`refresh_run_stages`) - nunca reclamar, avanzar etapas ni completar/fallar una corrida (eso es `GOVERNANCE_PIPELINE_WORKER_DB_URL`, exclusivo del worker local y de GitHub Actions, **nunca** en Netlify). La app desplegada nunca ejecuta el pipeline en sí, solo lo solicita.

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
