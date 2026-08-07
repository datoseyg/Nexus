# NEXUS V3 — Bloque 2: filtro de Cliente en Contratos + horario de cobertura contractual

Reporte final. Repo `eyg-nexus-local`, app `apps/nexus-bi-app`. Validado contra Postgres 16 local desechable (`nexus_bi_dev_local_test`, puerto 55480) — nunca Supabase Cloud.

---

## 1. Causa raíz exacta del filtro de Cliente (Sección 2 del encargo)

El facet (`fetchClientNameOptions`, `lib/explorer-sql.ts`, vía `CLIENTS_CANONICAL_CTE` sobre `processed.fieldbeat_clients` — identidad de **FieldBeat**) y el filtro (`contractsFilterConditions`, comparación exacta contra `config.contract_equipment_analysis.client_name_canonical` — identidad de la **planilla de contratos**) leían dos vocabularios de cliente estructuralmente distintos, sin relación de folding entre sí. El propio código ya documentaba que no calzaban ni con `UPPER(TRIM())` (comentario histórico en `fetchClientDetail`).

No es "solo un problema de mayúsculas": son dos pipelines de normalización independientes —

- FieldBeat (`CLIENTS_CANONICAL_CTE`): deduplica `processed.fieldbeat_clients` por `UPPER(TRIM(client_name))`, prefiriendo la fila con dirección.
- Contratos (`src/contracts/normalize-client.js::createClientNameNormalizer()`): elige, para cada fold-key (NFD + strip diacríticos + minúsculas + espacios colapsados), **la primera grafía vista en esa corrida de importación** — con estado **local a la corrida**, nunca compartido entre corridas ni persistido como clave estable. Confirmado leyendo el propio código: *"Fábrica con estado propio de una sola corrida de importación (nunca compartido entre corridas ni instanciado una sola vez a nivel de módulo)"*.

Las entradas basura del facet ("Mantención Preventiva Anual Linac HCM", "No indica") son datos reales de `processed.fieldbeat_clients.client_name` (trazados hasta `data/processed/fieldbeat/DIM_Clients.csv`), no un bug de columna — desaparecieron del facet de Contratos al dejar de usar esa fuente ahí, confirmado en vivo (ver §7).

Listado, conteo y exportación ya compartían `resolveExplorerEntityQuery`/`contractsFilterConditions` — el bug vivía en un solo punto, no duplicado.

---

## 2. Identidad canónica implementada: `client_name_key`

Se descartó `client_name_canonical` como identidad de filtro/facet (era la primera corrección propuesta, corregida tras revisión): al tener estado local a la corrida, dos importaciones distintas del mismo cliente real podrían —en principio— elegir dos grafías "canónicas" distintas.

**Diseño final**: columna persistida `config.contract_equipment_versions.client_name_key`, calculada por un **único algoritmo de folding**, reutilizado literalmente (no reimplementado) en los 3 puntos que lo necesitan.

### Helper único

El algoritmo (NFD + strip de diacríticos U+0300–U+036F + minúsculas + colapso de espacios) vivía duplicado en `normalize-client.js::foldForComparison()` y `fieldbeat-matcher.js::foldName()`. Se extrajo a **`apps/nexus-bi-app/lib/contract-client-name-key.js`** (`buildContractClientNameKey`) — la única implementación física. `fieldbeat-matcher.js::foldName` quedó como re-export (`export const foldName = buildContractClientNameKey;`), preservando el call site de `client-identity-aliases.js` sin cambios.

**Ubicación no trivial, documentada en el código**: el helper vive **dentro de `apps/nexus-bi-app`**, no en `src/contracts/` junto al resto del dominio contractual. Motivo real, descubierto en implementación (no una preferencia estética): `next.config.ts` pinea `turbopack.root` a esta app deliberadamente (comentario preexistente: evita que Turbopack infiera el workspace subiendo hasta `eyg-nexus-local/`, que también tiene su propio `package-lock.json`). Un archivo fuera de ese root **nunca puede incluirse en un bundle de cliente** — confirmado con dos intentos reales:
1. Import relativo `../../../src/contracts/...` → `next build` real: `Module not found`.
2. `turbopack.resolveAlias` apuntando al archivo externo → `next build` real: *"the chunking context does not support external modules"* (falla específicamente para el bundle de **cliente**; el alias sí resolvía el path).

Dado que Node (los scripts del pipeline en `src/contracts/`) no tiene esa restricción — puede importar con una ruta relativa normal hacia adentro de `apps/nexus-bi-app` —, la única implementación física quedó ahí, y **el pipeline la alcanza desde afuera**, nunca al revés. `src/contracts/normalize-client.js` y `fieldbeat-matcher.js` importan `../../apps/nexus-bi-app/lib/contract-client-name-key.js`. Verificado que ambos siguen produciendo la misma clave (`test/contracts/client-name-key.test.js`, ver §9).

`apps/nexus-bi-app` tiene `allowJs:false` (no puede tipar un `.js` directamente) — se agregó `lib/contract-client-name-key.d.ts` (declaración de tipos, sin segunda implementación) al lado del `.js`.

### Semántica de las tres columnas

| Columna | Rol |
|---|---|
| `client_name_raw` | Valor tal como llegó de la fuente (ya existía, nunca expuesto a la app) |
| `client_name_canonical` | Grafía legible para presentación — el **label** |
| `client_name_key` (nueva) | Clave estable de comparación — el **value**, nunca mostrada al usuario |

Aliases semánticos ("ROS" → "Radio Oncología del Sur") **no** se resuelven por folding (el folding solo cubre ortografía) — siguen resolviéndose exclusivamente por `client-identity-aliases.json` + `foldName`, en importación, sin cambio de alcance.

---

## 3. Migraciones aplicadas (número real)

Próximo número disponible verificado contra el repo real: `103` (el último existente era `099_part_no_usage_markers_sync.sql`; se descubrieron `100`-`102` ya aplicados por otro trabajo, no asumidos a ciegas).

- **`sql/103_contract_client_name_key_nullable.sql`**: `ALTER TABLE ... ADD COLUMN client_name_key text` (nullable); `CREATE INDEX ... WHERE is_current = true` (mismo patrón que el índice parcial ya existente); **`config.contract_equipment_analysis`** (vista) se define acá, no en `070_config.sql` — motivo real descubierto en implementación, ver §4.
- **`sql/104_contract_client_name_key_not_null.sql`**: aborta (`RAISE EXCEPTION`) si quedan filas NULL; `ALTER COLUMN ... SET NOT NULL`; `ADD CONSTRAINT contract_client_name_key_not_blank_chk CHECK (BTRIM(client_name_key) <> '')` — `NOT NULL` por sí solo no impide `''` (`buildContractClientNameKey(null)`/`buildContractClientNameKey("   ")` devuelven cadena vacía).
- **`sql/070_config.sql` editado in-place** (no una migración numerada aparte): `config.contract_service_window_analysis` pasa de `FROM contract_service_windows w JOIN contract_service_schedules s` a `FROM contract_service_schedules s LEFT JOIN contract_service_windows w` — ver §4 para por qué se editó en el mismo archivo en vez de agregar `sql/105`.

**Orden de despliegue real (staging, no solo local)**: helper único → migrar `normalize-client.js`/`fieldbeat-matcher.js` → actualizar el writer (`record-builder.js`, `db-writer.js`) → aplicar 103 → desplegar el writer actualizado → backfill → auditoría → aplicar 104. En Postgres local se ejecutó todo seguido; el orden queda documentado para que una importación nueva nunca quede sin clave entre el backfill y el `SET NOT NULL`.

---

## 4. Corrección de arquitectura de migraciones descubierta en implementación

Primer intento: agregar `sql/105_contract_service_window_analysis_left_join.sql` como archivo separado (`DROP VIEW` + `CREATE VIEW` con columnas reordenadas), y dejar que `103` hiciera `CREATE OR REPLACE VIEW config.contract_equipment_analysis` agregando columnas al final sobre la definición de `070`.

**Ambos enfoques rompieron la idempotencia real del bootstrap** (`test/fieldbeat/sql-migration-idempotency.integration.test.ts`, que aplica **todo** `sql/*.sql` dos veces seguidas sobre la misma base — el mecanismo real de `setup-local-dev-db.mjs`/`bootstrap-disposable-postgres.mjs`, confirmado en su propio comentario: *"Contenedor reutilizado - reaplicando sql/*.sql de todos modos"*). Causa: `CREATE OR REPLACE VIEW` de Postgres exige que la vista nueva **nunca "pierda" columnas** respecto a la vigente. En la segunda aplicación, el archivo **numerado antes** (`070`) reafirma su forma original (más corta / distinto orden), chocando con la forma ya extendida por el archivo numerado después — `ERROR: cannot drop columns from view`.

**Corrección aplicada**: cada vista se define en **un solo archivo, el último que la modifica** —
- `contract_service_window_analysis`: se edita directamente en `070_config.sql` (mismo orden de columnas, solo cambia el tipo de JOIN) — no depende de ninguna columna nueva, no hay problema de secuencia.
- `contract_equipment_analysis`: se **removió por completo de `070_config.sql`** (view + su `GRANT`) y se **relocalizó íntegra a `103`** (con su propio `GRANT`), porque selecciona `client_name_key`, columna que `070` todavía no conoce.

Verificado con una recreación completa del contenedor desde cero (`docker rm` + `setup-local-dev-db.mjs`) y una corrida real de `test:integration:fresh` — **26/26 archivos de integración verdes**, incluyendo la prueba de idempotencia.

---

## 5. Backfill, auditoría de colisiones y valores vacíos

`scripts/contracts/backfill-client-name-key.mjs` (nuevo) — reutiliza `buildContractClientNameKey` importado directamente (cero reimplementación). Por defecto dry-run (`--apply` explícito, mismo convenio que `contracts:import`); paginación por keyset (`contract_version_id > lastSeenId`, correcto en dry-run y en apply); **falla** (exit ≠ 0) si calcula una clave vacía para cualquier fila, sin persistirla; reporta filas leídas/actualizadas/ya-con-clave/vacías; usa `assertWriteConfirmed` (mismo guard que `applyContracts()`) — nunca escribe sin confirmar el destino.

`scripts/contracts/audit-client-name-key-collisions.mjs` (nuevo, solo lectura) — agrupa por `client_name_key`, reporta filas NULL/vacías y grupos con más de una grafía canónica. **Sin clasificador automático por distancia de edición** (prohibido explícitamente) — solo evidencia (`array_agg` de grafías + `contract_version_id`), la aprobación es humana.

**Resultado real** (23 contratos reales reimportados desde `data/manual/contracts/Detalles Contractuales EyG.xlsx - Clientes (2).csv`, writer ya actualizado — **0 filas necesitaron backfill**, el writer las escribió directamente):

```
[audit] Filas con client_name_key NULL o vacío: Ninguna.
[audit] Grupos con más de una grafía canónica bajo la misma client_name_key: Ninguno.
[audit] Resumen: 24 filas totales, 12 claves de cliente distintas.
```

(La corrida anterior, sobre las mismas 24 filas antes de que el writer persistiera la clave, backfilleó 24/24 sin claves vacías ni colisiones — evidencia idéntica, dos caminos.)

---

## 6. Índice y evidencia `EXPLAIN ANALYZE`

`contract_equipment_versions_client_name_key_idx` — parcial, `WHERE is_current = true` (mismo patrón que el índice único ya existente `contract_equipment_versions_current_key_uidx`).

**Filtro por un cliente** (`client_name_key = 'clinica alemana de santiago'`, 4 filas reales):

| | Sin índice | Con índice |
|---|---|---|
| Scan | `Seq Scan` + `Filter` | **`Index Scan using contract_equipment_versions_client_name_key_idx`** |
| Execution Time | 0.371 ms | 0.232 ms |
| Buffers (nivel superior) | shared hit=19 | shared hit=19 (hit=2 en el nodo del índice vs. hit=2 en el seq scan — la diferencia real está en el costo de filtrado, no en buffers a esta escala) |

El planner **usa el índice** para esta forma de consulta (selectiva, con `LIMIT`) — confirmado eliminando y recreando el índice en vivo, no asumido.

**Facet agrupado** (`GROUP BY client_name_key`) y **conteo/export sin `LIMIT`**: el planner elige `Seq Scan` incluso con el índice presente — comportamiento correcto y esperado a esta escala real (23 filas totales, el índice no aporta sobre un escaneo casi completo de una tabla que cabe en unas pocas páginas). Documentado honestamente, no se fuerza el uso del índice donde el planner tiene razón en no usarlo — el beneficio real del índice crecerá con el volumen de contratos, que es un catálogo curado de crecimiento lento, y el índice parcial (`WHERE is_current = true`) se mantiene liviano incluso así.

---

## 7. Facet y filtro — antes/después, en vivo contra el servidor real

**Antes** (código ya corregido, pero facet histórico vía `"clientes"`): mezclaba `RADIO ONCOLOGÍA DEL SUR` (FieldBeat) con textos como "Mantención Preventiva Anual Linac HCM"/"No indica" — comparados contra `client_name_canonical` de contratos, sin ninguna coincidencia real.

**Después**, confirmado con Playwright contra `http://localhost:3000` real (usuario GERENCIA), datos reales reimportados:

- Facet `contractClients` (nuevo `dynamicOptionsKey`, exclusivo de Contratos): 12 clientes reales, `value` = clave plegada (ej. `"clinica alemana de santiago"`), `label` = grafía canónica (`"Clínica Alemana de Santiago"`) — confirmado que `value !== label`.
- **Cero** entradas "Mantención..."/"No indica" en el facet de Contratos.
- Seleccionar "Radio Oncología del Sur" en la UI real → filas reales devueltas, nunca "Sin resultados para este filtro" (el bug original, reproducido y cerrado).
- Filtrar por la grafía canónica cruda ("Explorer Test Contract Client", fixture) en vez de la clave → `totalRows = 0` — confirma que el filtro compara contra la clave, nunca contra el texto crudo (test de integración, no solo browser).
- `client=` inexistente en la URL → estado "El cliente del enlace ya no está disponible en el listado actual" + botón "Limpiar filtro de cliente", **nunca** el panel genérico de cero resultados — confirmado en vivo.

**Migración de URL heredada** (`lib/contract-client-filter.ts`, nuevo): compara el valor de la URL contra las opciones actuales del facet (mismo fetch, sin request adicional); si no hay coincidencia exacta, aplica `buildContractClientNameKey` (mismo helper único, import `@/lib/contract-client-name-key`, sin segunda implementación) al valor de la URL y busca una coincidencia única contra las claves actuales — `MIGRATED` reescribe la URL con `router.replace` (nunca `push`); ambigüedad o cero coincidencias → `UNRESOLVED`, nunca elige al azar. **Sin matching difuso en el backend** — un vocabulario verdaderamente distinto (FieldBeat pre-fix) no se reconciliaría de forma confiable ahí, y reabriría una segunda ruta de resolución de identidad.

**Facets dependientes de otros filtros activos (Sección 4 del encargo original) — fuera de alcance, documentado**: `app/api/explorer/[entity]/facets/route.ts` calcula facets sin considerar otros filtros activos, para las 9 entidades por igual (confirmado leyendo la ruta completa). Construir faceting cruzado-dependiente afectaría a las 9 entidades, no es específico de Contratos. Con la clave unificada, la falla "cero por definición" (el bug reportado) desaparece para el caso sin otros filtros activos; el caso general de faceting dependiente queda como hallazgo documentado, no resuelto en este bloque.

---

## 8. Horario de cobertura contractual

### Corrección de la fuente

`config.contract_service_window_analysis` usaba `INNER JOIN` partiendo de `contract_service_windows` — un schedule con **cero ventanas** (`FULL_24X7`/`CRITICAL_ONLY_24X7`/`BUSINESS_HOURS_UNDEFINED`/`ON_DEMAND`/`NOT_COVERED`/`NOT_APPLICABLE`, caso explícitamente válido según el propio esquema) simplemente no aparecía — indistinguible de "no existe schedule". **Confirmado contra datos reales antes del fix**: 9 de 23 schedules (`BUSINESS_HOURS_UNDEFINED` ×5, `NOT_APPLICABLE` ×1, `UNKNOWN` ×3) eran invisibles. Corregido a `LEFT JOIN` desde `contract_service_schedules` (ver §4 sobre por qué se editó `070_config.sql` en el mismo lugar).

### Tipos — `types/contracts.ts` (nuevo, neutral)

`ContractCoverageType` refleja **directamente** los 8 valores reales del CHECK de `coverage_type` (sin un segundo enum simplificado en paralelo — corrección aplicada tras la primera versión, que sí tenía una traducción paralela). `ContractServiceWindow`/`ContractCoverageSchedule` — nunca `{startTime, endTime}` plano, siempre un arreglo de ventanas reales. `ContractScheduleResult` — resultado **discriminado** (`AVAILABLE` / `MISSING` / `UNAVAILABLE`), nunca `null` + un boolean suelto. `FieldbeatContractRelation` (en `types/fieldbeat-report-detail.ts`) importa estos tipos — la dependencia correcta es "FieldBeat report detail → tipos de contratos", nunca al revés (contrato de tipos subido a 2.2.0, aditivo).

### Estados — `resolveContractCoverageState()` (`lib/contracts-vocabulary.ts`)

Nueve ramas distinguibles, nunca colapsadas en "Horario no informado": `UNAVAILABLE`, `MISSING` ("No existe una configuración horaria contractual para esta versión" — nunca dice "ventana", un `FULL_24X7` válido puede no tener ninguna), `TWENTY_FOUR_SEVEN`, **`CRITICAL_ONLY_TWENTY_FOUR_SEVEN`** (estado propio, nunca colapsado en `UNKNOWN` — corrección aplicada tras la primera versión), `EXPLICIT_WINDOWS`, `NO_EXPLICIT_WINDOWS`, `BUSINESS_HOURS_UNSPECIFIED` (nunca inventa Lun-Vie 08:30-18:30), `NO_COVERAGE`, `UNKNOWN`. `parseStatus=REVIEW_REQUIRED` es una marca ortogonal, coexiste con cualquier estado.

### Derivación honesta de `coversWeekends`/`coversHolidays`

`boolean | null` — `null` cuando no hay ventanas de las que derivarlo (nunca `false` por defecto, que afirmaría algo que el contrato no dice). `FULL_24X7`/`CRITICAL_ONLY_24X7` → `true`/`true`; `FIXED_WINDOW` → derivado de las ventanas reales; el resto → `null`/`null`.

### Mapper único — `lib/contract-coverage-schedule.ts`

`mapServiceWindowRowsToCoverageSchedule(rows, versionValidity)` — único lugar que arma `coverageType`/`windows`/`coversWeekends`/`coversHolidays`/vigencia. `effectiveFrom`/`effectiveTo` vienen de la **versión exacta** ya resuelta por el caller (nunca "la vigente actual" del equipo) — una versión histórica muestra su propia vigencia sin lookup adicional. Orden de ventanas Lun→Dom vía constante `DAY_ORDER`, definido una sola vez (nunca alfabético).

**Ambos consumidores comparan filas crudas y llaman al mismo mapper** — se descartó el diseño donde un lado armaba JSON en SQL y el otro agregaba en JS:
- Contratos (`fetchContractDetail`, `lib/explorer-sql.ts`): `WHERE contract_version_id = $1`.
- Reportes/After-Hours (`fieldbeat-report-detail-queries.ts` + `fetchContractScheduleResultsByVersionIds`, `lib/explorer-sql.ts`): **una sola consulta batch** `WHERE contract_version_id = ANY($1::bigint[])` para **todos** los contratos de **todos** los equipos de un reporte — `collectReportContractVersionIds()` los recolecta y deduplica antes. Nunca una consulta por contrato ni por ventana.

### Consulta secuencial, no paralela imposible (corrección aplicada tras la primera versión)

`contract_version_id` es un **resultado** de la consulta base de `fetchContractDetail`, no un input disponible de antemano — no puede describirse como parte de un `Promise.allSettled` inicial. La consulta de schedule corre **después**, envuelta en su propio try/catch — un fallo produce `UNAVAILABLE` sin tumbar el resto del detalle. Sigue siendo **una sola request HTTP** (confirmado en integración: `body.summary.schedule` viaja en la misma respuesta que `equipment_model`).

Para el detalle de Reportes/After-Hours: `buildReportDetailQuery()` sigue siendo puro constructor de SQL (ya lo era); la orquestación del batch de schedules vive en la capa que ya hace el resto del trabajo de I/O para ese detalle (`app/api/dashboard/fieldbeat/reports/[id]/route.ts`), no dentro del generador de SQL.

### Componente compartido — `components/contracts/ContractCoverageScheduleView.tsx` (nuevo)

Recibe `ContractScheduleResult` ya resuelto — sin fetch propio, sin interpretar texto. `appliedSource` opcional (solo lo pasan Reportes y After-Hours, que tienen un `data_basis` de tarea contra el cual comparar) — el drawer de Contratos por sí solo nunca lo pasa. **Tres consumidores reales**: drawer de Contratos (`ExplorerDetailDrawer.tsx`), sección Equipos del detalle de Reportes (`FieldbeatReportDetailContent.tsx`), y el mismo punto de montaje con `appliedSource` poblado cuando `afterHoursContext` está presente (`data_basis==="CONTRACTUAL"` → "Horario contractual del equipo"; `="LEGACY_SCHEDULE"` → "Horario global de respaldo" + motivo; `="NONE"` → "Sin horario calculable" — decidido por `dataBasisCode`, campo nuevo agregado a `AfterHoursDrawerContext` porque `CodeLabel` no exponía el código crudo, solo el label). El horario global **nunca** se presenta como si fuera parte del contrato.

---

## 9. Pruebas

**Unitarias** (`npm test`, `apps/nexus-bi-app`): **517/517 verdes**. Nuevas: `resolveContractCoverageState` (17 casos, cada estado + `needsReview` ortogonal), `mapServiceWindowRowsToCoverageSchedule` (8 casos: cero ventanas en `FULL_24X7`, orden Lun→Dom, derivación de `coversWeekends`/`coversHolidays`, `CRITICAL_ONLY_24X7`, vigencia por versión, `parseStatus`, tipo no reconocido), `resolveLegacyContractClientFilter` (4 casos), `buildContractClientNameKey` (6 casos, incluyendo que los 3 consumidores del algoritmo producen la misma clave).

**Integración** (`npm run test:integration:fresh`, contenedor desechable recreado desde cero): **26/26 archivos verdes**, incluyendo:
- `sql-migration-idempotency` (aplicar todo `sql/*.sql` dos veces seguidas) — la prueba que expuso y confirmó la corrección de arquitectura de §4.
- Filtro de Cliente: shape del facet (`value` ≠ `label`), **propiedad general** (cada opción del facet, sin otros filtros, `count > 0`), filtrado exacto por clave, causa raíz reproducida (grafía cruda → 0 filas).
- Horario: `FULL_24X7` sin ventanas → `AVAILABLE`; `FIXED_WINDOW` con 5 ventanas reales → orden Lun→Vie; contrato sin schedule → `MISSING`; **resiliencia real** (`contract_version_id` no numérico, forzando un error de cast en Postgres — no un mock) → `UNAVAILABLE`; una sola request HTTP.

**Root-level** (`contracts:test:integration`, `working-hours:test:integration`, contenedores desechables propios): **2 archivos / 22 tests** y **3 archivos / 55+ tests**, todos verdes — ambos requirieron parchear sus fixtures (`client_name_key` agregado a sus `INSERT`s manuales) y, en el caso de `versioning-lifecycle`/`db-writer` de contratos (que aplican un subconjunto propio de `sql/*.sql`), agregar `103` a esa lista — mismo patrón ya documentado en el propio archivo para cuando `084` agregó columnas antes.

**Typecheck + build**: `next typegen && tsc --noEmit` limpio; `next build` (Turbopack) limpio, las 80+ rutas compilan.

---

## 10. Validación visual (`/run`, Playwright real contra `localhost:3000`, usuario GERENCIA)

| # | Check | Resultado |
|---|---|---|
| 1 | Seleccionar Radio Oncología del Sur → devuelve su contrato | ✅ confirmado |
| 2 | Cada opción visible del facet → sin ceros incoherentes | ✅ confirmado (12 clientes reales) |
| 3 | Facet sin textos de mantenimiento | ✅ confirmado |
| 4 | `client=` obsoleto en la URL → estado "no disponible" + limpiar | ✅ confirmado |
| 5 | Drawer de Contratos muestra "Horario de cobertura contractual" | ✅ confirmado |
| 6 | `FULL_24X7`/ventana limitada se distinguen | ✅ confirmado ("Cobertura 24/7.") |
| 7 | `CRITICAL_ONLY_24X7` distinto de 24/7 pleno | ✅ confirmado ("eventos críticos") |
| 8 | "Horario hábil sin tramo" no inventa horas | ✅ confirmado, y ventanas explícitas (Lun-Vie) también encontradas en datos reales |
| 9 | Fallback global rotulado, nunca mezclado con el contrato (drawer de Reporte/After-Hours) | ⚠️ **no verificable en esta sesión** — el contenedor desechable reconstruido no tiene datos de `processed.fieldbeat_tasks`/`marts.fieldbeat_working_hours_analysis_current` (pipeline de minería + working-hours build, fuera de alcance de este bloque). El mecanismo (`contractAppliedSource()` en `FieldbeatReportDetailContent.tsx`, gateado por `dataBasisCode`) está implementado, es el mismo componente ya verificado en vivo para los 8 checks anteriores, y su lógica de derivación está trazada explícitamente en este reporte (§8) — pero no se reprodujo con datos reales de tarea. Documentado honestamente en vez de asumido. |
| 10 | Escritorio y móvil (390×844) | ✅ confirmado (drawer de Contratos con horario visible en tarjeta móvil) |
| 11 | 1 request HTTP por apertura de drawer, sin N+1 | ✅ confirmado (`/api/explorer/detail` × 1, capturado por red real) |
| 12 | Sin warnings/errores de consola | ✅ confirmado (0 capturados en las 3 sesiones de browser) |

---

## 11. Reutilización y limpieza

**Helpers duplicados eliminados**: `foldForComparison` (en `normalize-client.js`) y la implementación local de `foldName` (en `fieldbeat-matcher.js`) — ambos ahora importan `buildContractClientNameKey`, una sola vez física.

**Tipos centralizados**: `types/contracts.ts` (nuevo, neutral) — `FieldbeatContractRelation` importa desde ahí, nunca al revés.

**Mappers reutilizados**: `mapServiceWindowRowsToCoverageSchedule` — un solo lugar, dos consumidores (Contratos, Reportes/After-Hours). `resolveContractCoverageState` — un solo lugar, consumido por el componente y por los tests.

**Componente compartido**: `ContractCoverageScheduleView` — 3 consumidores reales, cero framework genérico de calendario.

**Archivos nuevos, cada uno justificado** (ningún archivo nuevo sin una razón trazada en este reporte): `lib/contract-client-name-key.js`+`.d.ts` (única implementación del algoritmo, ubicación forzada por `turbopack.root`), `lib/contract-client-filter.ts` (migración de URL heredada), `lib/contract-coverage-schedule.ts` (mapper único), `types/contracts.ts` (tipos neutrales), `components/contracts/ContractCoverageScheduleView.tsx` (componente compartido, 3 consumidores reales — se verificó primero que no existiera uno equivalente), `sql/103`+`104` (identidad, staged), `scripts/contracts/backfill-client-name-key.mjs`+`audit-client-name-key-collisions.mjs` (operación de una sola corrida, reutilizan el helper).

**Archivos creados y luego eliminados durante la implementación** (corrección de diseño, no código muerto dejado atrás): `src/contracts/client-name-key.js`+`.d.ts` (relocados a `apps/nexus-bi-app/lib/` tras descubrir la restricción de `turbopack.root`), `sql/105_contract_service_window_analysis_left_join.sql` (fusionado a `070_config.sql` in-place tras descubrir que rompía la idempotencia real, ver §4).

**Sin código muerto dejado atrás**: `next.config.ts`/`tsconfig.json` recibieron cambios exploratorios (`resolveAlias`, `paths`) durante el diagnóstico de la restricción de bundling — ambos revertidos a su estado original una vez decidida la solución real (reubicar el archivo), confirmado por `git status` sin diffs pendientes en ninguno de los dos.

**Líneas** (`git diff --stat`, excluyendo `data/processed/*.csv`/`data/reports/*.json` no relacionados con este bloque, modificados por un proceso de refresh de datos ajeno a esta sesión): ~46 archivos de código/test propios de Bloque 2 tocados entre nuevos y modificados; el diff crudo de `git diff --stat` incluye ruido de datos no relacionado y no se reporta el número agregado por no ser representativo.

---

## Cierre

`NEXUS_CONTRACT_CLIENT_FILTER_AND_COVERAGE_SCHEDULE_FIXED`

Único punto no cerrado con evidencia en vivo: el rotulado del horario de respaldo global dentro del drawer de Reportes/After-Hours (check visual #9) — la lógica está implementada, trazada y comparte el mismo componente ya verificado para los otros 11 checks, pero requeriría poblar el pipeline de minería FieldBeat + `working-hours:build` (fuera del alcance de este bloque) para reproducirlo con datos reales en esta sesión.
