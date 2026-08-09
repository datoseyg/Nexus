# Checklist de release Supabase + Netlify

No marcar una casilla por inferencia. Adjuntar comando, SHA, log, screenshot o consulta read-only como evidencia. Las secciones remotas permanecen bloqueadas hasta recibir autorización explícita.

## Gate 0 — Baseline

- [ ] Candidato en `Frontend-Rev`; SHA registrado.
- [ ] `git rev-list --left-right --count main...Frontend-Rev` revisado.
- [ ] AUTH-P0 consolidado; working tree entendido y sin archivos accidentales.
- [ ] Diff sin secretos, respaldos locales ni credenciales.
- [ ] `docs/RUNBOOK_SUPABASE_NETLIFY.md` y anexos corresponden al SHA.

Rollback: descartar la candidatura, no alterar `main` ni servicios remotos.

## Gate 1 — Local

- [ ] Instalación raíz y app reproducible mediante lockfiles.
- [ ] Pipeline/warehouse local candidato construido.
- [ ] Si se regeneró DDL, diff de `010`–`030` revisado.
- [ ] Typecheck app verde.
- [ ] Tests unitarios AUTH y app verdes.
- [ ] Tests raíz relevantes verdes.
- [ ] Integración solo contra PostgreSQL marcado `DISPOSABLE_TEST` verde.
- [ ] Build Next verde.
- [ ] Smoke anónimo local verde.
- [ ] Diff check final verde.

Rollback: corregir localmente o volver a un commit candidato anterior; no avanzar.

## Gate 1B — Blockers del pipeline PostgreSQL

- [x] El validador filtra/entiende `DUCKDB_SYNC`, `EXTERNAL`, `POSTGRES_BUILDER` y `POSTGRES_TRANSACTIONAL`. Evidencia: `DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md`, casos 1–4.
- [x] Las vistas `VIEW_NOT_APPLICABLE` no se tratan como tablas faltantes/extras. Evidencia: caso 5 y cadena local `PASSED`.
- [x] La validación es read-only y su registro es una operación separada con guard. Evidencia: huella de `audit.warehouse_sync_state` idéntica antes/después y casos 7–10.
- [x] `db:pg:build` completo demostrado dos veces contra PostgreSQL 16 desechable. Evidencia: dos exits 0, `27 sincronizadas / 13 omitidas / 0 errores`, `LOAD_RAW=false`.
- [x] Cada objeto sincronizable se carga a staging y se publica mediante swap transaccional sin `CASCADE`; fallo de carga/swap no vacía la tabla publicada.
- [x] Recorder enlaza y verifica destino sanitizado + `run_id`; reportes legacy o cruzados abortan antes del UPDATE.
- [x] Suites de dominio usan bases desechables aisladas y los runners rechazan entorno incompleto en vez de certificar skips.
- [x] Pruebas negativas confirman que un host Supabase no autorizado sigue bloqueado. Evidencia: pooler `*.supabase.com`, exit 1 antes de conectar por falta de doble confirmación.

Evidencia consolidada: [`DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md`](DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md). Gate 1B local cerrado el 2026-07-20; no autoriza Gate 2 ni ninguna conexión remota.

Rollback: mantener la ejecución remota bloqueada. No debilitar `db-safety.js` para hacer pasar la cadena.

## Gate 2 — Supabase (requiere autorización)

- [ ] Project ref, región, entorno y owner aprobados.
- [ ] Se confirmó si es proyecto nuevo o versión 1 con datos.
- [ ] Backup/snapshot creado y restauración ensayada o verificada.
- [ ] Catálogo remoto inspeccionado read-only y comparado con los 15 SQL.
- [ ] Drift de owners, schemas, tables, views, functions, constraints y grants resuelto.
- [ ] Precondición de datos de `085` consultada y aprobada.
- [ ] Ruta direct IPv6 disponible o session pooler `:5432` aprobado como fallback.
- [ ] DDL ejecutado en orden, una pieza por vez, sin errores ignorados.
- [ ] Password placeholder de `nexus_app` rotado fuera del repositorio.
- [ ] Schemas de datos ausentes de PostgREST Exposed schemas.
- [ ] Grants efectivos de `nexus_app` verificados read-only.

Rollback: restaurar snapshot o ejecutar rollback SQL específicamente revisado. No continuar a migración si DDL queda parcial.

## Gate 3 — Migración (requiere autorización separada)

- [ ] Scope de tablas `DUCKDB_SYNC` capturado desde código candidato.
- [ ] `LOAD_RAW=false` confirmado.
- [ ] Conteos/constraints previos capturados.
- [ ] `SUPABASE_DB_URL_DIRECT` apunta al host/puerto/base autorizados.
- [ ] Ambos tokens exactos de confirmación fueron revisados por dos personas.
- [ ] Ventana de cambio y responsable de restore disponibles.
- [ ] Migración terminó sin tablas fallidas.
- [ ] Validador corregido terminó `PASSED`.
- [ ] Reconciliación read-only independiente aprobada.

Rollback: restaurar snapshot previo. Un rerun con `TRUNCATE` no es rollback.

## Gate 4 — Auth (requiere autorización separada)

- [ ] Registro público deshabilitado.
- [ ] Redirect URLs de preview/producción limitadas.
- [ ] Cuenta GERENCIA creada y `app_metadata.nexus_role=gerencia` verificado server-side.
- [ ] Cuenta ADMINISTRACION creada y `app_metadata.nexus_role=administracion` verificado server-side.
- [ ] Credenciales entregadas por canal seguro.
- [ ] No existe `service_role`/secret key en app, Netlify o logs.
- [ ] Login positivo por rol probado en entorno no productivo.
- [ ] Sesión ausente/expirada devuelve `401` en API.
- [ ] Rol inválido devuelve `403`.
- [ ] Open redirect bloqueado.
- [ ] Logout invalida acceso posterior.

Rollback: bloquear/eliminar cuentas creadas, rotar credenciales y retirar redirect URLs de prueba.

## Gate 5 — Code review

- [ ] Standards review completada.
- [ ] Spec review completada.
- [ ] `BLOCKERS=0`.
- [ ] `HIGH=0`.
- [ ] Findings MEDIUM/LOW aceptados o resueltos con evidencia.

Rollback: no crear ni promover preview.

## Gate 6 — Netlify preview (`Frontend-Rev`)

- [ ] Base `apps/nexus-bi-app`.
- [ ] Package directory vacío/no configurado.
- [ ] Build `npm run build`.
- [ ] Publish `.next` relativo a base.
- [ ] No existe `@netlify/plugin-nextjs`; build usa OpenNext automático.
- [ ] Variables con scopes y contexto preview según matriz.
- [ ] `SUPABASE_DB_URL` usa transaction pooler `:6543` y rol `nexus_app`.
- [ ] `NEXUS_SHOW_AUDIT=false`.
- [ ] `NEXUS_SHOW_EXPLORER=false`.
- [ ] `GOVERNANCE_PIPELINE_REQUESTER_DB_URL` configurada (NEXUS V3 - `DataRefreshControl` en la sidebar no está detrás de un flag; sin esta variable, `POST`/`GET /api/data-refresh/runs*` responden `DB_CONNECTION_ERROR`, no un 404/500 silencioso).
- [ ] Build y Functions logs sin secretos/errores.
- [ ] Smoke anónimo read-only verde.
- [ ] Smoke autenticado manual read-only verde para ambos roles.
- [ ] Expiración, logout y open redirect verificados.

Rollback: bloquear deploy de preview, revertir al deploy anterior de preview y rotar secretos de preview si corresponde.

## Gate 7 — Producción (`main`)

- [ ] Merge aprobado de `Frontend-Rev` a `main`; SHA productivo registrado.
- [ ] `main` es la única rama de producción.
- [ ] Variables productivas revisadas por nombre/scope sin exponer valores.
- [ ] Backup, responsables y ventana vigentes.
- [ ] Deploy de `main` verde; ninguna migración se ejecutó en build.
- [ ] Smoke productivo anónimo read-only verde.
- [ ] Login y lecturas esenciales verdes con cuentas autorizadas.
- [ ] Logout verde.
- [ ] Logs y métricas iniciales revisados.

Rollback frontend: publicar el deploy anterior de Netlify. Rollback de base: proceso separado mediante snapshot/plan SQL; nunca asumir que el rollback frontend lo cubre.

## Nota — actualización de datos STAGING/PRODUCTION (NEXUS V3)

`.github/workflows/data-refresh.yml` (`workflow_dispatch`) es un prerequisito **separado** de este checklist, no bloquea ningún Gate de arriba: la app se despliega y funciona igual sin él (STAGING/PRODUCTION simplemente no tienen todavía forma de refrescar datos hasta que se complete). Antes de la primera ejecución real:

- [ ] Crear los GitHub Environments `STAGING` y `PRODUCTION` (Settings → Environments) con sus secretos (ver [data-refresh-runbook.md](data-refresh-runbook.md) §4).
- [ ] Confirmar `SUPABASE_PROJECT_REF_V3` de cada Environment coincide con el proyecto Supabase V3 real correspondiente (nunca el de Nexus V2).
- [ ] Considerar "required reviewers" en el Environment `PRODUCTION` como aprobación humana adicional.

Rollback: el workflow no tiene rollback propio - una corrida `FAILED`/`PARTIAL_FAILED` nunca mueve `pipeline.published_dataset_state` (ver runbook §5), así que no hay nada que revertir en el estado publicado.

## Cierre

- [ ] Evidencia archivada sin secretos.
- [ ] SHA, fecha, responsables y resultado registrados.
- [ ] Incidentes/deudas abiertas documentados.
- [ ] Veredicto de release emitido por el responsable autorizado.
