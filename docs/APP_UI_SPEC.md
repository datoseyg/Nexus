# Especificación de UI - App BI Operacional (Fase 1)

12 pantallas. **Esto es especificación, no implementación** - ver [PRODUCT_APP_ARCHITECTURE.md](PRODUCT_APP_ARCHITECTURE.md) para el diseño técnico general antes de construir cualquiera de estas pantallas.

Convención por pantalla: objetivo, usuario esperado, tablas fuente, acciones disponibles, qué puede editar, qué NO puede editar.

> **Formato visual obligatorio para dashboards de métricas:** toda pantalla de tipo dashboard (KPIs + gráficos + tablas) debe seguir el layout, componentes y paleta documentados en [DASHBOARD_VISUAL_STYLE.md](DASHBOARD_VISUAL_STYLE.md) - filtros superiores, KPI cards, gráficos en cards, tablas paginadas con header azul claro, sin datos placeholder (todo métrica no disponible se marca explícitamente como "No disponible" / "Pendiente de parametrización", nunca inventada). La implementación de referencia de este formato es `/dashboard/operacional` (2 tabs: Dashboard Operacional e Integración Uptime/Downtime), construida aparte de la Pantalla 2 de este documento - ver detalle abajo.

---

## 1. Dashboard Ejecutivo

**Objetivo:** vista de KPIs de alto nivel del universo ticket-céntrico (Zendesk accesible), para decisiones rápidas de negocio.

**Usuario esperado:** gerencia, stakeholders no técnicos.

**Tablas fuente:** `gold.operational_dashboard`, `gold.data_quality_report`, `gold.client_service_profile`, `gold.equipment_service_profile`, `gold.scope_metadata`.

**Acciones disponibles:** ver tarjetas de KPI, ver gráfico de calidad de datos, ver ranking de clientes/equipos, ver nota de alcance (`scope_metadata`).

**Qué puede editar:** nada.

**Qué NO puede editar:** nada - 100% solo lectura.

---

## 2. Dashboard Operacional FieldBeat

**Objetivo:** vista de KPIs del universo report-céntrico completo (todos los reportes FieldBeat, con o sin ticket Zendesk) - la foto real de volumen de trabajo técnico.

**Usuario esperado:** coordinador de servicio técnico, jefatura de operaciones.

**Tablas fuente:** `gold.fieldbeat_report_analysis`, `gold.client_parts_consumption`, `gold.client_report_volume_by_period`, `gold.equipment_parts_consumption`, `gold.fieldbeat_data_quality`.

**Acciones disponibles:** ver tarjetas de KPI, filtrar por período (usando el campo `period` ya agregado por mes), ver ranking de clientes/equipos por consumo de repuestos y volumen de reportes.

**Qué puede editar:** nada.

**Qué NO puede editar:** nada.

> **Nota de implementación:** el corte visual "estilo Proyecto 7" de este dominio (filtros, KPI cards, gráficos Chart.js, tabla de repuestos, detalle operativo, y una segunda pestaña de Integración Uptime/Downtime) se implementó como una ruta separada, `/dashboard/operacional`, en lugar de sobre esta Pantalla 2 - ver [DASHBOARD_VISUAL_STYLE.md](DASHBOARD_VISUAL_STYLE.md) para el mapeo completo visualización → tabla DuckDB. Ambas rutas coexisten: `/dashboard/fieldbeat` (KPIs GOLD agregados, Recharts) y `/dashboard/operacional` (detalle operativo estilo referencia, Chart.js).

---

## 3. Explorador de Tablas

**Objetivo:** navegar cualquiera de las 27 tablas del warehouse como una planilla, para usuarios que quieren ver el dato crudo/agregado sin escribir SQL.

**Usuario esperado:** analista de datos, power user, cualquiera con [DATA_DICTIONARY.md](DATA_DICTIONARY.md) a mano.

**Tablas fuente:** cualquier tabla de `processed`, `marts`, `gold` (schema `reports` queda oculto en Fase 1 - está vacío).

**Acciones disponibles:** elegir schema/tabla, paginar (server-side, obligatorio para tablas grandes como `processed.fieldbeat_report_fields` con 66107 filas), ordenar por columna, filtro de texto por columna, exportar la vista actual a CSV, ver tipo de columna (tooltip con lo documentado en `DATA_DICTIONARY.md`).

**Qué puede editar:** nada.

**Qué NO puede editar:** ninguna celda - es explícitamente de solo lectura. Cualquier corrección redirige al Centro de Correcciones correspondiente (pantallas 5-8).

---

## 4. Búsqueda / Lupa

**Objetivo:** responder preguntas puntuales en lenguaje natural o palabras clave, sin que el usuario sepa SQL ni en qué tabla está el dato.

**Usuario esperado:** cualquier usuario no técnico (técnico de terreno, coordinador, atención al cliente).

**Tablas fuente:** `marts.fieldbeat_report_dolibarr_operational_view`, `marts.ticket_fieldbeat_dolibarr_operational_view`, `processed.fieldbeat_tasks`, `processed.fieldbeat_report_fields`, `gold.used_parts_analysis`.

**Acciones disponibles:** escribir pregunta libre, ver resultados en tabla, ver qué query SQL se ejecutó (transparencia), refinar la búsqueda.

**Qué puede editar:** nada.

**Qué NO puede editar:** nada.

---

## 5. Correcciones de Repuestos

**Objetivo:** resolver repuestos sin match o ambiguos contra el catálogo Dolibarr, creando reglas de alias curadas.

**Usuario esperado:** encargado de repuestos/bodega, alguien que conoce el catálogo Dolibarr.

**Tablas fuente:** `gold.used_parts_analysis` (cola priorizada por `occurrences`), `marts.used_parts_dolibarr_match`, `processed.dolibarr_products` (para buscar el producto correcto), `data/curation/part_identity_aliases.csv`.

**Acciones disponibles:** ver ranking de `NO_MATCH`/`AMBIGUOUS_MATCH` por ocurrencia, buscar producto Dolibarr candidato, ver preview de impacto (cuántos repuestos históricos calzan), completar `reason`, guardar regla, ver historial de reglas ya creadas.

**Qué puede editar:** `data/curation/part_identity_aliases.csv` (agregar filas nuevas).

**Qué NO puede editar:** `processed.dolibarr_products`, `marts.used_parts_dolibarr_match`, ni forzar un match sin pasar por una regla curada con `reason`.

---

## 6. Correcciones de Clientes

**Objetivo:** unificar variantes de nombre de cliente FieldBeat bajo un `client_key` canónico.

**Usuario esperado:** administrador de datos / alguien con visibilidad de la cartera de clientes real.

**Tablas fuente:** `processed.fieldbeat_clients`, `gold.client_service_profile`, `gold.client_parts_consumption`, `data/curation/client_aliases.csv`.

**Acciones disponibles:** ver lista de clientes con variantes sospechosas (ej. nombres similares por distancia de texto - heurística simple, no IA), elegir el `client_key` canónico, preview de impacto (cuántas tasks se reasignarían), guardar regla.

**Qué puede editar:** `data/curation/client_aliases.csv`.

**Qué NO puede editar:** `processed.fieldbeat_clients.client_key` directamente, ni `processed.fieldbeat_tasks.client_key`.

---

## 7. Correcciones de Máquinas

**Objetivo:** unificar variantes de `equipment_internal_id` bajo un identificador canónico.

**Usuario esperado:** mismo perfil que Correcciones de Clientes, o el técnico que conoce el parque de equipos real.

**Tablas fuente:** `processed.fieldbeat_equipments`, `gold.equipment_service_profile`, `gold.equipment_parts_consumption`, `data/curation/equipment_aliases.csv`.

**Acciones disponibles:** ver equipos con variantes sospechosas, elegir `equipment_internal_id` canónico, preview de impacto, guardar regla.

**Qué puede editar:** `data/curation/equipment_aliases.csv`.

**Qué NO puede editar:** `processed.fieldbeat_equipments`, `processed.fieldbeat_task_equipments.equipment_internal_id` directamente.

---

## 8. Correcciones de Ticket Links

**Objetivo:** resolver los reportes FieldBeat vinculados a un ticket Zendesk "fantasma" (no existe o no es accesible) - el problema de las 920 relaciones documentado en [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md).

**Usuario esperado:** supervisor de service desk, alguien con acceso a Zendesk para verificar el ticket real.

**Tablas fuente:** `marts.fieldbeat_report_dolibarr_operational_view` (filtrado por `zendesk_join_status != 'LINKED_TO_ACCESSIBLE_ZENDESK'`), `data/curation/ticket_link_overrides.csv`.

**Acciones disponibles:** ver cola de reportes con ticket faltante/restringido, buscar y corregir el ticket real (`override_type = CORRECTED`), o confirmar que nunca hubo ticket (`override_type = CONFIRMED_NO_TICKET`), o marcar para ignorar sin resolver (`override_type = IGNORE`), preview de impacto, guardar.

**Qué puede editar:** `data/curation/ticket_link_overrides.csv`.

**Qué NO puede editar:** `processed.fieldbeat_tasks.linked_zendesk_ticket_id`, `data/processed/fieldbeat/BR_Ticket_FieldBeat_Task.csv` directamente.

---

## 9. Estado del Pipeline

**Objetivo:** administrar y monitorear la ejecución del pipeline local - miners, normalizers, marts, GOLD, warehouse.

**Usuario esperado:** administrador técnico / quien opera el pipeline (ver [LOCAL_OPERATIONS_RUNBOOK.md](LOCAL_OPERATIONS_RUNBOOK.md)).

**Tablas fuente:** no consulta tablas SQL directamente - lee `data/reports/*.json` (`duckdb_validation_summary.json`, `gold_build_summary.json`, `fieldbeat_gold_build_summary.json`, `scope_reconciliation_summary.json`, `phase1_final_audit_summary.json`, `curation_validation_summary.json`).

**Acciones disponibles:** ver último estado de cada etapa (fecha, éxito/error), lanzar rebuild completo o por etapa, ver logs en vivo de la ejecución, ver reglas de curation pendientes de rebuild (`curation_audit_log.rebuild_triggered = false`).

**Qué puede editar:** nada de datos - dispara procesos (scripts de `package.json`), no edita archivos directamente.

**Qué NO puede editar:** ningún CSV ni la base DuckDB directamente desde esta pantalla.

---

## 10. Limitaciones y Alcance

**Objetivo:** dejar siempre visible qué universo de datos representa la app, para que ningún número se malinterprete como "el 100% del negocio".

**Usuario esperado:** cualquiera - pensada como referencia permanente, no una pantalla que se visita una vez.

**Tablas fuente:** `gold.scope_metadata`.

**Acciones disponibles:** leer el resumen de alcance (628 tickets accesibles, 3747 reportes totales, 291 tickets 403, etc.), links a [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md) y [KNOWN_LIMITATIONS_PHASE_1.md](KNOWN_LIMITATIONS_PHASE_1.md).

**Qué puede editar:** nada.

**Qué NO puede editar:** nada - es un panel informativo, y debería estar enlazado/visible desde el Dashboard Ejecutivo (pantalla 1), no solo accesible por su cuenta.

---

## 11. Auditoría / Validación Manual

**Estado:** implementada en `/audit/manual-review` (solo lectura) - ver [MANUAL_REVIEW_VIEW.md](MANUAL_REVIEW_VIEW.md) para el detalle completo de criterios, fuentes y acciones futuras.

**Objetivo:** darle a un usuario operacional un lugar único donde ver todo lo que el sistema considera poco confiable, ambiguo o pendiente de validación - la antesala de las pantallas 5-8 (Correcciones), que todavía no existen.

**Usuario esperado:** coordinador de servicio técnico, encargado de repuestos/bodega - el mismo perfil de las pantallas 5-8.

**Tablas fuente:** `marts.used_parts_dolibarr_match`, `processed.fieldbeat_used_parts`, `marts.fieldbeat_report_dolibarr_operational_view`, `gold.fieldbeat_data_quality`, `gold.scope_metadata`.

**Acciones disponibles:** 6 pestañas (Repuestos por revisar, Matches ambiguos, Placeholders, Reportes con revisión requerida, Tickets faltantes o restringidos, Resumen de calidad), cada una con filtros (cliente/máquina/fecha/estado/búsqueda) y paginación; botones de acción de curación **visibles pero deshabilitados** ("Disponible cuando se active Centro de Correcciones").

**Qué puede editar:** nada - 100% solo lectura en este corte.

**Qué NO puede editar:** ninguna tabla del warehouse ni archivo de `data/curation/`. Cuando el Centro de Correcciones (pantallas 5-8) se implemente, los botones deshabilitados de esta pantalla pasan a dispararlo.

---

## 12. Trabajo Fuera de Horario

**Estado:** implementada en `/dashboard/after-hours` (solo lectura) - **vista independiente**, no una sección de la Pantalla 2 (Dashboard Operacional). Ver [AFTER_HOURS_METRICS.md](AFTER_HOURS_METRICS.md) y [CALCULATION_CONFIDENCE_MODEL.md](CALCULATION_CONFIDENCE_MODEL.md) para la metodología completa.

**Objetivo:** cuantificar el trabajo técnico registrado fuera del horario hábil configurado (noche/madrugada en día hábil, fin de semana, feriado), con un score de confiabilidad explícito por KPI - nunca presentar estos números como una certeza absoluta.

**Usuario esperado:** jefatura de operaciones, coordinador de servicio técnico - mismo perfil que el Dashboard Operacional, pero para una pregunta distinta ("¿cuánto trabajo cae fuera de horario y qué tan confiable es ese número?").

**Tablas fuente:** `marts.fieldbeat_working_hours_analysis` (consultada en vivo, con filtros), `gold.after_hours_work_analysis`, `gold.after_hours_by_client`, `gold.after_hours_by_task_type`, `gold.after_hours_by_technician`, `gold.after_hours_by_period`.

**Acciones disponibles:** ver 6 KPIs (cada uno con su badge de confiabilidad), 5 gráficos (por mes, top clientes, por tipo de tarea, por técnico, distribución de confiabilidad), tabla de detalle filtrable (cliente/técnico/tipo de tarea/nivel de confiabilidad/solo fuera de horario/solo baja confianza), ver factores de confiabilidad de cualquier fila (tooltip).

**Qué puede editar:** nada desde la UI. `data/config/business-hours.json` y `data/config/holidays.json`/`.example.json` se editan a mano fuera de la app (mismo mecanismo que `data/config/part_identity_aliases.csv`).

**Qué NO puede editar:** ninguna tabla del warehouse, ni RAW/PROCESSED/MARTS/GOLD.
