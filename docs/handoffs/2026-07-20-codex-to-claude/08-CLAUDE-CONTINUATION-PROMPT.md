# Claude CLI continuation prompt

Lee primero, en este orden:

1. `docs/handoffs/2026-07-20-codex-to-claude/00-START-HERE.md`
2. `docs/handoffs/2026-07-20-codex-to-claude/01-GIT-STATE.md`
3. `docs/handoffs/2026-07-20-codex-to-claude/02-AUTH-P0-STATE.md`
4. `docs/handoffs/2026-07-20-codex-to-claude/03-DEPLOYMENT-REBASELINE-STATE.md`
5. `docs/handoffs/2026-07-20-codex-to-claude/04-NEXT-TASK-DEPLOY-PIPELINE-FIX.md`
6. `docs/handoffs/2026-07-20-codex-to-claude/05-TEST-EVIDENCE.md`
7. `docs/handoffs/2026-07-20-codex-to-claude/06-CHANGED-FILES.md`
8. `docs/handoffs/2026-07-20-codex-to-claude/07-SECURITY-AND-REMOTE-RESTRICTIONS.md`

Then inspect the real repository and Git state before editing; distrust the handoff if files contradict it. Load your available skills, use TDD for any concrete local fix, and continue only the local closure/review of DEPLOY-PIPELINE-FIX. Use PostgreSQL 16 disposable databases only. Do not connect to Supabase or Netlify, do not deploy, do not create Auth accounts, do not run remote DDL/migrations/imports/TRUNCATE, do not use Graphify, do not commit, and do not modify `main`.

Useful Git Bash commands:

```bash
git status --short
git branch --show-current
git rev-parse HEAD
git diff --check
node --check src/db/migrate-to-supabase.js
node --check src/db/validate-supabase.js
node --check src/db/record-supabase-validation.js
npm run contracts:test
npm run holidays:test
npm run working-hours:test
npm run db:pg:build
cd apps/nexus-bi-app
npm test
npm run typecheck
npm run build
```

Do not rerun destructive local teardown or long suites unless necessary and explicitly documented. Preserve the existing dirty tree. Produce the maximum permitted local result:

```text
LOCAL_DEPLOYMENT_PIPELINE_CERTIFIED
REMOTE_EXECUTION_PENDING_AUTHORIZATION
```
