# Nexus

Pipeline de datos operacional (FieldBeat, Zendesk, Dolibarr) + app BI (`apps/nexus-bi-app`, Next.js sobre Supabase/PostgreSQL) para EYG.

## Documentación

- [Arquitectura](docs/ARCHITECTURE.md) — capas RAW/PROCESSED/MARTS/GOLD, de DuckDB local a Postgres/Supabase.
- [Orden de ejecución del pipeline](docs/DATA_PIPELINE.md) — comandos, uno por uno, y el orquestador NEXUS V3.
- [Actualización manual de datos (NEXUS V3)](docs/data-refresh-runbook.md) — worker local vs GitHub Actions, cómo leer el estado de una corrida.
- [Runbook de liberación Supabase + Netlify](docs/RUNBOOK_SUPABASE_NETLIFY.md) — secuencia de despliegue y reglas inviolables.
- [Matriz de variables de despliegue](docs/DEPLOYMENT_VARIABLE_MATRIX.md) — qué variable vive en qué entorno.
- [Checklist de liberación](docs/DEPLOYMENT_RELEASE_CHECKLIST.md) — gates y evidencia requerida.
- [Decisiones de arquitectura (ADR)](docs/adr/) — el porqué de las decisiones que no son obvias leyendo el código.
