# 10 -Síntesis de la auditoría

Commit auditado: `4a3d055` (`supabase-migration`). Ver `00-audit-baseline.md` para la línea base completa.

## 1. Mapa funcional consolidado

| Módulo | ¿Tiene pantalla? | Pantalla(s) |
|---|---|---|
| Ingesta (Zendesk/FieldBeat/Dolibarr) | No | -(CLI únicamente) |
| Normalización, resolución de identidad, marts, QA, GOLD, warehouse, migración Postgres | No | -(CLI únicamente) |
| Explorador de tablas | Sí | `/explorer` |
| Búsqueda | Sí | `/search` |
| Dashboard FieldBeat | Sí | `/dashboard/fieldbeat` |
| Dashboard Operacional + Uptime/Downtime | Sí | `/dashboard/operacional` (2 tabs) |
| Trabajo Fuera de Horario | Sí | `/dashboard/after-hours` |
| Auditoría (lectura) | Sí | `/audit/manual-review` |
| Auditoría (escritura) / CRUD admin (5 recursos) | No | -(API existe, sin caller) |
| Automatización de stock | No | -(tabla existe, sin escritor ni UI) |
| CERBERUS / JANUS / ATLAS | No | -(prometidos, no construidos bajo ese nombre) |
| Equipment Lifecycle | No (en esta branch) | Existe completo en `cloud-d1-readonly`/`cloud-smoke-test` |

**11 de 17 módulos identificados no tienen ninguna superficie de UI en la branch auditada** -la mayoría por diseño (pipeline es CLI), algunos por decisión de producto pendiente (CRUD admin, stock, CERBERUS/JANUS/ATLAS, Equipment Lifecycle).

## 2. Contradicciones encontradas (rankeadas por potencial de inducir a error de diseño)

1. **CERBERUS/JANUS/ATLAS** -contrato cerrado y pagado ("TODO NEXUS + TODO CERBERUS", $3M CLP), cero rastro en código vigente. Home: `00-product-north-star.md`, `11-product-decision-register.md` D1/D2.
2. **Cloudflare vs. Supabase+Netlify** -dos HTML en la raíz del repo presentan Cloudflare como plan vigente; es LEGACY, congelado por requisito de tarjeta. Home: `docs/ARCHITECTURE.md:64-74` (fuente canónica), `00-product-north-star.md`.
3. **`CLAUDE.md` raíz obsoleto** -describe solo la Fase 0 (miners), cero mención de normalizadores/marts/GOLD/DuckDB/Supabase/`apps/`. No usar como fuente de estado actual en ningún archivo de este directorio.
4. **`apps/nexus-bi-app/lib/duckdb.ts` código muerto** -nunca importado por ninguna ruta activa; su existencia puede confundir a quien busque "cómo lee datos la app". La app real usa `lib/db.ts` (Postgres).
5. **`src/lib/calculation-confidence.js` referenciado por comentarios de código vigente pero inexistente en esta branch** -solo recuperable vía `git show 7e69d7c:...` (rama `cloud-smoke-test`). Corrige la afirmación inicial de "3 implementaciones paralelas" -son 2 en esta branch (consistentes entre sí) + 1 legacy. Ver `05-business-metrics.md`.
6. **`docs/VISUAL_REDESIGN_EYG.md`/`DASHBOARD_VISUAL_STYLE.md` referenciados por código vigente, ausentes del `docs/` actual** -mismo patrón de doc-drift entre branches que los puntos 2 y 5. Los tokens que documentan sí están vigentes (paridad confirmada por `git diff`); el documento no.
7. **Conteo de rutas API** -la exploración inicial reportó 33; el conteo directo de esta sesión confirma **34**. Corregido en `04-data-and-api-contracts.md` y en `api-inventory.json`.

## 3. Vacíos que impedirían diseñar con seguridad (cross-ref `11-product-decision-register.md`)

- Modelo real de usuarios/roles (D4, D5) -sin esto, cualquier segmentación de UI por perfil es especulativa.
- Semántica de escritura de Auditoría (D6) -sin esto, no se puede diseñar el flujo de "resolver" un ítem.
- Vigencia de CERBERUS/JANUS/ATLAS (D1, D2) -sin esto, no se sabe si falta construir un módulo entero.
- Propósito de `/api/admin/**` (D3) y estado de Equipment Lifecycle (D7) -mismo riesgo.
- Fuentes oficiales de marca (D10) -sin esto, cualquier sistema visual que se proponga no puede llamarse "la marca de EyG".
- Branch/URL de producción real (D9) -sin esto, no se puede confirmar que lo auditado (`supabase-migration` local) sea lo que un usuario real ve hoy.

## 4. Pantallas prioritarias para el MVP (clasificación completa en `08-screen-evidence-matrix.md`)

`design ready`: `/`, `/dashboard/fieldbeat`, `/dashboard/operacional` (tab Operacional, con nota de alcance obligatoria), `/dashboard/after-hours`, `/audit/manual-review` (solo la parte de lectura).
`designable with assumptions`: `/dashboard/operacional` (tab Uptime/Downtime) -asunción obligatoria: preservar el disclaimer "no es downtime real".

## 5. Pantallas que no deben diseñarse todavía

- `/audit/manual-review` (parte de **acciones**) -`blocked by product decision` (D6).
- `/explorer`, `/search` -`not recommended` para el producto orientado a negocio; se leen como herramientas internas de depuración, no como tareas de las personas inferidas en `02`. Pendiente D8.
- Equipment Lifecycle -no existe en esta branch; `blocked by product decision` (D7).
- Cualquier UI de `/api/admin/**` -`blocked by product decision` (D3); no hay evidencia de intención de diseño, diseñarla ahora sería inventar.

## 6. Archivos concretos que Claude Design deberá recibir

**Paquete primario (los 14 de `docs/design-context/`):** `00-audit-baseline.md`, `00-product-north-star.md`, `01-functional-inventory.md`, `02-users-roles-and-tasks.md`, `03-information-architecture.md`, `04-data-and-api-contracts.md`, `05-business-metrics.md`, `06-system-states.md`, `07-brand-system.md`, `08-screen-evidence-matrix.md`, `09-design-principles.md`, `10-audit-summary.md` (este archivo), `11-product-decision-register.md`, `12-security-privacy-accessibility.md`, más los 5 artefactos máquina-legibles (`api-inventory.json`, `metric-catalog.yaml`, `route-screen-matrix.json`, `design-tokens-current.json`, `data-status-vocabulary.json`).

**Referencia viva, no copiar contenido:** `docs/GOLD_DATA_CONTRACT.md`, `docs/SCOPE_AND_LIMITATIONS.md`, `docs/DATA_DICTIONARY.md` -para semántica de columna más allá de lo resumido aquí.

**Instrucción explícita -NO usar como estado actual:** `readme-arquitectural.html`, `target-architecture-cloudflare.html` (raíz del repo), `CLAUDE.md` (raíz), cualquier archivo bajo `docs/legacy/` -solo como contexto histórico si hace falta, siempre etiquetado LEGACY.

---

## DESIGN READINESS GATE

**Nivel general de preparación: PARCIAL -bloqueado en 6 decisiones críticas abiertas (D1, D2, D3, D4, D5, D6 en `11-product-decision-register.md`), con 3 decisiones adicionales de menor bloqueo (D7, D9, D10).**

### Decisiones bloqueantes (todas `OPEN` en `11-product-decision-register.md`)

D1 (CERBERUS), D2 (JANUS/ATLAS), D3 (`/api/admin/**`), D4 (usuarios humanos), D5 (auth/roles), D6 (escritura de Auditoría), D7 (Equipment Lifecycle), D8 (Explorer/Search), D9 (branch/deploy canónico), D10 (branding oficial).

### Datos faltantes

- Calendario laboral y feriados reales (`businessHoursStatus`/`holidaysStatus` = `"MISSING"`, confirmado LOCAL_RUNTIME) -afecta la confianza de todo el dashboard After-Hours.
- Fecha de actualización y responsable de cada tabla GOLD (`05-business-metrics.md`, ausencia confirmada por grep).
- Builder reproducible de `marts.fieldbeat_working_hours_analysis` en esta branch (existe solo en `cloud-d1-readonly`) -riesgo de continuidad si se pierde el warehouse actual.

### Fuentes no verificadas (`NOT_RUNTIME_VERIFIED`)

- Todo lo relativo a `DEPLOYED_RUNTIME` (Netlify producción) -sin URL conocida, ver `00-audit-baseline.md`.
- Comportamiento visual de estados `loading` (transitorios de cliente, no observables por `curl`).
- Accesibilidad (WCAG) -no se ejecutó ningún auditor automático en esta sesión.
- Si la instancia de Supabase usada en esta auditoría es la misma que sirve producción.

### Módulos aptos para diseño

`/`, `/dashboard/fieldbeat`, `/dashboard/operacional` (ambas tabs, con las notas obligatorias ya indicadas), `/dashboard/after-hours`, `/audit/manual-review` (solo lectura).

### Módulos aptos solo para exploración (no para diseño de producto final)

`/explorer`, `/search` -mantener como herramientas internas si se conservan, fuera del flujo de diseño de producto hasta D8.

### Módulos que no deben diseñarse

`/audit/manual-review` (acciones), cualquier UI de `/api/admin/**`, Equipment Lifecycle, cualquier "dashboard CERBERUS" o rebranding de la UI de calidad de datos existente hacia ese nombre.

### Instrucción final

**Claude Design no debe recibir mandato de producir el frontend definitivo de Nexus mientras D1-D6 permanezcan `OPEN`.** Puede y debe trabajar sobre los módulos "aptos para diseño" listados arriba, con las notas de alcance obligatorias de `08-screen-evidence-matrix.md`, mientras el dueño de producto resuelve el resto del registro de decisiones.
