# cloud/d1/

Artefactos de la capa Cloudflare D1 (Fase 2 Cloud, read-only) - ver [docs/CLOUDFLARE_D1_MIGRATION.md](../../docs/CLOUDFLARE_D1_MIGRATION.md) para la guía completa paso a paso.

- **`schema.sql`** - `CREATE TABLE IF NOT EXISTS` para las 17 tablas SQLite planas (`gold_*`, `marts_*`, `curation_*`, `rules_*`). Se aplica una sola vez (o cada vez que cambie) contra la base D1 real con `wrangler d1 execute`.
- **`seeds/`** - un archivo `NNN_<tabla>.sql` por tabla, con sentencias `INSERT` en lotes. **Generado por `npm run cloud:d1:export`** (`src/cloud/export-d1-seed.js`) - nunca se edita a mano, se regenera. No se commitea a git por defecto (contiene un dump completo, aunque sanitizado, de los datos operativos) - ver `.gitignore`.

## Por qué prefijos y no `schema.tabla`

D1 es SQLite - un único namespace plano de tablas, sin el concepto de schema de DuckDB/Postgres (`gold.operational_dashboard`, `marts.used_parts_dolibarr_match`, etc.). Cada tabla usa el prefijo que tenía su schema de origen en el warehouse local (`gold_`, `marts_`, `curation_`, `rules_`) para no perder esa procedencia.

## Regenerar el seed

```bash
npm run db:build              # (re)construye data/warehouse/eyg_nexus.duckdb
npm run cloud:d1:export       # lee DuckDB, sanitiza, escribe cloud/d1/seeds/*.sql
npm run cloud:d1:validate     # valida antes de subir a D1 real
```
