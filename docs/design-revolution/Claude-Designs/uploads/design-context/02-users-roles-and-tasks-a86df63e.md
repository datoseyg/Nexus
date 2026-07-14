# 02 -Usuarios, roles y tareas

Regla dura de esta auditoría: **el usuario anónimo público y el caller portador de `NEXUS_ADMIN_TOKEN` nunca se etiquetan como "persona de negocio."** Ambos son condiciones de acceso técnicas, no personas. Este archivo separa cinco capas distintas que la exploración inicial tendía a mezclar.

## 1. Roles de autorización (los únicos que existen en código -AS_IS)

| Rol de autorización | Definición | Evidencia | Estado |
|---|---|---|---|
| Anónimo público | Cualquier request sin credenciales; cubre 6 de 7 rutas de producto y 23 de 33 rutas API | STATIC_CODE -ausencia de middleware: `find apps/nexus-bi-app -iname "middleware.ts"` → sin resultados; `grep -rniE "signIn|signOut|useSession|NextAuth|clerk|supabase\.auth|getServerSession" apps/nexus-bi-app` → sin resultados (commit `4a3d055`) | AS_IS · CONFIRMADA (ausencia) |
| Caller server-to-server con token | Header `x-nexus-admin-token` comparado contra `NEXUS_ADMIN_TOKEN`; gatea 10 rutas `/api/admin/**` | STATIC_CODE `lib/auth.ts:6-32`; LOCAL_RUNTIME: `GET` sin token → 401 `{code:"UNAUTHORIZED"}` en las 5 familias de rutas admin probadas; `GET` con token → 200 | AS_IS · CONFIRMADA |

**No existe** un tercer rol (usuario autenticado con sesión, "editor", "admin de UI", etc.) en ningún punto del código auditado. El propio código documenta la intención: `lib/auth.ts:6-11` dice explícitamente que esto es server-to-server, "hasta que exista login/sesión/middleware real."

## 2. Servicio técnico / caller no-humano

| Actor técnico | Rol | Evidencia |
|---|---|---|
| Pipeline Node.js (miners, normalizadores, marts, gold, QA) | Ejecuta contra las APIs externas (Zendesk/FieldBeat/Dolibarr) y contra el DuckDB local; **no pasa por ningún rol de autorización de la app** -es un proceso CLI separado, invocado manualmente por un operador | STATIC_CODE `package.json` scripts raíz, `src/**` |
| `migrate-to-supabase.js` / `validate-supabase.js` | Únicos scripts que escriben directamente en Postgres vía rol `postgres` (`SUPABASE_DB_URL_DIRECT`), fuera del rol `nexus_app` que usa la app | STATIC_CODE `src/db/migrate-to-supabase.js:45-58` |

## 3. Actor humano observado en runtime

**Ninguno.** No hay telemetría, analytics, logs de acceso, ni sistema de sesiones en el repo -no hay forma de confirmar quién usa la aplicación ni con qué frecuencia.

- AUSENCIA CONFIRMADA · comando: `grep -rniE "analytics|posthog|mixpanel|google-analytics|gtag|amplitude" apps/nexus-bi-app --include=*.ts --include=*.tsx` (excluyendo `node_modules`) · commit `4a3d055` · resultado: sin coincidencias.
- El único contador visible es el badge de "pendientes de revisión" en `NavBar.tsx:22-29`, que refleja un dato de negocio (`reportsReviewRequired`), no actividad de usuario.

Estado: DESCONOCIDA (no observable con la evidencia disponible, no es un vacío que se resuelva con más lectura de código -requiere telemetría que no existe).

## 4. Personas de negocio inferidas (nunca CONFIRMADA -siempre PROPUESTA o PARCIALMENTE CONFIRMADA)

Ninguna de estas personas tiene login, sesión ni registro de actividad. Se infieren de: (a) los campos de datos que el pipeline captura, (b) el alcance contratado descrito en `docs/legacy/relevamiento_maestro_nexus_cerberus.html`, (c) los nombres de las pantallas mismas.

| Persona (PROPUESTA) | Indicio | Tareas que le darían sentido a esa pantalla | Frecuencia esperada (PROPUESTA, no medida) | Riesgo de error si la persona interpreta mal el dato |
|---|---|---|---|---|
| Técnico de terreno | Campo `assigned_to`/`technician_names` en FieldBeat (`processed.fieldbeat_tasks`, `types/after-hours.ts:31-50`) | Reportar trabajo, no necesariamente **usar** el dashboard | DESCONOCIDA | Bajo -no es consumidor de la UI, es la fuente de los datos que la UI muestra |
| Agente/analista Zendesk | Campo `assigned_to` en tickets (`sql/010_processed.sql` `zendesk_tickets`) | Vincular tickets a reportes de trabajo | DESCONOCIDA | Medio -si confía en `zendesk_join_status` sin entender que 291 tickets están 403-bloqueados (`docs/SCOPE_AND_LIMITATIONS.md:18,42-46`), puede asumir cobertura completa donde no la hay |
| Analista BI / gerencia operacional | Los 3 dashboards (FieldBeat, Operacional, Trabajo Fuera de Horario) están diseñados para lectura agregada, no captura | Revisar KPIs, exportar informes (export JSON/CSV client-side ya implementado) | DESCONOCIDA -plausiblemente periódica (semanal/mensual) dado el perfil BI, sin evidencia que lo confirme | **Alto** -es quien más fácilmente podría tomar un número (ej. `pctConTicketAccesible=7.7%` confirmado LOCAL_RUNTIME) sin el contexto de `docs/SCOPE_AND_LIMITATIONS.md`; ninguna de las cifras en pantalla enlaza a esa salvedad hoy |
| Bodeguero / encargado de inventario Dolibarr | `stock.stock_movements` (schema existe, CRUD existe, sin UI); rol descrito en el linaje legacy P4 (`docs/Documentación Proyecto 4.md`, automatización de descuento real de stock) | Confirmar/revertir movimientos de stock generados por reportes | No aplica todavía -la funcionalidad es TO_BE (ver `01`§D) | Alto si se diseña una UI antes de que la automatización de origen exista -ver `11-product-decision-register.md` |
| Responsable de calidad de datos / "CERBERUS operator" | Rol implícito en el contrato original (`docs/legacy/relevamiento_maestro_nexus_cerberus.html:491-499`, "Dashboard ejecutivo CERBERUS") | Clasificar reportes apto/parcial/dudoso/no apto | No implementado -ver `01`§D | No aplica -el rol nunca tuvo una pantalla real construida |

## 5. Condición de acceso actual por pantalla

| Pantalla | Condición de acceso | Evidencia |
|---|---|---|
| `/`, `/explorer`, `/search`, `/dashboard/fieldbeat`, `/dashboard/operacional`, `/dashboard/after-hours` | Pública, sin gate | LOCAL_RUNTIME: las 7 rutas de producto respondieron 200 sin ninguna credencial |
| `/audit/manual-review` (lectura) | Pública, sin gate | Idem -LOCAL_RUNTIME 200 |
| `/api/admin/**` (10 rutas) | Requiere `x-nexus-admin-token`; sin caller en ninguna UI del repo | LOCAL_RUNTIME: 401 sin token, 200 con token; STATIC_CODE -grep de las 10 rutas confirma cero imports desde `components/**` o `app/**` fuera de `app/api/admin/**` mismo |

## 6. Tareas críticas -no medibles, se listan como PROPUESTA a partir de la estructura de cada pantalla

| Tarea (PROPUESTA) | Pantalla que la soportaría | Info necesaria hoy disponible | Info necesaria pero ausente |
|---|---|---|---|
| Revisar reportes con calidad de dato degradada | `/audit/manual-review` (lectura) | `report_quality_status`, `suggested_action` (texto) | Ninguna acción ejecutable -el botón está deshabilitado (ver `01`§B) |
| Monitorear tasa de trabajo fuera de horario | `/dashboard/after-hours` | KPIs con score de confianza explícito | Calendario laboral y feriados reales -`businessHoursStatus`/`holidaysStatus` = `"MISSING"` confirmado LOCAL_RUNTIME |
| Revisar volumen operacional por cliente/máquina/período | `/dashboard/operacional` | Filtros cruzados, export JSON | Ninguna decisión de escritura -es 100% lectura |
| Auditar cobertura de repuestos vs. catálogo Dolibarr | `/dashboard/fieldbeat`, `/audit/manual-review` (tabs parts/ambiguous/placeholders) | `match_status`, candidatos ambiguos | Mecanismo para resolver un `AMBIGUOUS_MATCH` desde la UI -no existe (solo vía `POST /api/admin/manual-review/part-aliases`, sin caller) |

## Fuentes

`apps/nexus-bi-app/lib/auth.ts`, `NavBar.tsx`, `.env.example` (ambos), los 10 route.ts de `app/api/admin/**`, `docs/SCOPE_AND_LIMITATIONS.md`, `docs/legacy/relevamiento_maestro_nexus_cerberus.html`, `docs/Documentación Proyecto 4.md`, sondeo LOCAL_RUNTIME de esta sesión, búsquedas de ausencia citadas inline.
