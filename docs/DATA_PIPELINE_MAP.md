# Mapa de flujo de datos

```
APIs externas (Zendesk, FieldBeat, Dolibarr)
        │
        ▼
   data/raw/            (RAW - inmutable, no versionar)
        │  normalizers
        ▼
  data/processed/        (PROCESSED - regenerable desde RAW)
        │  resolvers + marts
        ▼
   data/marts/           (MARTS - regenerable desde PROCESSED + config)
        │  gold builders
        ▼
    data/gold/           (GOLD - regenerable desde MARTS)
        │  db:load
        ▼
data/warehouse/eyg_nexus.duckdb   (regenerable desde PROCESSED+MARTS+GOLD)
        │
        ▼
apps/nexus-bi-app (dashboards/auditoría/explorador/búsqueda) + sql/ (queries) + QA (src/qa/*)
```

Hay **4 líneas paralelas y complementarias** que comparten RAW/PROCESSED pero divergen en MARTS/GOLD - ninguna reemplaza a la otra:

| Línea | Grano | Mart principal | GOLD principal |
|---|---|---|---|
| Ticket-céntrica | 1 ticket Zendesk (628, solo accesibles) | `Ticket_FieldBeat_Dolibarr_Operational_View.csv` | `GOLD_Operational_Dashboard.csv` + 5 más |
| Report-céntrica / FieldBeat-first | 1 task FieldBeat (3747, universo completo) | `FieldBeat_Report_Dolibarr_Operational_View.csv` | `GOLD_FieldBeat_Report_Analysis.csv` + 4 más |
| Trabajo Fuera de Horario | 1 task FieldBeat (3747), clasificado por horario | `FieldBeat_Working_Hours_Analysis.csv` | `GOLD_After_Hours_Work_Analysis.csv` + 4 más |
| Vida Útil de Repuestos por Máquina | 1 evento task×equipo×repuesto (2214) / 1 intervalo equipo×repuesto (697) | `Equipment_Part_Lifecycle_Events.csv` + `Equipment_Part_Lifecycle_Intervals.csv` | `GOLD_Equipment_Part_Lifecycle_By_Machine.csv` + 4 más (motor de modelos AUTO - ver [LIFECYCLE_PREDICTIVE_MODELS.md](LIFECYCLE_PREDICTIVE_MODELS.md)) |

---

## Etapa por etapa

| Etapa | Scripts | Entradas | Salidas | Archivos responsables | Validaciones |
|---|---|---|---|---|---|
| **1. Extracción (RAW)** | `get:zendesk`, `get:fieldbeat:all`, `get:dolibarr`, `get:all` | APIs externas (credenciales en `.env`) | `data/raw/{zendesk,fieldbeat,dolibarr}/*.json` | `src/miners/*.js` | Ninguna automática - errores de red/auth abortan el script |
| **1b. Backfill puntual** | `get:zendesk:backfill-fieldbeat` | `data/reports/fieldbeat_tasks_linked_to_missing_zendesk_ticket.csv` | `data/raw/zendesk/backfill_by_fieldbeat_ticket_ids/*.json` | `src/miners/zendesk-backfill-missing-ticket-ids.js` | Ninguna - ya ejecutado, no repetir sin necesidad |
| **2. Normalización (RAW→PROCESSED)** | `normalize:fieldbeat`, `normalize:zendesk`, `normalize:dolibarr` | JSON de `data/raw/` | CSV de `data/processed/<plataforma>/` | `src/normalizers/*.js` | `qa:fieldbeat`/`qa:zendesk`/`qa:dolibarr` (duplicados, cobertura, integridad referencial) |
| **3. Resolución de identidad (repuestos)** | `build:used-parts-dolibarr-match` | `DB_FieldBeat_Used_Parts.csv`, `DIM_Dolibarr_Product_Identity_Map.csv`, `data/config/part_identity_aliases.csv` (opcional) | `data/marts/Used_Parts_Dolibarr_Match.csv` + reportes de no-match/ambiguos | `src/resolvers/part-identity-resolver.js`, `src/marts/build-used-parts-dolibarr-match.js` | Ninguna automática - revisar `data/reports/dolibarr_parts_match_summary.json` |
| **4. Marts ticket-céntricos** | `build:ticket-fieldbeat-view`, `build:ticket-fieldbeat-dolibarr-view` | PROCESSED + Used_Parts_Dolibarr_Match | `data/marts/Ticket_FieldBeat_*.csv` | `src/marts/build-ticket-fieldbeat-view.js`, `build-ticket-fieldbeat-dolibarr-view.js` | `qa:scope-reconciliation` (antes de GOLD) |
| **5. GOLD ticket-céntrico** | `build:gold` | Marts ticket-céntricos + reportes JSON | `data/gold/GOLD_{Operational_Dashboard,Data_Quality_Report,Client_Service_Profile,Equipment_Service_Profile,Used_Parts_Analysis,Scope_Metadata}.csv` | `src/gold/build-gold.js` | Ninguna automática dedicada |
| **6. Mart + GOLD report-céntrico** | `build:fieldbeat-report-dolibarr-view`, `build:gold:fieldbeat` | PROCESSED FieldBeat/Zendesk + Used_Parts_Dolibarr_Match | `FieldBeat_Report_Dolibarr_Operational_View.csv` + 5 `GOLD_FieldBeat_*`/`GOLD_Client_*`/`GOLD_Equipment_Parts_Consumption.csv` | `src/marts/build-fieldbeat-report-dolibarr-view.js`, `src/gold/build-fieldbeat-gold.js` | Ninguna automática dedicada |
| **7. Mart + GOLD Trabajo Fuera de Horario** | `build:fieldbeat-working-hours`, `build:gold:after-hours` | `DB_FieldBeat_Tasks.csv`, `DB_FieldBeat_Report_Fields.csv`, mart report-céntrico, `data/config/business-hours.json`/`holidays.*.json` | `FieldBeat_Working_Hours_Analysis.csv` + 5 `GOLD_After_Hours_*.csv` | `src/marts/build-fieldbeat-working-hours-analysis.js`, `src/gold/build-after-hours-gold.js` | Self-check interno (rango de `after_hours_rate` y `confidence_score`) en `data/reports/fieldbeat_working_hours_analysis_summary.json` |
| **7b. Mart + GOLD Vida Útil de Repuestos por Máquina** | `build:equipment-part-lifecycle-events`, `build:equipment-part-lifecycle-intervals`, `build:gold:equipment-lifecycle` | `DB_FieldBeat_Tasks.csv`, `DB_FieldBeat_Task_Equipments.csv`, `DB_FieldBeat_Used_Parts.csv`, `Used_Parts_Dolibarr_Match.csv`, mart report-céntrico, mart Trabajo Fuera de Horario (opcional), `data/config/manufacturer_life_specs.csv` (legacy, opcional), `business-rules/entities/part_manufacturer_life.csv` (preferido, opcional), `business-rules/policies/lifecycle-model-policy.json` | `Equipment_Part_Lifecycle_Events.csv`, `Equipment_Part_Lifecycle_Intervals.csv` + 5 `GOLD_Equipment_Part_Lifecycle_*.csv` | `src/marts/build-equipment-part-lifecycle-events.js`, `src/marts/build-equipment-part-lifecycle-intervals.js`, `src/gold/build-equipment-part-lifecycle-gold.js`, `src/models/lifecycle/*` (motor de modelos AUTO), `business-rules/loaders/load-business-rules.js` | Ninguna automática dedicada - ver resúmenes JSON en `data/reports/equipment_part_lifecycle_*` |
| **7c. Business Rules Layer** | `business-rules:validate` | `business-rules/entities/*.example.csv`, `business-rules/schemas/*.schema.json` | `data/reports/business_rules_validation_summary.json` | `business-rules/loaders/validate-business-rules.js` | No falla si falta un archivo real (opcional por diseño) - sí falla si falta un `.example.csv` o un archivo real tiene columnas equivocadas |
| **8. Warehouse (DuckDB)** | `db:build` (= `db:init`+`db:load`+`db:validate`) | Todo `data/processed/`, `data/marts/`, `data/gold/` | `data/warehouse/eyg_nexus.duckdb` (40 tablas) | `src/db/{init,load,validate}-duckdb.js`, `src/db/warehouse-config.js` | `db:validate` compara conteo CSV vs SQL, falla explícito si no calza |
| **9. Auditoría final** | `qa:phase1` | Docs requeridos, `sql/`, estado del warehouse | `data/reports/phase1_final_audit_summary.json` | `src/qa/final-phase1-audit.js` | Es la validación en sí (`phase1_status`) |
| **10. Consumo** | (ninguno - lectura) | `data/warehouse/eyg_nexus.duckdb` | Dashboards, tablas, gráficos | `apps/nexus-bi-app/**`, `sql/*.sql` | La app fuerza `READ_ONLY`; nunca escribe el warehouse |

---

## Qué capas son inmutables vs. reconstruibles

- **Inmutable:** `data/raw/`. Nunca se edita a mano, nunca se regenera a partir de otra capa - solo se vuelve a minar desde la API si hace falta.
- **Reconstruibles (en cascada):** `data/processed/` (desde RAW), `data/marts/` (desde PROCESSED + config), `data/gold/` (desde MARTS), `data/warehouse/*.duckdb` (desde PROCESSED+MARTS+GOLD). Ninguna de estas 4 capas debería editarse a mano - cualquier edición manual se pierde en el próximo build.
- **Configuración hecha a mano (no reconstruible, es un input):** `data/config/*`, `business-rules/entities/*` y `business-rules/policies/*` (ver [BUSINESS_RULES_LAYER.md](BUSINESS_RULES_LAYER.md)), y (cuando exista contenido real, no solo `.example`) `data/curation/*`.

## Dónde se aplican (o deberían aplicarse) reglas de curación

Hoy **no se aplican en ningún punto real** - `data/curation/` solo tiene plantillas `.example.csv`, validadas por `src/curation/validate-curation-files.js` (`curation:validate`), pero ningún normalizer/resolver/mart las lee todavía. El único mecanismo de corrección manual que sí está conectado al pipeline es `data/config/part_identity_aliases.csv` (leído directamente por `build:used-parts-dolibarr-match`). Ver `docs/CURATION_MODEL.md` para el diseño completo, y la nota de duplicado conceptual entre ambos `part_identity_aliases*` en [PROJECT_CLEANUP_CANDIDATES.md](PROJECT_CLEANUP_CANDIDATES.md).

## Cómo se actualiza DuckDB

Solo vía `npm run db:build` (que es `db:init && db:load && db:validate`). `db:load` hace `CREATE OR REPLACE TABLE` para cada entrada de `src/db/warehouse-config.js::TABLES` - reconstrucción completa desde los CSV actuales, no incremental. Registrar una tabla nueva = agregar una línea a ese array; no hace falta tocar `init`/`load`/`validate` (iteran genéricamente).

## Qué no debe editarse manualmente

`data/raw/`, `data/processed/`, `data/marts/`, `data/gold/`, y el archivo `.duckdb` - los 5 son generados/reconstruibles y cualquier edición manual se pierde (o peor, queda inconsistente) en el próximo build. La única forma correcta de cambiar lo que producen es cambiar su entrada (RAW nuevo, o los archivos de `data/config/`) y volver a correr el script correspondiente.
