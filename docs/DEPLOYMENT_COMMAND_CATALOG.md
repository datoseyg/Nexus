# Catálogo de comandos y autorizaciones remotas

Este archivo separa comandos locales/read-only de operaciones que cambian servicios remotos. Que un comando figure aquí no autoriza ejecutarlo.

## Certificación local reproducible — PowerShell

Requiere Node.js 22+, Docker y dos terminales para el smoke. En Windows se usa `npm.cmd` para no depender de la política de ejecución de `npm.ps1`. La secuencia siguiente destruye y recrea **solo** el contenedor local desechable `nexus_bi_dev_local`; nunca usarla si ese nombre fue reutilizado para datos que deban conservarse.

Desde `apps/nexus-bi-app`, crear el clúster limpio y aplicar los 15 SQL en orden:

```powershell
npm.cmd run dev:local:teardown
npm.cmd run dev:local:setup
Set-Location ../..
$warehouseUrl='postgresql://postgres:localtest@localhost:55480/nexus_bi_dev_local_test'
$warehouseRunId=(docker exec nexus_bi_dev_local psql -U postgres -d nexus_bi_dev_local_test -Atc "SELECT replace(shobj_description(oid, 'pg_database'), 'DISPOSABLE_TEST:', '') FROM pg_database WHERE datname=current_database()").Trim()
if (-not $warehouseRunId) { throw 'No se encontró DISPOSABLE_TEST run_id' }
$sqlArgs=Get-ChildItem sql/*.sql | Sort-Object Name | ForEach-Object { "--sql=$($_.FullName)" }
function Initialize-DisposableDatabase([string]$database) {
  docker exec nexus_bi_dev_local createdb -U postgres $database
  if ($LASTEXITCODE) { throw "No se pudo crear $database" }
  $url="postgresql://postgres:localtest@localhost:55480/$database"
  $output=& node scripts/bootstrap-disposable-postgres.mjs "--url=$url" @sqlArgs
  if ($LASTEXITCODE) { throw "Falló bootstrap de $database" }
  return $output[-1].Trim()
}
$contractsRunId=Initialize-DisposableDatabase 'nexus_contracts_disposable'
$holidaysRunId=Initialize-DisposableDatabase 'nexus_holidays_disposable'
$workingRunId=Initialize-DisposableDatabase 'nexus_working_hours_disposable'
$appRunId=Initialize-DisposableDatabase 'nexus_after_hours_pipeline_disposable'
```

Ejecutar unitarias, declarar el entorno desechable y correr todas las integraciones; los runners abortan si falta URL o `RUN_ID`:

```powershell
npm.cmd run db:build
npm.cmd run db:validate
npm.cmd run contracts:test
npm.cmd run holidays:test
npm.cmd run working-hours:test
$env:CONTRACTS_TEST_DATABASE_URL='postgresql://postgres:localtest@localhost:55480/nexus_contracts_disposable'
$env:CONTRACTS_TEST_RUN_ID=$contractsRunId
$env:HOLIDAYS_TEST_DATABASE_URL='postgresql://postgres:localtest@localhost:55480/nexus_holidays_disposable'
$env:HOLIDAYS_TEST_RUN_ID=$holidaysRunId
$env:WORKING_HOURS_TEST_DATABASE_URL='postgresql://postgres:localtest@localhost:55480/nexus_working_hours_disposable'
$env:WORKING_HOURS_TEST_RUN_ID=$workingRunId
$env:SUPABASE_DB_URL_DIRECT=$warehouseUrl
$env:LOAD_RAW='false'
npm.cmd run contracts:test:integration
npm.cmd run holidays:test:integration
npm.cmd run working-hours:test:integration
npm.cmd run db:pg:build
npm.cmd run db:pg:build
npm.cmd run db:pg:record-validation
$env:CONTRACTS_TEST_DATABASE_URL=$env:WORKING_HOURS_TEST_DATABASE_URL
$env:CONTRACTS_TEST_RUN_ID=$env:WORKING_HOURS_TEST_RUN_ID
npm.cmd run working-hours:ownership:test
```

Ejecutar la app contra su propia base aislada y declarar explícitamente la configuración local/mock usada por build y smoke:

```powershell
$appUrl='postgresql://postgres:localtest@localhost:55480/nexus_after_hours_pipeline_disposable'
Set-Location apps/nexus-bi-app
$env:AFTER_HOURS_TEST_DATABASE_URL=$appUrl
$env:AFTER_HOURS_TEST_RUN_ID=$appRunId
$env:SUPABASE_DB_URL=$appUrl
$env:DATABASE_SSL_MODE='disable'
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:13321' # debe coincidir con supabase/config.toml
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='local-publishable-placeholder'
$env:NEXUS_AUTH_GERENCIA_EMAIL='gerencia.local@example.invalid'
$env:NEXUS_AUTH_ADMINISTRACION_EMAIL='administracion.local@example.invalid'
$env:NEXUS_SHOW_AUDIT='false'
$env:NEXUS_SHOW_EXPLORER='false'
npm.cmd test
npm.cmd run test:integration
npm.cmd run test:integration
npm.cmd run typecheck
npm.cmd run build
```

Para smoke, en la primera terminal ejecutar `npm.cmd start -- --port 3108` con el mismo bloque de variables; en otra, desde la app:

```powershell
$env:BASE_URL='http://localhost:3108'
npm.cmd run smoke
```

La aceptación exige `0 fail` y `0 skipped` en cada comando `:integration`, ambas cadenas `db:pg:build` verdes y smoke 5/5. Al terminar puede retirarse el clúster con `npm.cmd run dev:local:teardown` desde la app.

Git/diff read-only:

```powershell
git status --short
git branch --show-current
git rev-parse HEAD
git rev-list --left-right --count main...Frontend-Rev
git diff --check
git diff --stat
```

No ejecutar Graphify como parte de esta certificación.

## Comandos administrativos que podrán ejecutarse posteriormente

### Regenerar DDL desde DuckDB

```powershell
npm run db:pg:ddl
```

Es local, pero sobrescribe `sql/010_processed.sql`, `020_marts.sql` y `030_gold.sql`. Requiere revisión de diff y un warehouse candidato reproducible.

### Aplicar el DDL completo — no autorizado ahora

Con `psql` instalado y una URL administrativa ya aprobada, la secuencia exacta es:

```powershell
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/000_roles_and_schemas.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/005_raw.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/010_processed.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/020_marts.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/030_gold.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/040_audit.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/050_manual_review.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/060_stock.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/070_config.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/080_holiday_calendar.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/081_working_hours_contract_marts.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/082_working_hours_analysis_current_view.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/083_holiday_calendar_import_support.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/084_contract_valid_from_correction.sql
psql "$env:SUPABASE_DB_URL_DIRECT" -v ON_ERROR_STOP=1 -f sql/085_contract_version_revision_uniqueness.sql
```

Ejecutar uno por uno, conservar cada salida y detenerse en el primer error. Esta lista no sustituye backup, catálogo previo, revisión de `085` ni autorización por destino.

### Migrar a Supabase — no autorizado ahora

Después de aprobar el destino y definir ambos tokens exactos:

```powershell
$env:SUPABASE_DB_URL_DIRECT='<direct-o-session-pooler-admin>'
$env:CONFIRM_WRITE_TARGET='<host>:<port>/<database>'
$env:CONFIRM_PROTECTED_WRITE_TARGET='<host>:<port>/<database>'
$env:LOAD_RAW='false'
npm run db:pg:migrate
```

No incluir valores reales en tickets, documentación o logs. La conexión directa usa `:5432` e IPv6; el fallback administrativo IPv4 usa session pooler `:5432`.

### Validar PostgreSQL/Supabase — read-only, conexión remota aún no autorizada

```powershell
npm run db:pg:validate
```

El comando respeta el ownership manifest, abre DuckDB y el attach PostgreSQL en modo read-only, genera solo el reporte JSON local y no modifica `audit.warehouse_sync_state`. Conectarlo a Supabase sigue requiriendo autorización explícita, aunque sea read-only.

El registro opcional es un comando distinto y declara que escribe:

```powershell
npm run db:pg:record-validation
```

En un host Supabase exige simultáneamente `CONFIRM_WRITE_TARGET` y `CONFIRM_PROTECTED_WRITE_TARGET`, ambos iguales al token exacto `<host>:<port>/<database>`. No forma parte de `db:pg:build` y no debe ejecutarse desde Netlify.

### Cadena completa — certificada localmente; remota no autorizada

```powershell
npm run db:pg:build
```

Regenera DDL de forma idempotente, carga staging y reemplaza transaccionalmente solo objetos `DUCKDB_SYNC`, y valida read-only. Fue ejecutada dos veces contra PostgreSQL 16 desechable con `LOAD_RAW=false`. No debe utilizarse como atajo remoto: DDL, migración y conexión de validación requieren autorizaciones separadas por destino.

## Equivalentes para Git Bash

La misma certificación, comenzando por un contenedor limpio:

```bash
set -euo pipefail
cd apps/nexus-bi-app
npm run dev:local:teardown
npm run dev:local:setup
cd ../..
WAREHOUSE_URL='postgresql://postgres:localtest@localhost:55480/nexus_bi_dev_local_test'
WAREHOUSE_RUN_ID=$(docker exec nexus_bi_dev_local psql -U postgres -d nexus_bi_dev_local_test -Atc "SELECT replace(shobj_description(oid, 'pg_database'), 'DISPOSABLE_TEST:', '') FROM pg_database WHERE datname=current_database()")
test -n "$WAREHOUSE_RUN_ID"
SQL_ARGS=()
while IFS= read -r file; do SQL_ARGS+=("--sql=$file"); done < <(find sql -maxdepth 1 -name '*.sql' -print | sort)
initialize_disposable_database() {
  local database="$1"
  docker exec nexus_bi_dev_local createdb -U postgres "$database"
  node scripts/bootstrap-disposable-postgres.mjs "--url=postgresql://postgres:localtest@localhost:55480/$database" "${SQL_ARGS[@]}" | tail -n 1
}
CONTRACTS_RUN_ID=$(initialize_disposable_database nexus_contracts_disposable)
HOLIDAYS_RUN_ID=$(initialize_disposable_database nexus_holidays_disposable)
WORKING_RUN_ID=$(initialize_disposable_database nexus_working_hours_disposable)
APP_RUN_ID=$(initialize_disposable_database nexus_after_hours_pipeline_disposable)
test -n "$CONTRACTS_RUN_ID" && test -n "$HOLIDAYS_RUN_ID" && test -n "$WORKING_RUN_ID" && test -n "$APP_RUN_ID"
npm run db:build
npm run db:validate
npm run contracts:test
npm run holidays:test
npm run working-hours:test
export CONTRACTS_TEST_DATABASE_URL='postgresql://postgres:localtest@localhost:55480/nexus_contracts_disposable'
export CONTRACTS_TEST_RUN_ID="$CONTRACTS_RUN_ID"
export HOLIDAYS_TEST_DATABASE_URL='postgresql://postgres:localtest@localhost:55480/nexus_holidays_disposable'
export HOLIDAYS_TEST_RUN_ID="$HOLIDAYS_RUN_ID"
export WORKING_HOURS_TEST_DATABASE_URL='postgresql://postgres:localtest@localhost:55480/nexus_working_hours_disposable'
export WORKING_HOURS_TEST_RUN_ID="$WORKING_RUN_ID"
export SUPABASE_DB_URL_DIRECT="$WAREHOUSE_URL"
export LOAD_RAW=false
npm run contracts:test:integration
npm run holidays:test:integration
npm run working-hours:test:integration
npm run db:pg:build
npm run db:pg:build
npm run db:pg:record-validation
export CONTRACTS_TEST_DATABASE_URL="$WORKING_HOURS_TEST_DATABASE_URL"
export CONTRACTS_TEST_RUN_ID="$WORKING_HOURS_TEST_RUN_ID"
npm run working-hours:ownership:test
```

Crear y bootstrapear la base aislada de la app:

```bash
APP_URL='postgresql://postgres:localtest@localhost:55480/nexus_after_hours_pipeline_disposable'
cd apps/nexus-bi-app
export AFTER_HOURS_TEST_DATABASE_URL="$APP_URL"
export AFTER_HOURS_TEST_RUN_ID="$APP_RUN_ID"
export SUPABASE_DB_URL="$APP_URL"
export DATABASE_SSL_MODE=disable
export NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:13321' # debe coincidir con supabase/config.toml
export NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='local-publishable-placeholder'
export NEXUS_AUTH_GERENCIA_EMAIL='gerencia.local@example.invalid'
export NEXUS_AUTH_ADMINISTRACION_EMAIL='administracion.local@example.invalid'
export NEXUS_SHOW_AUDIT=false
export NEXUS_SHOW_EXPLORER=false
npm test
npm run test:integration
npm run test:integration
npm run typecheck
npm run build
```

Levantar `npm start -- --port 3108` en una terminal con esas variables y ejecutar `BASE_URL='http://localhost:3108' npm run smoke` en otra. El criterio de aceptación es idéntico al de PowerShell; `set -o pipefail` evita que `tail` oculte un fallo del bootstrap.

Diff read-only:

```bash
git status --short
git diff --check
git diff --stat
```

### Importadores administrativos — no autorizados ahora

```powershell
npm run contracts:import -- --file=PATH_TO_CONTRACTS_CSV --effective-date=YYYY-MM-DD --apply
npm run holidays:import -- apply --file=PATH_TO_HOLIDAYS_JSON --confirm
npm run working-hours:build -- apply --from=YYYY-MM-DD --to=YYYY-MM-DD --confirm
```

`contracts:import` reutiliza `SUPABASE_DB_URL_DIRECT`; festivos y working-hours usan variables aisladas. Los tres llaman guards que, en el código actual, no habilitan doble confirmación para Supabase protegido; working-hours además rechaza estructuralmente hosts Supabase. Ninguno puede promoverse a Supabase cambiando solo una variable: requiere cambio de diseño probado y autorización propios.

## Operaciones remotas que requieren autorización explícita

Las siguientes operaciones se autorizan por separado; aprobar una no autoriza las demás:

1. Crear un proyecto Supabase o modificar configuración/billing.
2. Consultar read-only el catálogo o datos del proyecto antiguo si se entregan credenciales administrativas.
3. Crear backup/snapshot o probar una restauración.
4. Ejecutar cualquiera de los 15 archivos SQL, incluso si usa `IF NOT EXISTS`.
5. Crear/alterar el rol `nexus_app`, su contraseña, grants o default privileges.
6. Ejecutar `TRUNCATE`, migración, cargas RAW o cualquier INSERT/UPDATE/DELETE remoto.
7. Conectar el validador read-only a Supabase, aun cuando no escriba.
8. Ejecutar `db:pg:record-validation`, que sí actualiza auditoría y exige doble confirmación.
9. Ejecutar importaciones de contratos, festivos o working-hours sobre un destino compartido.
10. Cambiar Exposed schemas, Auth settings o redirect URLs en Supabase.
11. Crear, bloquear, borrar o modificar cuentas GERENCIA/ADMINISTRACION y sus claims.
12. Conectar el repositorio a Netlify, crear el sitio o editar variables/secrets.
13. Lanzar deploy preview desde `Frontend-Rev`.
14. Fusionar/promover `Frontend-Rev` a `main`.
15. Desplegar o hacer rollback de producción.
16. Rotar/eliminar credenciales remotas.

## Operaciones explícitamente prohibidas

- Guardar `service_role`, secret key o una URL administrativa en Netlify.
- Ejecutar migraciones durante `next build` o desde una Function.
- Usar transaction pooler `:6543` para DDL/migración.
- Usar conexión directa/session pooler como runtime serverless.
- Ejecutar un smoke mutante en preview o producción.
- Poner `LOAD_RAW=true` por conveniencia.
- Reintentar un fallo sobre producción con `TRUNCATE` o DDL sin diagnóstico, backup y nueva autorización.
