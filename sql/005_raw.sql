-- Espejo mínimo de data/raw/<plataforma>/*.json. Carga opcional y apagada
-- por default (LOAD_RAW=false en src/db/migrate-to-supabase.js) — ver
-- hallazgo de presupuesto de espacio (106MB de JSON) en el plan de migración.
-- No hay generador propio por plataforma más allá de este espejo simple:
-- el payload completo de cada respuesta de API queda en `payload` (jsonb).

CREATE TABLE IF NOT EXISTS raw.zendesk_tickets_raw (
  id bigserial PRIMARY KEY,
  source_file text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.fieldbeat_tasks_raw (
  id bigserial PRIMARY KEY,
  source_file text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS raw.dolibarr_products_raw (
  id bigserial PRIMARY KEY,
  source_file text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL
);
