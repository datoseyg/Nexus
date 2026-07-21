-- Schema audit: logueo de corridas del pipeline, hallazgos de calidad de
-- dato, y estado de sincronización DuckDB -> Postgres. Tablas transaccionales
-- (CRUD vía app/api/admin/audit/**) -nunca tocadas por
-- src/db/migrate-to-supabase.js.

CREATE TABLE IF NOT EXISTS audit.pipeline_runs (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  stage text NOT NULL,
  status text NOT NULL CHECK (status IN ('STARTED','SUCCESS','FAILED')),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  rows_affected integer,
  error_message text,
  metadata jsonb,
  CONSTRAINT pipeline_runs_run_id_key UNIQUE (run_id)
);

CREATE TABLE IF NOT EXISTS audit.data_quality_events (
  id bigserial PRIMARY KEY,
  run_id uuid REFERENCES audit.pipeline_runs(run_id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  issue_type text NOT NULL,
  severity text NOT NULL DEFAULT 'WARNING' CHECK (severity IN ('INFO','WARNING','ERROR')),
  details jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved boolean NOT NULL DEFAULT false,
  resolved_at timestamptz
);

-- Registra el estado de la última sincronización DuckDB -> Postgres.
-- src/db/migrate-to-supabase.js inserta una fila al terminar
-- (validation_status='PENDING'); src/db/validate-supabase.js, que corre
-- inmediatamente después dentro de `db:pg:build`, hace UPDATE de esa misma
-- fila (por run_id) con el resultado real de sus 4 chequeos.
CREATE TABLE IF NOT EXISTS audit.warehouse_sync_state (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL DEFAULT gen_random_uuid(),
  synced_at timestamptz NOT NULL DEFAULT now(),
  tables_migrated integer NOT NULL DEFAULT 0,
  tables_skipped integer NOT NULL DEFAULT 0,
  tables_failed integer NOT NULL DEFAULT 0,
  validation_status text NOT NULL DEFAULT 'PENDING' CHECK (validation_status IN ('PENDING','PASSED','FAILED')),
  validation_summary jsonb,
  duckdb_source_path text,
  triggered_by text
);
