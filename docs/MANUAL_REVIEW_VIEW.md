# Auditoría y Validación Manual (`/audit/manual-review`)

## Objetivo

Darle a un usuario operacional (coordinador de servicio técnico, encargado de repuestos/bodega) un lugar único donde revisar **todo lo que el pipeline considera poco confiable, ambiguo o pendiente de validación** - sin tener que conocer SQL ni saber en qué tabla vive cada cosa. Es la antesala de solo lectura del futuro Centro de Correcciones (pantallas 5-8 de [APP_UI_SPEC.md](APP_UI_SPEC.md)), que todavía no existe.

Esta vista **no escribe en ningún dato**. Todas las acciones de corrección están preparadas visualmente (botón + texto de qué haría) pero deshabilitadas.

## Qué se considera "revisión manual"

El pipeline (`src/resolvers/part-identity-resolver.js` y los marts derivados) ya clasifica explícitamente qué necesita ojo humano - esta vista no inventa una nueva clasificación, solo la hace visible y navegable:

| Concepto | Campo real | Significado |
|---|---|---|
| Repuesto sin match | `match_status = 'NO_MATCH'` | El identificador crudo no calzó con ningún producto Dolibarr por REF/BARCODE/ID, ni exacto ni normalizado. |
| Repuesto ambiguo | `match_status = 'AMBIGUOUS_MATCH'` | Calzó con más de un producto candidato - `candidate_dolibarr_product_ids` lista las opciones. |
| Placeholder | `match_status = 'PLACEHOLDER_VALUE'` | El valor crudo es basura conocida (N/A, S/N, NO HAY, etc. - ver `PLACEHOLDER_LITERALS` del resolver), rechazado antes de intentar matchear. |
| Necesita revisión aunque haya match | `needs_manual_review = true` | Match de baja confianza (ej. `REF_LIKE`) que el resolver aceptó pero marca para confirmar. |
| Reporte con calidad degradada | `report_quality_status IN ('HAS_PLACEHOLDERS','HAS_UNMATCHED_PARTS','HAS_AMBIGUOUS_PARTS','REVIEW_REQUIRED')` | El reporte FieldBeat tiene al menos un repuesto en alguno de los estados de arriba. |
| Ticket faltante o restringido | `zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK'` | El reporte referencia un `zendesk_ticket_id` que no está entre los 628 tickets minados (ver los 291 casos 403 documentados en `CLAUDE.md` § Pendientes conocidos para Fase 2). |

## Fuentes de datos (todas de solo lectura, `access_mode: READ_ONLY`)

- `marts.used_parts_dolibarr_match` - resultado del resolver por cada repuesto usado (match_status, match_method, match_confidence, candidatos).
- `processed.fieldbeat_used_parts` - cantidad y bodega de origen del repuesto.
- `marts.fieldbeat_report_dolibarr_operational_view` - vista report-céntrica (cliente, máquina, fecha, calidad del reporte, vínculo a Zendesk).
- `gold.fieldbeat_data_quality` - desglose de reportes y repuestos por `report_quality_status`.
- `gold.scope_metadata` - fila única con métricas de alcance (tickets 403, reportes sin ticket, reportes linkeados a ticket faltante/restringido).

## Criterios por pestaña

### A. Repuestos por revisar (`/api/audit/parts-review`)
**Criterio:** `needs_manual_review = true OR match_status IN ('NO_MATCH','AMBIGUOUS_MATCH','PLACEHOLDER_VALUE')`.
**Columnas:** tarea, fecha, cliente, máquina, identificador crudo, nombre de repuesto, cantidad, match status, método, confianza, candidatos, ref. Dolibarr actual, acción sugerida.
**Acción sugerida** (`lib/audit-sql.ts::suggestAction`): PLACEHOLDER_VALUE → "Marcar como placeholder válido o crear regla de exclusión"; NO_MATCH → "Buscar producto Dolibarr y crear alias"; AMBIGUOUS_MATCH → "Elegir producto candidato correcto"; MATCHED + `needs_manual_review` → "Validar match de baja confianza".

### B. Matches ambiguos (`/api/audit/ambiguous-parts`)
**Criterio:** `match_status = 'AMBIGUOUS_MATCH'`, agrupado por identificador crudo.
**Columnas:** identificador crudo, nombre de repuesto, candidatos Dolibarr, ocurrencias, clientes afectados, equipos afectados (aproximado por `COUNT(DISTINCT equipment_internal_ids)`, no desagrega equipos individuales dentro de un mismo reporte multi-equipo).

### C. Placeholders (`/api/audit/placeholders`)
**Criterio:** `match_status = 'PLACEHOLDER_VALUE'`, agrupado por `UPPER(TRIM(raw_part_identifier))` (consolida variantes de mayúsculas/espacios del mismo valor basura, ej. "N/A" y "n/a" cuentan juntos). Objetivo explícito: ver cuáles son los valores basura más frecuentes del pipeline real (confirmado con datos reales: "n/a" 216 ocurrencias, "na" 73, "sn" 60, "n/c" 49, entre otros) - no se preselecciona una lista fija, se muestra lo que hay.

### D. Reportes con revisión requerida (`/api/audit/reports-review`)
**Criterio:** `report_quality_status IN ('HAS_PLACEHOLDERS','HAS_UNMATCHED_PARTS','HAS_AMBIGUOUS_PARTS','REVIEW_REQUIRED') OR review_required_used_parts_count > 0`.
**Columnas:** tarea, fecha, cliente, máquina, tipo de tarea, técnico, repuestos usados, repuestos por revisar, calidad del reporte, ticket vinculado, estado del vínculo Zendesk.

### E. Tickets faltantes o restringidos (`/api/audit/ticket-links-review`)
**Criterio:** `zendesk_join_status = 'LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK'`.
**Columnas:** tarea, fecha, cliente, máquina, ID de ticket vinculado, tipo de tarea, técnico, repuestos usados, calidad del reporte.
**Nota:** no confundir con los 291 tickets 403 documentados en `CLAUDE.md` (esos son tickets Zendesk existentes que el token actual no puede leer); esta pestaña muestra los **reportes FieldBeat** cuyo ticket vinculado no aparece entre los 628 tickets minados - puede solaparse con esos 291, pero también incluye referencias con typos/IDs inválidos.

### F. Resumen de calidad (`/api/audit/summary`)
**Fuente:** `gold.fieldbeat_data_quality` (sumado por categoría) + `gold.scope_metadata`.
**Muestra:** reportes OK, reportes con revisión requerida, repuestos matched/unmatched/ambiguos/placeholder, tickets 403 pendientes, reportes sin ticket, reportes linkeados a ticket faltante/restringido. Mismo endpoint que alimenta el contador "Auditoría · N pendientes" del NavBar.

## Filtros disponibles

Todos los endpoints aceptan: `cliente`, `maquina` (ILIKE), `from`/`to` (rango de fechas sobre `fieldbeat_task_date`), `q` (búsqueda textual sobre las columnas de texto relevantes de cada pestaña), paginación (`page`/`pageSize`). Adicionalmente: `matchStatus` en Repuestos por revisar, `reportQuality` en Reportes con revisión requerida.

## Acciones futuras de curación (no implementadas en este corte)

Cada fila de las pestañas A-E tiene un botón deshabilitado (`components/audit/FutureActionButton.tsx`), con tooltip "Disponible cuando se active Centro de Correcciones":

- Crear alias de repuesto
- Confirmar placeholder / crear regla de exclusión
- Elegir candidato Dolibarr
- Marcar reporte como revisado
- Corregir ticket asociado

Cuando se implemente el Centro de Correcciones, la escritura real deberá (sin excepción, ver `CURATION_MODEL.md`):
1. Escribir solo en `data/curation/*.csv` (nunca en RAW/PROCESSED/MARTS/GOLD/DuckDB directamente).
2. Registrar la acción en `curation_audit_log.csv` (quién, cuándo, por qué, impacto estimado).
3. Mostrar un preview de impacto (`SELECT COUNT(*) ...`) antes de confirmar.
4. Ofrecer "Reconstruir ahora" o "Reconstruir después", nunca aplicar el efecto sin que el usuario lo pida.

## Qué NO edita esta vista (en este corte)

- Ningún archivo de `data/curation/`.
- Ninguna tabla de `data/raw/`, `data/processed/`, `data/marts/`, `data/gold/` ni el archivo DuckDB - conexión estrictamente `READ_ONLY`.
- No hay movimientos de stock en Dolibarr, en ninguna circunstancia.
- No hay autenticación - cualquiera con acceso a la app local ve esta pantalla (igual que el resto de Fase 1).
