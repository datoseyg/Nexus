# Security and remote restrictions

The following are not authorized: remote Supabase connection or inspection, project creation, remote DDL, migration, `TRUNCATE`, imports, Auth users or claims, Netlify connection/variables/deploy/preview, merge to `main`, production, rollback, credential rotation/deletion or any remote data mutation.

Never read or show `.env`, local env backups or credential values. Never version credentials. Never use `service_role` in Netlify. Never use `SUPABASE_DB_URL_DIRECT` as runtime configuration. Never print a URL containing a password. The local `.env.development.local.previous` backup was preserved because this handoff explicitly forbids discarded files; do not inspect it or delete it without explicit approval.

Only the official disposable bootstrap may seed `DISPOSABLE_TEST`. Every fixture suite must require a disposable URL and matching `RUN_ID`. Keep `NEXUS_SHOW_AUDIT=false` and `NEXUS_SHOW_EXPLORER=false` for the first release. Transaction pooler is runtime-only; direct/session pooler is administrative. No remote operation is implied by a green local test.
