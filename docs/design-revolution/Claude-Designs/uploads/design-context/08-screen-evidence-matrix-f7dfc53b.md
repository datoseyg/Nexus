# 08 -Matriz de evidencia por pantalla

Nivel pantalla (ruta × composición de UI) -complementa sin duplicar `01-functional-inventory.md` (capacidad). Las 7 rutas, todas confirmadas LOCAL_RUNTIME (200) en esta sesión.

Clasificación de prioridad por 8 factores (corrección del usuario, punto 10) → una de: `design ready` / `designable with assumptions` / `blocked by product decision` / `blocked by data` / `blocked by security` / `not recommended`.

---

## `/dashboard/fieldbeat`

- **Objetivo:** lectura agregada del universo FieldBeat completo (report-céntrico, sin depender del alcance Zendesk).
- **Usuario (cross-ref `02`):** analista BI / gerencia operacional (PROPUESTA).
- **Tarea (cross-ref `02`):** revisar volumen de reportes y consumo de repuestos por cliente/equipo.
- **Ruta:** `app/dashboard/fieldbeat/page.tsx`.
- **Datos:** `GET /api/dashboard/fieldbeat` (ver `04`) -5 queries fijas a GOLD, sin filtros de usuario.
- **Acciones:** ninguna de escritura; solo lectura.
- **Componentes:** `MetricCard`×7, `HorizontalBarChart`×3.
- **Estados:** loading/error/null-data explícitos en `page.tsx:54-70` (STATIC_CODE).
- **Evidencia:** LOCAL_RUNTIME 200, `{kpis,dataQuality:[6],reportsByClient:[10],partsConsumptionByClient:[10],topEquipmentByParts:[10]}`.
- **Incertidumbres:** ninguna cifra en pantalla enlaza a `docs/SCOPE_AND_LIMITATIONS.md` -un lector puede no saber que este universo (3747 tasks) es distinto del universo ticket-céntrico (628 tickets) que muestra `/dashboard/operacional`.

**Clasificación:** valor de negocio alto (única vista del universo FieldBeat completo) · frecuencia esperada alta (PROPUESTA) · criticidad media · cobertura de datos alta (100% de FieldBeat, sin depender de Zendesk) · sin capacidad de acción (100% lectura, consistente con el resto del producto) · madurez técnica alta (sin stubs, sin `null` forzados) · riesgo bajo · sin dependencia de decisiones pendientes → **design ready**.

---

## `/dashboard/operacional` (2 tabs: Operacional, Uptime/Downtime)

- **Objetivo (tab Operacional):** cruce ticket-céntrico Zendesk↔FieldBeat↔Dolibarr con filtros y cross-filter.
- **Objetivo (tab Uptime/Downtime):** horas registradas por tipo de tarea -**explícitamente no es disponibilidad de equipo real**.
- **Usuario:** analista BI / gerencia operacional (PROPUESTA).
- **Tarea:** explorar volumen por cliente/máquina/período; en la tab Uptime, revisar horas registradas con la salvedad ya visible en pantalla.
- **Ruta:** `app/dashboard/operacional/page.tsx` → `DashboardShell.tsx` → `OperationalDashboardTab.tsx` / `UptimeDowntimeTab.tsx`.
- **Datos:** `GET /api/dashboard/operacional/{filters,summary,parts,detail}` y `/api/dashboard/uptime/{summary,table,tasks}` (ver `04`).
- **Acciones:** filtros cruzados con auto-exclusión, click-to-filter en gráficos, export JSON (summary) client-side, botón manual "⟳ Actualizar Datos" (sin auto-polling).
- **Componentes:** `ChartCard`, `FilterBar`, `FilterChips`, `DateRangePicker`, `KpiCard`, `DataTableCard`, `MiniBarTableCell` (sistema visual propio vía `dashboard.module.css`, distinto del resto de la app).
- **Estados:** `pendingBanner` explícito en la tab Uptime (STATIC_CODE `UptimeDowntimeTab.tsx:211-216`) -confirmado LOCAL_RUNTIME (`downtimeWarning:true`).
- **Evidencia:** LOCAL_RUNTIME -`totalRegistros:3747, totalTickets:628, pctConTicketAccesible:7.74%` (tab Operacional); `totalHorasRegistradas:8234.45, downtimeWarning:true` (tab Uptime).
- **Incertidumbres:** `bodegas` (25.6% cobertura) y `origenRegistro` (heurística `LIKE '%APOTECA%'`) son señaladas como heurísticas por el propio código, pero conviene decidir si Claude Design las presenta con el mismo peso visual que un filtro confiable.

**Clasificación (tab Operacional):** valor de negocio alto (es la vista principal de negocio, ticket-céntrica) · frecuencia alta (PROPUESTA) · criticidad alta · cobertura de datos **baja** (7.74% de accesibilidad confirmada -ver `05`) · sin capacidad de acción · madurez técnica alta (ruta más grande y más filtrada de la app) · riesgo medio (números pequeños/engañosos sin contexto) · sin decisión pendiente que la bloquee → **design ready, con nota obligatoria de que el diseño debe transmitir visualmente el alcance limitado (7.74%), no solo los números absolutos**.

**Clasificación (tab Uptime/Downtime):** valor de negocio medio (la propia app dice que no es la métrica real que se quiere) · frecuencia media (PROPUESTA) · criticidad baja (auto-advertida) · cobertura de datos alta para lo que sí mide (horas registradas) · sin capacidad de acción · madurez técnica media (`hcCalc/uptimePct/tha/hcTeorica` fijos en `null`) · riesgo medio-alto (nombre "Uptime/Downtime" es engañoso si se diseña sin la advertencia) → **designable with assumptions** -asunción requerida: el diseño debe mantener o reforzar el disclaimer "no es downtime real", nunca ocultarlo por razones estéticas.

---

## `/dashboard/after-hours`

- **Objetivo:** medir trabajo fuera de horario laboral con score de confianza metodológica explícito.
- **Usuario:** analista BI / gerencia operacional (PROPUESTA).
- **Tarea:** revisar tasa de trabajo fuera de horario por cliente/técnico/período, filtrando por nivel de confianza.
- **Ruta:** `app/dashboard/after-hours/page.tsx` → `AfterHoursShell.tsx`.
- **Datos:** 7 rutas `GET /api/dashboard/after-hours/*` (ver `04`).
- **Acciones:** filtros (cliente/técnico/tipo/fecha/nivel de confianza/`onlyAfterHours`/`onlyLowConfidence`); sin escritura.
- **Componentes:** `AfterHoursKpiGrid` (con `MetricCardWithConfidence`), `AfterHoursFilterBar`, `AfterHoursByPeriodChart`, `ConfidenceDistributionChart` (color semántico por tier), `AfterHoursDetailTable`.
- **Estados:** loading/error/empty vía `ResponsiveTableShell`; copy explícito en `page.tsx:24-28` ("methodological, not statistical").
- **Evidencia:** LOCAL_RUNTIME -`businessHoursStatus:"MISSING", holidaysStatus:"MISSING"`, confianza 79.3 "Media" en los 4 KPIs principales.
- **Incertidumbres:** el algoritmo que calcula el `confidence_score` por tarea es LEGACY (no reproducible en esta branch, ver `05`) -los valores que la pantalla muestra son un snapshot heredado, no algo que el pipeline actual sepa recalcular. Esto no impide diseñar la pantalla, pero sí debería documentarse como una limitación operativa conocida (si se pierde el warehouse actual, esta pantalla no tiene forma de regenerar sus propios números en esta branch).

**Clasificación:** valor de negocio medio-alto · frecuencia media (PROPUESTA) · criticidad media · cobertura de datos media (confianza declarada "Media", nunca "Alta", en los KPIs principales) · sin capacidad de acción · madurez técnica alta (la más sofisticada en manejo de incertidumbre de todo el producto -es la única pantalla que expone su propia confianza) · riesgo bajo (ya se autolimita correctamente) · dependencia de datos ausentes (calendario laboral/feriados) documentada en pantalla, no oculta → **design ready**.

---

## `/audit/manual-review` (6 tabs: quality, parts, ambiguous, placeholders, reports, tickets)

- **Objetivo (lectura):** exponer reportes/repuestos/tickets con calidad de dato degradada.
- **Objetivo (acciones):** **no cumplido** -cada botón de acción está deshabilitado.
- **Usuario:** responsable de calidad de datos (PROPUESTA, sin persona confirmada -ver `02`§4).
- **Tarea:** revisar backlog de items que necesitan curación manual.
- **Ruta:** `app/audit/manual-review/page.tsx` → `AuditManualReviewShell.tsx`.
- **Datos:** 6 rutas `GET /api/audit/*` (ver `04`).
- **Acciones:** **ninguna real** -`FutureActionButton.tsx` en las 5 secciones de tabla, `title="Disponible cuando se active Centro de Correcciones"`.
- **Componentes:** `QualitySummarySection`, `PartsReviewSection`, `AmbiguousPartsSection`, `PlaceholdersSection`, `ReportsReviewSection`, `TicketLinksReviewSection`, `AuditFilterBar`.
- **Estados:** loading/error/empty vía `ResponsiveTableShell`; badge de conteo en `NavBar` (`reportsReviewRequired`).
- **Evidencia:** LOCAL_RUNTIME -`reportsReviewRequired:1329`, `partsAmbiguous:56`, `partsPlaceholder:721`.
- **Incertidumbres:** qué significa exactamente "resolver" cada tipo de item (aprobar un placeholder, confirmar un alias) no está definido en ningún doc ni en el schema más allá del nombre de columna -ver `11-product-decision-register.md`, entrada "Capacidad de escritura de Auditoría".

**Clasificación (parte de lectura: listados/filtros/resumen):** valor de negocio alto (es la única vista de backlog de calidad de dato) · frecuencia media-alta (PROPUESTA) · criticidad alta · cobertura de datos alta (los 6 endpoints funcionan y traen datos reales) · **sin capacidad de acción** (factor limitante) · madurez técnica media (patrón repetido consistente en las 5 secciones) · riesgo bajo para la parte de lectura · sin decisión pendiente que bloquee **mostrar** el backlog → **design ready, solo para la parte de lectura**.

**Clasificación (parte de acciones -aprobar/resolver/vincular):** → **blocked by product decision**. No hay definición de qué hace cada acción sobre `manual_review.*`/`audit.data_quality_events`, ni evidencia de que el dueño del producto haya decidido activar "Centro de Correcciones". Diseñar flujos de acción ahora significaría inventar semántica de negocio que no existe en ningún artefacto del repo. Ver `11-product-decision-register.md`.

---

## `/explorer`

- **Objetivo:** navegar cualquier tabla de `processed/marts/gold` con paginación/orden/filtro de una columna.
- **Usuario:** perfil técnico/QA interno (PROPUESTA -no hay evidencia de que una persona de negocio lo use).
- **Tarea:** depuración, verificación puntual de una tabla.
- **Ruta:** `app/explorer/page.tsx`.
- **Datos:** `GET /api/tables`, `GET /api/tables/[schema]/[table]`.
- **Acciones:** export CSV client-side de la página actual.
- **Componentes:** `DataTable` (TanStack Table), `PaginationControls`.
- **Estados:** loading/error explícitos.
- **Evidencia:** LOCAL_RUNTIME 200, 40 tablas listadas, navegación funcional confirmada sobre 3 tablas de ejemplo.
- **Incertidumbres:** sin información de negocio (nombres de columna crudos, sin traducción a vocabulario de dominio) -refuerza la lectura de herramienta interna.

**Clasificación:** valor de negocio bajo para una persona de negocio final (alto solo para debugging técnico) · frecuencia desconocida · criticidad baja · cobertura de datos total (accede a las 40 tablas) · capacidad de acción nula (solo lectura+export) · madurez técnica alta pero deliberadamente genérica · riesgo de exposición de datos más alto que cualquier otra pantalla (ver `12-security-privacy-accessibility.md` -accede a cualquier columna de cualquier tabla de `processed/marts/gold` sin restricción de columna) · sin decisión de producto que confirme su rol → **not recommended** para el diseño de producto orientado a las personas de negocio de `02`; si se conserva, debe enmarcarse explícitamente como herramienta interna, fuera de la IA recomendada (`03`).

---

## `/search`

- **Objetivo:** búsqueda libre por palabra clave sobre FieldBeat/Zendesk.
- **Usuario:** perfil técnico/QA interno (PROPUESTA), mismo razonamiento que `/explorer`.
- **Tarea:** ubicar rápidamente un reporte/ticket por texto.
- **Ruta:** `app/search/page.tsx`.
- **Datos:** `GET /api/search?q=`.
- **Acciones:** ninguna de escritura; panel de "SQL ejecutada" visible (transparencia técnica, no una acción de negocio).
- **Componentes:** `DataTable` con `RESULT_COLUMNS` fijo, `QueryDisclosure`.
- **Estados:** loading ("buscando…"), empty explícito, error 400 si falta `q` (confirmado LOCAL_RUNTIME).
- **Evidencia:** LOCAL_RUNTIME 200, `q=bomba` → 45 resultados.
- **Incertidumbres:** exponer la SQL ejecutada a un usuario final es una decisión de transparencia técnica que no encaja con un perfil de negocio no técnico -otro indicio de herramienta interna.

**Clasificación:** mismo razonamiento que `/explorer` → **not recommended** para el diseño de producto orientado a negocio; conservar como herramienta interna si se mantiene.

---

## `/` (landing)

- **Objetivo:** enlazar las 6 pantallas y declarar el estado del producto ("Fase 1 MVP - solo lectura").
- **Usuario:** cualquiera que entre a la app.
- **Datos:** ninguno -contenido estático (`SCREENS`/`NOT_YET` arrays en `page.tsx:5-44`).
- **Incertidumbres:** el array `NOT_YET` en `page.tsx:38-44` está desactualizado respecto al propio código (menciona "Autenticación / multiusuario" como no implementado, lo cual sigue siendo cierto, pero la redacción no refleja que sí existe un gate server-to-server parcial) -corregible al diseñar, no bloqueante.

**Clasificación:** landing de bajo riesgo, sin datos ni acciones → **design ready**.

---

## Resumen de clasificación

| Pantalla | Clasificación |
|---|---|
| `/dashboard/fieldbeat` | design ready |
| `/dashboard/operacional` (tab Operacional) | design ready (con nota de alcance obligatoria) |
| `/dashboard/operacional` (tab Uptime/Downtime) | designable with assumptions |
| `/dashboard/after-hours` | design ready |
| `/audit/manual-review` (lectura) | design ready |
| `/audit/manual-review` (acciones) | blocked by product decision |
| `/` | design ready |
| `/explorer` | not recommended (para producto orientado a negocio) |
| `/search` | not recommended (para producto orientado a negocio) |

## Fuentes

Los 7 `page.tsx`/shells de pantalla, los 34 `route.ts` (ver `04`), `docs/SCOPE_AND_LIMITATIONS.md`, `02-users-roles-and-tasks.md`, `05-business-metrics.md`, sondeo LOCAL_RUNTIME completo de esta sesión.
