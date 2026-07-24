# NEXUS — relevo Codex → Claude CLI

```text
PROJECT: NEXUS
HANDOFF_FROM: Codex
HANDOFF_TO: Claude CLI
CURRENT_BRANCH: Control-Acceso
CURRENT_SHA: 6a699960ed038ae395c73057f98b515c5a667321
WORKING_TREE: dirty-documented
LAST_COMPLETED_STAGE: DEPLOY-PIPELINE-FIX local certification
NEXT_STAGE: DEPLOY-PIPELINE-FIX closure/review, then remote authorization gates
REMOTE_OPERATIONS_AUTHORIZED: NO
```

AUTH-P0 is implemented locally: Supabase SSR clients, `/login`, Server Actions, `proxy.ts`, server-only role resolution, central auth/role guards, protected pages/APIs, 401/403 contracts, open-redirect protection, visible identity/logout and feature flags. The runbook was rebaselined and the local DEPLOY-PIPELINE-FIX chain was completed against PostgreSQL 16 disposable databases.

Read [the RED/GREEN report](../../DEPLOY_PIPELINE_FIX_RED_GREEN_REPORT.md) and [the command catalog](../../DEPLOYMENT_COMMAND_CATALOG.md) after this index. The current implementation includes ownership-aware validation, read-only validation, an explicit recorder, atomic staging swaps, fail-fast unknown objects, provenance binding, protected-host guards and integration-runner preflights.

Remaining work is documentation/review/commit preparation and, only after explicit authorization, inspection of a real Supabase project and Netlify preview. No remote compatibility has been proven.

Do not execute Supabase, Netlify, remote DDL/migrations, imports, production `TRUNCATE`, Auth account creation, claims changes, deploys, merges to `main`, or credential operations. Do not run Graphify in this handoff. Do not discard the existing dirty worktree. The local `.env.development.local.previous` backup was preserved because the handoff requires `FILES_DISCARDED=NO`; do not read or print it.

Expected continuation result: preserve the evidence, perform the final code review over the DEPLOY-PIPELINE-FIX implementation plus docs, and leave remote execution explicitly pending authorization.
