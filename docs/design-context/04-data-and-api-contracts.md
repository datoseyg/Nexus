# 04 — Contratos de datos y API

**Corrección de cifra:** la exploración inicial reportó "33 rutas API". El conteo directo de esta sesión (`find app/api -name "route.ts" | wc -l`, commit `4a3d055`) da **34** archivos `route.ts`. Se usa 34 en todo este documento y en `api-inventory.json`.

Todas las rutas: `export const runtime = "nodejs"`, usan `runQuery`/`serializeRow(s)` de `lib/db.ts` (Postgres/Supabase, rol `nexus_app`), envueltas en `try/catch → lib/api-error.ts`. Ninguna ruta acepta valores SQL sin parametrizar salvo identificadores validados contra `information_schema` (`lib/sql-guardrails.ts`).

Cada fila trae, cuando existe, evidencia `LOCAL_RUNTIME` de esta sesión (ver metodología y salvaguardas en `00-audit-baseline.md`): status HTTP real observado + forma de la respuesta (claves de primer nivel, no el cuerpo completo). Donde no se pudo o no se debía verificar en runtime (mutaciones), se marca `NOT_RUNTIME_VERIFIED` explícito — nunca se ejecutó ningún `POST`/`PATCH`/`DELETE` real durante esta auditoría.

## Explorador / Búsqueda (3 rutas, permisos: público)

| Ruta | Método | Params | Tabla(s) origen | Respuesta (LOCAL_RUNTIME) | Errores observados | Frescura |
|---|---|---|---|---|---|---|
| `/api/tables` | GET | — | `information_schema.tables` filtrado a `processed/marts/gold` | 200 · `{tables:[{table_schema,table_name}]}` · 40 tablas (`processed`=11,`marts`=8,`gold`=21) | — | Instantánea (introspección de schema, no de datos) |
| `/api/tables/[schema]/[table]` | GET | `page,pageSize,sortColumn,sortDir,filterColumn,filterValue` | Cualquier tabla de `processed/marts/gold` validada contra `information_schema` | 200 en `processed.fieldbeat_tasks`, `marts.used_parts_dolibarr_match`, `gold.fieldbeat_data_quality` · `{schema,table,columns,rows,page,pageSize,totalRows,totalPages}` | 400 `{error:"Schema no permitido: \"badschema\"",code:"QUERY_ERROR"}` confirmado con schema inventado | Igual a la tabla subyacente — sin metadato de frescura propio |
| `/api/search` | GET | `q` (requerido) | `marts.fieldbeat_report_dolibarr_operational_view` + `processed.fieldbeat_report_fields` (con soft-fail si falta) | 200 con `q=bomba` · `{query,keywords,results:[45],resultCount,queries}` (SQL literal incluida solo para mostrar en UI, nunca re-ejecutada) | 400 `{error:"Falta el parámetro de búsqueda (q)."}` confirmado sin `q` | Igual a los marts subyacentes |

## Auditoría — lectura (6 rutas, permisos: público)

| Ruta | Método | Params | Tabla(s) origen | Respuesta (LOCAL_RUNTIME) |
|---|---|---|---|---|
| `/api/audit/summary` | GET | — | `gold.fieldbeat_data_quality`, `gold.scope_metadata` | 200 · `{reportsOk:480,reportsReviewRequired:1329,partsMatched:927,partsUnmatched:489,partsAmbiguous:56,partsPlaceholder:721,ticketsForbiddenPending:291,reportsNoTicket:2537,reportsLinkedMissingOrRestricted:920,totalFieldbeatReports:3747}` — cruza exacto con `docs/SCOPE_AND_LIMITATIONS.md` (2537/920/291/3747) |
| `/api/audit/ambiguous-parts` | GET | `page,pageSize,cliente,maquina,from,to,reportQuality,q` | `marts.used_parts_dolibarr_match` filtrado `match_status='AMBIGUOUS_MATCH'` | 200 · `PaginatedResponse` |
| `/api/audit/parts-review` | GET | ídem + `matchStatus` | ídem, `needs_manual_review=true OR match_status IN (...)` | 200 · `PaginatedResponse` |
| `/api/audit/placeholders` | GET | ídem | `match_status='PLACEHOLDER_VALUE'` agrupado por valor normalizado | 200 · página 3/3 con `page=9999` confirma clamp automático a `totalPages`, `totalRows=14` |
| `/api/audit/reports-review` | GET | ídem | `report_quality_status IN (...)` | 200 · `PaginatedResponse` |
| `/api/audit/ticket-links-review` | GET | ídem | `zendesk_join_status='LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK'` | 200 · `PaginatedResponse` |

Tipos formales: `types/audit.ts` (único archivo que tipa estas 6 respuestas centralmente).

## Dashboard FieldBeat (1 ruta, permisos: público, sin filtros)

`/api/dashboard/fieldbeat` GET → 5 queries fijas a GOLD (`gold.fieldbeat_report_analysis`, `fieldbeat_data_quality`, `client_report_volume_by_period`, `client_parts_consumption`, `equipment_parts_consumption`). LOCAL_RUNTIME: 200 · `{kpis,dataQuality:[6],reportsByClient:[10],partsConsumptionByClient:[10],topEquipmentByParts:[10]}`.

## Dashboard Operacional (4 rutas, permisos: público)

| Ruta | Params | Respuesta (LOCAL_RUNTIME) |
|---|---|---|
| `/filters` | — | 200 · `{clientes:[26],tiposTarea:[11],maquinas:[57],estadosTicket:[3],dateRange,bodegas,origenRegistro}` — `bodegas` y `origenRegistro` documentados en el propio código como heurísticas (25.6% de cobertura y `equipment_internal_ids LIKE '%APOTECA%'` respectivamente, no campos nativos del pipeline) |
| `/summary` | `from,to,grain,cliente,tipoTarea,maquina,sku,bodega,estadoTicket,origenRegistro,reportQuality` | 200 · `{filtersApplied,kpis:{totalRegistros:3747,totalTickets:628,repuestosUsados:2193,pctConTicketReportado:32.29%,pctConTicketAccesible:7.74%,ultimoCliente:"CLINICA ALEMANA DE SANTIAGO"},estados:[3],evolucion:[95],bodegasClientes,rankingBodegas,ticketsCliente:[26],estadoGeneral:[4],maquinasClientes}` |
| `/parts` | + paginación | 200 · `PaginatedResponse`, solo `match_status='MATCHED'` y ref no-basura |
| `/detail` | + paginación | 200 · `PaginatedResponse` + columna derivada `origen` (heurística Apoteca/General) |

## Dashboard Uptime/Downtime (3 rutas, permisos: público) — **no es downtime real**, ver `05-business-metrics.md`

| Ruta | Respuesta (LOCAL_RUNTIME) |
|---|---|
| `/summary` | 200 · `{kpis:{totalHorasRegistradas:8234.45,correctivasProgramadas:2736.75,correctivasNoProgramadas:2353,preventivasProgramadas:2122,requerimientoCliente:333,asistenciaRemota:117.28,instalacionIntegracion:242},downtimeWarning:true}` — el flag `downtimeWarning` viene `true` en runtime, confirmando el autodisclaimer |
| `/table` | 200 · `{table,periodChart:[95]}` — `hcCalc/uptimePct/tha/hcTeorica` son `null` fijo (STATIC_CODE `route.ts:84-87`, no verificado individualmente en runtime por no estar en el resumen de claves top-level, pero el propio código los fija a `null` sin condicional) |
| `/tasks` | 200 · `PaginatedResponse` — usa `last_transition_at` (100% cobertura) como aproximación de hora de término en vez de `finished_data_synced_at` (8% cobertura, STATIC_CODE) |

## Dashboard Trabajo Fuera de Horario (7 rutas, permisos: público)

| Ruta | Respuesta (LOCAL_RUNTIME) |
|---|---|
| `/summary` | 200 · `businessHoursStatus:"MISSING"`, `holidaysStatus:"MISSING"` (confirma en runtime que `data/config/business-hours.json`/`holidays.json` no existen — ver `07`); `kpis.totalHours.confidence_score=79.3` label "Media" |
| `/by-client` | 200 · `{rows:[26]}` |
| `/by-period` | 200 · `{rows:[96]}` |
| `/by-task-type` | 200 · `{rows:[11]}` |
| `/by-technician` | 200 · `{rows:[19]}` |
| `/confidence-distribution` | 200 · `{rows:[4]}` — histograma de 4 niveles, siempre completo aunque algún bucket esté en cero (STATIC_CODE) |
| `/detail` | 200 · `PaginatedResponse` |

Tipos formales: `types/after-hours.ts` (único archivo que tipa estas 7 respuestas centralmente).

## Administración — CRUD server-to-server (10 rutas, permisos: token `x-nexus-admin-token`)

Sin caller en ninguna UI del repo (STATIC_CODE, confirmado por grep de las 10 rutas contra `components/**`).

| Recurso | GET (lectura, verificado LOCAL_RUNTIME) | POST/PATCH/DELETE (existen en código, **NO ejecutados** en esta auditoría — `NOT_RUNTIME_VERIFIED` por regla de solo-lectura) |
|---|---|---|
| `audit.data_quality_events` | Sin token → 401 `{error,code:"UNAUTHORIZED"}`. Con token → 200, `pageSize=1` → 1 fila (**hay datos reales en esta tabla**) | POST (alta, 400 si falta `entity_type/entity_id/issue_type` o `severity` inválida, STATIC_CODE); `[id]` PATCH (marca resuelto), DELETE |
| `audit.pipeline_runs` | Sin token → 401. Con token → 200, `pageSize=1` → **0 filas** (tabla vacía en la instancia auditada) | POST (crea `status='STARTED'`, STATIC_CODE comenta que no hay wiring de pipeline real); `[id]` PATCH (`SUCCESS`/`FAILED`), DELETE |
| `manual_review.part_aliases` | Sin token → 401. Con token → 200, `pageSize=1` → **0 filas** | POST (valida `alias_type IN (RAW,NORMALIZED)`); `[id]` PATCH, DELETE = **baja lógica** (`active=false`, STATIC_CODE) |
| `manual_review.ticket_link_overrides` | Sin token → 401. Con token → 200, `pageSize=1` → **0 filas** | POST (valida `override_type`, requiere `corrected_zendesk_ticket_id` salvo `CONFIRMED_NO_TICKET`); `[id]` PATCH, DELETE = **baja física** (hard-delete, sin columna `active` — distinto a `part_aliases`, STATIC_CODE) |
| `stock.stock_movements` | Sin token → 401. Con token → 200, `pageSize=1` → **0 filas** | POST (crea `status='PENDING'`); `[id]` PATCH (`PENDING→CONFIRMED/REVERSED`), DELETE — **solo permitido si `status='PENDING'`**, si no 409 `{code:"INVALID_STATE"}` (guardia de máquina de estados, STATIC_CODE `route.ts:56-85`, no ejercitada en runtime por la regla de solo-lectura) |

**Verificación adicional (solo confirma el gate, no ejecuta mutación):** `PATCH`/`DELETE` sin token contra `/api/admin/stock/movements/1` devolvieron 401 antes de tocar cualquier fila — confirma que el gate de autorización cubre también los métodos mutantes, sin que esta auditoría haya llegado a ejecutar una mutación real en ningún caso.

## Errores — patrón común (STATIC_CODE `lib/api-error.ts:16-29`)

| Código | HTTP | Origen |
|---|---|---|
| `DB_CONNECTION_ERROR` | 503 | `DbConnectionError` (falla de conexión a Postgres) |
| `DB_NOT_FOUND` | 503 | `DbNotFoundError` |
| `QUERY_ERROR` | 400 | Cualquier otro error de consulta — confirmado LOCAL_RUNTIME con schema inválido |
| `UNAUTHORIZED` | 401 | Token admin ausente/incorrecto — confirmado LOCAL_RUNTIME ×5 |
| `SERVER_MISCONFIGURED` | 500 | `NEXUS_ADMIN_TOKEN` no configurado en el entorno — no aplica en esta sesión (el token sí está configurado) |
| `VALIDATION_ERROR` | 400 | Body inválido en rutas admin POST — STATIC_CODE, no ejercitado (implicaría un intento de escritura) |
| `NOT_FOUND` | 404 | `[id]` inexistente en rutas admin — STATIC_CODE, no ejercitado |
| `INVALID_STATE` | 409 | Transición de estado inválida en `stock.stock_movements` — STATIC_CODE, no ejercitado |

## Estados vacíos y de carga (detalle completo en `06-system-states.md`)

- Todas las tablas paginadas comparten `ResponsiveTableShell.tsx` — loading "Cargando…", empty configurable por prop (default "Sin resultados para este filtro.").
- `HorizontalBarChart.tsx` — "Sin datos." cuando el array es vacío.
- `components/dashboard/ChartCard.tsx` — prop `available`/`unavailableReason` → "No disponible" en vez de un gráfico vacío o engañoso.

## Permisos — resumen

24 de 34 rutas son públicas; 10 (`/api/admin/**`) requieren token server-to-server. Ninguna ruta tiene un tercer nivel de permiso (p. ej. rol de solo-lectura vs. edición dentro de una misma tabla).

## Fuentes

Los 34 `route.ts` bajo `apps/nexus-bi-app/app/api/**` (commit `4a3d055`), `types/audit.ts`, `types/after-hours.ts`, `lib/{db,api-error,auth,sql-guardrails,admin-guardrails,dashboard-filters}.ts`, sondeo LOCAL_RUNTIME completo de esta sesión (comandos y salvaguardas en `00-audit-baseline.md`).
