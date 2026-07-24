# Changed files inventory

The working tree contains a large AUTH-P0/DEPLOY-REBASELINE delta plus the local pipeline fix. All entries below are intentional unless marked unknown.

```text
PATH: apps/nexus-bi-app/proxy.ts; app/login/**; lib/auth/**; lib/supabase/**; protected app/api/**; shell/layout files
STAGE: AUTH-P0
PURPOSE: SSR auth, session refresh, login/logout, roles, 401/403, protected pages and visible identity
STATUS: complete locally; production configuration pending
TESTS: app unit/integration, typecheck, build, smoke
RISKS: real Supabase cookies/claims/redirects not tested
NEXT_ACTION: authorized preview only

PATH: src/db/ownership-manifest.js; src/db/warehouse-validation.js; src/db/validate-supabase.js; src/db/record-supabase-validation.js
STAGE: DEPLOY-PIPELINE-FIX
PURPOSE: central ownership, read-only validator, explicit correlated recorder
STATUS: complete locally
TESTS: focused unit tests, PostgreSQL 16 chain
RISKS: remote catalog drift unknown
NEXT_ACTION: no remote action; review only

PATH: src/db/migrate-to-supabase.js; src/db/generate-postgres-ddl.js; src/lib/db-safety.js; scripts/bootstrap-disposable-postgres.mjs; apps/nexus-bi-app/scripts/setup-local-dev-db.mjs; integration runners
STAGE: DEPLOY-PIPELINE-FIX
PURPOSE: fail-closed preflight, named-column staging swap, host guards, stable disposable setup, no-skip runners
STATUS: complete locally
TESTS: two pipeline builds, isolated integrations, negative guards
RISKS: no remote execution authorized
NEXT_ACTION: preserve; final review

PATH: docs/RUNBOOK_SUPABASE_NETLIFY.md; docs/DEPLOYMENT_*.md; docs/DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md
STAGE: DOCUMENTATION
PURPOSE: rebaseline, variables, SQL inventory, release gates, evidence
STATUS: complete enough for handoff; final review scope must include current implementation
TESTS: diff check and local evidence
RISKS: remote values intentionally absent
NEXT_ACTION: review/commit preparation

PATH: package.json; package-lock.json; apps/nexus-bi-app/package.json; apps/nexus-bi-app/package-lock.json; netlify.toml; sql/040_audit.sql
STAGE: CONFIGURATION
PURPOSE: Supabase deps, Node >=22, scripts, Netlify/OpenNext and audit comments
STATUS: intentional
TESTS: typecheck/build
RISKS: lockfile changes include AUTH-P0 dependencies
NEXT_ACTION: do not install against remote

PATH: .claude/settings.local.json
STAGE: UNKNOWN
PURPOSE: pre-existing local file
STATUS: not reviewed; do not include
TESTS: none
RISKS: may contain local settings
NEXT_ACTION: leave untouched
```
