# Cloudflare D1 Migration - Fase 2 Cloud (read-only)

Segundo escalón de despliegue cloud, después de la demo estática de [docs/CLOUD_SMOKE_TEST.md](CLOUD_SMOKE_TEST.md). En vez de JSON pre-generado congelado, esta fase sirve datos vía **Cloudflare D1** (SQLite serverless) consultado en vivo desde **Cloudflare Pages Functions** - permite paginar/filtrar sin tener que regenerar un snapshot completo cada vez, pero sigue siendo **read-only** y sigue sin tocar `data/warehouse/eyg_nexus.duckdb` en producción.

Tercer modo de datos: `NEXT_PUBLIC_DATA_MODE=d1` (ver `apps/nexus-bi-app/lib/data-mode.ts`).

## Qué tablas se migran

17 tablas SQLite planas en `cloud/d1/schema.sql` (D1 no soporta schemas tipo `gold.tabla` - se usa el prefijo `gold_`/`marts_`/`curation_`/`rules_` en el nombre):

| Tabla D1 | Fuente | Filas (snapshot actual) |
|---|---|---|
| `gold_operational_dashboard` | `gold.operational_dashboard` | 1 |
| `gold_fieldbeat_report_analysis` | `gold.fieldbeat_report_analysis` | 1 |
| `gold_fieldbeat_data_quality` | `gold.fieldbeat_data_quality` | 6 |
| `gold_client_report_volume_by_period` | `gold.client_report_volume_by_period` | 913 |
| `gold_client_parts_consumption` | `gold.client_parts_consumption` | 913 |
| `gold_equipment_parts_consumption` | `gold.equipment_parts_consumption` | 57 |
| `gold_after_hours_work_analysis` | `gold.after_hours_work_analysis` | 1 |
| `gold_after_hours_by_client` | `gold.after_hours_by_client` | 26 |
| `gold_after_hours_by_period` | `gold.after_hours_by_period` | 96 |
| `gold_scope_metadata` | `gold.scope_metadata` | 1 |
| `marts_used_parts_dolibarr_match` | `marts.used_parts_dolibarr_match` | 2193 |
| `marts_fieldbeat_report_dolibarr_operational_view` | `marts.fieldbeat_report_dolibarr_operational_view` | 3747 |
| `marts_fieldbeat_working_hours_analysis` | `marts.fieldbeat_working_hours_analysis` | 3747 |
| `curation_placeholder_rules` | `data/curation/placeholder_rules.csv` | 0 (solo existe `.example.csv`) |
| `curation_part_identity_aliases` | `data/curation/part_identity_aliases.csv` | 0 (solo existe `.example.csv`) |
| `rules_client_contracts` | `business-rules/entities/client_contracts.csv` | 0 (solo existe `.example.csv`) |
| `rules_part_manufacturer_life` | `business-rules/entities/part_manufacturer_life.csv` | 0 (solo existe `.example.csv`) |

Las 4 últimas se crean siempre (tabla vacía) para que los endpoints nunca fallen con "no such table" - se llenan solas la próxima vez que se corra `npm run cloud:d1:export` después de que el negocio complete el archivo real (ver `business-rules/README.md`).

## Qué NO se migra

- **`data/raw/`, `.env`, `data/warehouse/eyg_nexus.duckdb`** - nunca salen de la máquina local (ver `.gitignore`).
- **`processed.*`** completo (tickets Zendesk crudos, tasks FieldBeat crudos, productos Dolibarr crudos) - son el detalle más granular y sensible del pipeline; D1 solo recibe los `marts`/`gold` ya agregados/filtrados que necesitan los dashboards y la auditoría.
- **Ninguna descripción de ticket ni texto largo sin sanitizar** - ninguna de las 17 tablas trae una columna de descripción cruda; el texto libre que sí migra (`scope_warning`, `calculation_notes`, `confidence_factors`, etc.) pasa por la misma redacción de email/teléfono/token + truncado que la Fase 1 estática (`src/cloud/sanitize-cloud-export.js`, reusado por `sanitize-d1-export.js`).
- **`client_rut` (RUT chileno) sin enmascarar** - decisión explícita de negocio para esta fase: se conserva la columna (permite distinguir clientes) pero **enmascarado** a solo los últimos 2 caracteres (ej. `76.746.730-3` → `**.***.**3-3`... en general `**.***.**X-Y`). Ver `maskClientRut()` en `src/cloud/sanitize-d1-export.js`.
  - **Importante:** `client_key` (en `marts_fieldbeat_report_dolibarr_operational_view` y `marts_fieldbeat_working_hours_analysis`) trae el RUT **embebido sin formato** dentro de un string compuesto `FIELD_BEAT_CLIENT|<rut>|<nombre>` - se detectó durante la validación de este mismo corte y se enmascara con `maskClientKey()` (mismo criterio, solo el segmento del medio). Si en el futuro aparece una columna nueva con un patrón similar, agregarla explícitamente a `sanitizeD1Value()` - el escaneo de `validate-d1-export.js` (`UNMASKED_RUT_REGEX`) es la red de seguridad que lo detectaría igual antes de subir a D1 real.
- **Curación real** (`data/curation/*.csv` sin sufijo `.example`) y **Business Rules reales** (`business-rules/entities/*.csv` sin sufijo `.example`) - hoy no existen, así que esas 4 tablas quedan vacías (ver tabla arriba). Cuando el negocio complete alguno, `npm run cloud:d1:export` lo toma solo.
- **Escritura/curación real** - las Pages Functions son 100% `GET`, nadie puede escribir en D1 desde la app todavía (coherente con "Centro de correcciones" pendiente, ver `app/page.tsx`).
- **`get:all` ni ninguna llamada a Zendesk/FieldBeat/Dolibarr** - el export lee exclusivamente el warehouse DuckDB ya construido localmente.

## Arquitectura

```
data/warehouse/eyg_nexus.duckdb  (local, nunca sale de la máquina)
        │  npm run cloud:d1:export
        ▼
cloud/d1/seeds/*.sql  (INSERT sanitizados, gitignored - se regeneran)
        │  wrangler d1 execute --remote
        ▼
Cloudflare D1 (eyg-nexus-bi)
        │  context.env.DB.prepare(...).bind(...).all()
        ▼
apps/nexus-bi-app/functions/api/d1/*.ts  (Cloudflare Pages Functions)
        │  fetch("/api/d1/...")
        ▼
apps/nexus-bi-app/lib/data-client.ts  (NEXT_PUBLIC_DATA_MODE=d1)
```

`functions/` es un árbol **separado** de `app/` - corre en el runtime de Cloudflare Workers (no en Next.js), se bundlea con `wrangler`/Cloudflare Pages al deployar, y tiene su propio `functions/tsconfig.json` (con `@cloudflare/workers-types`) explícitamente excluido del `tsconfig.json` principal de la app - así `next build`/`next dev` nunca intentan tipar-checkear `D1Database`/`PagesFunction`, que no existen en el runtime de Next.

## Paso a paso

### 1. Construir el warehouse local

```bash
npm run db:build
```

### 2. Exportar los seeds D1

```bash
npm run cloud:d1:export
```

Corre `src/cloud/export-d1-seed.js`: abre `data/warehouse/eyg_nexus.duckdb` en `READ_ONLY`, para cada tabla de la lista de arriba lee las columnas reales (`DESCRIBE schema.tabla`), sanitiza cada valor (`src/cloud/sanitize-d1-export.js` - redacción de email/teléfono/token, truncado, `maskClientRut`/`maskClientKey`, bool→0/1, fecha→TEXT ISO, BigInt→TEXT si excede `Number.MAX_SAFE_INTEGER`) y escribe `cloud/d1/seeds/NNN_<tabla>.sql` con `INSERT` en lotes de 200 filas. Escribe también `data/reports/cloud_d1_export_summary.json` (filas por tabla).

### 3. Validar el export

```bash
npm run cloud:d1:validate
```

Corre `src/cloud/validate-d1-export.js`: cruza `cloud/d1/schema.sql` contra los seeds generados, escanea cada archivo en busca de email/teléfono/token sin redactar y de RUT sin enmascarar (`\d{7,8}-[0-9K]` crudo), y chequea tamaños de archivo. Escribe `data/reports/cloud_d1_export_validation.json` con estado `READY` / `READY_WITH_WARNINGS` / `NOT_READY`. **No subas a D1 real si el estado es `NOT_READY`.**

### 4. Crear la base D1 (una sola vez, manual)

```bash
wrangler d1 create eyg-nexus-bi
```

Wrangler devuelve un `database_id` - copialo a `apps/nexus-bi-app/wrangler.toml` (reemplaza el placeholder `REPLACE_WITH_REAL_D1_DATABASE_ID`).

### 5. Aplicar el schema

```bash
wrangler d1 execute eyg-nexus-bi --remote --file=cloud/d1/schema.sql
```

### 6. Importar los seeds

`--file` de wrangler **no soporta wildcards** - hay que subir cada archivo de `cloud/d1/seeds/` explícitamente (o armar un loop):

```bash
for f in cloud/d1/seeds/*.sql; do
  wrangler d1 execute eyg-nexus-bi --remote --file="$f"
done
```

En PowerShell:

```powershell
Get-ChildItem cloud/d1/seeds/*.sql | ForEach-Object {
  wrangler d1 execute eyg-nexus-bi --remote --file=$_.FullName
}
```

### 7. Configurar el binding en Cloudflare Pages

En el dashboard del proyecto Pages → **Settings → Functions → D1 database bindings**:

- **Variable name:** `DB`
- **D1 database:** `eyg-nexus-bi`

(mismo binding que ya está declarado en `apps/nexus-bi-app/wrangler.toml` para desarrollo/preview con `wrangler pages dev`).

### 8. Build estático + deploy

```bash
npm run app:build:d1
```

Igual que `app:build:static` (ver `docs/CLOUD_SMOKE_TEST.md`) pero con `NEXT_PUBLIC_DATA_MODE=d1` - saca `app/api/` del árbol temporalmente (incompatible con `output: "export"`), corre `next build`, lo restaura. El resultado en `apps/nexus-bi-app/out/` + `apps/nexus-bi-app/functions/` es lo que se sube a Cloudflare Pages (build output directory: `out`, igual que la Fase 1).

### 9. Validar en vivo

Una vez deployado, `GET /api/d1/table-counts` en el sitio de Cloudflare Pages debe devolver las 17 tablas con las mismas filas que `data/reports/cloud_d1_export_summary.json`.

### 10. Volver a local-duckdb

No hace falta ningún revert: `npm run app:dev` / `npm run app:build` normales nunca setean `NEXT_PUBLIC_DATA_MODE`, así que caen al default `local-duckdb` y la app vuelve a pegarle a DuckDB local. `wrangler.toml` y `functions/` no afectan en nada al modo local (Next.js ni los toca).

## Endpoints creados (Pages Functions)

Todos en `apps/nexus-bi-app/functions/api/d1/`, todos `GET`, todos usan `context.env.DB.prepare(...).all()` (y `parts-review.ts` además `.bind()` para el único parámetro que viene de un usuario):

| Endpoint | Tablas D1 que consulta |
|---|---|
| `/api/d1/operational-summary` | `gold_operational_dashboard`, `gold_fieldbeat_data_quality`, `marts_fieldbeat_report_dolibarr_operational_view` |
| `/api/d1/fieldbeat-summary?client=&q=&from=&to=` | `marts_fieldbeat_report_dolibarr_operational_view` (filtrable, ver abajo) |
| `/api/d1/audit/summary` | `gold_fieldbeat_data_quality`, `gold_scope_metadata` |
| `/api/d1/parts-review?q=&limit=&offset=` | `marts_used_parts_dolibarr_match` |
| `/api/d1/after-hours/summary` | `marts_fieldbeat_working_hours_analysis` (agregado en vivo, filtrable) |
| `/api/d1/after-hours/by-client` / `by-task-type` / `by-technician` / `by-period` | `marts_fieldbeat_working_hours_analysis` (agrupado, filtrable) |
| `/api/d1/after-hours/confidence-distribution` | `marts_fieldbeat_working_hours_analysis` (4 categorías fijas) |
| `/api/d1/after-hours/detail?page=&pageSize=&...` | `marts_fieldbeat_working_hours_analysis` (paginado, filtrable) |
| `/api/d1/table-counts` | las 17 (vía `DB.batch()`) |

Convención de rutas: los endpoints con varias "vistas" del mismo dominio viven en subcarpeta (`after-hours/*`, `audit/*`) - el resto son un solo archivo plano (`operational-summary.ts`, `fieldbeat-summary.ts`, `parts-review.ts`, `table-counts.ts`). Todos comparten `functions/api/d1/_shared.ts` (tipos `Env`/helpers de respuesta).

`apps/nexus-bi-app/lib/data-client.ts` expone un getter por cada uno de estos (`getOperationalSummary()`, `getFieldbeatSummary()`, etc.) que internamente elige `/api/dashboard/*` (local-duckdb) / `static-data-client.ts` (static) / `/api/d1/*` (d1) según `NEXT_PUBLIC_DATA_MODE`. Cableado hoy: `/dashboard/fieldbeat` (completo, con filtros) y la pestaña "Resumen de calidad" de `/audit/manual-review`. El resto de componentes (`OperationalDashboardTab`, `AfterHoursShell`, `PartsReviewSection`) siguen pegándole directo a `/api/dashboard/*` a propósito - tienen filtros (cliente, máquina, técnico, rango de fechas, paginación por página) que `data-client.ts`/los endpoints D1 todavía no replican 1:1; migrarlos sin esa paridad completa rompería el filtrado en modo local-duckdb. Extender el filtro completo a esos tres queda como siguiente paso.

### `/api/d1/fieldbeat-summary` - filtros

`client`, `q`, `from`, `to` viajan siempre parametrizados (`.bind()` en D1 / `$1,$2,...` en DuckDB) - nunca se interpola el valor de un usuario directo en el SQL. `client=ALL` / `client=Todos` (cualquier capitalización) o vacío se tratan como "sin filtro" - ver `isRealFilter()` en `functions/api/d1/fieldbeat-summary.ts` y `app/api/dashboard/fieldbeat/route.ts`. `confidenceLevel` no aplica a esta tabla (no tiene columna de confianza) - se omitió a propósito en vez de agregar un filtro que no haría nada.

## Validado contra un D1 local emulado

Antes de tocar la base D1 real, este corte se probó completo con `wrangler d1 execute --local` (SQLite emulado por miniflare, sin tocar la nube ni requerir login) + `wrangler pages dev`:

```bash
cd apps/nexus-bi-app
npx wrangler d1 execute eyg-nexus --local --file=../../cloud/d1/schema.sql
for f in ../../cloud/d1/seeds/*.sql; do npx wrangler d1 execute eyg-nexus --local --file="$f"; done
npm run build:d1
npx wrangler pages dev out --port=8788
# en otra terminal:
curl http://127.0.0.1:8788/api/d1/fieldbeat-summary
```

Esto encontró y corrigió dos bugs reales antes de que llegaran a producción:

1. **`SQLITE_TOOBIG`** al insertar `marts_fieldbeat_working_hours_analysis` con lotes de 200 filas - la tabla tiene ~28 columnas, varias de texto libre, y el `INSERT` superaba el límite de tamaño de sentencia de D1. `BATCH_SIZE` bajó de 200 a 50 en `src/cloud/export-d1-seed.js`.
2. **`SQL code did not contain a statement`** al cargar los 4 seeds de tablas vacías (solo tenían un comentario) - ahora escriben `SELECT 1;` como sentencia no-op válida.

## Troubleshooting

- **`cloud:d1:validate` da `NOT_READY` por RUT o PII sin enmascarar**: revisar `data/reports/cloud_d1_export_validation.json` → `blockers`, identificar el archivo/tabla, y si es una columna nueva agregar el caso a `sanitizeD1Value()` en `src/cloud/sanitize-d1-export.js` antes de re-exportar.
- **`wrangler d1 execute` tira `SQLITE_TOOBIG`**: bajar `BATCH_SIZE` en `src/cloud/export-d1-seed.js` (ya en 50, probado OK contra la tabla más ancha) y volver a exportar.
- **Un endpoint `/api/d1/*` devuelve error 500 con "no such table"**: falta aplicar `cloud/d1/schema.sql` contra esa base D1 (paso 5), o el binding no apunta a la base correcta.
- **`wrangler pages dev` no encuentra las tablas aunque ya corriste los seeds**: si arrancaste `pages dev` con un flag `--d1=DB=<nombre>` explícito, probá SIN ese flag - deja que tome el binding directo de `wrangler.toml` (`[[d1_databases]]`). Con `--d1` de más se detectó que crea un binding ad-hoc que apunta a un estado local distinto del que usa `wrangler d1 execute`, aunque ambos digan "local" y el mismo nombre de base.
- **`npm run app:build:d1` falla en el typecheck** con errores de `D1Database`/`PagesFunction`: confirmar que `apps/nexus-bi-app/tsconfig.json` sigue excluyendo `functions/` (`"exclude": ["node_modules", "functions"]`) - si se sacó por error, `next build` intenta tipar Pages Functions con el `lib: ["dom", ...]` de Next, que no las reconoce.
