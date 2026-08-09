# Test evidence

| Command/evidence | Executed | Result | Skips | Environment |
|---|---:|---|---:|---|
| `npm run db:pg:build` twice | yes | PASS; 27 synchronized / 13 external / 0 errors; `PASSED` both times | 0 | PostgreSQL 16 local pipeline disposable |
| `npm run db:pg:record-validation` | yes | PASS; run `6009228a-f873-4acb-9ad4-fb16de25a441`, provenance matched | 0 | same disposable DB |
| root contracts/holidays/working-hours integrations | yes | PASS; isolated databases; no suite skips | 0 | PostgreSQL 16 local disposable |
| ownership integration | yes | PASS; 13 tests in the isolated ownership run | 0 | PostgreSQL 16 local disposable |
| app `npm test` | yes | PASS; prior known count 293; a later emergency rerun was interrupted before its summary | NOT_RUN for final rerun | local/mock + app disposable |
| app `npm run test:integration` twice | yes | PASS; 42 each run | 0 | isolated app disposable DB |
| app `npm run typecheck` | yes | PASS | 0 | local/mock |
| app `npm run build` | yes | PASS; Next 16.2.10, 36 routes, Proxy active | 0 | local/mock |
| app `npm run smoke` via `next start` | yes | PASS 5/5; login 200, redirects 307, APIs 401 | 0 | local/mock public Supabase values |
| focused ownership/validator/safety/runner tests | yes | PASS; 69 pass, 0 fail, 2 integration skips when env intentionally absent | 2 | local unit context |
| `git diff --check` | yes | PASS; only line-ending warnings | 0 | local Git |
| `npm audit --omit=dev` | no | NOT_RUN | — | — |
| real Supabase / Netlify | no | NOT_RUN by policy | — | remote prohibited |

Do not present `SKIPPED_NO_DISPOSABLE_POSTGRES` as approval. Integration runners now abort when URL or `RUN_ID` is missing.
