# DEPLOYMENT_DELTA_REPORT

Fecha de auditoría: 2026-07-20

Alcance: repositorio local, configuración y documentación.

Exclusiones remotas: no se conectó a Supabase o Netlify, no se desplegó, no se ejecutó DDL/migración remota y no se modificaron datos ni cuentas remotas. La certificación sí ejecutó DDL, migraciones, fixtures y smoke contra PostgreSQL 16 local desechable.

## Veredicto

```text
DEPLOYMENT_RUNBOOK_REBASELINED
REMOTE_EXECUTION_PENDING_AUTHORIZATION
```

El runbook versión 1 no era seguro para ejecución con el código actual. Queda rebaselinado y el pipeline local está certificado en PostgreSQL 16 desechable. La ejecución remota sigue bloqueada hasta comparar el catálogo del destino real y obtener autorización explícita por operación y destino.

## Baseline comprobado

| Referencia | SHA | Estado observado |
|---|---|---|
| Rama auditada | `Control-Acceso` | Working tree con AUTH-P0 sin consolidar |
| `Frontend-Rev` local/origin | `6a699960ed038ae395c73057f98b515c5a667321` | Mismo HEAD que la rama auditada; baseline de preview |
| `main` local/origin | `1b57e98700ec4069a7abde75a04ccb6274236203` | Baseline de producción; 42 commits detrás de `Frontend-Rev` al auditar |

La rama `supabase-migration` fue eliminada del runbook como baseline vigente. Antes de liberar debe consolidarse AUTH-P0, volver a calcular la relación entre ramas y registrar el SHA candidato.

## Skills registradas

| Skill | Ruta | Uso concreto |
|---|---|---|
| `research` | `.agents/skills/research/SKILL.md` | Contraste en agente de background con documentación oficial de Netlify y Supabase; resultado en `docs/research/2026-07-20-deploy-rebaseline-official-sources.md` |
| `codebase-design` | `.agents/skills/codebase-design/SKILL.md` | Separó la interfaz estable del runbook de los inventarios cambiantes de SQL, variables y comandos; hizo explícitos seams, gates y errores |
| `systematic-debugging` | `.agents/skills/systematic-debugging/SKILL.md` | Trazó contradicciones desde síntoma documental hasta código: ownership, alcance del validador, guard de escritura y semántica de rutas Netlify |
| `code-review` | `.agents/skills/code-review/SKILL.md` | Revisión final paralela por Standards y Spec, con fixed point `HEAD` y alcance limitado a los artefactos de DEPLOY-REBASELINE |

## Delta: versión 1 frente al repositorio actual

| Tema | Runbook anterior | Estado comprobado / corrección |
|---|---|---|
| Ramas | `supabase-migration` | Preview `Frontend-Rev`; producción `main` |
| SQL | Ocho archivos, `000`–`060` | Quince archivos, `000`–`085`, en orden numérico exacto |
| Idempotencia | Afirmaba que todo SQL era idempotente | `085` contiene precondiciones estrictas y puede abortar por historia incompatible; cada migración exige revisión |
| Sincronización | Afirmaba que todas las tablas descubiertas recibían `TRUNCATE+INSERT` | El migrador descubre más objetos, pero solo sincroniza el inventario `DUCKDB_SYNC`; no se mantienen conteos operativos hardcodeados |
| Validación | `db:pg:build` descrito como cadena verde | Gate 1B resuelto localmente: ownership compartido, validación read-only y recorder separado; ejecución remota aún no autorizada |
| Netlify | Base y publish contradictorios | `base=apps/nexus-bi-app`, package vacío, build `npm run build`, publish `.next` relativo a base |
| Next en Netlify | Plugin explícito `@netlify/plugin-nextjs` | Retirado; integración OpenNext automática vigente |
| Conectividad | Solo conexión directa | Direct IPv6 para administración, session pooler `:5432` como fallback IPv4 y transaction pooler `:6543` para runtime serverless |
| Variables | Mezclaba local, build, runtime y administración | Matriz por superficie y scope; `service_role` prohibido en Netlify |
| Auth | No reflejaba completamente AUTH-P0 | SSR browser/server, proxy, guards centrales, identidad visible, logout y contratos 401/403 documentados |
| Smoke | Incluía un POST productivo y verificación de fila | Solo lecturas, redirects, 401/403, login/logout; ninguna mutación en preview o producción |
| Secuencia | Despliegue lineal sin gates suficientes | `local → Supabase → Auth → preview → producción`, con gates y rollback separados |

## DDL y ownership real

El orden completo está en `DEPLOYMENT_SQL_INVENTORY.md`. Los schemas Postgres definidos son `raw`, `processed`, `marts`, `gold`, `audit`, `manual_review`, `stock` y `config`. El schema DuckDB `reports` queda deliberadamente fuera; ningún schema de datos debe exponerse por PostgREST.

La frontera de ownership es la siguiente:

- `DUCKDB_SYNC`: única categoría que `migrate-to-supabase.js` puede truncar y recargar.
- `EXTERNAL`: objetos físicos o lógicos no gobernados por la sincronización; se omiten.
- `POSTGRES_BUILDER`: tablas mantenidas por builders Postgres-native; no se reemplazan desde DuckDB.
- `POSTGRES_TRANSACTIONAL`: configuración y revisión administrativa transaccional; no se sincroniza desde DuckDB.
- Las vistas Postgres-native se registran separadamente como no aplicables a la sincronización.

El generador de DDL inspecciona todas las tablas DuckDB de `processed`, `marts` y `gold`, por lo que `010`–`030` pueden declarar objetos que el migrador deliberadamente omite. Esa diferencia es válida solo si el validador también comprende ownership.

### Delta de schema conocido desde la versión 1

Aunque el catálogo remoto antiguo no fue inspeccionado, el árbol SQL actual agrega respecto del baseline `000`–`060` documentado por la versión 1:

- schema `config` con ocho tablas contractuales, tres tablas de festivos, vistas curadas, funciones e índices;
- `manual_review.contract_data_issues`;
- tres tablas `marts` Postgres-native para cobertura/working-hours, su función de cardinalidad y la vista curada `marts.fieldbeat_working_hours_analysis_current`;
- `083`: reemplazo del constraint `holiday_calendar_entries_holiday_type_check`;
- `084`: `valid_from` nullable, cinco columnas de procedencia y constraint de consistencia de vigencia;
- `085`: `superseded_at`, reemplazo del CHECK de autoridad, eliminación de unicidad histórica anterior y nuevo índice parcial `NULLS NOT DISTINCT` por equipo/período.

Los snapshots generados `010`–`030` también pueden haber cambiado desde la versión 1, pero no existe en el repositorio un catálogo remoto antiguo con el que calcular esa diferencia objeto por objeto. Debe obtenerse mediante inspección read-only autorizada; no se puede inferir aplicando el DDL actual sobre el proyecto antiguo.

## Incompatibilidades concretas

### BLOCKER 1 — RESUELTO LOCALMENTE: ownership compartido

La implementación posterior de DEPLOY-PIPELINE-FIX centralizó la clasificación en `src/db/ownership-manifest.js`. Solo `DUCKDB_SYNC` compara presencia, conteos, columnas y tipos; las demás categorías tienen contratos explícitos y los objetos desconocidos fallan con diagnóstico.

Evidencia de cierre: tests positivos/negativos y dos cadenas completas en PostgreSQL 16 desechable, documentados en `DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md`.

### BLOCKER 2 — RESUELTO LOCALMENTE: validador read-only

El validador ya no actualiza `audit.warehouse_sync_state`: abre sus fuentes read-only y genera un reporte local. El registro opcional se movió a `db:pg:record-validation`, que declara la escritura y exige doble confirmación exacta para Supabase. La prueba remota real sigue pendiente de autorización.

Evidencia de cierre: huella de auditoría sin cambios tras validar, recorder local positivo y host pooler Supabase simulado bloqueado sin ambos tokens. El guard global fue fortalecido para `.supabase.com`.

### HIGH — Proyecto versión 1 con estado desconocido

El repositorio no contiene una captura verificable del schema remoto antiguo. No puede asumirse equivalencia. Los riesgos incluyen:

- constraints o grants con drift;
- objetos antiguos que el validador trataría como extras;
- datos contractuales históricos que hacen abortar `085`;
- dependencias desconocidas que hagan abortar el swap transaccional sin `CASCADE`;
- vistas/configuración Postgres-native que no se recuperan recargando DuckDB;
- pérdida no revertible si no existe snapshot.

Gate: inventario read-only, diff de catálogo, backup y ensayo en clon/desechable antes de autorizar cualquier DDL o migración.

## Grants efectivos de `nexus_app`

El rol runtime necesita:

- `USAGE` en `raw`, `processed`, `marts`, `gold`, `audit`, `manual_review`, `stock` y `config`;
- `SELECT` en las tablas de `raw`, `processed`, `marts` y `gold`;
- `SELECT/INSERT/UPDATE/DELETE` y secuencias en `audit`, `manual_review` y `stock` para APIs administrativas;
- `SELECT` únicamente en vistas curadas de configuración (`config.contract_equipment_analysis`, `config.contract_service_window_analysis`) y `marts.fieldbeat_working_hours_analysis_current`.

Se revoca acceso directo del rol a tablas base de contratos, festivos, tablas working-hours Postgres-native, funciones administrativas y `manual_review.contract_data_issues`. Los default privileges de `000` aplican a objetos creados por el rol `postgres`; si el owner real difiere, los grants deben verificarse explícitamente.

## Netlify y protección

La app es un package independiente, no un npm workspace. La raíz se conserva como base del repositorio, pero Netlify ejecuta desde `apps/nexus-bi-app`. El runtime usa transaction pooler con `nexus_app`; los secretos de Functions se configuran fuera de `netlify.toml`.

El inventario observado contiene 39 Route Handlers:

- 29 rutas de datos con `requireReadApiAccess` y contrato `401`/`403`;
- 10 rutas administrativas con `requireAdminToken`;
- `proxy.ts` renueva sesiones y redirige páginas, pero omite `/api/admin/**` para conservar el mecanismo técnico;
- páginas privadas tienen guard server-side y el shell muestra identidad/logout.

El smoke automatizado actual es solo anónimo. El smoke autenticado sigue siendo manual y read-only hasta crear un harness seguro.

## Evidencia de pruebas por entorno

### Local con configuración local/mock

- PostgreSQL 16 local desechable, marcado con `DISPOSABLE_TEST`, con los 15 SQL aplicados en orden;
- dos ejecuciones completas consecutivas de `db:pg:build`, con DDL idempotente, migración ownership-aware y validación read-only;
- 27 objetos `DUCKDB_SYNC` sincronizados, 13 `EXTERNAL` omitidos de forma explícita y cero errores en la cadena certificada;
- tablas `POSTGRES_BUILDER` preservadas entre ambas cadenas; el validador no modificó la huella de `audit.warehouse_sync_state`;
- suites root unitarias e integraciones reales de contratos, festivos, working-hours y ownership con `0 fail` y `0 skipped` en los comandos de integración;
- app: 293 unit tests y 42 integration tests; la integración pasó dos veces consecutivas contra una segunda base desechable aislada;
- app `typecheck` y `build`: pass; smoke anónimo local 5/5 (`/login` 200, páginas privadas 307, APIs privadas 401);
- guards negativos: host Supabase/pooler simulado bloqueado antes de conectar, incluido case/trailing-dot; runners abortan si faltan URL o `RUN_ID`;
- detalles, RED/GREEN y comandos exactos en `DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md`.

### Pruebas reales contra Supabase

Ninguna. No se abrió una conexión real, no se aplicó DDL, no se migró, no se validó, no se creó Auth y no se modificaron datos remotos. El siguiente gate es inspección/diff read-only autorizado del destino real; la certificación local no demuestra compatibilidad con su drift.

### Pruebas pendientes de Netlify

- verificación del log OpenNext en deploy preview;
- scopes/contextos de variables;
- build y Functions en la plataforma;
- smoke anónimo y autenticado read-only de `Frontend-Rev`;
- promoción y smoke read-only de `main`;
- rollback de frontend.

## Code review final

Fixed point: `6a699960ed038ae395c73057f98b515c5a667321`. Scope: los ocho artefactos DEPLOY-REBASELINE; se excluyeron cambios AUTH-P0 preexistentes y archivos no relacionados.

| Eje | BLOCKER | HIGH | MEDIUM | LOW | Veredicto |
|---|---:|---:|---:|---:|---|
| Standards | 0 | 0 | 0 | 0 | PASS |
| Spec | 0 | 0 | 0 | 0 | PASS |

Los blockers del pipeline descritos en este informe son gates técnicos de una futura ejecución remota, no findings sin resolver del cambio documental. El review confirma que están identificados y bloquean correctamente los comandos correspondientes.

## Próximo permiso requerido

La próxima autorización no debe ser genérica. Debe indicar, por separado, si permite:

1. crear o inspeccionar read-only un proyecto Supabase concreto;
2. ejecutar DDL sobre un project ref concreto;
3. ejecutar migración con reemplazo transaccional sobre ese destino;
4. crear las identidades Auth;
5. configurar/deployar preview en Netlify;
6. promover `main` a producción.
