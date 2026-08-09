# Deployment rebaseline

Authoritative documents:

- `docs/RUNBOOK_SUPABASE_NETLIFY.md`
- `docs/DEPLOYMENT_DELTA_REPORT.md`
- `docs/DEPLOYMENT_VARIABLE_MATRIX.md`
- `docs/DEPLOYMENT_COMMAND_CATALOG.md`
- `docs/DEPLOYMENT_RELEASE_CHECKLIST.md`
- `docs/DEPLOYMENT_SQL_INVENTORY.md`

Baseline is preview `Frontend-Rev` and production `main`; `supabase-migration` is not a baseline. Audited branch is `Control-Acceso`, HEAD `6a699960...`, with AUTH-P0 changes not yet committed. Netlify is OpenNext-oriented: base `apps/nexus-bi-app`, package directory empty, build `npm run build`, publish `.next` relative to base, no explicit legacy `@netlify/plugin-nextjs`.

The SQL inventory is 15 files in numeric order `000`, `005`, `010`, `020`, `030`, `040`, `050`, `060`, `070`, `080`, `081`, `082`, `083`, `084`, `085`. Ownership categories are `DUCKDB_SYNC`, `EXTERNAL`, `POSTGRES_BUILDER`, `POSTGRES_TRANSACTIONAL`, `VIEW_NOT_APPLICABLE`; unknown objects fail closed. Runtime uses transaction pooler; direct IPv6/session pooler is for admin fallback only. `service_role` is prohibited in Netlify.

Gates and rollback are in the release checklist. First release flags remain:

```text
NEXUS_SHOW_AUDIT=false
NEXUS_SHOW_EXPLORER=false
```

Remote operations are still blocked: no Supabase catalog/data inspection, DDL, migration, recorder, Auth accounts/claims, Netlify connection/deploy, preview promotion or production. Rollback requires an approved snapshot/restore or reviewed SQL plan; frontend rollback does not roll back database state.

```text
DEPLOYMENT_RUNBOOK_REBASELINED
REMOTE_EXECUTION_PENDING_AUTHORIZATION
```
