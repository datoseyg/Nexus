# 11 -Registro de decisiones de producto

Cada entrada: contexto, evidencia, alternativas, impacto, responsable requerido, estado (`OPEN`/`DECIDED`/`DEFERRED`/`REJECTED`), bloqueo sobre Claude Design. Mientras una entrada esté `OPEN`, `10-audit-summary.md` § `DESIGN READINESS GATE` la trata como bloqueante para el módulo que le corresponde.

---

### D1 -Vigencia de CERBERUS

- **Contexto:** `docs/legacy/relevamiento_maestro_nexus_cerberus.html` documenta un contrato cerrado ("Monto cerrado Fase 1: $3.000.000 CLP", "Alcance: TODO NEXUS + TODO CERBERUS") donde CERBERUS es un motor formal de calidad de reportes FieldBeat con fórmula ponderada `integridad_reporte` y clasificación de 4 niveles (apto/parcial/dudoso/no apto).
- **Evidencia:** STATIC_DOC+EXTERNAL_OFFICIAL_SOURCE `docs/legacy/relevamiento_maestro_nexus_cerberus.html:212-220,650-727`. AUSENCIA CONFIRMADA en código: `git grep -i cerberus 4a3d055 -- . ':!docs/legacy'` → 0 resultados.
- **Alternativas:** (a) construir CERBERUS como se contrató originalmente; (b) declarar formalmente que el `data_quality_status`/`report_quality_status` ya implementado (`05-business-metrics.md`) es la versión final y CERBERUS queda descartado; (c) construir una versión reducida.
- **Impacto:** si (a), el frontend necesita una pantalla/dashboard ejecutivo de calidad que hoy no existe en ningún lugar del código. Si (b)/(c), no se debe diseñar nada adicional más allá de lo que `01-functional-inventory.md`§B ya documenta.
- **Responsable requerido:** dueño de producto (quien contrató la Fase 1).
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** no diseñar ningún "dashboard CERBERUS" ni renombrar la UI de calidad de datos existente a "CERBERUS" hasta que esta entrada se resuelva.

### D2 -Vigencia de JANUS y ATLAS

- **Contexto:** mismo documento, Fase 2 proyectada "~6 meses después" -JANUS (uptime/downtime con confianza formal) y ATLAS (base de datos operacional unificada).
- **Evidencia:** `docs/legacy/relevamiento_maestro_nexus_cerberus.html:220,273,518,523`. AUSENCIA CONFIRMADA en código (mismo comando que D1).
- **Alternativas:** (a) confirmar que la Fase 2 sigue vigente y su horizonte; (b) declararla descartada; (c) redefinir su alcance a la luz de lo ya construido (el tab Uptime/Downtime actual es un antecedente parcial y auto-limitado de JANUS, no una implementación de JANUS).
- **Impacto:** determina si el tab Uptime/Downtime actual (`01`§B, `08`) debe diseñarse como versión preliminar de algo mayor, o como una pieza definitiva y autocontenida.
- **Responsable requerido:** dueño de producto.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** no asumir que el tab Uptime/Downtime actual "es" JANUS ni diseñarlo como si tuviera el alcance formal prometido para JANUS.

### D3 -Propósito futuro de `/api/admin/**`

- **Contexto:** 10 rutas CRUD completas y funcionales (confirmado LOCAL_RUNTIME), sin ningún caller en la UI del repo.
- **Evidencia:** `04-data-and-api-contracts.md` § Administración; STATIC_CODE -grep confirma cero imports desde `components/**`.
- **Alternativas:** (a) construir un "Centro de Correcciones" que las use, como ya prometen los tooltips de `FutureActionButton.tsx`; (b) mantenerlas como API server-to-server sin UI nunca; (c) exponer solo un subconjunto.
- **Impacto:** determina si `/audit/manual-review` (parte de acciones) y el CRUD de `stock.stock_movements` deben diseñarse.
- **Responsable requerido:** dueño de producto.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** no diseñar flujos de escritura para Auditoría/Stock hasta resolver esta entrada -ver clasificación `blocked by product decision` en `08`.

### D4 -Definición de usuarios humanos

- **Contexto:** cero actores humanos observados en runtime (sin telemetría, sin sesiones); las "personas de negocio" de `02-users-roles-and-tasks.md`§4 son inferencias.
- **Evidencia:** AUSENCIA CONFIRMADA de analytics/sesión -ver `02`§1,§3.
- **Alternativas:** (a) el dueño de producto confirma/corrige la lista de personas inferidas; (b) se instala telemetría antes de diseñar más a fondo; (c) se diseña igual, documentando explícitamente que las personas son PROPUESTA.
- **Impacto:** afecta directamente el tono, densidad de información y nivel de tecnicismo que Claude Design debería asumir para cada pantalla.
- **Responsable requerido:** dueño de producto.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** cualquier persona/perfil de usuario que use Claude Design debe citarse como PROPUESTA, nunca presentarse como validada con usuarios reales.

### D5 -Autenticación y roles

- **Contexto:** no existe sistema de usuarios; solo un gate server-to-server (`NEXUS_ADMIN_TOKEN`) desconectado de cualquier UI.
- **Evidencia:** `02-users-roles-and-tasks.md`§1; STATIC_CODE `lib/auth.ts:6-11` (comentario propio del código dice que esto es temporal, "hasta que exista login/sesión/middleware real").
- **Alternativas:** (a) construir login real con roles; (b) mantener el modelo actual (público + token oculto) indefinidamente; (c) un modelo intermedio (login simple sin roles diferenciados).
- **Impacto:** alto -determina si el nuevo frontend necesita pantallas de login/gestión de usuarios, y si distintas pantallas deben ocultarse por rol.
- **Responsable requerido:** dueño de producto + quien vaya a operar la seguridad.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** no diseñar pantallas de login/gestión de usuarios sin esta decisión -hoy no hay ninguna evidencia de qué modelo se quiere.

### D6 -Capacidad de escritura de Auditoría

- **Contexto:** `FutureActionButton.tsx` promete una acción ("Centro de Correcciones") sin que exista definición de qué hace cada tipo de acción sobre `manual_review.*`/`audit.data_quality_events`.
- **Evidencia:** `01-functional-inventory.md`§B; `sql/050_manual_review.sql:1-9`.
- **Alternativas:** (a) definir la semántica exacta de cada acción (aprobar alias, vincular ticket corregido, marcar placeholder como resuelto) antes de diseñar; (b) diseñar una versión mínima genérica ("marcar visto"); (c) posponer indefinidamente.
- **Impacto:** alto para `/audit/manual-review` -es la única pantalla del producto con una promesa de escritura visible mas no implementada.
- **Responsable requerido:** dueño de producto + quien conozca el flujo operativo real de curación de datos.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** ver `08` -clasificado `blocked by product decision`.

### D7 -Estado de Equipment Lifecycle

- **Contexto:** dashboard completo (pantallas, componentes, rutas API) existe en `cloud-d1-readonly`/`cloud-smoke-test`; en `supabase-migration` solo sobreviven las tablas Postgres como snapshot, sin builder ni UI.
- **Evidencia:** `docs/TECH_DEBT_UNREPRODUCIBLE_TABLES.md:20-26`; AUSENCIA CONFIRMADA en `supabase-migration` (`find apps/nexus-bi-app/app -iname "*lifecycle*"` → sin resultados).
- **Alternativas:** (a) portar el dashboard completo desde `cloud-d1-readonly` a `supabase-migration`; (b) descartarlo definitivamente; (c) rediseñarlo desde cero con Claude Design usando solo los datos y sin el código de la otra branch.
- **Impacto:** si (a) o (c), es una pantalla nueva de tamaño considerable a incorporar al mapa de navegación.
- **Responsable requerido:** dueño de producto.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** no diseñar esta pantalla todavía -ver `08`/`10` § pantallas que no deben diseñarse todavía.

### D8 -Clasificación de Explorer y Search

- **Contexto:** ambas pantallas leen como herramientas internas de depuración (browser genérico de tabla, panel de "SQL ejecutada" visible) más que como superficie de producto para las personas de negocio inferidas.
- **Evidencia:** `08-screen-evidence-matrix.md` § `/explorer`, § `/search`.
- **Alternativas:** (a) confirmar que son herramientas internas y sacarlas del mapa de producto (`03`); (b) confirmar que sí son producto y justificar por qué exponen SQL crudo a un usuario de negocio; (c) mantener ambas pero re-diseñadas para un público no técnico.
- **Impacto:** medio -afecta el alcance del rediseño y el tono de esas 2 pantallas.
- **Responsable requerido:** dueño de producto.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** tratar ambas como `not recommended` para el diseño orientado a negocio hasta que se resuelva (ya reflejado en `03`/`08`).

### D9 -Branch y deployment canónicos

- **Contexto:** `supabase-migration` es la branch auditada y con HEAD más reciente, pero no hay evidencia en el repo de que sea la que Netlify efectivamente despliega, ni de si/cuándo se mergea a `main`.
- **Evidencia:** `00-audit-baseline.md` § Configuración de despliegue -DESCONOCIDA la branch/URL de producción real.
- **Alternativas:** (a) el dueño de producto confirma la branch/URL de producción; (b) se conecta el CLI de Netlify para verificarlo en runtime.
- **Impacto:** afecta si esta auditoría (basada en `supabase-migration`) efectivamente describe lo que un usuario real ve hoy.
- **Responsable requerido:** quien administre la cuenta de Netlify.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** ninguno directo sobre el diseño visual, pero si se requiere validar el resultado final contra producción, esta entrada debe resolverse primero.

### D10 -Fuentes oficiales de branding

- **Contexto:** no existe manual de marca, logo vectorial ni tipografía oficial en ningún branch del repositorio (ver `07-brand-system.md`).
- **Evidencia:** `07-brand-system.md` § 2-3; búsqueda de assets de imagen en las 5 branches → 0 resultados.
- **Alternativas:** (a) el dueño de producto aporta un manual de marca real de EyG; (b) se ratifican los tokens actuales de `globals.css` como la paleta oficial de facto; (c) Claude Design propone un sistema nuevo desde cero.
- **Impacto:** alto para cualquier trabajo de identidad visual del nuevo frontend.
- **Responsable requerido:** dueño de producto / equipo de marketing-comunicaciones de EyG si existe.
- **Estado:** `OPEN`.
- **Bloqueo sobre Claude Design:** no presentar los tokens de `globals.css` como "la marca oficial de EyG" -solo como el punto de partida de implementación confirmado.

---

## Metodología de esta auditoría (nota de alcance, no una decisión de producto)

Toda verificación runtime citada en este registro y en el resto de `docs/design-context/` se realizó bajo autorización de **lectura y análisis únicamente**. Ninguna prueba ejecutó escritura, sincronización, eliminación ni ningún efecto lateral sobre una base real -ver el detalle completo de la regla y los comandos ejecutados en `00-audit-baseline.md`.

## Fuentes

Todas las citadas inline; síntesis cruzada de `01`, `02`, `05`, `07`, `08`.
