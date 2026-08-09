# DEPLOY-PIPELINE-FIX — reporte RED/GREEN y certificación local

Fecha: 2026-07-20  
Alcance: blockers locales de ownership y escritura del validador PostgreSQL.  
Restricciones respetadas: cero conexiones a Supabase, cero credenciales remotas, cero cambios Netlify, cero deploys, cero cuentas Auth, cero cambios en `main` y cero ejecuciones Graphify.

## Skills invocadas

| Skill disponible | Ruta | Uso concreto |
|---|---|---|
| `systematic-debugging` | `.agents/skills/systematic-debugging/SKILL.md` | Reproducción, aislamiento de causa raíz y diagnóstico de fallos reales de Windows, fixtures y auth. |
| `test-driven-development` | `.agents/skills/test-driven-development/SKILL.md` | Ciclos RED → GREEN → REFACTOR del manifest, validador read-only, recorder y runners. Es la equivalente disponible de `$test-driven-development`. |
| `codebase-design` | `.agents/skills/codebase-design/SKILL.md` | Un único contrato de ownership y separación entre evaluación pura, I/O read-only y escritura explícita. |
| `code-review` | `.agents/skills/code-review/SKILL.md` | Review final paralelo Standards/Spec y clasificación BLOCKER/HIGH. Es la equivalente disponible de `$eyg-nexus-local:code-review`. |

## Causa raíz confirmada

1. `validate-supabase.js` descubría todas las tablas de DuckDB/PostgreSQL y mantenía criterios propios, sin consumir el ownership manifest del migrador.
2. Los objetos desconocidos caían implícitamente en `EXTERNAL`, ocultando drift.
3. El validador abría DuckDB en escritura, llamaba al guard de escritura y actualizaba `audit.warehouse_sync_state` como efecto oculto.
4. El host protegido reconocía `.supabase.co`, pero no el session/transaction pooler `.supabase.com`.

## Evidencia TDD

### RED inicial

Comando:

```text
node --test test/db/migrate-to-supabase.ownership.test.js test/db/validate-supabase.test.js test/db/record-supabase-validation.test.js test/lib/db-safety.test.js
```

Resultado previo a la implementación: `57 tests`, `39 pass`, `16 fail`, `2 skipped`. Los fallos cubrieron categorías ausentes, clasificación silenciosa, comparación incorrecta, escritura del validador, recorder inexistente y pooler `.supabase.com` no protegido.

### GREEN del contrato principal

El mismo conjunto quedó en `57 tests`, `55 pass`, `0 fail`, `2 skipped`; los dos skips eran integraciones que luego se ejecutaron con entorno disposable real y quedaron en `0 skipped`.

Los doce comportamientos exigidos quedaron cubiertos:

1. solo `DUCKDB_SYNC` compara DuckDB/PostgreSQL;
2. `EXTERNAL` informa `NOT_SYNCHRONIZED`, no un falso faltante;
3. `POSTGRES_BUILDER` valida existencia y columnas Postgres-native;
4. `POSTGRES_TRANSACTIONAL` valida existencia sin comparar conteos;
5. `VIEW_NOT_APPLICABLE` no entra al inventario de tablas extra/faltante;
6. objeto desconocido genera diagnóstico y `FAILED`;
7. validación read-only no emite DML;
8. recorder opcional exige el guard;
9. host Supabase sin ambos tokens exactos queda bloqueado;
10. target local disposable registra el resultado;
11. fallo parcial conserva la causa y produce reporte `FAILED`;
12. estado sano produce `PASSED`.

### RED/GREEN adicionales surgidos de incompatibilidades concretas

- Tipo temporal: la validación real expuso DuckDB `TIMESTAMP` frente a PostgreSQL `timestamp without time zone`. Se agregó primero el test del contrato compartido y luego el matcher común; GREEN.
- Idempotencia Windows: la segunda cadena falló al reabrir un SQL idéntico que el generador acababa de reescribir. Dos tests RED demostraron la ausencia de `writeFileIfChanged`; la implementación evita escrituras si el contenido no cambió; GREEN.
- Runners raíz: `contracts:test` incluía integraciones concurrentes y una suite eliminaba `config` mientras otra la usaba. El fallo RED fue `schema "config" does not exist`; el runner ahora separa unitarias e integración y serializa esta última; GREEN.
- Rol de fixture: un primer intento alteraba la contraseña del rol cluster-global `nexus_app`. La revisión lo rechazó; las suites usan ahora el placeholder local ya creado por `sql/000` y nunca ejecutan `ALTER ROLE`; GREEN sin mutación global.
- AUTH-P0: los handlers históricos respondieron correctamente `401` a los fixtures sin sesión. Se añadió un provider de integración central, habilitado exclusivamente con `NODE_ENV=test`; las pruebas 401/403 unitarias permanecen verdes y las 42 integraciones positivas usan una identidad Gerencia explícita.
- Aislamiento: la suite after-hours detectó los datos del warehouse compartido. Se ejecutó contra una base `_disposable` independiente con su propio marker; GREEN sin truncar el warehouse candidato.
- Aislamiento root: contracts elimina schemas de fixture al terminar. Contracts, holidays y working-hours se certificaron en bases distintas; ownership corre sobre la base de working-hours solo después de su suite, nunca sobre el pipeline candidato.
- Atomicidad: un review detectó `TRUNCATE` seguido de `INSERT` fuera de transacción. La carga ahora se completa primero en staging y el swap publicado usa una única transacción, sin `CASCADE`; el test contractual verifica `BEGIN/TRUNCATE/INSERT/DROP/COMMIT`.
- Procedencia: el recorder podía combinar reportes globales de corridas distintas. Migración y validación guardan destino sanitizado + `run_id`, y el recorder rechaza destino, corrida o formato legacy incompatibles antes del guard/DML.
- Docker init: `pg_isready` aceptaba el servidor transitorio de la imagen oficial. El setup exige cinco comprobaciones consecutivas espaciadas y la recreación limpia quedó verde.

## Diseño implementado

- `src/db/ownership-manifest.js` es la única fuente de clasificación: `DUCKDB_SYNC`, `EXTERNAL`, `POSTGRES_BUILDER`, `POSTGRES_TRANSACTIONAL` y `VIEW_NOT_APPLICABLE`.
- `src/db/warehouse-validation.js` contiene la evaluación pura y acepta un adapter de lectura.
- `src/db/validate-supabase.js` usa DuckDB `READ_ONLY`, attach PostgreSQL `READ_ONLY`, escribe solo el reporte JSON local y falla después de conservar el diagnóstico.
- `src/db/record-supabase-validation.js` es la escritura opcional, separada y explícita; no forma parte de `db:pg:build`.
- Migrador y validador consumen el mismo classifier; lo desconocido nunca se omite silenciosamente.
- El manifiesto falla al inicializar si un `(kind, schema, object)` aparece en más de una categoría.
- El migrador hace preflight de objetos desconocidos antes de escribir, usa columnas nombradas, staging y swap transaccional por tabla sin `CASCADE`.
- `db-safety.js` se fortaleció para `.supabase.co` y `.supabase.com`; no se relajó ningún guard.
- Los hosts se normalizan a minúsculas y sin punto DNS final antes de reconocer Supabase.
- El generador DDL no toca archivos cuyo contenido no cambia.
- Los runners distinguen unitarias de integración y ejecutan fixtures PostgreSQL secuencialmente.

## Certificación PostgreSQL 16 local disposable

Targets locales usados, todos en el contenedor PostgreSQL 16 `nexus_bi_dev_local` y marcados por el bootstrap oficial:

- pipeline: `nexus_bi_dev_local_test`, marker final `a5e923f6-c534-4396-a3df-68da2ca81575`;
- contracts: `nexus_contracts_disposable`, marker `67b3ab67-0e0c-487e-ae18-6e7c2cf5ff2a`;
- holidays: `nexus_holidays_disposable`, marker `a566dffb-d36f-4319-8606-34b79c78e6a5`;
- working-hours/ownership: `nexus_working_hours_disposable`, marker `b0a9b899-e6ea-46c9-b939-2cf1d1159c71`;
- app: `nexus_after_hours_pipeline_disposable`, marker `8090d179-1b3a-4cc9-9daa-a5fd1704f7d3`.

Se aplicaron los 15 archivos `sql/*.sql` en orden lexicográfico comprobado por el bootstrap oficial.

### Cadena y reconciliación

| Evidencia | Resultado |
|---|---|
| `npm run db:build` + `npm run db:validate` | 27 objetos DuckDB, todos `MATCH`. |
| DDL individual | Generación de processed/marts/gold sin cambios de contenido. |
| Migración individual | `27 sincronizadas`, `13 EXTERNAL omitidas`, `0 errores`, `LOAD_RAW=false`. |
| Validación individual | `PASSED`, solo lectura. |
| `npm run db:pg:build`, corrida 1 | exit 0; `27/13/0`; `PASSED`. |
| `npm run db:pg:build`, corrida 2 | exit 0; `27/13/0`; `PASSED`. |
| Reemplazo publicado | carga staging + swap transaccional por tabla, columnas nombradas y sin `CASCADE`. |
| Tablas `POSTGRES_BUILDER` | delta de `relfilenode=0`; no fueron truncadas/recreadas. |
| Auditoría antes/después de validar | misma huella `46b6faeadf92355df444645a5b20215b`, 5 filas. |
| Recorder local explícito | `PASSED` registrado para `run_id=6009228a-f873-4acb-9ad4-fb16de25a441`, con destino/run correlacionados en ambos JSON. |
| Pooler Supabase simulado sin tokens | exit 1 antes de conectar; `PROTECTED_HOST_WITHOUT_DUAL_CONFIRMATION=BLOCKED`. |

## Validación final local

- Raíz: `db:build`, `db:validate`, contratos, festivos, working-hours y ownership verdes.
- Integraciones PostgreSQL: contratos, festivos, working-hours y ownership con `0 fail`, `0 skipped`, aisladas por base.
- App: todas las unitarias verdes; `42` integraciones autenticadas verdes, `0 skipped`.
- Repetibilidad app: la cadena de `42` integraciones pasó dos veces consecutivas; el runner limpia ambos rangos reservados antes del primer fixture.
- AUTH: ausencia/expiración `401`, rol inválido `403`, roles válidos positivos y seam de test cubiertos.
- Typecheck: verde.
- Next build: verde, 36 páginas generadas y Proxy activo.
- Smoke anónimo local sobre `next start`: `5/5` (`/login`, redirects de páginas y APIs `401`).
- `apps/nexus-bi-app/package-lock.json`: el diff ya contiene las dependencias justificadas de AUTH-P0 (`@supabase/ssr` y `@supabase/supabase-js`); DEPLOY-PIPELINE-FIX no ejecutó instalación ni añadió cambios de lockfile.

## Separación de entornos

### Pruebas locales con configuración mock o disposable

Todas las pruebas y certificaciones anteriores. Las URLs públicas Supabase usadas en build/smoke fueron valores locales ficticios; PostgreSQL fue exclusivamente Docker local marcado.

### Pruebas reales contra Supabase

Ninguna. No se abrió conexión, no se usaron credenciales, no se ejecutó DDL/migración/validación y no se modificó ningún dato remoto.

### Pruebas pendientes de Netlify

Todas: configuración del sitio, variables por scope, preview `Frontend-Rev`, Functions/OpenNext, smoke autenticado y promoción de `main`. No se modificó Netlify.

## Operaciones remotas que continúan bloqueadas

1. Conectar o inspeccionar un proyecto Supabase real.
2. Ejecutar los 15 SQL, migración, importadores, `TRUNCATE` o recorder remoto.
3. Conectar incluso el validador read-only a Supabase.
4. Crear/alterar `nexus_app`, grants, Auth users, claims o redirect URLs.
5. Crear/configurar Netlify, cargar variables, desplegar preview/producción o hacer rollback remoto.
6. Hacer commit, merge, push o modificar `main`.

El cierre de Gate 1B no autoriza ninguna de estas operaciones.
