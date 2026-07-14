# Diccionario de datos -DuckDB Warehouse v1.2

Snapshot tomado directamente de `data/warehouse/eyg_nexus.duckdb` (vía `DESCRIBE` + `COUNT(*)` por tabla, no de memoria) el **2026-07-02**, después de la última corrida exitosa de `npm run db:build` (`data/reports/duckdb_validation_summary.json`: `all_match: true`, 26 tablas).

Este documento puede quedar desactualizado si se vuelve a correr el pipeline con datos nuevos. Los **nombres de columna y su significado** son estables (dependen del código de los normalizers/marts/gold, no de los datos), pero los **conteos de filas** son del momento de este snapshot. Para refrescar conteos, correr `npm run db:validate` y mirar `data/reports/duckdb_validation_summary.json`.

## Cómo leer este documento

- 4 schemas: `processed`, `marts`, `gold`, `reports` (este último vacío en v1.2 -ver [SQL_WAREHOUSE.md](SQL_WAREHOUSE.md)).
- Cada tabla tiene: para qué sirve, granularidad (qué representa una fila), tabla de columnas (nombre, tipo SQL real, significado), y notas si aplica.
- Los tipos son los que `read_csv_auto` de DuckDB infirió automáticamente -no hay un schema SQL manual. Ver la sección **"Anomalías y advertencias de tipos"** al final antes de escribir joins entre tablas.
- Hay dos líneas de análisis complementarias, no una reemplaza a la otra: **ticket-céntrica** (1 fila = 1 ticket Zendesk, universo de 628 tickets accesibles) y **report-céntrica / FieldBeat-first** (1 fila = 1 reporte FieldBeat, universo completo de 3747, incluye lo que nunca tuvo ticket Zendesk). Cada tabla de abajo indica a cuál línea pertenece.

## Índice rápido (26 tablas)

| Schema | Tabla | Filas | Grano (1 fila = ...) |
|---|---|---|---|
| processed | `zendesk_tickets` | 628 | 1 ticket Zendesk |
| processed | `zendesk_ticket_tags` | 8383 | 1 tag de 1 ticket |
| processed | `zendesk_custom_fields` | 10048 | 1 campo personalizado de 1 ticket |
| processed | `fieldbeat_tasks` | 3747 | 1 task/reporte FieldBeat |
| processed | `fieldbeat_used_parts` | 2193 | 1 repuesto usado (crudo, sin resolver contra Dolibarr) |
| processed | `fieldbeat_task_equipments` | 3157 | 1 relación task↔equipo |
| processed | `fieldbeat_clients` | 43 | 1 cliente FieldBeat |
| processed | `fieldbeat_equipments` | 83 | 1 equipo FieldBeat |
| processed | `dolibarr_products` | 1609 | 1 producto Dolibarr |
| processed | `dolibarr_product_identity_map` | 3219 | 1 identidad (REF/BARCODE/ID) de 1 producto Dolibarr |
| marts | `ticket_fieldbeat_operational_view` | 628 | 1 ticket Zendesk (cruce con FieldBeat) |
| marts | `ticket_fieldbeat_dolibarr_operational_view` | 628 | 1 ticket Zendesk (cruce con FieldBeat + Dolibarr) |
| marts | `ticket_fieldbeat_report_detail` | 290 | 1 relación ticket↔task válida |
| marts | `used_parts_dolibarr_match` | 2193 | 1 repuesto usado, ya resuelto contra Dolibarr (global) |
| marts | `fieldbeat_report_dolibarr_operational_view` **(report-céntrica)** | 3747 | 1 task/reporte FieldBeat (universo completo) |
| gold | `operational_dashboard` | 1 | KPIs globales (universo ticket-céntrico) |
| gold | `data_quality_report` | 6 | 1 fila por `data_quality_status` |
| gold | `client_service_profile` | 14 | 1 cliente (fan-out desde tickets) |
| gold | `equipment_service_profile` | 23 | 1 equipo (fan-out desde tickets) |
| gold | `used_parts_analysis` | 576 | 1 identificador de repuesto normalizado (global) |
| gold | `scope_metadata` | 1 | metadata de alcance de GOLD v1 |
| gold | `fieldbeat_report_analysis` **(report-céntrica)** | 1 | KPIs globales (universo report-céntrico, 3747 reportes) |
| gold | `client_parts_consumption` **(report-céntrica)** | 913 | 1 cliente × período mensual |
| gold | `client_report_volume_by_period` **(report-céntrica)** | 913 | 1 cliente × período mensual (volumen de reportes, no repuestos) |
| gold | `equipment_parts_consumption` **(report-céntrica)** | 57 | 1 equipo (fan-out desde reportes) |
| gold | `fieldbeat_data_quality` **(report-céntrica)** | 6 | 1 fila por `report_quality_status` |

---

## Schema `processed`

Una tabla por entidad normalizada de cada plataforma. Sin joins entre plataformas todavía -eso empieza en `marts`.

### `processed.zendesk_tickets` (628 filas)
1 fila por ticket Zendesk minado. Fuente: `data/processed/zendesk/DB_Zendesk_Tickets.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `zendesk_ticket_id` | BIGINT | PK. ID numérico del ticket en Zendesk. |
| `external_id` | VARCHAR | ID externo opcional (casi siempre vacío). |
| `type` | VARCHAR | Tipo Zendesk: `problem`, `incident`, `question`, `task`. |
| `subject` / `raw_subject` | VARCHAR | Asunto del ticket. |
| `description` | VARCHAR | Cuerpo del primer comentario. |
| `priority` | VARCHAR | Prioridad Zendesk: `low`/`normal`/`high`/`urgent` (texto, no número -**no confundir con `fieldbeat_tasks.priority`**, ver anomalías). |
| `status` | VARCHAR | `new`/`open`/`pending`/`solved`/`closed`. |
| `via_channel` | VARCHAR | Canal de entrada (`email`, `web`, etc.). |
| `requester_id` / `submitter_id` / `assignee_id` / `organization_id` / `group_id` | BIGINT | IDs internos de Zendesk (agente, org, grupo). No hay tabla de agentes/organizaciones cargada -son solo IDs de referencia. |
| `is_public` / `has_incidents` | BOOLEAN | Flags Zendesk. |
| `due_at` | VARCHAR | Fecha límite si aplica. |
| `satisfaction_rating` | VARCHAR | Score de satisfacción (`good`/`bad`/`offered`/`unoffered`). |
| `ticket_form_id` / `brand_id` | BIGINT | IDs de formulario/marca Zendesk. |
| `created_at` / `updated_at` | TIMESTAMPTZ | Fechas del ticket. |
| `extracted_at` | TIMESTAMPTZ | Cuándo se normalizó (no cuándo se creó el ticket). |

### `processed.zendesk_ticket_tags` (8383 filas)
1 fila por tag de un ticket (relación 1-a-muchos). Fuente: `DB_Zendesk_Ticket_Tags.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `ticket_tag_id` | VARCHAR | PK sintética: `zendesk_ticket_id\|tag`. |
| `zendesk_ticket_id` | BIGINT | FK a `zendesk_tickets`. |
| `tag` | VARCHAR | El tag literal. |
| `extracted_at` | TIMESTAMPTZ | -|

### `processed.zendesk_custom_fields` (10048 filas)
1 fila por campo personalizado de un ticket (Zendesk define ~16 campos por ticket; solo 18.59% tienen valor no nulo). Fuente: `DB_Zendesk_Custom_Fields.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `ticket_custom_field_id` | VARCHAR | PK sintética: `zendesk_ticket_id\|field_id`. |
| `zendesk_ticket_id` | BIGINT | FK a `zendesk_tickets`. |
| `field_id` | BIGINT | ID del campo personalizado en Zendesk (no hay tabla de definición de campos cargada). |
| `field_value` | VARCHAR | Valor del campo (vacío si nunca se llenó). |
| `extracted_at` | TIMESTAMPTZ | -|

### `processed.fieldbeat_tasks` (3747 filas)
1 fila por task/reporte técnico de FieldBeat. **Universo completo**, no filtrado por si tiene ticket Zendesk. Fuente: `DB_FieldBeat_Tasks.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `fieldbeat_task_id` | BIGINT | PK. |
| `linked_zendesk_ticket_id` | VARCHAR | Número de ticket que el técnico escribió a mano en el reporte (texto libre, no validado -fuente del problema de "tickets fantasma", ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md)). |
| `task_type` | VARCHAR | Tipo de intervención (`PREVENTIVA PROGRAMADA`, `CORRECTIVA PROGRAMADA`, `REQUERIMIENTO DEL CLIENTE`, etc.). |
| `priority` | BIGINT | Prioridad **numérica** de FieldBeat (1-N). **No es lo mismo que `zendesk_tickets.priority`** (texto). |
| `state` | VARCHAR | Estado del task (`FINISHED`, etc.). |
| `description` | VARCHAR | Descripción del trabajo (o "TRABAJO REALIZADO" extraído del reporte). |
| `client_key` | VARCHAR | Clave sintética `FIELD_BEAT_CLIENT\|<rut>\|<nombre>` -FK conceptual a `fieldbeat_clients`, pero también parseable directamente. |
| `assigned_to` | VARCHAR | Técnico asignado (usuario FieldBeat). |
| `created_by` | VARCHAR | Quién creó el registro (a veces un token de integración, no una persona). |
| `created_at` / `updated_at` / `start_time` / `last_transition_at` / `finished_data_synced_at` | TIMESTAMPTZ/TIMESTAMP | Distintos hitos temporales del ciclo de vida del task. `start_time` es la fecha real de la intervención en terreno. |
| `duration_minutes` | BIGINT | Duración del trabajo. |
| `created_in` | VARCHAR | Origen del registro (`APK` = app móvil, etc.). |
| `extracted_at` | TIMESTAMPTZ | Cuándo se normalizó. |

### `processed.fieldbeat_used_parts` (2193 filas)
1 fila por repuesto usado, **crudo** -ya con la explosión de listas numeradas aplicada, pero **sin resolver contra Dolibarr** (eso vive en `marts.used_parts_dolibarr_match`). Fuente: `DB_FieldBeat_Used_Parts.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `used_part_id` | VARCHAR | PK sintética: `task_id\|group_index\|item_index\|part_number`. |
| `fieldbeat_task_id` | BIGINT | FK a `fieldbeat_tasks`. |
| `zendesk_ticket_id` | VARCHAR | Casi siempre vacío (viene del mismo campo de texto libre que `linked_zendesk_ticket_id`, no es confiable). |
| `part_number` | VARCHAR | Identificador de repuesto tal como quedó tras la explosión de listas -este es el valor que se usa como `raw_part_identifier` en el resolver. |
| `part_name` | VARCHAR | Nombre/descripción del repuesto. |
| `quantity` | BIGINT | Cantidad usada (puede estar vacía si no se pudo alinear tras explotar una lista). |
| `raw_original_part_number` / `raw_original_part_name` | VARCHAR | Valor **antes** de explotar listas numeradas -trazabilidad al dato crudo original. |
| `origin_location` / `photo_ref` | VARCHAR | Metadata del reporte FieldBeat. |
| `dolibarr_product_id` / `dolibarr_ref` / `unit_cost` / `estimated_total_cost` | VARCHAR | **Vestigiales/no confiables** -`dolibarr_ref` acá es simplemente una copia de `part_number` (la asunción ingenua que motivó construir el resolver de identidad). Usar `marts.used_parts_dolibarr_match` para el match real. |
| `needs_manual_review` | BOOLEAN | Marca si la explosión de una lista quedó ambigua (part_name/quantity no se pudieron alinear). |
| `extracted_at` | TIMESTAMPTZ | -|

### `processed.fieldbeat_task_equipments` (3157 filas)
1 fila por relación task↔equipo (un task puede intervenir más de un equipo). Fuente: `DB_FieldBeat_Task_Equipments.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `task_equipment_id` | VARCHAR | PK sintética. |
| `fieldbeat_task_id` | BIGINT | FK a `fieldbeat_tasks`. |
| `equipment_uuid` | VARCHAR | UUID interno de FieldBeat del equipo. |
| `equipment_internal_id` | VARCHAR | Identificador legible del equipo (ej. `LINAC-153038`) -es el que se usa en todos los reportes GOLD por equipo. |
| `extracted_at` | TIMESTAMPTZ | -|

### `processed.fieldbeat_clients` (43 filas)
1 fila por cliente FieldBeat (dimensión). Fuente: `DIM_Clients.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `client_key` | VARCHAR | PK -mismo valor que aparece en `fieldbeat_tasks.client_key`. |
| `client_name` / `fieldbeat_client_name` | VARCHAR | Nombre del cliente (duplicado, mismo valor en la práctica). |
| `rut` | VARCHAR | RUT del cliente. |
| `address_raw` / `city` / `commune` / `country` | VARCHAR | Dirección. |
| `latitude` / `longitude` | DOUBLE | Coordenadas. |
| `updated_at` | TIMESTAMPTZ | -|

### `processed.fieldbeat_equipments` (83 filas)
1 fila por equipo FieldBeat (dimensión). Fuente: `DIM_Equipments.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `equipment_key` | VARCHAR | PK sintética. |
| `equipment_uuid` | VARCHAR | FK conceptual a `fieldbeat_task_equipments.equipment_uuid`. |
| `internal_id` | VARCHAR | Mismo valor que `fieldbeat_task_equipments.equipment_internal_id`. |
| `client_key` | VARCHAR | FK a `fieldbeat_clients` -de qué cliente es el equipo. |
| `equipment_type` | VARCHAR | Inferido heurísticamente del `internal_id` (`LINAC`, `BRAQUITERAPIA`, `CT`, `RX`, o vacío si no se pudo inferir). |
| `source_system` | VARCHAR | Siempre `FIELDBEAT`. |
| `updated_at` | TIMESTAMPTZ | -|

### `processed.dolibarr_products` (1609 filas)
1 fila por producto del catálogo Dolibarr. Fuente: `DB_Dolibarr_Products.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `dolibarr_product_id` | BIGINT | PK -ID interno de Dolibarr. |
| `ref` | VARCHAR | Referencia/código del producto (100% de cobertura). |
| `barcode` | BIGINT | Código de barra -**solo 1 de 1609 productos lo tiene** (el resto queda `NULL`, por eso DuckDB infirió BIGINT en vez de VARCHAR). |
| `label` | VARCHAR | Nombre/descripción del producto. |
| `status` / `status_buy` | BIGINT | Flags de estado en Dolibarr (activo para venta / compra). |
| `price` / `cost_price` | DOUBLE | Precio de venta / costo. |
| `date_creation` / `date_modification` | TIMESTAMP | Fechas Dolibarr. |
| `extracted_at` | TIMESTAMPTZ | -|

### `processed.dolibarr_product_identity_map` (3219 filas)
1 fila por cada identidad posible de un producto (REF, BARCODE, ID) -es el índice que usa `part-identity-resolver.js` para matchear repuestos. `1609 REF + 1609 ID + 1 BARCODE = 3219`. Fuente: `DIM_Dolibarr_Product_Identity_Map.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `identity_id` | VARCHAR | PK sintética: `product_id\|identity_type\|identity_value`. |
| `dolibarr_product_id` | BIGINT | FK a `dolibarr_products`. |
| `identity_type` | VARCHAR | `REF` \| `BARCODE` \| `ID`. |
| `identity_value` | VARCHAR | El valor literal (ref, barcode o ID como string). |
| `identity_value_normalized` | VARCHAR | Mismo valor pasado por `normalizeIdentifier()` (mayúsculas, sin tildes, solo alfanumérico) -es contra esto que matchean los tiers `*_NORMALIZED_EXACT` y `REF_LIKE`. |
| `dolibarr_ref` / `dolibarr_barcode` / `dolibarr_label` | VARCHAR/BIGINT/VARCHAR | Denormalizados del producto, para que el resolver no necesite un segundo lookup. |
| `extracted_at` | TIMESTAMPTZ | -|

---

## Schema `marts`

Cruces entre plataformas, con joins ya resueltos.

### `marts.ticket_fieldbeat_operational_view` (628 filas)
1 fila por ticket Zendesk, cruzado solo con FieldBeat (sin Dolibarr todavía). Es la base sobre la que se construye `ticket_fieldbeat_dolibarr_operational_view`. Fuente: `Ticket_FieldBeat_Operational_View.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `zendesk_ticket_id` | BIGINT | PK, FK a `zendesk_tickets`. |
| `subject` / `status` / `priority` | VARCHAR | Copiados de `zendesk_tickets` para no tener que hacer join en consultas simples. |
| `has_fieldbeat_report` | BOOLEAN | Si el ticket tiene al menos 1 task FieldBeat vinculado (vía tabla puente, ticket debe existir). |
| `fieldbeat_report_count` | BIGINT | Cuántos tasks FieldBeat vinculados. |
| `has_multiple_fieldbeat_reports` | BOOLEAN | `fieldbeat_report_count > 1`. |
| `fieldbeat_task_ids` | VARCHAR | Lista pipe-joined de `fieldbeat_task_id`. |
| `first_fieldbeat_start_time` / `last_fieldbeat_start_time` | TIMESTAMPTZ | Rango de fechas de las intervenciones. |
| `fieldbeat_states` / `fieldbeat_types` / `fieldbeat_assignees` | VARCHAR | Listas pipe-joined únicas. |
| `client_names` | VARCHAR | Lista pipe-joined (un ticket puede tener reportes de más de un cliente). |
| `equipment_internal_ids` | VARCHAR | Lista pipe-joined de equipos intervenidos. |
| `has_used_parts` / `used_parts_count` / `used_part_numbers` | BOOLEAN/BIGINT/VARCHAR | Repuestos asociados (sin info de matching contra Dolibarr acá). |
| `operational_join_status` | VARCHAR | `NO_FIELDBEAT_REPORT` \| `SINGLE_FIELDBEAT_REPORT` \| `MULTIPLE_FIELDBEAT_REPORTS`. |

### `marts.ticket_fieldbeat_dolibarr_operational_view` (628 filas)
**La tabla ticket-céntrica principal.** Todas las columnas de arriba, más las métricas de repuestos ya resueltos contra Dolibarr. Fuente: `Ticket_FieldBeat_Dolibarr_Operational_View.csv`. Documentada en detalle en [GOLD_DATA_CONTRACT.md](GOLD_DATA_CONTRACT.md) (aunque técnicamente es un mart, no GOLD).

| Columna | Tipo | Significado |
|---|---|---|
| *(todas las de `ticket_fieldbeat_operational_view`, ver arriba -`used_parts_count`/`used_part_numbers` quedan sobreescritas acá con el valor calculado vía el resolver)* | | |
| `matched_used_parts_count` / `placeholder_used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` | BIGINT | Desglose de repuestos por `match_status`. |
| `manual_alias_match_count` / `ref_exact_match_count` / `ref_like_match_count` | BIGINT | Desglose por `match_method` (los 3 más relevantes; hay más métodos posibles, ver `used_parts_dolibarr_match.match_method`). |
| `review_required_used_parts_count` | BIGINT | Repuestos con `needs_manual_review = true` -incluye placeholder/no_match/ambiguous **y** matches `REF_LIKE` de baja confianza. |
| `dolibarr_product_ids` / `dolibarr_refs` | VARCHAR | Listas pipe-joined de productos Dolibarr resueltos. |
| `used_part_names` | VARCHAR | Lista pipe-joined de nombres de repuesto. |
| `part_match_methods` / `part_match_statuses` | VARCHAR | Listas pipe-joined únicas. |
| `part_match_quality_status` | VARCHAR | `NO_USED_PARTS` \| `ALL_PARTS_MATCHED` \| `HAS_PLACEHOLDERS_ONLY` \| `HAS_UNMATCHED_PARTS` \| `HAS_AMBIGUOUS_PARTS` \| `MIXED_QUALITY`. |
| `data_quality_status` | VARCHAR | `OK` \| `NO_FIELDBEAT_REPORT` \| `HAS_PLACEHOLDERS` \| `HAS_UNMATCHED_PARTS` \| `HAS_AMBIGUOUS_PARTS` \| `REVIEW_REQUIRED`. Estado único por ticket, cascada por severidad. |

### `marts.ticket_fieldbeat_report_detail` (290 filas)
1 fila por relación ticket↔task **válida** (el ticket existe en los 628 minados). Las otras 920 relaciones de la tabla puente quedan fuera de esta tabla -ver `data/reports/fieldbeat_tasks_linked_to_missing_zendesk_ticket.csv` (no cargado en el warehouse). Fuente: `Ticket_FieldBeat_Report_Detail.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `bridge_id` | VARCHAR | PK, mismo ID que en la tabla puente original. |
| `zendesk_ticket_id` | BIGINT | FK a `zendesk_tickets`. |
| `fieldbeat_task_id` | BIGINT | FK a `fieldbeat_tasks`. |
| `link_method` | VARCHAR | Siempre `fieldbeat_report_ticket_number` (único método de vinculación implementado). |
| `confidence` | BIGINT | Siempre `1` (no hay niveles de confianza de vinculación implementados todavía). |
| `task_type` / `state` / `priority` / `description` / `client_name` / `assigned_to` / `created_at` / `updated_at` / `start_time` / `duration_minutes` | varios | Copiados del task FieldBeat correspondiente, para no tener que hacer join. |
| `equipment_internal_ids` | VARCHAR | Pipe-joined, equipos de ese task específico. |
| `used_parts_count` / `used_part_numbers` | BIGINT/VARCHAR | Repuestos de ese task específico (sin info de matching Dolibarr). |

### `marts.used_parts_dolibarr_match` (2193 filas)
**La tabla de resolución de identidad de repuestos, universo global** (todos los tasks FieldBeat, no solo los de tickets accesibles). Fuente: `Used_Parts_Dolibarr_Match.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `used_part_id` | VARCHAR | PK, mismo valor que `processed.fieldbeat_used_parts.used_part_id`. |
| `fieldbeat_task_id` | BIGINT | FK a `fieldbeat_tasks`. |
| `zendesk_ticket_id` | VARCHAR | **Tipo distinto a `zendesk_tickets.zendesk_ticket_id` (BIGINT)** -ver anomalías al final. Casi siempre vacío. |
| `part_name` | VARCHAR | Copiado de `fieldbeat_used_parts`. |
| `raw_part_identifier` | VARCHAR | El `part_number` original, tal como se intentó resolver. |
| `normalized_part_identifier` | VARCHAR | Resultado de `normalizeIdentifier()` sobre `raw_part_identifier`. |
| `dolibarr_product_id` | BIGINT | Producto ganador si `match_status = MATCHED`; vacío en cualquier otro caso. |
| `dolibarr_ref` / `dolibarr_barcode` / `dolibarr_label` | VARCHAR | Datos del producto ganador (vacíos si no matcheó). |
| `match_method` | VARCHAR | `MANUAL_ALIAS_EXACT` \| `PLACEHOLDER_REJECTED` \| `REF_EXACT` \| `BARCODE_EXACT` \| `ID_EXACT` \| `REF_NORMALIZED_EXACT` \| `BARCODE_NORMALIZED_EXACT` \| `REF_LIKE` \| `NONE`. |
| `match_confidence` | DOUBLE | 0 a 1, según el tier que matcheó (ver `src/resolvers/part-identity-resolver.js`). |
| `match_status` | VARCHAR | `MATCHED` \| `NO_MATCH` \| `AMBIGUOUS_MATCH` \| `PLACEHOLDER_VALUE`. |
| `needs_manual_review` | BOOLEAN | `true` para todo lo que no sea un match limpio de alta confianza (incluye `REF_LIKE` aunque su status sea `MATCHED`). |
| `candidate_dolibarr_product_ids` | VARCHAR | Pipe-joined de IDs candidatos, solo poblado cuando `match_status = AMBIGUOUS_MATCH`. |

### `marts.fieldbeat_report_dolibarr_operational_view` (3747 filas) -report-céntrica
**FieldBeat-first, complementaria a `ticket_fieldbeat_dolibarr_operational_view`, no la reemplaza.** 1 fila por cada `fieldbeat_task_id` -universo completo, sin excluir los que nunca tuvieron ticket Zendesk. Fuente: `FieldBeat_Report_Dolibarr_Operational_View.csv`.

| Columna | Tipo | Significado |
|---|---|---|
| `fieldbeat_task_id` | BIGINT | PK, FK a `fieldbeat_tasks`. |
| `fieldbeat_task_date` | TIMESTAMPTZ | `start_time` del task, con fallback a `created_at` si falta. Es la fecha real de la intervención. |
| `client_key` / `client_rut` / `client_name` | VARCHAR | Parseados de `fieldbeat_tasks.client_key` (formato `FIELD_BEAT_CLIENT\|rut\|nombre`). |
| `task_type` / `task_state` | VARCHAR | Copiados de `fieldbeat_tasks`. |
| `technician_names` | VARCHAR | Mapea a `fieldbeat_tasks.assigned_to` -único campo de técnico disponible en el schema actual (no hay lista de múltiples técnicos por task). |
| `equipment_internal_ids` | VARCHAR | Pipe-joined, equipos de este task específico. |
| `linked_zendesk_ticket_id` | VARCHAR | El `zendesk_ticket_id` de la tabla puente para este task (vacío si nunca se reportó ninguno). |
| `zendesk_join_status` | VARCHAR | `NO_TICKET_REPORTED` (2537) \| `LINKED_TO_ACCESSIBLE_ZENDESK` (290) \| `LINKED_TO_MISSING_OR_RESTRICTED_ZENDESK` (920). |
| `used_parts_count` / `matched_used_parts_count` / `placeholder_used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` / `review_required_used_parts_count` | BIGINT | Mismo significado que en la línea ticket-céntrica, pero acá `used_parts_count` sumado sobre las 3747 filas da exactamente 2193 (el total global) -a diferencia de la vista ticket-céntrica, que solo suma 200. |
| `dolibarr_refs` / `dolibarr_product_ids` | VARCHAR | Pipe-joined. **Nota:** acá `dolibarr_product_ids` sí es `VARCHAR` (a diferencia de `gold.used_parts_analysis.dolibarr_product_ids`, que es `BIGINT` -ver anomalías), porque en este grano (por task) sí hay casos con más de un producto distinto. |
| `used_part_numbers` / `used_part_names` | VARCHAR | Pipe-joined. |
| `part_match_statuses` / `part_match_methods` | VARCHAR | Pipe-joined únicos. |
| `report_quality_status` | VARCHAR | `OK` \| `NO_USED_PARTS` \| `HAS_PLACEHOLDERS` \| `HAS_UNMATCHED_PARTS` \| `HAS_AMBIGUOUS_PARTS` \| `REVIEW_REQUIRED`. Igual cascada que `data_quality_status` del lado ticket-céntrico, pero sin el estado `NO_FIELDBEAT_REPORT` (no aplica: cada fila YA es un reporte FieldBeat) -en su lugar, `NO_USED_PARTS`. |

---

## Schema `gold`

Tablas finales agregadas, pensadas para consumo BI directo. Ver [GOLD_DATA_CONTRACT.md](GOLD_DATA_CONTRACT.md) para objetivo/uso recomendado de cada una -acá el foco es columna por columna.

### `gold.operational_dashboard` (1 fila)
KPIs globales del universo ticket-céntrico (628 tickets accesibles).

| Columna | Tipo | Significado |
|---|---|---|
| `total_zendesk_tickets` | BIGINT | 628. |
| `tickets_with_fieldbeat_report` / `tickets_without_fieldbeat_report` | BIGINT | 228 / 400. |
| `tickets_with_multiple_fieldbeat_reports` | BIGINT | 38. |
| `tickets_with_used_parts` | BIGINT | 113. |
| `tickets_with_all_parts_matched` | BIGINT | 59 -tickets donde `part_match_quality_status = ALL_PARTS_MATCHED`. |
| `tickets_review_required` | BIGINT | 59 (**por coincidencia numérica, no es el mismo grupo que el anterior** -ver nota en conversación previa; cuenta tickets con `review_required_used_parts_count > 0`). |
| `total_used_parts_in_ticket_scope` | BIGINT | 200 -repuestos dentro del alcance de tickets accesibles (no los 2193 globales). |
| `matched_used_parts` / `placeholder_used_parts` / `unmatched_used_parts` / `ambiguous_used_parts` | BIGINT | 137 / 31 / 27 / 5. |
| `ticket_fieldbeat_coverage_rate` / `used_parts_match_rate` / `review_required_rate` | VARCHAR | Porcentajes ya formateados como texto (`"36.31%"`, etc.) -para sumarlos/promediarlos en SQL hay que parsearlos primero. |

### `gold.data_quality_report` (6 filas)
1 fila fija por cada valor posible de `data_quality_status` (aunque tenga 0 tickets).

| Columna | Tipo | Significado |
|---|---|---|
| `data_quality_status` | VARCHAR | PK -uno de los 6 estados (ver arriba en `ticket_fieldbeat_dolibarr_operational_view`). |
| `ticket_count` | BIGINT | Cuántos tickets en ese estado. |
| `percent_of_total_tickets` | VARCHAR | Texto formateado (`"63.69%"`). |
| `used_parts_count` / `matched_used_parts_count` / `placeholder_used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` | BIGINT | Suma de repuestos de los tickets en ese estado. |

### `gold.client_service_profile` (14 filas)
1 fila por cliente (fan-out desde `client_names` pipe-joined de la vista ticket-céntrica -un ticket con 2 clientes cuenta para ambos).

| Columna | Tipo | Significado |
|---|---|---|
| `client_name` | VARCHAR | PK. |
| `total_tickets` | BIGINT | Tickets atribuidos a este cliente. |
| `tickets_with_fieldbeat` | BIGINT | (en la práctica, igual a `total_tickets` -el cliente solo aparece si hubo un reporte FieldBeat). |
| `fieldbeat_report_count` | BIGINT | Suma de reportes FieldBeat. |
| `tickets_with_multiple_fieldbeat_reports` | BIGINT | -|
| `tickets_with_used_parts` / `used_parts_count` | BIGINT | -|
| `matched_used_parts_count` / `placeholder_used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` | BIGINT | -|
| `review_required_tickets` | BIGINT | -|

### `gold.equipment_service_profile` (23 filas)
Igual que `client_service_profile` pero por `equipment_internal_id` (fan-out desde `equipment_internal_ids`).

| Columna | Tipo | Significado |
|---|---|---|
| `equipment_internal_id` | VARCHAR | PK. |
| `total_tickets` / `fieldbeat_report_count` / `tickets_with_used_parts` / `used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` / `review_required_tickets` | BIGINT | Mismo significado que en `client_service_profile`. |

### `gold.used_parts_analysis` (576 filas)
**Universo global** (2193 repuestos, no los 200 en alcance de tickets), agrupado por `normalized_part_identifier` único.

| Columna | Tipo | Significado |
|---|---|---|
| `normalized_part_identifier` | VARCHAR | PK. |
| `raw_part_identifier` | VARCHAR | Variantes crudas pipe-joined que normalizan a esta misma clave. |
| `part_name` | VARCHAR | Variantes de nombre pipe-joined. |
| `occurrences` | BIGINT | Cuántas veces aparece este repuesto (útil para priorizar aliases manuales). |
| `matched_count` / `placeholder_count` / `no_match_count` / `ambiguous_count` | BIGINT | Desglose por resultado de matching. |
| `dolibarr_refs` | VARCHAR | Ref(s) Dolibarr matcheadas, pipe-joined. |
| `dolibarr_product_ids` | **BIGINT** | ⚠️ Ver anomalías -semánticamente es una lista pipe-joined, pero DuckDB infirió BIGINT porque en los datos actuales ningún grupo tuvo más de un producto distinto matcheado. Si eso cambia, el tipo cambiará a VARCHAR en el próximo `db:load`. |
| `match_statuses` / `match_methods` | VARCHAR | Pipe-joined únicos, todos los vistos para este repuesto. |
| `needs_manual_review` | BOOLEAN | `true` si CUALQUIER ocurrencia de este repuesto necesita revisión. |

### `gold.scope_metadata` (1 fila)
Metadata de alcance de GOLD v1 -ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md) para la narrativa completa.

| Columna | Tipo | Significado |
|---|---|---|
| `total_fieldbeat_tasks` | BIGINT | 3747. |
| `total_fieldbeat_used_parts_global` | BIGINT | 2193. |
| `used_parts_in_ticket_mart` / `used_parts_outside_ticket_mart` | BIGINT | 200 / 1993. |
| `fieldbeat_tasks_with_zendesk_ticket` / `fieldbeat_tasks_without_zendesk_ticket` | BIGINT | 1210 / 2537. |
| `fieldbeat_tasks_linked_to_existing_zendesk_ticket` / `fieldbeat_tasks_linked_to_missing_zendesk_ticket` | BIGINT | 290 / 920. |
| `zendesk_backfill_unique_missing_ticket_ids` | BIGINT | 656 -IDs únicos que se intentaron recuperar. |
| `zendesk_backfill_tickets_found` / `zendesk_backfill_tickets_not_found` / `zendesk_backfill_tickets_forbidden` | BIGINT | 4 / 361 / **291**. |
| `scope_warning` | VARCHAR | Texto fijo de advertencia (ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md)). |
| `phase_2_pending_action` | VARCHAR | Texto fijo -recuperar los 291 IDs con 403 usando un token con permisos ampliados. Lista completa en `data/reports/zendesk_ticket_ids_not_accessible_403.json` (no cargada en el warehouse). |

### `gold.fieldbeat_report_analysis` (1 fila) -report-céntrica
KPIs globales del universo report-céntrico (3747 reportes) -equivalente de `gold.operational_dashboard` pero sin recortar por alcance de ticket.

| Columna | Tipo | Significado |
|---|---|---|
| `total_fieldbeat_reports` | BIGINT | 3747. |
| `reports_no_ticket_reported` / `reports_linked_to_accessible_zendesk` / `reports_linked_to_missing_or_restricted_zendesk` | BIGINT | 2537 / 290 / 920. |
| `reports_with_used_parts` | BIGINT | 1809. |
| `reports_ok` | BIGINT | 480 -reportes con `report_quality_status = OK`. |
| `reports_review_required` | BIGINT | 1329 (**cuenta amplia**: cualquier reporte con al menos 1 repuesto `needs_manual_review = true`, incluye placeholders/no-match/ambiguous, no solo el estado puro `REVIEW_REQUIRED` que son 117). |
| `total_used_parts` | BIGINT | 2193 -acá sí es el total global (a diferencia del dashboard ticket-céntrico). |
| `matched_used_parts` / `placeholder_used_parts` / `unmatched_used_parts` / `ambiguous_used_parts` | BIGINT | 927 / 721 / 489 / 56. |
| `zendesk_link_rate` / `used_parts_match_rate` / `review_required_rate` | VARCHAR | Porcentajes formateados como texto. |

### `gold.client_parts_consumption` (913 filas) -report-céntrica
**Grano deliberado (cliente × período mensual)**, no solo cliente -permite responder tanto "qué cliente usa más repuestos" (sumando todos los períodos) como "en qué ventana de tiempo" (filtrando `period`). Ver query de ejemplo #8 en [SQL_WAREHOUSE.md](SQL_WAREHOUSE.md).

| Columna | Tipo | Significado |
|---|---|---|
| `client_name` | VARCHAR | Parte de la PK compuesta (`client_name`, `period`). |
| `client_rut` | VARCHAR | RUT del cliente (representativo). |
| `period` | VARCHAR | `YYYY-MM`, derivado de `fieldbeat_task_date`. Valor especial `"(sin fecha)"` si el task no tenía fecha. |
| `total_reports` | BIGINT | Reportes de ese cliente en ese mes. |
| `used_parts_count` / `matched_used_parts_count` / `placeholder_used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` | BIGINT | Repuestos de ese cliente en ese mes. |

### `gold.client_report_volume_by_period` (913 filas) -report-céntrica
Mismo grano que la anterior (cliente × período), pero enfocada en **volumen de reportes**, no en repuestos -útil para tendencias de estacionalidad/capacidad, no de consumo.

| Columna | Tipo | Significado |
|---|---|---|
| `client_name` / `period` | VARCHAR | PK compuesta. |
| `total_reports` | BIGINT | -|
| `reports_with_used_parts` | BIGINT | Cuántos de esos reportes tuvieron al menos 1 repuesto. |
| `reports_review_required` | BIGINT | Cuántos tuvieron al menos 1 repuesto con `needs_manual_review = true`. |

### `gold.equipment_parts_consumption` (57 filas) -report-céntrica
1 fila por `equipment_internal_id` (fan-out desde `fieldbeat_report_dolibarr_operational_view.equipment_internal_ids`), sin desglose por período (a diferencia de las tablas de cliente).

| Columna | Tipo | Significado |
|---|---|---|
| `equipment_internal_id` | VARCHAR | PK. |
| `total_reports` / `used_parts_count` / `matched_used_parts_count` / `placeholder_used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` | BIGINT | Mismo significado que en las tablas de cliente. |

### `gold.fieldbeat_data_quality` (6 filas) -report-céntrica
1 fila fija por cada valor posible de `report_quality_status` (aunque tenga 0 reportes) -equivalente de `gold.data_quality_report` para el universo report-céntrico.

| Columna | Tipo | Significado |
|---|---|---|
| `report_quality_status` | VARCHAR | PK -uno de los 6 estados. |
| `report_count` | BIGINT | Cuántos reportes en ese estado. |
| `percent_of_total_reports` | VARCHAR | Texto formateado. |
| `used_parts_count` / `matched_used_parts_count` / `placeholder_used_parts_count` / `unmatched_used_parts_count` / `ambiguous_used_parts_count` | BIGINT | Suma de repuestos de los reportes en ese estado. |

---

## Relaciones entre tablas (claves de join)

```
processed.zendesk_tickets.zendesk_ticket_id
  ├─< processed.zendesk_ticket_tags.zendesk_ticket_id
  ├─< processed.zendesk_custom_fields.zendesk_ticket_id
  ├─< marts.ticket_fieldbeat_report_detail.zendesk_ticket_id
  └── marts.ticket_fieldbeat_operational_view.zendesk_ticket_id (1:1)
        └── marts.ticket_fieldbeat_dolibarr_operational_view.zendesk_ticket_id (1:1)

processed.fieldbeat_tasks.fieldbeat_task_id
  ├─< processed.fieldbeat_used_parts.fieldbeat_task_id
  ├─< processed.fieldbeat_task_equipments.fieldbeat_task_id
  ├─< marts.ticket_fieldbeat_report_detail.fieldbeat_task_id
  ├─< marts.used_parts_dolibarr_match.fieldbeat_task_id
  └── marts.fieldbeat_report_dolibarr_operational_view.fieldbeat_task_id (1:1)

processed.fieldbeat_tasks.client_key
  └── processed.fieldbeat_clients.client_key (N:1)

processed.fieldbeat_task_equipments.equipment_uuid
  └── processed.fieldbeat_equipments.equipment_uuid (N:1)

processed.dolibarr_products.dolibarr_product_id
  └─< processed.dolibarr_product_identity_map.dolibarr_product_id
  └─< marts.used_parts_dolibarr_match.dolibarr_product_id

marts.fieldbeat_report_dolibarr_operational_view.client_name
  └─< gold.client_parts_consumption.client_name (fan-out por período)
  └─< gold.client_report_volume_by_period.client_name (fan-out por período)

marts.fieldbeat_report_dolibarr_operational_view.equipment_internal_ids
  └─< gold.equipment_parts_consumption.equipment_internal_id (fan-out, pipe-split)
```

---

## Anomalías y advertencias de tipos

`read_csv_auto` infiere tipos por columna a partir del contenido real -esto significa que columnas con el "mismo" significado en tablas distintas pueden terminar con tipos SQL distintos si sus datos son suficientemente diferentes (muchos vacíos, valores no numéricos, etc.). Verificado contra la BDD real, no supuesto:

1. **`zendesk_ticket_id` no es del mismo tipo en todas las tablas.** En `processed.zendesk_tickets`, `marts.ticket_fieldbeat_*` y `processed.zendesk_ticket_tags`/`zendesk_custom_fields` es `BIGINT`. En **`marts.used_parts_dolibarr_match` es `VARCHAR`** (esa columna viene casi siempre vacía, lo que hace que el sniffer de DuckDB no la infiera como número). Un `JOIN ... ON a.zendesk_ticket_id = b.zendesk_ticket_id` entre esta tabla y cualquier otra **fallará silenciosamente (0 filas)** sin un cast explícito. Usar `CAST(zendesk_ticket_id AS VARCHAR)` del lado BIGINT, o filtrar por `fieldbeat_task_id` en su lugar (ese sí es BIGINT consistente en ambos lados).

2. **`priority` significa cosas distintas en `zendesk_tickets` (VARCHAR: `low`/`high`/etc.) vs `fieldbeat_tasks`/`ticket_fieldbeat_report_detail` (BIGINT: 1-N).** Incluso el TIPO es distinto -no hay riesgo de join accidental, pero sí de confundir el significado en una query que junte ambas.

3. **`gold.used_parts_analysis.dolibarr_product_ids` es `BIGINT`, no `VARCHAR`**, aunque el código lo genera como lista pipe-joined -es así porque en el dataset actual ningún grupo de repuesto normalizado tuvo más de un producto Dolibarr distinto matcheado (0 valores con `|` en 576 filas). Es un artefacto de los datos de hoy, no una garantía -puede volverse `VARCHAR` en un `db:load` futuro si aparece un caso con múltiples productos. **Prueba de que esto es real y no solo teórico:** la columna con el mismo nombre `dolibarr_product_ids` en `marts.fieldbeat_report_dolibarr_operational_view` (grano por task, no por repuesto normalizado) **sí es `VARCHAR`**, porque ahí sí hay casos con múltiples productos distintos en el mismo reporte. Mismo nombre de columna, mismo pipeline de generación, tipo SQL distinto -depende 100% de los datos, no del código.

4. **`barcode` (en `dolibarr_products` y `dolibarr_product_identity_map`) es `BIGINT`**, aunque semánticamente es un código (podría tener ceros a la izquierda). Es así porque solo 1 de 1609 productos tiene barcode, y ese único valor (`7804612571018`) es puramente numérico -el resto son `NULL`. Si un futuro barcode viniera con letras, el tipo cambiaría a `VARCHAR`.

5. **`processed.fieldbeat_used_parts.dolibarr_product_id` / `dolibarr_ref` / `unit_cost` / `estimated_total_cost` son vestigiales.** Quedaron del diseño original antes de construir el resolver de identidad (`dolibarr_ref` ahí es literalmente una copia de `part_number`, la asunción que resultó ser incorrecta). **La fuente real de verdad de matching es `marts.used_parts_dolibarr_match`.**

6. **Columnas de porcentaje (`*_rate`, `percent_of_total_*`) son `VARCHAR`** (ej. `"42.27%"`), no numéricas -vienen pre-formateadas desde JS. Para operar con ellas en SQL hay que parsear el `%` primero (ej. `TRY_CAST(REPLACE(used_parts_match_rate, '%', '') AS DOUBLE)`).

7. **Columnas `BIGINT` se devuelven como `bigint` de JS** al consultar desde Node (ver [SQL_WAREHOUSE.md](SQL_WAREHOUSE.md)) -no aplica si se consulta desde SQL puro/DBeaver/Python.
