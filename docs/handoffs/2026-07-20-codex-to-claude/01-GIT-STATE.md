# Git state

Captured from the repository with `git -c safe.directory=...`:

```text
branch: Control-Acceso
HEAD: 6a699960ed038ae395c73057f98b515c5a667321
last commit: 6a69996 Implementando Graphify
main...Frontend-Rev: 0 42
working tree: dirty; no commit, merge, rebase, reset, checkout or stash created
```

`git diff --check` passed; the only output was the Windows LF→CRLF warning. The working tree contains pre-existing AUTH-P0/DEPLOY-REBASELINE work plus DEPLOY-PIPELINE-FIX implementation/tests/docs. No file was intentionally discarded. `.claude/settings.local.json` is pre-existing untracked and is not part of this handoff.

Classification of relevant changes:

| Scope | Paths | State |
|---|---|---|
| AUTH-P0 | `apps/nexus-bi-app/proxy.ts`, `app/login/**`, `lib/auth/**`, `lib/supabase/**`, protected `app/api/**`, layouts/shell/sidebar files, `app/*/layout.tsx` | implemented; typecheck/build passed; final production configuration pending |
| DEPLOY-REBASELINE | `netlify.toml`, `docs/RUNBOOK_SUPABASE_NETLIFY.md`, `docs/DEPLOYMENT_*.md` | implemented/documented; review must cover current dirty tree |
| DEPLOY-PIPELINE-FIX | `src/db/ownership-manifest.js`, `src/db/warehouse-validation.js`, `src/db/validate-supabase.js`, `src/db/record-supabase-validation.js`, `src/db/migrate-to-supabase.js`, `src/lib/db-safety.js`, `src/db/generate-postgres-ddl.js`, setup/bootstrap/runners and tests | implemented; local disposable certification passed; final review/evidence handoff remains |
| CONFIGURATION | root/app `package.json` and lockfiles, `apps/nexus-bi-app/.env.example`, `sql/040_audit.sql` | intentional; no secret values added |
| TEST | `test/db/**`, `test/lib/db-safety.test.js`, `test/scripts/**`, integration fixture files, app integration-runner/auth tests | intentional; positive/negative/expiry/open-redirect and disposable guards covered |
| DOCUMENTATION | `docs/DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md`, `docs/DEPLOYMENT_COMMAND_CATALOG.md`, `docs/DEPLOYMENT_SQL_INVENTORY.md`, `docs/DEPLOYMENT_RELEASE_CHECKLIST.md`, `docs/DEPLOYMENT_DELTA_REPORT.md`, this handoff | intentional |
| GENERATED LOCAL EVIDENCE | `data/reports/supabase_sync_run_id.json`, `supabase_validation_summary.json`, DuckDB summary | local disposable output only; never treat as remote evidence |
| UNKNOWN | `.claude/settings.local.json` | pre-existing; do not include without owner review |

No `.env` contents were read or copied into this handoff. The ignored `.env.development.local` is disposable local configuration; its `.previous` backup was preserved, not deleted.
