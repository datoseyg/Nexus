# Inventario SQL y ownership

Fuente: `sql/**`, `src/db/generate-postgres-ddl.js`, `src/db/warehouse-config.js`, `src/db/ownership-manifest.js` y `src/db/migrate-to-supabase.js`, auditados el 2026-07-20.

## Orden de ejecución comprobado

| # | Archivo | Propósito y riesgo |
|---:|---|---|
| 1 | `sql/000_roles_and_schemas.sql` | Crea rol/schemas y grants/default privileges. Contiene contraseña placeholder de `nexus_app`, que debe rotarse fuera del repo. |
| 2 | `sql/005_raw.sql` | Tres tablas RAW JSON. La carga RAW permanece opcional y apagada. |
| 3 | `sql/010_processed.sql` | Snapshot DDL autogenerado de tablas `processed` observadas en DuckDB. |
| 4 | `sql/020_marts.sql` | Snapshot DDL autogenerado de tablas `marts` observadas en DuckDB. Incluye objetos que pueden ser `EXTERNAL`. |
| 5 | `sql/030_gold.sql` | Snapshot DDL autogenerado de tablas `gold` observadas en DuckDB. Incluye objetos que pueden ser `EXTERNAL`. |
| 6 | `sql/040_audit.sql` | Tablas de corridas, calidad y estado de sincronización. |
| 7 | `sql/050_manual_review.sql` | Alias de partes y overrides de vínculos. |
| 8 | `sql/060_stock.sql` | Movimientos de stock. |
| 9 | `sql/070_config.sql` | Modelo contractual, issues y vistas curadas; revoca acceso directo a base tables. |
| 10 | `sql/080_holiday_calendar.sql` | Calendario, cobertura, funciones y vistas de festivos; revocado a `nexus_app`. |
| 11 | `sql/081_working_hours_contract_marts.sql` | Tres tablas y función Postgres-native; revocadas a `nexus_app`. |
| 12 | `sql/082_working_hours_analysis_current_view.sql` | Vista actual curada; concede `SELECT` a `nexus_app`. |
| 13 | `sql/083_holiday_calendar_import_support.sql` | Reemplaza constraint de tipo de festivo. |
| 14 | `sql/084_contract_valid_from_correction.sql` | Altera vigencia contractual y añade procedencia; puede invalidar supuestos de datos antiguos. |
| 15 | `sql/085_contract_version_revision_uniqueness.sql` | Corrige modelo de revisiones dentro de transacción; precondiciones estrictas pueden abortar y el rollback es condicional. |

No saltar ni reordenar archivos. `000` contiene un comentario de orden antiguo que llega solo hasta `060`; este inventario refleja el árbol actual.

## Objetos DDL por archivo

- `000`: rol `nexus_app`; schemas `raw`, `processed`, `marts`, `gold`, `audit`, `manual_review`, `stock`; grants actuales y default privileges.
- `005`: `raw.zendesk_tickets_raw`, `raw.fieldbeat_tasks_raw`, `raw.dolibarr_products_raw`.
- `010`: once tablas `processed` enumeradas en la sección `DUCKDB_SYNC`.
- `020`: `marts.equipment_part_lifecycle_events`, `equipment_part_lifecycle_intervals`, `fieldbeat_report_dolibarr_operational_view`, `fieldbeat_working_hours_analysis`, `ticket_fieldbeat_dolibarr_operational_view`, `ticket_fieldbeat_operational_view`, `ticket_fieldbeat_report_detail`, `used_parts_dolibarr_match`.
- `030`: tablas `gold.after_hours_by_client`, `after_hours_by_period`, `after_hours_by_task_type`, `after_hours_by_technician`, `after_hours_work_analysis`, `client_parts_consumption`, `client_report_volume_by_period`, `client_service_profile`, `data_quality_report`, cinco tablas `equipment_part_lifecycle_*`, `equipment_parts_consumption`, `equipment_service_profile`, `fieldbeat_data_quality`, `fieldbeat_report_analysis`, `operational_dashboard`, `scope_metadata`, `used_parts_analysis`.
- `040`: `audit.pipeline_runs`, `audit.data_quality_events`, `audit.warehouse_sync_state`.
- `050`: `manual_review.part_aliases`, `manual_review.ticket_link_overrides`.
- `060`: `stock.stock_movements`.
- `070`: ocho tablas `config.contract_*`, `manual_review.contract_data_issues`; índices `contract_import_runs_success_sha_uidx`, `contract_equipment_versions_current_key_uidx`, `contract_equipment_match_overrides_active_fb_uidx`; vistas `config.contract_equipment_analysis` y `config.contract_service_window_analysis`; revokes/grants curados.
- `080`: tablas `config.holiday_import_runs`, `holiday_calendar_entries`, `holiday_calendar_coverage`; índices `holiday_import_runs_success_sha_uidx`, `holiday_calendar_entries_date_idx`, `holiday_calendar_coverage_lookup_idx`, `holiday_calendar_coverage_range_gist_idx`; funciones `check_holiday_coverage_no_overlap()` y `publish_holiday_coverage(...)`; trigger `holiday_calendar_coverage_no_overlap`; vistas `current_holiday_calendar_entries` y `current_holiday_calendar_coverage`; revokes.
- `081`: tablas `marts.fieldbeat_contract_coverage_segments`, `fieldbeat_working_hours_analysis_v2`, `fieldbeat_working_hours_equipment_links`; índices `fbchs_*`, `fbwha_v2_*`, `fbwhel_*`; función `marts.validate_equipment_links_cardinality(bigint)`; revokes de tablas, secuencias y función.
- `082`: crea/reemplaza `marts.fieldbeat_working_hours_analysis_current` y concede `SELECT` a `nexus_app`.
- `083`: elimina y recrea `config.holiday_calendar_entries.holiday_calendar_entries_holiday_type_check` con la taxonomía vigente.
- `084`: hace nullable `config.contract_equipment_versions.valid_from`; añade `valid_from_is_inferred`, `valid_from_basis`, `valid_from_precision`, `valid_from_source_field`, `valid_from_source_value_raw`; recrea `contract_equipment_versions_valid_from_basis_consistency`.
- `085`: añade `superseded_at`; elimina `contract_equipment_versions_check`, `contract_equipment_versions_equipment_key_valid_from_key`, `contract_equipment_versions_current_key_uidx` y el legado opcional `contract_equipment_versions_period_fingerprint_key`; crea `contract_equipment_versions_current_supersede_consistency` y `contract_equipment_versions_current_per_period_uidx` con `NULLS NOT DISTINCT`. Incluye precondiciones de catálogo/datos y rollback documental condicional.

Los nombres anteriores inventarían una falsa garantía si se separaran de las definiciones SQL: para columnas, tipos, FKs, CHECKs y cuerpos completos, los archivos en este orden son la fuente de verdad. Antes de ejecutar, generar un catálogo esperado desde estos archivos y compararlo con el destino.

## DDL autogenerado

`npm run db:pg:ddl` ejecuta `src/db/generate-postgres-ddl.js` y sobrescribe `010_processed.sql`, `020_marts.sql` y `030_gold.sql` a partir del warehouse DuckDB actual. Debe ejecutarse solo con un warehouse candidato reproducible y su diff debe revisarse antes de cualquier aplicación.

No mantener en el runbook un total fijo de tablas. El número cambia con el warehouse y no equivale al número de tablas sincronizadas.

## Inventario `DUCKDB_SYNC`

Estas son las entradas actuales de `warehouse-config.js::TABLES` y, salvo override, las únicas que el migrador puede cargar a staging y reemplazar transaccionalmente mediante `TRUNCATE ... RESTART IDENTITY` + `INSERT`, sin `CASCADE`:

### `processed`

- `zendesk_tickets`
- `fieldbeat_tasks`
- `fieldbeat_used_parts`
- `dolibarr_products`
- `fieldbeat_clients`
- `fieldbeat_equipments`
- `fieldbeat_task_equipments`
- `fieldbeat_report_fields`
- `zendesk_ticket_tags`
- `zendesk_custom_fields`
- `dolibarr_product_identity_map`

### `marts`

- `ticket_fieldbeat_operational_view`
- `ticket_fieldbeat_dolibarr_operational_view`
- `used_parts_dolibarr_match`
- `ticket_fieldbeat_report_detail`
- `fieldbeat_report_dolibarr_operational_view`

### `gold`

- `operational_dashboard`
- `data_quality_report`
- `client_service_profile`
- `equipment_service_profile`
- `used_parts_analysis`
- `scope_metadata`
- `fieldbeat_report_analysis`
- `client_parts_consumption`
- `client_report_volume_by_period`
- `equipment_parts_consumption`
- `fieldbeat_data_quality`

## Objetos DuckDB observados pero no sincronizables

El manifiesto clasifica explícitamente los objetos conocidos; cualquier tabla desconocida queda sin ownership y hace abortar migración/validación. `marts.fieldbeat_working_hours_analysis` y los demás objetos de esta lista tienen entradas `EXTERNAL` explícitas. En el warehouse auditado, las tablas presentes en `processed/marts/gold` pero ausentes de `TABLES` fueron:

- `marts.equipment_part_lifecycle_events`
- `marts.equipment_part_lifecycle_intervals`
- `marts.fieldbeat_working_hours_analysis`
- `gold.after_hours_by_client`
- `gold.after_hours_by_period`
- `gold.after_hours_by_task_type`
- `gold.after_hours_by_technician`
- `gold.after_hours_work_analysis`
- `gold.equipment_part_lifecycle_by_client`
- `gold.equipment_part_lifecycle_by_machine`
- `gold.equipment_part_lifecycle_by_part`
- `gold.equipment_part_lifecycle_insights`
- `gold.equipment_part_lifecycle_summary`

Que `010`–`030` creen una tabla no la convierte en sincronizable. El migrador omite los objetos `EXTERNAL`; el validador comparte el mismo manifiesto y no exige igualdad DuckDB/PostgreSQL para ellos.

## Objetos Postgres-native

### `POSTGRES_BUILDER`

- `marts.fieldbeat_contract_coverage_segments`
- `marts.fieldbeat_working_hours_analysis_v2`
- `marts.fieldbeat_working_hours_equipment_links`

### `POSTGRES_TRANSACTIONAL`

- `audit.pipeline_runs`
- `audit.data_quality_events`
- `audit.warehouse_sync_state`
- `manual_review.part_aliases`
- `manual_review.ticket_link_overrides`
- `manual_review.contract_data_issues`
- `stock.stock_movements`
- `config.contract_import_runs`
- `config.contract_source_rows`
- `config.contract_equipment_versions`
- `config.contract_equipment_observations`
- `config.contract_service_schedules`
- `config.contract_service_windows`
- `config.contract_equipment_matches`
- `config.contract_equipment_match_overrides`
- `config.holiday_import_runs`
- `config.holiday_calendar_entries`
- `config.holiday_calendar_coverage`

### Vistas no aplicables a sincronización

- `marts.fieldbeat_working_hours_analysis_current`
- `config.current_holiday_calendar_entries`
- `config.current_holiday_calendar_coverage`

También existen las vistas curadas contractuales `config.contract_equipment_analysis` y `config.contract_service_window_analysis`; son DDL Postgres y no payload DuckDB.

## RAW opcional

`sql/005_raw.sql` crea:

- `raw.zendesk_tickets_raw`
- `raw.fieldbeat_tasks_raw`
- `raw.dolibarr_products_raw`

El migrador solo intenta cargarlas con `LOAD_RAW=true`. La primera liberación debe conservar `LOAD_RAW=false` salvo una autorización explícita que evalúe volumen, necesidad y exposición.

## Schemas y exclusiones

Schemas creados para esta arquitectura:

- `raw`, `processed`, `marts`, `gold`
- `audit`, `manual_review`, `stock`, `config`

Exclusiones deliberadas:

- `reports` existe en el universo DuckDB/local, pero no forma parte del DDL ni del explorador PostgreSQL.
- Ninguno de los schemas anteriores debe agregarse a “Exposed schemas” de Supabase/PostgREST.
- El explorador de la app permite solo `processed`, `marts` y `gold`.

## Grants de `nexus_app`

| Área | Acceso esperado |
|---|---|
| `raw`, `processed`, `marts`, `gold` | `USAGE` de schema + `SELECT` de tablas |
| `audit`, `manual_review`, `stock` | `USAGE`; CRUD de tablas y uso/select de secuencias |
| `config` | `USAGE` + `SELECT` solo en las dos vistas contractuales curadas |
| `marts.fieldbeat_working_hours_analysis_current` | `SELECT` explícito |
| Tablas contractuales/festivos base | Sin acceso directo |
| Tablas/function working-hours builder | Sin acceso directo |
| `manual_review.contract_data_issues` | Sin acceso directo |

Los default privileges de `000` se asocian al owner que ejecuta ese archivo. Verificar grants reales después del DDL; no inferirlos únicamente del texto si se cambia el rol ejecutor.

## Riesgo destructivo

- Un FK desconocido en un proyecto antiguo hará fallar el `TRUNCATE` sin `CASCADE`; el swap transaccional debe preservar la tabla, pero exige diagnóstico de drift antes de reintentar.
- `085` aborta si encuentra historia contractual que no puede reinterpretar con seguridad.
- `ALTER TABLE` puede bloquear o fallar por datos/constraints existentes.
- Ejecutar una secuencia incompleta puede dejar un híbrido de schemas versión 1 y actual.
- No existe rollback universal para esta cadena. Se exige snapshot/restore probado y ensayo en clon o PostgreSQL desechable.
