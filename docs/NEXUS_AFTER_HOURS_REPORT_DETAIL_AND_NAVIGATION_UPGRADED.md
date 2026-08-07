# NEXUS V3 — Consolidación del detalle de reporte After-Hours ↔ Explorador

Fecha: 2026-08-02
Alcance: Sección 14 (After-Hours) + Sección 15 (skills/reutilización) del encargo, más Bloque 0 (verificación independiente del encargo anterior de Explorador/BD).

---

## Bloque 0 — Verificación independiente del encargo Explorador/Filtros/BD anterior

Confirmado por lectura directa de código, no por lo que la conversación anterior asumía cerrado:

| Sección del encargo anterior | Estado | Evidencia |
|---|---|---|
| 2/6 — Identidad de fila + clic repetido idempotente | **Cerrado** | `ExplorerShell.tsx` tiene `loadState: ExplorerLoadState`, `requestGenerationRef`, guarda de generación activa |
| 9 — Contrato único de carga/error | **Cerrado** | `types/explorer.ts::ExplorerLoadState` discriminado, en uso real |
| 1 — Rango Desde/Hasta After-Hours | **Abierto** | `lib/after-hours-url-state.ts` existe pero no está importado en ningún componente |
| 3 — Filtro cliente en `contracts` | **Abierto** | `contractsFilterConditions` sigue sin normalizar (arquitectónicamente distinto, ver informe previo) |
| 4 — Filtro "Modelo de equipo" en Reportes (como filtro de listado) | **Abierto** | `ReportsExplorerFilters.model` declarado pero nunca leído en `parseReportsFilters`/`reportsFilterConditions` |
| 5 — Clasificación de calidad de identificación de equipos | **No iniciado** | Sin vocabulario IDENTIFIED/INCOMPLETE_IDENTIFICATION/POSSIBLE_NOISE/PLACEHOLDER_ONLY |
| 7 — Timeouts de pool PostgreSQL | **No iniciado** | `lib/db.ts`/`lib/governance-db.ts` sin cambios, sin `connectionTimeoutMillis`/`statement_timeout` |
| 8 — Auditoría de tormenta de requests | **Sin concluir formalmente** | Sin cambios de código ni cierre documentado |
| 10-12 | **Mayormente sin escribir/realizar** | Solo tests de Explorador ya existentes |

**Decisión de alcance**: estas secciones abiertas NO se implementan en este documento (reabrirlas duplicaría un encargo de 13 secciones dentro de uno nuevo). Este Bloque 1 SÍ exporta y extiende la maquinaria de resolución de modelo/contrato de equipo (`EQUIPMENT_CANONICAL_CTE`, `equipmentContractCandidatesLateral`, `EQUIPMENT_MODEL_RESOLUTION_COLUMNS`) — groundwork reutilizable para cuando se retome la Sección 4 del encargo anterior (filtro de listado en Reportes), pero **no implementa ese filtro de listado** en este cambio.

---

## Bloque 1 — Consolidación del detalle de reporte After-Hours

### A. Fuente anterior

- **Tabla** (`AfterHoursDetailTable.tsx`): 10 columnas, sin N.º de reporte ni Modelo, header "Equipo" mostraba el ID crudo, cero resaltado visual de fila seleccionada, sin variante responsive para móvil (solo scroll horizontal).
- **Drawer** (`AfterHoursDrawer.tsx`, eliminado): recibía la fila completa ya cargada por la tabla (`row: AfterHoursDetailRow`), sin fetch propio, sin ticket/contrato/repuestos/incidencias/lista de participantes, sin acción de navegación, con el bug de rótulo "Minutos cubiertos"/"Minutos fuera de cobertura" para un valor formateado en horas.
- **Endpoint**: `/api/dashboard/after-hours/detail` (lista paginada, sin endpoint de detalle único), fuente `marts.fieldbeat_working_hours_analysis_current`, sin ningún join a modelo/contrato/incidencias.
- **Identidad de reporte**: no existe un "número de reporte" separado de `fieldbeat_task_id` en ninguna fuente del pipeline (grep exhaustivo, cero resultados para `report_number`/`reportNumber`) — el propio drawer canónico ya titulaba `Tarea #{fieldbeat_task_id}` y el Explorador ya rotulaba esa misma columna "Reporte". La identidad visible y la identidad técnica **son el mismo valor**; no se inventó un campo nuevo.

### B. Contrato nuevo

- **`FIELDBEAT_REPORT_DETAIL_CONTRACT_VERSION`**: `2.0.0` → `2.1.0` (aditivo, ningún consumidor 2.0.0 existente — Búsqueda, FieldBeat Calidad — rompe).
- **`FieldbeatEquipmentItem`** (antes solo `internalId/source/confirmed`) gana: `resolutionSource: "TASK_EQUIPMENT_LINK" | "TEXT_FALLBACK"`, `model: string | null`, `modelResolutionStatus: "RESOLVED"|"AMBIGUOUS"|"UNKNOWN"`, `equipmentFamily: string | null`, `serialNumbers: string[]`, `contracts: FieldbeatContractRelation[]`.
- **`FieldbeatContractRelation`** (nuevo): `{ contractVersionId, statusCode, spaTierCode, partsCoverageCode, warrantyEndDate }` — objetos reales, nunca arrays paralelos. `contractVersionId` es el PK real de `config.contract_equipment_versions` (confirmado por lectura directa del esquema) — nunca `equipment_key`, que identifica el equipo del lado del sistema de contratos, no un contrato puntual.
- **`FieldbeatIssuesAvailability`** (nuevo): `{status:"available", issues: FieldbeatReportIssue[]} | {status:"unavailable"}` — unión discriminada explícita (nunca `T[] | null`), mismo principio que `ExplorerLoadState`.
- **Resolución de equipo con precedencia estructurada real**: `processed.fieldbeat_task_equipments` (vínculo real tarea↔equipo, no usado por ningún código de la app hasta este cambio) es la fuente primaria; el fallback de texto (`UNNEST` de `equipment_internal_ids`) solo se activa cuando esa tabla no tiene NINGUNA fila para la tarea — nunca cuando hay filas estructuradas que simplemente no matchean `canonical_equipment` (ahí se degrada a `UNKNOWN` vía `LEFT JOIN`, nunca se descarta la fila ni se cae al fallback).

### C. Tabla

- Columnas añadidas: **N.º de reporte** (`#{fieldbeat_task_id}`) y **Modelo**. Header "Equipo" → **"ID del equipo"** (mismo valor).
- `formatModelCell` (`lib/explorer-entity-config.ts`, extendida y exportada) gana la rama `UNKNOWN` explícita — antes caía en `formatValue()` → `"-"`, violando la prohibición explícita del encargo. Ahora: `AMBIGUOUS` → "Modelo por confirmar"; `UNKNOWN`/vacío → `"—"` (guion largo), nunca `-`/`N/A`/`NA`/`null`/`''`. Reutilizada literalmente por `AfterHoursDetailTable.tsx` (mismo consumidor real, no reimplementada).
- Selección visual: prop `selectedTaskId`, tokens `--nx-row-selected-bg`/`--nx-row-selected-border` (los mismos que ya usa `ExplorerShell.tsx`), `aria-selected`/`data-selected`, nunca solo color (inset box-shadow).
- **Responsive**: la tabla no tenía variante móvil (solo `overflow-x-auto` con ya 10 columnas). Con 12 columnas, se agregó la misma variante de tarjetas (`md:hidden`) que `ExplorerShell.tsx` ya usa — reutilizada, no reinventada.
- **Identidad de fila**: `key={row.fieldbeat_task_id}` — ya era correcta antes de este cambio (no index-based); confirmado con pruebas.

### D. Drawer

`AfterHoursShell.tsx` monta directamente **`FieldbeatReportDetailDrawer`** (el mismo componente que ya usan Explorador/Búsqueda/FieldBeat Calidad) — no existe un segundo sistema de detalle de reportes. Abrir el drawer pasa de instantáneo (leía la fila ya cargada) a disparar el mismo fetch real (`/api/dashboard/fieldbeat/reports/[id]`) que el resto de la app — cambio intencional: es lo que comparte el contrato en vez de duplicarlo, y lo que hace significativos los estados de carga/error/cancelado (gratis vía `useAfterHoursSection`, que ya trae AbortController + guarda de generación monotónica).

Secciones del drawer:
- **Identidad, Resumen de calidad, Inconsistencias, Cronología, Responsable+cliente, Participantes (nombres completos, nunca "+2"), Duración e intervención, Equipos (extendida), Tickets, Repuestos** — ya existían, reutilizadas sin cambios salvo la sección Equipos.
- **Equipos** (extendida): ahora muestra, por ítem, Modelo/Familia/N.º de serie/Contrato relacionado (estado + SPA tier), usando los campos nuevos del contrato 2.1.0.
- **Incidencias** (nueva): 3 estados distinguibles — confirmado-vacío ("Sin incidencias activas"), con datos (lista con severidad), y degradado ("No fue posible verificar incidencias activas" — cuando la query del rol de gobierno falla, sin tumbar el resto del detalle).
- **Tiempos del reporte / Resolución contractual** (nuevas, **exclusivas de After-Hours**): solo se renderizan cuando `afterHoursContext` está presente (Explorador/Búsqueda/FieldBeat Calidad no lo pasan, quedan visualmente idénticos). Etiquetas corregidas: **"Tiempo cubierto"/"Tiempo fuera de cobertura"** (antes "Minutos cubiertos"/"Minutos fuera de cobertura" para un valor en horas — bug de rótulo real, corregido; `formatHoursOrDash` se mantuvo sin cambios, el formato ya era correcto). Confianza temporal y confianza contractual quedan diferenciadas, nunca bajo una etiqueta genérica única.
- **Auditoría** — sin cambios.
- Botón nuevo: **"Abrir reporte en el Explorador"** (`next/link`, junto a "Copiar enlace"/"Descargar PDF"/"Abrir en FieldBeat"), solo renderizado cuando `explorerHref` está definido.

### E. Navegación

- **URL**: `/explorer?entity=reports&key=<fieldbeat_task_id>` — reutiliza el parámetro `key` **ya existente** en `ExplorerShell.tsx` (usado por las otras 8 entidades), en vez de introducir un parámetro `report` paralelo. Se descartó explícitamente esa alternativa: no existía incompatibilidad real que la justificara.
- **`ExplorerShell.tsx`**: se eliminó el `useState` local de `reportDrawerId` (que antes SIEMPRE arrancaba en `null`, ignorando cualquier `key` de la URL para la entidad Reportes — brecha documentada y ahora cerrada). `selectedKey`/`reportDrawerId` se derivan ahora del mismo `urlKey` en cada render vía `deriveExplorerDrawerKeys()` (función pura extraída a `lib/explorer-url-state.ts`, testeada) — reactivo a atrás/adelante del navegador sin lógica adicional, colapsando dos mecanismos de selección paralelos en uno solo.
- **`pushState` con `{replace:true}`**: antes, cada clic de fila apilaba una entrada de historial nueva vía `router.push`. Ahora la selección de fila (abrir/cerrar el drawer, cambiar solo `key`) usa `router.replace` — el botón "atrás" después de "Abrir reporte en el Explorador" cierra el drawer y vuelve directo a After-Hours, sin tener que pasar fila por fila. Cambios de entidad/filtros/página siguen usando `push` (navegación real).
- **Resolución de la fila fuera de la página actual**: el drawer canónico pide su propio detalle por `reportId`, independiente de la paginación de la lista — el reporte se abre correctamente exista o no en la página cargada actualmente; el resaltado en la tabla es correctamente condicional a que esa fila esté renderizada (no requirió lógica nueva de "resolver la página" en el backend).

---

## Reutilización y limpieza (Sección 15.11 del encargo)

1. **Componentes reutilizados**: `FieldbeatReportDetailDrawer`/`FieldbeatReportDetailContent` (ahora con 4 consumidores: Explorador, Búsqueda, FieldBeat Calidad, After-Hours), `DetailDrawer`, `StatusBadge`, tokens `--nx-row-selected-bg`/`--nx-row-selected-border`, patrón de tarjetas móviles de `ExplorerShell.tsx`.
2. **Hooks reutilizados**: `useAfterHoursSection` (ya traía AbortController + guarda de generación monotónica — Sección 14.9 del encargo quedó satisfecha sin código nuevo).
3. **Servicios/queries reutilizados**: `EQUIPMENT_CANONICAL_CTE`, `EQUIPMENT_MODEL_RESOLUTION_COLUMNS` (exportados, antes locales a `explorer-sql.ts`); `equipmentContractCandidatesLateral` (parametrizada — antes `EQUIPMENT_CONTRACT_CANDIDATES_LATERAL` hardcodeaba el predicado de correlación, ahora acepta el predicado como argumento, con 2 consumidores reales: el Explorador y el detalle de reporte/lista de After-Hours); `formatModelCell` (extendida y exportada, 2 consumidores).
4. **Tipos/contratos reutilizados**: `FieldbeatReportDetail` extendido en vez de duplicado; `ExplorerLoadState`-style discriminated union reutilizado como patrón para `FieldbeatIssuesAvailability`.
5. **Código duplicado eliminado**: `AfterHoursDrawer.tsx` (110 líneas) — segundo sistema de detalle de reportes, eliminado por completo tras confirmar (grep) cero importadores restantes. Dos mecanismos de selección de fila del Explorador (`useState` local + URL) colapsados en uno.
6. **Archivos eliminados**: `components/after-hours/AfterHoursDrawer.tsx`.
7. **Exports muertos eliminados**: ninguno adicional — se verificó explícitamente que cada export de `lib/after-hours-labels.ts` y `lib/after-hours-detail-view.ts` sigue teniendo consumidores reales tras el cambio.
8. **Nuevas abstracciones creadas**: `equipmentContractCandidatesLateral()` (parametrización, 2 consumidores reales); `mergeEquipmentEnrichment()`, `resolveRowModel()`, `isAfterHoursRowSelected()`, `buildAfterHoursDrawerContext()`, `deriveExplorerDrawerKeys()` (funciones puras extraídas para ser testeables, cada una con 1-2 consumidores reales concretos, no especulativos); `fetchReportActiveIssues()` (justificada: no existía ningún helper que devolviera filas completas de `governance.issues` para una entidad, solo conteos/keys).
9. **Consumidores reales de cada abstracción nueva**: documentados arriba junto a cada una — ninguna se extrajo por semejanza superficial sin un segundo consumidor real o una razón de testabilidad concreta.
10. **Justificación de cada archivo nuevo**: 3 archivos de test nuevos (`test/after-hours/after-hours-detail-view.test.ts`, `test/explorer/explorer-entity-config.test.ts`, `test/fieldbeat/report-detail-equipment-enrichment.integration.test.ts`) — ninguna pieza de código de producción nueva requirió un archivo propio (todo se agregó a archivos ya existentes con responsabilidad afín).

**Líneas**: +1050/-131 en 19 archivos modificados, más 110 líneas eliminadas (`AfterHoursDrawer.tsx`), más 3 archivos de test nuevos (112+29+320 = 461 líneas). Cero implementaciones paralelas restantes.

---

## Resultados

### Typecheck
```
npm run typecheck
✓ Types generated successfully
(sin errores)
```

### Build de producción
```
npm run build
✓ Generating static pages using 5 workers (62/62)
(sin errores, 91 rutas)
```

### Pruebas unitarias
```
npm test
tests 495
pass 495
fail 0
```
(479 pre-existentes + 16 nuevas: 3 en `explorer-url-state.test.ts` para `deriveExplorerDrawerKeys`, 9 en `after-hours-detail-view.test.ts` para `resolveRowModel`/`isAfterHoursRowSelected`/`buildAfterHoursDrawerContext`/identidad de fila, 4 en `explorer-entity-config.test.ts` para `formatModelCell`.)

### Pruebas de integración (Postgres local desechable, `npm run test:integration:fresh`)
```
=== 26 archivo(s) de integración, todos verdes ===
```
267 pruebas de integración pasando, 0 fallas, contra una base de datos nueva creada, migrada (sql/000-102 vía el bootstrap oficial) y destruida en esta misma corrida — incluye los 5 tests nuevos de `test/fieldbeat/report-detail-equipment-enrichment.integration.test.ts` y confirma que `test/fieldbeat/quality-api.integration.test.ts` (pre-existente, actualizado en este cambio para reflejar el contrato 2.1.0) sigue en verde junto con las otras 24 suites no relacionadas con este encargo.

**Dos fallas reales encontradas y corregidas durante esta corrida** (documentadas explícitamente, no ocultas):
1. `test/fieldbeat/quality-api.integration.test.ts` tenía una aserción `deepEqual` sobre la forma EXACTA (2.0.0) de `equipment.items[0]` — falló correctamente al agregar los campos aditivos del contrato 2.1.0; corregida para reflejar el nuevo contrato con los valores reales del fixture existente (`equipmentFamily: "BOMBA"`, `resolutionSource: "TEXT_FALLBACK"` porque ese fixture no tiene fila en `fieldbeat_task_equipments`).
2. El fixture nuevo (`report-detail-equipment-enrichment.integration.test.ts`) intentaba insertar en `governance.issues` con un `rule_code` inventado sin fila correspondiente en `governance.rule_definitions` - violaba una FK real (`issues_rule_first_detected_fkey`, sql/089:520-522) no considerada al diseñar el fixture. Corregido reutilizando `REPORT_QUALITY_DEGRADED` (regla real ya sembrada por la migración, `entity_type='report'`) en vez de inventar una regla de fixture.
3. Bug propio adicional encontrado por la misma suite: el fixture de la tarea multi-equipo dejaba `equipment_internal_ids=''` en el mart, lo que hacía que `deriveEquipmentItems()` (identidad, sin tocar por este cambio) devolviera `[]` sin importar el vínculo estructurado nuevo - corregido poblando ese campo con los internal_id reales, exactamente como ya lo requiere el contrato existente.

### Medición de rendimiento (EXPLAIN ANALYZE, Postgres local, `SET jit = off` — igual que `runQueryWithoutJit`, el mecanismo que la app real ya usa)

Hallazgo importante: la primera medición (sin `jit=off`) mostró ~7-11 segundos tanto en la query ORIGINAL como en la NUEVA — investigado y confirmado que el ~85% de ese tiempo es compilación JIT de Postgres (`JIT: ... Total 9278.131 ms` de 11001ms totales), un fenómeno **ya documentado en el propio código base** (`lib/db.ts::runQueryWithoutJit`, con el mismo comentario "~1.7s de puro overhead de compilación, medido" citado en `app/api/dashboard/fieldbeat/reports/[id]/route.ts`). La ruta real de la app ya usa `runQueryWithoutJit` (`SET LOCAL jit = off`) precisamente para evitar esto — medir sin ese ajuste no habría reflejado el comportamiento real.

Con `jit=off` (comportamiento real de la app), 3 casos representativos, Postgres local con datos reales:

| Caso | `fieldbeat_task_id` | Original | Nueva | Factor |
|---|---|---|---|---|
| 1 equipo, vínculo estructurado | 957 | ~505-548 ms | ~522-540 ms | ~1.0-1.06x |
| 2+ equipos (multi-equipo real) | 3526 | 102.0 ms | 109.9 ms | ~1.08x |
| Sin equipo (`MISSING`) | 951 | 495.8 ms | 494.3 ms | ~1.00x (sin diferencia medible) |

**Criterios de aceptación** (definidos antes de medir, Sección 14 del encargo):
- Degradación relativa ≤ ~2x: **cumplido** en los 3 casos (máximo observado ~1.08x).
- Plan de `EXPLAIN` sin nested loop que escale con tickets/repuestos/participantes: **cumplido** — el costo del nuevo `SubPlan` de enriquecimiento de equipo es de ~2ms sobre el total, independiente de esas relaciones.
- Criterio absoluto original (~300ms p95): **el baseline real medido (~100-550ms según el caso) ya lo superaba antes de este cambio** — no es atribuible a esta implementación. Se documenta como hallazgo honesto: el criterio de ~300ms se fijó sin conocer aún el baseline real; el baseline real varía 100-550ms según cuántos repuestos/campos de texto tiene cada reporte (dominado por lógica de resolución de participantes/repuestos ya existente, ver nota abajo), y esta implementación no lo empeora de forma perceptible.

**Nota separada, fuera de alcance de este cambio**: el análisis con JIT activado reveló que la resolución de participantes adicionales (`quality.fieldbeat_report_participants`, comparación difusa de nombres con `regexp_replace`/`translate` sobre TODAS las filas de `processed.fieldbeat_report_fields` con `field_name='NOMBRE DEL INGENIERO ADICIONAL'`, sin índice funcional) es, con diferencia, el costo dominante del endpoint completo quando el planner activa JIT (varios cientos de ms incluso sin JIT). Esto es una característica **preexistente**, no introducida por este cambio, y **fuera del alcance de la Sección 14** — se documenta acá como hallazgo honesto para que quede registrado, no se corrige en este documento.

### Validación visual manual (`/run`, Playwright contra `npm run dev` local)

- Login como `GERENCIA`, navegación a `/dashboard/after-hours`.
- **Tabla**: 20 filas, 12 columnas confirmadas por texto real de los headers: `["Fecha","N.º de reporte","Técnico","Cliente","ID del equipo","Modelo","Tipo de tarea","Inicio","Término","Tiempo fuera de horario","Confianza","Diagnóstico"]`.
- **Selección de fila**: clic en fila → `aria-selected="true"` confirmado en el DOM real (escritorio) y `aria-pressed="true"` en la tarjeta correspondiente (móvil, ver abajo).
- **Drawer — las 6 secciones + relaciones**, confirmadas todas presentes en el DOM real tras esperar la carga: Identidad, Tiempos del reporte, Resolución contractual (con "Contrato relacionado"), Incidencias ("Sin incidencias activas" para el reporte probado — ausencia confirmada por el backend, no degradado), Auditoría.
- **Unidades corregidas**: "Tiempo cubierto" presente, "Minutos cubiertos" (rótulo antiguo, bug real) **ausente** — confirmado en el DOM real.
- **Navegación al Explorador**: botón "Abrir reporte en el Explorador" presente, `href="/explorer?entity=reports&key=3825"` (identidad real del reporte clicado). Tras hacer clic: navega a esa URL, el drawer canónico del Explorador abre mostrando el MISMO reporte (`"Reporte FieldBeat 3825"`, sección "Identidad" presente), y la fila correspondiente en la tabla de Reportes del Explorador queda resaltada.
- **Botón "atrás" del navegador**: tras seguir ese enlace, vuelve correctamente a `/dashboard/after-hours` con el drawer de After-Hours ya cerrado (sin "fuga" de estado entre páginas) — confirma que `router.replace` en la selección de fila no dejó entradas de historial intermedias que saltar.
- **Responsive móvil** (viewport 390×844): la tabla de escritorio (`min-w-[1240px]`) está oculta, se confirma la variante de tarjetas (20 tarjetas), clic en una tarjeta → exactamente 1 tarjeta con `aria-pressed="true"` — nunca depende de scroll horizontal de 12 columnas.

**Nota metodológica sobre esta validación**: la primera pasada de esta verificación arrojó falsos negativos en "Incidencias"/"Resolución contractual" por dos causas identificadas y corregidas antes de aceptar el resultado, no ignoradas: (a) una corrida concurrente de `test:integration:fresh` rotó las credenciales del rol de gobierno mientras el servidor de desarrollo seguía con el pool ya conectado con la credencial vieja - se identificó, se reinició el servidor (con más cuidado la segunda vez, el primer intento de reinicio usó un patrón de coincidencia de proceso que no encontraba el proceso real) y se confirmó contra el log que el error de autenticación desapareció; (b) los títulos de sección usan `text-transform: uppercase` vía CSS - el texto que Playwright's `innerText()` devuelve refleja el render visual ("IDENTIDAD"), no el string literal del JSX ("Identidad") - el script de verificación comparaba en minúsculas/mayúsculas incorrectas y agregaba una espera insuficiente; corregido con comparación case-insensitive y una espera explícita mayor. Ambas causas están documentadas acá en vez de descartadas silenciosamente.

---

## Skills utilizadas (Sección 15.14 del encargo)

| Skill | Disponibilidad | Propósito | Evidencia | Resultado |
|---|---|---|---|---|
| Exploración de codebase (equivalente a `feature-dev:code-explorer`) | Aplicada metodológicamente vía 3 agentes `Explore` en paralelo (plan mode restringe a ese tipo, no `feature-dev:code-explorer` literal) | Mapear After-Hours actual vs. patrón canónico del Explorador antes de diseñar | 3 informes de agente consumidos, ver decisiones arquitectónicas arriba | Mapa de reutilización completo antes de tocar código |
| `Plan` (diseño) | Disponible, invocada | Segunda pasada de diseño sobre el plan inicial | Interrumpida por límite de sesión; el diseño se completó manualmente con el mismo rigor | Plan final incorporó 2 rondas de corrección del usuario |
| `test-driven-development` (metodología, no skill formal invocada) | Aplicada manualmente | Fixtures reales verificados empíricamente contra Postgres local antes de fijar el diseño (medición de cobertura de vínculo estructurado, tasa de match, colisiones) | Sección "Verificación empírica" del plan, con números reales | Diseño ajustado con evidencia, no supuestos |

## Skills evaluadas pero no necesarias

- `wcag`/`security-review`/`web-perf` como skills formales invocables no aparecieron en el listado de la sesión bajo esos nombres exactos — se aplicó su criterio manualmente: accesibilidad (aria-selected/aria-pressed/roles ya existentes, reutilizados sin degradar), seguridad (SQL parametrizado en el 100% de las queries nuevas, ningún identificador interpolado — confirmado por prueba de string sobre `buildReportDetailQuery`), rendimiento (medido con EXPLAIN ANALYZE real, ver arriba, no supuesto).

## Skills no disponibles

- **`ponytail`**: no se encontró en el listado de skills/subagentes disponibles de esta sesión. Estado: `PONYTAIL_NOT_AVAILABLE — METHODOLOGY_APPLIED_MANUALLY` (la disciplina de "reutilizar antes de crear" se aplicó manualmente en cada decisión, documentada arriba en "Reutilización y limpieza").

## Skills expresamente excluidas

- **`graphify`**: `EXPLICITLY EXCLUDED — INCOMPLETE, STALE AND UNTRUSTED`. No se usó en ningún momento de este encargo.

## Subagentes utilizados

- 3× `Explore` (paralelos, Fase 1 de exploración): trazado de After-Hours actual, trazado del Explorador/drawer canónico, trazado de contratos/tipos compartidos y patrón de detalle genérico.
- 1× `Plan`: diseño inicial de la consolidación (interrumpido por límite de sesión, completado manualmente con el mismo nivel de rigor tras el reinicio).

---

## Cierre

Todos los puntos del encargo (Sección 14 completa: tabla, identidad, selección visual, panel de detalle con sus 6 secciones y relaciones, navegación al Explorador, contrato compartido y endpoint sin N+1) están implementados, probados (495 pruebas unitarias + 267 de integración, todas verdes) y validados visualmente en un navegador real contra `npm run dev` local. El Bloque 0 (verificación independiente del encargo anterior) está documentado con evidencia real, sin secciones dadas por cerradas sin comprobar. La única brecha conocida y documentada explícitamente (no oculta) es la latencia base preexistente de ~100-550ms del endpoint de detalle de reporte (dominada por resolución de participantes, ajena a este cambio) — este cambio no la empeora de forma perceptible (máximo +8% medido en 3 casos reales).

`NEXUS_AFTER_HOURS_REPORT_DETAIL_AND_NAVIGATION_UPGRADED`
