# Pipeline de datos - orden de ejecución

Todos los comandos se corren desde la raíz del proyecto (`eyg-nexus-local/`). El orden importa: cada etapa depende de que la anterior haya generado sus archivos de salida.

> **Nota:** este documento detalla el flujo original ticket-céntrico (pasos 1-6). Dos líneas adicionales, complementarias, se agregaron después y se documentan aparte: la línea report-céntrica/FieldBeat-first (`npm run build:fieldbeat-report-dolibarr-view` + `npm run build:gold:fieldbeat`, ver [DATA_DICTIONARY.md](DATA_DICTIONARY.md)) y la de Trabajo Fuera de Horario (`npm run build:fieldbeat-working-hours` + `npm run build:gold:after-hours`, ver [AFTER_HOURS_METRICS.md](AFTER_HOURS_METRICS.md)). Ambas corren después del paso 6 y antes de `npm run db:build` - ver la secuencia completa y actualizada en [LOCAL_OPERATIONS_RUNBOOK.md](LOCAL_OPERATIONS_RUNBOOK.md).

## 1. Miners - RAW

```bash
npm run get:fieldbeat:all
npm run get:zendesk
npm run get:dolibarr
```

| Comando | Qué hace | Genera |
|---|---|---|
| `get:fieldbeat:all` | Pagina `/fleets/eyg/tasks` por cursor `next_page` hasta agotar páginas | `data/raw/fieldbeat/list_pages/page_N_*.json`, `all_tasks_latest.json`, `task_index.json` |
| `get:zendesk` | Pagina `/api/v2/search.json?query=type:ticket...` | `data/raw/zendesk/search_page_N_*.json` |
| `get:dolibarr` | Pagina `/api/index.php/products?limit=100&page=N` | `data/raw/dolibarr/products_page_N_*.json` |

`npm run get:all` corre los 3 miners en secuencia (Dolibarr → Zendesk → FieldBeat) vía `src/run-all.js`. `get:fieldbeat` (singular, sin `:all`) es un miner puntual por `FIELDBEAT_TASK_IDS` en `.env`, no forma parte del flujo GOLD.

Backfill puntual (fuera del flujo estándar, ver [PHASE_2_BACKLOG.md](PHASE_2_BACKLOG.md)):
```bash
npm run get:zendesk:backfill-fieldbeat
```
Busca en Zendesk, uno por uno, los `zendesk_ticket_id` que FieldBeat menciona pero que no aparecieron en el `get:zendesk` masivo. Guarda RAW en `data/raw/zendesk/backfill_by_fieldbeat_ticket_ids/`.

## 2. Normalizers - RAW → PROCESSED

```bash
npm run normalize:fieldbeat
npm run normalize:zendesk
npm run normalize:dolibarr
```

| Comando | Lee | Genera en `data/processed/<plataforma>/` |
|---|---|---|
| `normalize:fieldbeat` | Todo `data/raw/fieldbeat/*.json` | `DB_FieldBeat_Tasks.csv`, `DB_FieldBeat_Task_Equipments.csv`, `DB_FieldBeat_Report_Fields.csv`, `DB_FieldBeat_Used_Parts.csv` (con explosión de listas numeradas - ver más abajo), `DIM_Clients.csv`, `DIM_Equipments.csv`, `BR_Ticket_FieldBeat_Task.csv` |
| `normalize:zendesk` | Todo `data/raw/zendesk/**/*.json` (recursivo, incluye backfill) | `DB_Zendesk_Tickets.csv`, `DB_Zendesk_Ticket_Tags.csv`, `DB_Zendesk_Custom_Fields.csv` |
| `normalize:dolibarr` | Todo `data/raw/dolibarr/*.json` | `DB_Dolibarr_Products.csv`, `DIM_Dolibarr_Product_Identity_Map.csv` (una fila por REF/BARCODE/ID de cada producto) |

**Nota sobre `DB_FieldBeat_Used_Parts.csv`:** el normalizador detecta cuando `part_number` es una lista numerada (`"1.- x\n2.- y"`) y la explota en filas atómicas, alineando `part_name`/`quantity` por posición cuando también son listas del mismo largo. Guarda `raw_original_part_number`/`raw_original_part_name` para trazabilidad y marca `needs_manual_review` cuando la alineación es ambigua.

## 3. Resolución de identidad de repuestos (FieldBeat ↔ Dolibarr)

```bash
npm run build:used-parts-dolibarr-match
```

Corre `src/resolvers/part-identity-resolver.js` sobre cada fila de `DB_FieldBeat_Used_Parts.csv`, con esta cascada de prioridad:

1. **Alias manual** (`data/config/part_identity_aliases.csv`, si existe - ver `.example.csv`)
2. **Placeholder** (`"sin numero"`, `"NC"`, valores vacíos tras normalizar, etc.) → rechazado sin intentar match
3. `REF_EXACT` → `BARCODE_EXACT` → `ID_EXACT` → `REF_NORMALIZED_EXACT` → `BARCODE_NORMALIZED_EXACT` → `REF_LIKE` (menor confianza) → `NO_MATCH`
4. Si más de un producto candidato calza → `AMBIGUOUS_MATCH`

Genera:
- `data/marts/Used_Parts_Dolibarr_Match.csv` (una fila por repuesto, global - todas las tasks FieldBeat, no solo las de tickets accesibles)
- `data/reports/used_parts_without_dolibarr_match.csv`, `used_parts_ambiguous_dolibarr_match.csv`
- `data/reports/used_parts_manual_review_queue.csv` (agrupado por `normalized_part_identifier`, para revisión humana)
- `data/reports/dolibarr_parts_match_summary.json`

## 4. Marts - cruces entre plataformas

```bash
npm run build:ticket-fieldbeat-view
npm run build:ticket-fieldbeat-dolibarr-view
```

| Comando | Lee | Genera |
|---|---|---|
| `build:ticket-fieldbeat-view` | `DB_Zendesk_Tickets.csv`, `BR_Ticket_FieldBeat_Task.csv`, `DB_FieldBeat_Tasks.csv`, `DB_FieldBeat_Used_Parts.csv`, `DB_FieldBeat_Task_Equipments.csv` | `data/marts/Ticket_FieldBeat_Operational_View.csv` (1 fila por ticket), `Ticket_FieldBeat_Report_Detail.csv` (1 fila por relación ticket↔task), `data/reports/fieldbeat_links_without_zendesk_ticket.csv` |
| `build:ticket-fieldbeat-dolibarr-view` | `Ticket_FieldBeat_Operational_View.csv`, `Used_Parts_Dolibarr_Match.csv` | `data/marts/Ticket_FieldBeat_Dolibarr_Operational_View.csv` (agrega métricas de repuestos por ticket + `part_match_quality_status` + `data_quality_status`), `data/reports/ticket_fieldbeat_dolibarr_summary.json` |

## 5. QA de alcance (antes de GOLD)

```bash
npm run qa:scope-reconciliation
```

Lee `Ticket_FieldBeat_Dolibarr_Operational_View.csv`, `Used_Parts_Dolibarr_Match.csv`, `DB_FieldBeat_Tasks.csv`, `BR_Ticket_FieldBeat_Task.csv`, `DB_Zendesk_Tickets.csv`, y responde: *¿cuánto de FieldBeat quedó realmente representado en el mart ticket-céntrico, y cuánto quedó fuera y por qué?* Genera `data/reports/scope_reconciliation_summary.json` y 3 CSV de detalle. Ver [SCOPE_AND_LIMITATIONS.md](SCOPE_AND_LIMITATIONS.md).

## 6. GOLD

```bash
npm run build:gold
```

Lee los marts finales + los 3 JSON de reportes (`scope_reconciliation_summary.json`, `zendesk_backfill_by_fieldbeat_summary.json`, `dolibarr_parts_match_summary.json`) y genera las 6 tablas de `data/gold/`. Ver [GOLD_DATA_CONTRACT.md](GOLD_DATA_CONTRACT.md).

## Otros comandos (QA independiente, no bloquean el flujo)

```bash
npm run qa:fieldbeat              # duplicados/coverage de DB_FieldBeat_*
npm run qa:zendesk                # duplicados/coverage de DB_Zendesk_*
npm run qa:dolibarr                # duplicados/coverage de DB_Dolibarr_*
npm run qa:ticket-fieldbeat        # tickets con más de 1 reporte FieldBeat
```

## Diagrama de flujo resumido

```
Zendesk API ──► RAW/zendesk ──► normalize:zendesk ──► DB_Zendesk_Tickets.csv ─┐
                                                                                │
FieldBeat API ─► RAW/fieldbeat ► normalize:fieldbeat ► DB_FieldBeat_*.csv ────┼─► build:ticket-fieldbeat-view
                                                        BR_Ticket_FieldBeat_Task.csv                │
                                                                                                       ▼
Dolibarr API ──► RAW/dolibarr ─► normalize:dolibarr ─► DIM_Dolibarr_Product_Identity_Map.csv    Ticket_FieldBeat_Operational_View.csv
                                                              │                                        │
                                                              ▼                                        │
                                          build:used-parts-dolibarr-match                              │
                                                              │                                        │
                                          Used_Parts_Dolibarr_Match.csv ────────────────────────────────┤
                                                                                                          ▼
                                                                              build:ticket-fieldbeat-dolibarr-view
                                                                                                          │
                                                                                                          ▼
                                                                              Ticket_FieldBeat_Dolibarr_Operational_View.csv
                                                                                                          │
                                                          qa:scope-reconciliation                        │
                                                                                                          ▼
                                                                                                    build:gold
                                                                                                          │
                                                                                                          ▼
                                                                                                    data/gold/*.csv
```
