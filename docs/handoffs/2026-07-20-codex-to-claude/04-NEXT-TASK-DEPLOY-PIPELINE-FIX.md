# DEPLOY-PIPELINE-FIX continuation contract

The implementation is present and locally certified; Claude must not restart it blindly. First inspect the real tree and compare it with `docs/DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md`.

Current design:

```text
db:pg:validate
  → DuckDB READ_ONLY + PostgreSQL attach READ_ONLY
  → ownership-aware local JSON report with sanitized target/run provenance
  → no PostgreSQL DML

db:pg:record-validation
  → separate explicit UPDATE
  → exact confirmation guard
  → protected target requires both confirmation tokens
  → rejects stale/missing target or run_id provenance
```

Ownership: `DUCKDB_SYNC` compares structure/types/counts; `EXTERNAL` is not synchronized; `POSTGRES_BUILDER` and `POSTGRES_TRANSACTIONAL` require native presence/contracts; views are not tables; unknown objects fail before writes. Migration loads staging, uses named columns, then performs `BEGIN/TRUNCATE/INSERT/DROP/COMMIT` without `CASCADE` per table.

Constraints: only local PostgreSQL 16 `DISPOSABLE_TEST`; no Supabase, Netlify, production, `main`, Graphify, imports, Auth, or secrets. Do not weaken `db-safety.js`, do not use `service_role`, do not print URLs with passwords, and do not commit.

If a final review finds a concrete defect, use TDD and only local disposable fixtures. The maximum permitted result remains:

```text
LOCAL_DEPLOYMENT_PIPELINE_CERTIFIED
REMOTE_EXECUTION_PENDING_AUTHORIZATION
```
